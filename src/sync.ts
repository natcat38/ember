import type { State } from "../core/task";
import { MAX_OPS, type Change, type Entity, type Op, type SyncResponse } from "../worker/protocol";

// Client side of POST /api/sync (Tech_Scope.md §5). The app never builds ops by hand: every state change is diffed
// against the last state the sync layer has seen, field by field, and each changed row becomes one op in the outbox.

type Row = Record<string, unknown>;

// What syncs, per entity. Mirrors worker/schema.ts; anything not listed (draft, focus, last_seen_at) stays on this
// device. Settings are one object on the device and one row ('me') on the server.
const FIELDS: Record<Entity, string[]> = {
  tasks: ["title", "state", "size", "quick", "holding_up", "deadline", "runway_start", "pinned_on", "snoozed_until", "done_at", "created_at", "updated_at"],
  chunks: ["task_id", "parent_id", "title", "position", "state", "deleted", "done_at", "updated_at"],
  sessions: ["chunk_id", "started_at", "ended_at", "completed"],
  days: ["confirmed_at", "shutdown_at", "deferred"],
  hard_blocks: ["weekdays", "start_min", "end_min", "label", "deleted", "updated_at"],
  settings: ["tz", "quiet_start", "quiet_end", "timer_mode", "unlock", "journal_key"],
  // Ciphertext only: the line is sealed in src/journal.ts before it reaches the state, so nothing here is readable.
  journal: ["iv", "text", "mood", "updated_at"],
};
// Upload order matters for the server's rules: a task before its steps, a parent step before its smaller steps.
const ORDER: Entity[] = ["tasks", "chunks", "sessions", "days", "hard_blocks", "settings", "journal"];
const keyOf = (e: Entity) => (e === "days" || e === "journal" ? "day" : "id");

const rows = (s: State, e: Entity): Row[] => (e === "settings" ? [{ id: "me", ...s.settings }] : (s[e] as unknown as Row[]));
const byKey = (s: State, e: Entity) => new Map(rows(s, e).map((r) => [String(r[keyOf(e)]), r]));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const pick = (e: Entity, r: Row) => Object.fromEntries(FIELDS[e].map((f) => [f, r[f] ?? null]));

const uuid = () => crypto.randomUUID();

// New rows become complete ops; changed rows send only the changed fields.
export function diff(prev: State, next: State, newId: () => string = uuid): Op[] {
  const ops: Op[] = [];
  for (const e of ORDER) {
    const before = byKey(prev, e);
    for (const r of rows(next, e)) {
      const id = String(r[keyOf(e)]);
      const old = before.get(id);
      if (old === r) continue;
      const fields = old ? Object.fromEntries(FIELDS[e].filter((f) => !same(old[f], r[f])).map((f) => [f, r[f] ?? null])) : pick(e, r);
      if (Object.keys(fields).length) ops.push({ op_id: newId(), entity: e, id, fields });
    }
  }
  return ops;
}

// The first sync uploads everything this device has (phase-1 data included), in an order the server's rules accept.
export function allOps(s: State, newId: () => string = uuid): Op[] {
  const parentsFirst = { ...s, chunks: [...s.chunks].sort((a, b) => Number(!!a.parent_id) - Number(!!b.parent_id)) };
  const nothing = { ...s, tasks: [], chunks: [], sessions: [], days: [], hard_blocks: [], journal: [] };
  const ops = diff(nothing, parentsFirst, newId);
  // Settings always exist on the device, so a diff never sees them as new; the first upload sends them whole.
  return [...ops, { op_id: newId(), entity: "settings", id: "me", fields: pick("settings", { ...s.settings }) }];
}

// Merge server rows in. A field with a local edit still waiting in the outbox keeps the local value: that edit
// reaches the server later and wins there too (per-field last write wins, in arrival order).
export function applyChanges(s: State, changes: Change[], pending: Op[]): State {
  if (!changes.length) return s;
  const waiting = new Set(pending.flatMap((o) => Object.keys(o.fields).map((f) => `${o.entity}:${o.id}:${f}`)));
  const next = { ...s } as Record<Exclude<Entity, "settings">, Row[]> & State;
  for (const e of ORDER) {
    const incoming = changes.filter((c) => c.entity === e);
    if (!incoming.length) continue;
    const list = [...rows(s, e)];
    const at = new Map(list.map((r, i) => [String(r[keyOf(e)]), i]));
    for (const { row } of incoming) {
      const id = String(row[keyOf(e)]);
      const i = at.get(id);
      const server = { [keyOf(e)]: id, ...pick(e, row) };
      if (i === undefined) {
        at.set(id, list.push(server) - 1);
        continue;
      }
      const merged = { ...list[i] };
      for (const f of FIELDS[e]) if (!waiting.has(`${e}:${id}:${f}`)) merged[f] = server[f];
      if (FIELDS[e].some((f) => !same(merged[f], list[i][f]))) list[i] = merged;
    }
    if (e === "settings") {
      // Rebuilt from the synced field list, so the row's `id` never lands in the state.
      next.settings = Object.fromEntries(FIELDS.settings.map((f) => [f, list[0][f]])) as unknown as State["settings"];
    } else next[e] = list as never;
  }
  return next;
}

// ---------------------------------------------------------------------------------------------------------------
// The engine: one request in flight at a time (so the first sync can't create two users), the outbox kept in
// localStorage so a closed tab loses nothing, and a push about 2 seconds after the last change (§5 "When").

const META_KEY = "ember.sync";

interface Meta {
  cursor: number;
  outbox: Op[];
  uploaded: boolean; // the first full upload has gone through
  seeded: boolean; // the first upload's ops are in the outbox (made once, after asking the server what it already has)
}

export interface SyncStatus {
  backedUp: boolean; // at least one sync has succeeded
  pending: number;
  offline: boolean; // the last attempt couldn't reach the server (a server error is not "offline")
}

interface Deps {
  update: (fn: (s: State) => State) => void;
  storage?: Pick<Storage, "getItem" | "setItem">;
  fetch?: typeof fetch;
  onStatus?: (s: SyncStatus) => void;
  onRejected?: () => void; // the server refused a change after a two-device race; the server's version now shows
}

export function createSync(initial: State, { update, storage = localStorage, fetch: send = fetch.bind(globalThis), onStatus, onRejected }: Deps) {
  let baseline = initial; // the last state the sync layer has turned into ops
  let busy = false;
  let again = false;
  let timer = 0;
  let batchSize = MAX_OPS;
  let offline = false;

  // The newest meta that did not fit in storage (a full device), with what storage held when it was parked. Reads
  // return it while storage is unchanged, so no op is lost; if another tab wrote since, its ops merge with ours.
  let held: { meta: Meta; raw: string | null } | null = null;
  const readMeta = (): Meta => {
    let raw: string | null = null;
    let stored: Meta = { cursor: 0, outbox: [], uploaded: false, seeded: false };
    try {
      raw = storage.getItem(META_KEY);
      stored = { ...stored, ...JSON.parse(raw ?? "{}") };
    } catch {
      // unreadable: start from nothing
    }
    if (!held) return stored;
    if (raw === held.raw) return held.meta;
    const have = new Set(stored.outbox.map((o) => o.op_id));
    return { ...stored, outbox: [...stored.outbox, ...held.meta.outbox.filter((o) => !have.has(o.op_id))] };
  };
  const writeMeta = (m: Meta) => {
    try {
      storage.setItem(META_KEY, JSON.stringify(m));
      held = null;
    } catch {
      // A full device: the outbox stays in memory for this session and the state itself is still saved by the app.
      let raw: string | null = null;
      try {
        raw = storage.getItem(META_KEY);
      } catch {
        // nothing to compare against
      }
      held = { meta: m, raw };
    }
  };
  let meta = readMeta();
  const status = () => onStatus?.({ backedUp: meta.uploaded, pending: meta.outbox.length, offline });

  function record(next: State) {
    const ops = diff(baseline, next);
    baseline = next;
    if (!ops.length) return;
    const now = readMeta();
    meta = { ...now, outbox: [...now.outbox, ...ops] };
    writeMeta(meta);
    status();
    clearTimeout(timer);
    timer = setTimeout(push, 2000) as unknown as number;
  }

  // Another tab saved: its ops are its own to send; take its state as already recorded here.
  function rebase(next: State) {
    baseline = next;
    meta = readMeta();
  }

  // A device that has not uploaded yet first asks the server what it holds (a sign-in or Telegram link joins an existing
  // list; a fresh device with no cookie gets an empty answer), merges that in, and queues only what the server lacks,
  // ahead of any edits already waiting. The queue is saved before anything is sent, so a failed or partial upload
  // resumes where it stopped instead of vanishing (Improvement_Audit.md #1-#3).
  async function firstPull() {
    const res = await send("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ cursor: 0, ops: [] }),
    });
    if (!res.ok) throw new Error(`sync ${res.status}`);
    const body = (await res.json()) as SyncResponse;
    const queued = readMeta().outbox;
    const had = new Set(body.changes.map((c) => `${c.entity}:${String(c.row[keyOf(c.entity)])}`));
    const theirKey = body.changes.find((c) => c.entity === "settings")?.row.journal_key ?? null;
    const myKey = baseline.settings.journal_key;
    // The server's settings stay as they are; only a journal key it lacks is filled in from this device.
    const upload = allOps(baseline)
      .map((o) => (o.entity === "settings" && had.has("settings:me") ? (theirKey === null && myKey ? { ...o, fields: { journal_key: myKey } } : null) : o))
      .filter((o): o is Op => !!o && (o.entity === "settings" || !had.has(`${o.entity}:${o.id}`)));
    if (body.changes.length) {
      baseline = applyChanges(baseline, body.changes, queued);
      update((s) => applyChanges(s, body.changes, queued));
    }
    meta = { cursor: body.cursor, outbox: [...upload, ...queued], uploaded: false, seeded: true };
    writeMeta(meta);
  }

  async function push() {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      meta = readMeta();
      if (!meta.seeded && !meta.uploaded) await firstPull(); // a device synced before `seeded` existed has uploaded already
      let refetch = false;
      let raced = false;
      do {
        refetch = false;
        const batch = meta.outbox.slice(0, batchSize);
        const res = await send("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ cursor: meta.cursor, ops: batch }),
        });
        if (res.status === 413) {
          if (batchSize === 1) throw new Error("A single change is too large to sync");
          batchSize = Math.max(1, Math.floor(batchSize / 2));
          continue;
        }
        const sent = new Set(batch.map((o) => o.op_id));
        if (res.status === 400) {
          // The server refuses a whole body for one malformed op. Retrying it would wedge the outbox forever, but the
          // rest of the batch is valid: halve until a single op is refused, then drop only that one and say so.
          if (batch.length > 1) {
            batchSize = Math.max(1, Math.floor(batch.length / 2));
            continue;
          }
          console.error("Ember sync: the server refused a malformed change; dropping it", batch[0], await res.text());
          const now = readMeta();
          meta = { ...now, outbox: now.outbox.filter((o) => !sent.has(o.op_id)) };
          writeMeta(meta);
          batchSize = MAX_OPS;
          continue;
        }
        if (res.status === 503 && !raced) {
          // Another of this user's requests won a race on the server, and nothing of ours was applied (worker/sync.ts,
          // the rev guard). Send the same ops again once, after the wait it asks for; the ledger makes a resend safe.
          raced = true;
          await new Promise((r) => setTimeout(r, Number(res.headers.get("Retry-After") ?? 1) * 1000));
          continue;
        }
        if (!res.ok) throw new Error(`sync ${res.status}`);
        const body = (await res.json()) as SyncResponse;
        if (body.created && (meta.uploaded || meta.cursor > 0)) {
          // This device had a server list and the server just made a new, empty user: the cookie was lost or the user
          // deleted. Start over; the pull-first path uploads everything this device has to the new user.
          restart();
          offline = false;
          again = true;
          return;
        }
        const remaining = readMeta().outbox.filter((o) => !sent.has(o.op_id));
        // A refused op changed nothing on the server, so its row isn't in `changes`. Pull everything once more: the
        // server's version then replaces the local change wherever no other edit is still waiting (Tech_Scope.md §5).
        refetch = body.rejected.length > 0;
        if (refetch) {
          console.warn("Ember sync: changes refused by the server", body.rejected);
          onRejected?.();
        }
        meta = { cursor: refetch ? 0 : body.cursor, outbox: remaining, uploaded: true, seeded: true };
        writeMeta(meta);
        if (body.changes.length) {
          // The baseline takes the same merge, so server rows are never echoed back as new ops.
          baseline = applyChanges(baseline, body.changes, remaining);
          update((s) => applyChanges(s, body.changes, remaining));
        }
      } while (meta.outbox.length || refetch);
      offline = false;
    } catch (e) {
      // fetch rejects (TypeError) only when the network is unreachable; an HTTP error means the server answered.
      offline = e instanceof TypeError; // either way the outbox is intact; the next open, focus, reconnect, or change retries
      console.warn("Ember sync: will retry", e);
    } finally {
      busy = false;
      status();
      if (again) {
        again = false;
        void push();
      }
    }
  }

  // This browser just joined another identity (a Telegram sign-in link): start over, so what's on the device uploads
  // to that user and everything of theirs comes down.
  function restart() {
    meta = { cursor: 0, outbox: [], uploaded: false, seeded: false };
    writeMeta(meta);
  }

  return { record, rebase, push, restart };
}
