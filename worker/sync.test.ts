import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "./index";
import { MAX_OPS, type Op, type SyncResponse } from "./protocol";
import { commit, lookup, planOps, sync as syncDb, SyncConflict } from "./sync";
import { emptyState } from "../core/task";
import { decryptLine, encryptLine, ensureKey } from "../src/journal";

const URL_SYNC = "https://ember.test/api/sync";
const uuid = () => crypto.randomUUID();

const task = (id: string, fields: Record<string, unknown> = {}): Op => ({
  op_id: uuid(),
  entity: "tasks",
  id,
  fields: { title: "Write cover letter", state: "inbox", ...fields },
});
const patch = (id: string, fields: Record<string, unknown>): Op => ({ op_id: uuid(), entity: "tasks", id, fields });

// Shapes the server checks: a 12-byte iv and a ciphertext as base64url, a 256-bit key as 43 characters of it.
const IV = "AAAAAAAAAAAAAAAA";
const CIPHERTEXT = "q".repeat(30);
const KEY = "k".repeat(43);
const journalOp = (day: string, fields: Record<string, unknown> = {}): Op => ({ op_id: uuid(), entity: "journal", id: day, fields: { iv: IV, text: CIPHERTEXT, mood: null, updated_at: 1, ...fields } });

function request(body: unknown, cookie?: string): Request {
  return new Request(URL_SYNC, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

interface Reply {
  res: Response;
  body: SyncResponse;
  /** `ember_uid=<id>` as the browser would send it back, or undefined when no cookie was set. */
  cookie?: string;
}

async function read(res: Response): Promise<Reply> {
  const setCookie = res.headers.get("Set-Cookie");
  return { res, body: (await res.json()) as SyncResponse, cookie: setCookie?.split(";")[0] };
}

async function sync(body: unknown, cookie?: string): Promise<Reply> {
  return read(await exports.default.fetch(request(body, cookie)));
}

// A fresh anonymous user, so each test owns its data.
async function newUser(): Promise<string> {
  const { cookie } = await sync({ cursor: 0, ops: [] });
  return cookie!;
}

const uidOf = (cookie: string) => cookie.split("=")[1];
const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())!.n;
const userRev = async (cookie: string) => (await env.DB.prepare("SELECT rev FROM users WHERE id = ?").bind(uidOf(cookie)).first<{ rev: number }>())!.rev;
// The ledger also holds one '#rev:<n>' guard row per write request (see commit in sync.ts); client ops are the rest.
const NOT_GUARD = "op_id NOT LIKE '#rev:%'";
const taskRow = (id: string) =>env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<Record<string, unknown>>();

describe("idempotency", () => {
  it("applies the same op sent twice once", async () => {
    const cookie = await newUser();
    const id = uuid();
    const op = task(id);

    const first = await sync({ cursor: 0, ops: [op] }, cookie);
    expect(first.res.status).toBe(200);
    expect(await userRev(cookie)).toBe(1);

    // A retry after a lost response carries the same op_id, and even different fields: the ledger wins.
    const second = await sync({ cursor: 0, ops: [{ ...op, fields: { ...op.fields, title: "Changed by a replay" } }] }, cookie);
    expect(second.res.status).toBe(200);
    expect(second.body.rejected).toEqual([]);
    expect(await userRev(cookie)).toBe(1);
    expect(await count(`SELECT COUNT(*) AS n FROM ops WHERE user_id = ? AND ${NOT_GUARD}`, uidOf(cookie))).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM tasks WHERE id = ?", id)).toBe(1);
    expect((await taskRow(id))!.title).toBe("Write cover letter");
    // The replay still gets the current rows back, so the client can finish the sync it thinks it lost.
    expect(second.body.changes.map((c) => c.row.id)).toEqual([id]);
  });

  it("counts an op_id repeated inside one body once", async () => {
    const cookie = await newUser();
    const op = task(uuid());
    await sync({ cursor: 0, ops: [op, op] }, cookie);
    expect(await userRev(cookie)).toBe(1);
  });

  it("leaves exactly one effect when two requests carry the same op at once", async () => {
    const cookie = await newUser();
    const id = uuid();
    const op = task(id);
    const body = { cursor: 0, ops: [op] };

    // If the two interleave, the loser is told to retry (503); either way the op lands once.
    const [a, b] = await Promise.all([sync(body, cookie), sync(body, cookie)]);
    expect([a.res.status, b.res.status].every((s) => s === 200 || s === 503)).toBe(true);
    expect([a.res.status, b.res.status]).toContain(200);
    expect(await userRev(cookie)).toBe(1);
    expect(await count(`SELECT COUNT(*) AS n FROM ops WHERE user_id = ? AND ${NOT_GUARD}`, uidOf(cookie))).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM tasks WHERE id = ?", id)).toBe(1);
  });

  it("answers 503 and Retry-After when a rival request lands between our check and our batch", async () => {
    // Promise.all above may or may not interleave. This forces it: just before our batch, a full rival request carrying
    // the same op runs to completion, so our batch hits the rev guard row's primary key and rolls back whole.
    const cookie = await newUser();
    const id = uuid();
    const op = task(id);
    const body = { cursor: 0, ops: [op] };

    const sqlOf = new Map<D1PreparedStatement, string>();
    let rivalRan = false;
    let collisions = 0;
    const db = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare") {
          return (q: string) => {
            // sync.ts always binds straight after preparing, and db.batch() receives the bound statements.
            return {
              bind: (...args: unknown[]) => {
                const bound = target.prepare(q).bind(...args);
                sqlOf.set(bound, q);
                return bound;
              },
            };
          };
        }
        if (prop === "batch") {
          return async (stmts: D1PreparedStatement[]) => {
            const writesLedger = stmts.some((s) => sqlOf.get(s)?.startsWith("INSERT INTO ops"));
            if (writesLedger && !rivalRan) {
              rivalRan = true;
              await exports.default.fetch(request(body, cookie));
            }
            try {
              return await target.batch(stmts);
            } catch (e) {
              if (writesLedger) collisions++;
              throw e;
            }
          };
        }
        return Reflect.get(target, prop);
      },
    });

    const res = await worker.fetch(request(body, cookie) as Parameters<typeof worker.fetch>[0], { ...env, DB: db });
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("1");
    expect(await res.json()).toMatchObject({ error: "conflict" });
    expect(res.headers.get("Set-Cookie")).toContain("ember_uid="); // the identity is still confirmed, so a retry stays this user
    expect(rivalRan).toBe(true);
    expect(collisions).toBe(1); // our one commit collided and rolled back whole; the Worker did not run a second pass
    expect(await userRev(cookie)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM tasks WHERE id = ?", id)).toBe(1);

    // The client's retry carries the same op_id: the ledger has it, so it is not applied twice, and it gets the rows back.
    const retry = await sync(body, cookie);
    expect(retry.res.status).toBe(200);
    expect(retry.body.rejected).toEqual([]);
    expect(retry.body.changes).toHaveLength(1);
    expect(await userRev(cookie)).toBe(1);
  });

  it("keeps op ids separate per user", async () => {
    const [a, b] = [await newUser(), await newUser()];
    const opId = uuid();
    const mk = (title: string): Op => ({ op_id: opId, entity: "tasks", id: uuid(), fields: { title, state: "inbox" } });
    await sync({ cursor: 0, ops: [mk("A")] }, a);
    await sync({ cursor: 0, ops: [mk("B")] }, b);
    expect(await userRev(a)).toBe(1);
    expect(await userRev(b)).toBe(1);
  });
});

describe("pull and cursor", () => {
  it("returns only rows newer than the cursor, and the cursor advances", async () => {
    const cookie = await newUser();
    const [t1, t2] = [uuid(), uuid()];

    const first = await sync({ cursor: 0, ops: [task(t1)] }, cookie);
    expect(first.body.cursor).toBe(1);

    const second = await sync({ cursor: first.body.cursor, ops: [task(t2, { title: "Second" })] }, cookie);
    expect(second.body.cursor).toBe(2);
    expect(second.body.changes.map((c) => c.row.id)).toEqual([t2]);

    const idle = await sync({ cursor: second.body.cursor, ops: [] }, cookie);
    expect(idle.body.cursor).toBe(2);
    expect(idle.body.changes).toEqual([]);

    const restore = await sync({ cursor: 0, ops: [] }, cookie);
    expect(restore.body.changes.map((c) => c.row.id)).toEqual([t1, t2]);
  });

  it("covers every synced entity, in the client's shape, oldest change first", async () => {
    const cookie = await newUser();
    const [t, c, s, h] = [uuid(), uuid(), uuid(), uuid()];
    const ops: Op[] = [
      task(t, { quick: true, size: "XS", deadline: "2026-10-09" }),
      { op_id: uuid(), entity: "chunks", id: c, fields: { task_id: t, parent_id: null, title: "Draft", position: 1.5, state: "todo", deleted: false } },
      { op_id: uuid(), entity: "sessions", id: s, fields: { chunk_id: c, started_at: 1000, ended_at: 2000, completed: true } },
      { op_id: uuid(), entity: "days", id: "2026-10-05", fields: { confirmed_at: 5, deferred: [c] } },
      { op_id: uuid(), entity: "hard_blocks", id: h, fields: { weekdays: [0, 2], start_min: 540, end_min: 720, label: "Classes" } },
      { op_id: uuid(), entity: "settings", id: "me", fields: { tz: "Europe/London", quiet_start: 1380, quiet_end: 420 } },
      { op_id: uuid(), entity: "journal", id: "2026-10-05", fields: { iv: IV, text: CIPHERTEXT, mood: 4, updated_at: 7 } },
    ];
    const { body } = await sync({ cursor: 0, ops }, cookie);

    // Seven tables: the pull runs as two statements (D1's 5-term cap) and the rows are still oldest change first.
    expect(body.changes.map((x) => x.entity)).toEqual(["tasks", "chunks", "sessions", "days", "hard_blocks", "settings", "journal"]);
    expect(body.changes.map((x) => x.row.rev)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(body.cursor).toBe(7);
    const [tr, cr, sr, dr, hr, st, jr] = body.changes.map((x) => x.row);
    expect(st).toEqual({ id: "me", tz: "Europe/London", quiet_start: 1380, quiet_end: 420, timer_mode: "pomodoro", unlock: "rotate", journal_key: null, rev: 6 });
    expect(jr).toEqual({ day: "2026-10-05", iv: IV, text: CIPHERTEXT, mood: 4, updated_at: 7, rev: 7 });
    expect(tr).toMatchObject({ id: t, title: "Write cover letter", quick: true, holding_up: false, size: "XS", deadline: "2026-10-09", pinned_on: null });
    expect(tr).not.toHaveProperty("user_id");
    expect(cr).toMatchObject({ id: c, task_id: t, parent_id: null, position: 1.5, deleted: false });
    expect(sr).toMatchObject({ id: s, chunk_id: c, completed: true });
    expect(dr).toMatchObject({ day: "2026-10-05", confirmed_at: 5, shutdown_at: null, deferred: [c] });
    expect(hr).toMatchObject({ id: h, weekdays: [0, 2], start_min: 540, end_min: 720, label: "Classes", deleted: false });
  });

  it("never returns another user's rows", async () => {
    const [a, b] = [await newUser(), await newUser()];
    await sync({ cursor: 0, ops: [task(uuid())] }, a);
    expect((await sync({ cursor: 0, ops: [] }, b)).body.changes).toEqual([]);
  });
});

describe("per-field last write wins", () => {
  it("lands two different fields patched by two ops", async () => {
    const cookie = await newUser();
    const id = uuid();
    await sync({ cursor: 0, ops: [task(id, { size: "M" })] }, cookie);

    // Two devices, both offline: one renames, one marks active. Both fields survive, and untouched fields stay.
    await sync({ cursor: 0, ops: [patch(id, { title: "Renamed" })] }, cookie);
    await sync({ cursor: 0, ops: [patch(id, { state: "active" })] }, cookie);

    expect(await taskRow(id)).toMatchObject({ title: "Renamed", state: "active", size: "M" });
  });

  it("ends with the later value when the same field is patched twice", async () => {
    const cookie = await newUser();
    const id = uuid();
    await sync({ cursor: 0, ops: [task(id)] }, cookie);

    await sync({ cursor: 0, ops: [patch(id, { title: "first" })] }, cookie);
    await sync({ cursor: 0, ops: [patch(id, { title: "second" })] }, cookie);
    expect((await taskRow(id))!.title).toBe("second");

    // Within one request, arrival order is array order.
    await sync({ cursor: 0, ops: [patch(id, { title: "third" }), patch(id, { title: "fourth" })] }, cookie);
    expect((await taskRow(id))!.title).toBe("fourth");
  });

  it("creates then patches in one request, and each write takes its own rev", async () => {
    const cookie = await newUser();
    const id = uuid();
    const { body } = await sync({ cursor: 0, ops: [task(id), patch(id, { state: "active" })] }, cookie);
    expect(await userRev(cookie)).toBe(2);
    expect(body.changes).toHaveLength(1); // one row, at its latest rev
    expect(body.changes[0].row).toMatchObject({ id, state: "active", rev: 2 });
  });

  it("refuses to create a row from a patch that lacks required fields, and does not record the op", async () => {
    const cookie = await newUser();
    const op = patch(uuid(), { state: "active" });
    const { body } = await sync({ cursor: 0, ops: [op] }, cookie);
    expect(body.rejected).toEqual([{ op_id: op.op_id, reason: "incomplete_create" }]);
    expect(body.changes).toEqual([]);
    expect(await userRev(cookie)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM ops WHERE user_id = ?", uidOf(cookie))).toBe(0);
  });

  it("cannot overwrite another user's row by reusing its id", async () => {
    const [a, b] = [await newUser(), await newUser()];
    const id = uuid();
    await sync({ cursor: 0, ops: [task(id, { title: "Mine" })] }, a);
    const [create, edit] = [task(id, { title: "Hijacked" }), patch(id, { state: "done" })];
    const { res, body } = await sync({ cursor: 0, ops: [create, edit] }, b);
    // Not a silent skip: both ops come back refused (reasons are covered in rules.test.ts), and b's rev stays 0.
    expect(res.status).toBe(200);
    expect(body.rejected).toEqual([
      { op_id: create.op_id, reason: "foreign_id" },
      { op_id: edit.op_id, reason: "foreign_id" },
    ]);
    expect(await userRev(b)).toBe(0);
    expect(await taskRow(id)).toMatchObject({ title: "Mine", state: "inbox" });
  });
});

describe("a stale read", () => {
  // lookup reads in one batch and commit writes in a later one, so two requests can both judge their ops against the
  // same old state. The rev guard row makes the second commit fail instead of applying a check that no longer holds.
  async function seeded() {
    const cookie = await newUser();
    const id = uuid();
    await sync({ cursor: 0, ops: [task(id, { state: "active" })] }, cookie);
    return { cookie, uid: uidOf(cookie), id };
  }

  it("fails the first request's commit, and changes nothing, when a second request committed in between", async () => {
    const { cookie, uid, id } = await seeded();
    const stale = [patch(id, { state: "overdue" })]; // legal from active
    const { applied, rows, rev } = await lookup(env.DB, uid, stale);
    const { plan, rejected } = planOps(stale, applied, rows);
    expect(rejected).toEqual([]);

    // Another device moves the task to done first. From done, overdue is illegal, so the stale check no longer holds.
    expect((await sync({ cursor: 0, ops: [patch(id, { state: "done" })] }, cookie)).body.rejected).toEqual([]);
    const revAfterRival = await userRev(cookie);

    await expect(commit(env.DB, uid, plan, 0, Date.now(), rev)).rejects.toBeInstanceOf(SyncConflict);
    expect(await taskRow(id)).toMatchObject({ state: "done" });
    expect(await userRev(cookie)).toBe(revAfterRival);
    expect(await count("SELECT COUNT(*) AS n FROM ops WHERE op_id = ?", stale[0].op_id)).toBe(0);

    // A fresh request reads the new state and rejects the op by the rules, as it should.
    const retry = await sync({ cursor: 0, ops: stale }, cookie);
    expect(retry.res.status).toBe(200);
    expect(retry.body.rejected).toEqual([{ op_id: stale[0].op_id, reason: "illegal_transition" }]);
  });

  it("commits when nothing has landed since the read, and writes one guard row per write request", async () => {
    const { cookie, uid, id } = await seeded();
    const ops = [patch(id, { state: "overdue" })];
    const { applied, rows, rev } = await lookup(env.DB, uid, ops);
    const { plan } = planOps(ops, applied, rows);
    await commit(env.DB, uid, plan, 0, Date.now(), rev);
    expect(await taskRow(id)).toMatchObject({ state: "overdue" });
    expect(await count("SELECT COUNT(*) AS n FROM ops WHERE user_id = ? AND op_id = ?", uid, `#rev:${rev}`)).toBe(1);

    // A request that writes nothing (no ops, or every op refused) takes no guard and never conflicts.
    const before = await count("SELECT COUNT(*) AS n FROM ops WHERE user_id = ?", uid);
    expect((await sync({ cursor: 0, ops: [] }, cookie)).res.status).toBe(200);
    expect((await sync({ cursor: 0, ops: [patch(uuid(), { state: "active" })] }, cookie)).res.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM ops WHERE user_id = ?", uid)).toBe(before);
  });
});

describe("settings", () => {
  it("is one row per user: two devices' patches merge per field, and another user is untouched", async () => {
    const [a, b] = [await newUser(), await newUser()];
    await sync({ cursor: 0, ops: [{ op_id: uuid(), entity: "settings", id: "me", fields: { quiet_end: 420 } }] }, a); // patch before any create
    await sync({ cursor: 0, ops: [{ op_id: uuid(), entity: "settings", id: "me", fields: { tz: "Asia/Kolkata", quiet_start: 1380, quiet_end: 480 } }] }, a);
    await sync({ cursor: 0, ops: [{ op_id: uuid(), entity: "settings", id: "me", fields: { quiet_end: 360 } }] }, a);
    await sync({ cursor: 0, ops: [{ op_id: uuid(), entity: "settings", id: "me", fields: { tz: null, quiet_start: 1320, quiet_end: 480 } }] }, b);
    const rowOf = (c: string) => env.DB.prepare("SELECT tz, quiet_start, quiet_end FROM settings WHERE user_id = ?").bind(uidOf(c)).all();
    expect((await rowOf(a)).results).toEqual([{ tz: "Asia/Kolkata", quiet_start: 1380, quiet_end: 360 }]);
    expect((await rowOf(b)).results).toEqual([{ tz: null, quiet_start: 1320, quiet_end: 480 }]);
  });

  it("refuses an unknown time zone or an id other than 'me'", async () => {
    const cookie = await newUser();
    const bad = (fields: Record<string, unknown>, id = "me") => sync({ cursor: 0, ops: [{ op_id: uuid(), entity: "settings", id, fields }] }, cookie);
    expect((await bad({ tz: "Mars/Olympus" })).res.status).toBe(400);
    expect((await bad({ quiet_end: 420 }, "you")).res.status).toBe(400);
  });

  it("patches rows of all seven tables in one request", async () => {
    const cookie = await newUser();
    const [t, c, s, h] = [uuid(), uuid(), uuid(), uuid()];
    await sync({ cursor: 0, ops: [
      task(t),
      { op_id: uuid(), entity: "chunks", id: c, fields: { task_id: t, parent_id: null, title: "Draft", position: 1, state: "todo" } },
      { op_id: uuid(), entity: "sessions", id: s, fields: { chunk_id: c, started_at: 1, ended_at: 2 } },
      { op_id: uuid(), entity: "days", id: "2026-10-05", fields: { confirmed_at: 1 } },
      { op_id: uuid(), entity: "hard_blocks", id: h, fields: { weekdays: [1], start_min: 60, end_min: 120 } },
      { op_id: uuid(), entity: "settings", id: "me", fields: { quiet_end: 420 } },
      { op_id: uuid(), entity: "journal", id: "2026-10-05", fields: { iv: IV, text: CIPHERTEXT } },
    ] }, cookie);
    // Partial patches of every table: each needs its row found.
    const { res, body } = await sync({ cursor: 0, ops: [
      { op_id: uuid(), entity: "tasks", id: t, fields: { title: "Renamed" } },
      { op_id: uuid(), entity: "chunks", id: c, fields: { title: "Redrafted" } },
      { op_id: uuid(), entity: "sessions", id: s, fields: { completed: true } },
      { op_id: uuid(), entity: "days", id: "2026-10-05", fields: { shutdown_at: 9 } },
      { op_id: uuid(), entity: "hard_blocks", id: h, fields: { label: "Gym" } },
      { op_id: uuid(), entity: "settings", id: "me", fields: { quiet_start: 1260 } },
      { op_id: uuid(), entity: "journal", id: "2026-10-05", fields: { mood: 5 } },
    ] }, cookie);
    expect(res.status).toBe(200);
    expect(body.rejected).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM settings WHERE user_id = ? AND quiet_start = 1260 AND quiet_end = 420", uidOf(cookie))).toBe(1);
  });
});

describe("phase-3 settings", () => {
  const set = (cookie: string, fields: Record<string, unknown>) => sync({ cursor: 0, ops: [{ op_id: uuid(), entity: "settings", id: "me", fields }] }, cookie);
  const stored = (cookie: string) => env.DB.prepare("SELECT timer_mode, unlock, journal_key FROM settings WHERE user_id = ?").bind(uidOf(cookie)).first();

  it("start at their defaults, round-trip, and merge per field with the older three", async () => {
    const [a, b] = [await newUser(), await newUser()];
    await set(a, { quiet_end: 420 }); // a row created by a phase-2 style op: the new columns take their defaults
    expect(await stored(a)).toEqual({ timer_mode: "pomodoro", unlock: "rotate", journal_key: null });

    await set(a, { timer_mode: "flowtime", unlock: "puzzle", journal_key: KEY });
    await set(a, { unlock: "fact" });
    expect(await stored(a)).toEqual({ timer_mode: "flowtime", unlock: "fact", journal_key: KEY });
    expect(await stored(b)).toBeNull();

    const { body } = await sync({ cursor: 0, ops: [] }, a);
    expect(body.changes.find((c) => c.entity === "settings")!.row).toMatchObject({ id: "me", quiet_end: 420, timer_mode: "flowtime", unlock: "fact", journal_key: KEY });
  });

  it("refuses a timer mode or unlock kind it does not know, and a journal key that is not 256 bits", async () => {
    const cookie = await newUser();
    for (const fields of [{ timer_mode: "stopwatch" }, { timer_mode: null }, { unlock: "chess" }, { unlock: null }, { journal_key: "short" }, { journal_key: "k".repeat(44) }, { journal_key: `${"k".repeat(42)}=` }, { journal_key: 5 }]) {
      expect((await set(cookie, fields)).res.status, JSON.stringify(fields)).toBe(400);
    }
    expect(await stored(cookie)).toBeNull();
    expect((await set(cookie, { journal_key: null })).res.status).toBe(200);
  });
});

describe("journal", () => {
  const stored = (cookie: string, day: string) => env.DB.prepare("SELECT iv, text, mood, updated_at FROM journal WHERE user_id = ? AND day = ?").bind(uidOf(cookie), day).first<Record<string, unknown>>();

  it("syncs as ciphertext: the stored row never holds the plaintext, and another device decrypts it", async () => {
    const cookie = await newUser();
    const line = "Sent the application. Walked to the park after.";
    const key = ensureKey(emptyState()).settings.journal_key!;
    const { iv, text } = await encryptLine(key, line);
    const { res, body } = await sync({ cursor: 0, ops: [journalOp("2026-10-05", { iv, text, mood: 5 })] }, cookie);
    expect(res.status).toBe(200);
    expect(body.rejected).toEqual([]);

    // What D1 holds is the ciphertext, byte for byte what the device sent, and no column carries the line.
    const row = (await stored(cookie, "2026-10-05"))!;
    expect(row).toEqual({ iv, text, mood: 5, updated_at: 1 });
    expect(JSON.stringify(row)).not.toContain("application");
    expect(JSON.stringify(row)).not.toContain("park");

    // A second device with the same user (and the key, which travels in settings) reads it back.
    const pulled = (await sync({ cursor: 0, ops: [] }, cookie)).body.changes.find((c) => c.entity === "journal")!.row as { iv: string; text: string };
    expect(await decryptLine(key, pulled)).toBe(line);
    expect(await decryptLine(ensureKey(emptyState()).settings.journal_key, pulled)).toBeNull();
  });

  it("is one row per user and day: a patch changes the mood alone, and another user's same day is separate", async () => {
    const [a, b] = [await newUser(), await newUser()];
    await sync({ cursor: 0, ops: [journalOp("2026-10-05", { mood: 2 })] }, a);
    await sync({ cursor: 0, ops: [journalOp("2026-10-05", { text: "B".repeat(30) }), journalOp("2026-10-05", { text: "C".repeat(30) })] }, b); // two creates of one day: the later wins
    await sync({ cursor: 0, ops: [{ op_id: uuid(), entity: "journal", id: "2026-10-05", fields: { mood: 4 } }] }, a);
    await sync({ cursor: 0, ops: [{ op_id: uuid(), entity: "journal", id: "2026-10-05", fields: { mood: null } }] }, b);
    expect(await stored(a, "2026-10-05")).toEqual({ iv: IV, text: CIPHERTEXT, mood: 4, updated_at: 1 });
    expect(await stored(b, "2026-10-05")).toEqual({ iv: IV, text: "C".repeat(30), mood: null, updated_at: 1 });
    expect(await count("SELECT COUNT(*) AS n FROM journal WHERE user_id IN (?, ?)", uidOf(a), uidOf(b))).toBe(2);
  });

  it("refuses a patch of a day that has no entry, and a create without iv and text", async () => {
    const cookie = await newUser();
    const { body } = await sync({ cursor: 0, ops: [{ op_id: uuid(), entity: "journal", id: "2026-10-06", fields: { mood: 3 } }, { op_id: uuid(), entity: "journal", id: "2026-10-06", fields: { iv: IV, mood: 3 } }] }, cookie);
    expect(body.rejected.map((r) => r.reason)).toEqual(["incomplete_create", "incomplete_create"]);
    expect(await stored(cookie, "2026-10-06")).toBeNull();
  });

  it("validates the day, the iv, the ciphertext and the mood", async () => {
    const cookie = await newUser();
    const bad = (day: string, fields: Record<string, unknown>) => sync({ cursor: 0, ops: [journalOp(day, fields)] }, cookie);
    expect((await bad("2026-13-40", {})).res.status).toBe(400);
    expect((await bad("yesterday", {})).res.status).toBe(400);
    expect((await bad("2026-02-30", {})).res.status).toBe(400);
    const badDay = await sync({ cursor: 0, ops: [{ op_id: uuid(), entity: "days", id: "2026-13-40", fields: { confirmed_at: 1 } }] }, cookie);
    expect(badDay.res.status).toBe(400); // the same check guards days, which used to answer 500 here
    expect((await bad("2026-10-05", { iv: "short" })).res.status).toBe(400);
    expect((await bad("2026-10-05", { iv: "+".repeat(16) })).res.status).toBe(400);
    expect((await bad("2026-10-05", { text: "a line of plain text, with spaces" })).res.status).toBe(400);
    expect((await bad("2026-10-05", { text: "A".repeat(4097) })).res.status).toBe(400);
    expect((await bad("2026-10-05", { text: null })).res.status).toBe(400);
    for (const mood of [0, 6, 2.5, "3"]) expect((await bad("2026-10-05", { mood })).res.status, String(mood)).toBe(400);
    expect((await bad("2026-10-05", { text: "A".repeat(4096), mood: 1 })).res.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM journal WHERE user_id = ?", uidOf(cookie))).toBe(1);
  });
});

describe("statement budget (Tech_Scope.md §11: 50 D1 statements per invocation)", () => {
  // Counts statements the way the platform does: each query is one, and each statement of a batch is one.
  function counting(db: D1Database) {
    let n = 0;
    const targets = new WeakMap<object, D1PreparedStatement>();
    const wrap = (st: D1PreparedStatement): D1PreparedStatement => {
      const proxy: D1PreparedStatement = new Proxy(st, {
        get: (target, prop) => (prop === "bind" ? (...args: unknown[]) => wrap(target.bind(...args)) : Reflect.get(target, prop)),
      });
      targets.set(proxy, st);
      return proxy;
    };
    const counted = new Proxy(db, {
      get(target, prop) {
        if (prop === "prepare") return (sql: string) => wrap(target.prepare(sql));
        if (prop === "batch") {
          return (stmts: D1PreparedStatement[]) => {
            n += stmts.length;
            return target.batch(stmts.map((s) => targets.get(s) ?? s));
          };
        }
        return Reflect.get(target, prop);
      },
    });
    return { db: counted as D1Database, statements: () => n };
  }

  it(`${MAX_OPS} partial patches across all seven tables cost MAX_OPS + 9 statements, so a request is MAX_OPS + 11 with identity: under 50`, async () => {
    const cookie = await newUser();
    const uid = uidOf(cookie);
    const [t, c, s, h] = [uuid(), uuid(), uuid(), uuid()];
    await sync({ cursor: 0, ops: [
      task(t),
      { op_id: uuid(), entity: "chunks", id: c, fields: { task_id: t, parent_id: null, title: "Draft", position: 1, state: "todo" } },
      { op_id: uuid(), entity: "sessions", id: s, fields: { chunk_id: c, started_at: 1, ended_at: 2 } },
      { op_id: uuid(), entity: "days", id: "2026-10-05", fields: { confirmed_at: 1 } },
      { op_id: uuid(), entity: "hard_blocks", id: h, fields: { weekdays: [1], start_min: 60, end_min: 120 } },
      { op_id: uuid(), entity: "settings", id: "me", fields: { quiet_end: 420 } },
      journalOp("2026-10-05"),
    ] }, cookie);

    // The widest lookup: every kind is wanted (the four id-keyed tables, a chunk's children, and the three per-user
    // tables, which a partial patch loads), which is 8 terms and so two statements; the pull is two as well.
    const sub = uuid();
    const ops: Op[] = [
      patch(t, { title: "Renamed" }),
      { op_id: uuid(), entity: "chunks", id: c, fields: { title: "Redrafted", parent_id: sub } },
      { op_id: uuid(), entity: "sessions", id: s, fields: { completed: true } },
      { op_id: uuid(), entity: "days", id: "2026-10-05", fields: { shutdown_at: 9 } },
      { op_id: uuid(), entity: "hard_blocks", id: h, fields: { label: "Gym" } },
      { op_id: uuid(), entity: "settings", id: "me", fields: { unlock: "trivia" } },
      { op_id: uuid(), entity: "journal", id: "2026-10-05", fields: { mood: 3 } },
    ];
    while (ops.length < MAX_OPS) ops.push(patch(t, { title: `Rename ${ops.length}` }));
    const counter = counting(env.DB);
    const result = await syncDb(counter.db, uid, 0, ops, Date.now());
    expect(result.rejected.map((r) => r.reason)).toEqual(["bad_parent"]); // only the chunk op, whose parent does not exist
    // 1 ledger + 2 lookup + 3 (rev guard, bump, ledger) + 37 writes + 2 pull + 1 cursor = 46; identity adds at most 2.
    expect(counter.statements()).toBeLessThanOrEqual(MAX_OPS + 9);
    expect(counter.statements() + 2).toBeLessThan(50);
  });
});

describe("identity", () => {
  it("creates a user and sets the cookie when none is presented", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM users");
    const res = await exports.default.fetch(request({ cursor: 0, ops: [] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toMatch(/^ember_uid=[A-Za-z0-9_-]{22}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=34560000$/);
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(before + 1);
    const uid = uidOf(res.headers.get("Set-Cookie")!.split(";")[0]);
    const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(uid).first<Record<string, number | string>>();
    expect(user).toMatchObject({ rev: 0 });
    expect(user!.created_at).toBe(user!.last_seen_at);
  });

  it("reuses the user and refreshes the cookie and last_seen_at on a second call", async () => {
    const cookie = await newUser();
    await env.DB.prepare("UPDATE users SET last_seen_at = 0 WHERE id = ?").bind(uidOf(cookie)).run();
    const before = await count("SELECT COUNT(*) AS n FROM users");

    const again = await sync({ cursor: 0, ops: [] }, cookie);
    expect(again.cookie).toBe(cookie);
    expect(again.res.headers.get("Set-Cookie")).toContain("Max-Age=34560000");
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(before);
    const row = await env.DB.prepare("SELECT last_seen_at FROM users WHERE id = ?").bind(uidOf(cookie)).first<{ last_seen_at: number }>();
    expect(row!.last_seen_at).toBeGreaterThan(0);
  });

  it("issues a new user for a malformed or unknown cookie instead of trusting it", async () => {
    for (const cookie of ["ember_uid=nope", "ember_uid=AAAAAAAAAAAAAAAAAAAAAA", "other=1"]) {
      const { cookie: issued } = await sync({ cursor: 0, ops: [] }, cookie);
      expect(issued).toMatch(/^ember_uid=[A-Za-z0-9_-]{22}$/);
      expect(issued).not.toBe(cookie);
    }
  });
});

describe("validation", () => {
  const good = (): Op => task(uuid());
  const bad: [string, unknown][] = [
    ["not JSON", "{nope"],
    ["a JSON array", []],
    ["a missing cursor", { ops: [] }],
    ["a negative cursor", { cursor: -1, ops: [] }],
    ["a fractional cursor", { cursor: 1.5, ops: [] }],
    ["ops that are not an array", { cursor: 0, ops: {} }],
    ["an op that is not an object", { cursor: 0, ops: ["x"] }],
    ["an unknown entity", { cursor: 0, ops: [{ ...good(), entity: "users" }] }],
    ["a prototype-chain entity", { cursor: 0, ops: [{ ...good(), entity: "constructor" }] }],
    ["an unknown field", { cursor: 0, ops: [{ ...good(), fields: { title: "x", state: "inbox", user_id: "evil" } }] }],
    ["a field that is not whitelisted (rev)", { cursor: 0, ops: [{ ...good(), fields: { title: "x", rev: 99 } }] }],
    ["a wrong type", { cursor: 0, ops: [{ ...good(), fields: { title: "x", state: "inbox", quick: 1 } }] }],
    ["an enum value that does not exist", { cursor: 0, ops: [{ ...good(), fields: { title: "x", state: "finished" } }] }],
    ["an empty title", { cursor: 0, ops: [{ ...good(), fields: { title: "   ", state: "inbox" } }] }],
    ["an oversized title", { cursor: 0, ops: [{ ...good(), fields: { title: "x".repeat(501), state: "inbox" } }] }],
    ["an impossible date", { cursor: 0, ops: [{ ...good(), fields: { title: "x", state: "inbox", deadline: "2026-02-31" } }] }],
    ["empty fields", { cursor: 0, ops: [{ ...good(), fields: {} }] }],
    ["a malformed op_id", { cursor: 0, ops: [{ ...good(), op_id: "has space" }] }],
    ["a malformed row id", { cursor: 0, ops: [{ ...good(), id: "../x" }] }],
    ["a day id that is not a date", { cursor: 0, ops: [{ op_id: uuid(), entity: "days", id: "monday", fields: { deferred: [] } }] }],
    ["a deferred list with a non-id", { cursor: 0, ops: [{ op_id: uuid(), entity: "days", id: "2026-10-05", fields: { deferred: ["ok", 5] } }] }],
  ];

  it.each(bad)("returns 400 for %s, and creates no user", async (_name, body) => {
    const before = await count("SELECT COUNT(*) AS n FROM users");
    const res = await exports.default.fetch(request(body));
    expect(res.status).toBe(400);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(await res.json()).toMatchObject({ error: "invalid_body" });
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(before);
  });

  it("applies nothing when one op in the body is bad", async () => {
    const cookie = await newUser();
    const id = uuid();
    const res = await exports.default.fetch(request({ cursor: 0, ops: [task(id), { ...good(), fields: { title: 5 } }] }, cookie));
    expect(res.status).toBe(400);
    expect(await taskRow(id)).toBeNull();
    expect(await userRev(cookie)).toBe(0);
  });

  it(`accepts ${MAX_OPS} ops and refuses ${MAX_OPS + 1} with 413`, async () => {
    const cookie = await newUser();
    const ok = await sync({ cursor: 0, ops: Array.from({ length: MAX_OPS }, () => task(uuid())) }, cookie);
    expect(ok.res.status).toBe(200);
    expect(ok.body.changes).toHaveLength(MAX_OPS);
    expect(ok.body.cursor).toBe(MAX_OPS);

    const res = await exports.default.fetch(request({ cursor: 0, ops: Array.from({ length: MAX_OPS + 1 }, () => task(uuid())) }, cookie));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "too_many_ops" });
    expect(await userRev(cookie)).toBe(MAX_OPS);
  });

  it("answers 405 to GET and 404 to an unknown API path", async () => {
    expect((await exports.default.fetch(new Request(URL_SYNC))).status).toBe(405);
    expect((await exports.default.fetch(new Request("https://ember.test/api/nope", { method: "POST" }))).status).toBe(404);
  });
});


describe("done_at", () => {
  const chunk = (id: string, task_id: string, fields: Record<string, unknown> = {}): Op => ({
    op_id: uuid(),
    entity: "chunks",
    id,
    fields: { task_id, title: "A step", position: 1, state: "todo", ...fields },
  });

  it("stores done_at on a task and a chunk and returns it on the next pull, null by default", async () => {
    const cookie = await newUser();
    const t = uuid();
    const c = uuid();
    await sync({ cursor: 0, ops: [task(t, { state: "active" }), chunk(c, t)] }, cookie);
    expect((await taskRow(t))!.done_at).toBeNull();

    const when = 1_760_000_000_000;
    const { body } = await sync({ cursor: 0, ops: [patch(t, { state: "done", done_at: when }), { op_id: uuid(), entity: "chunks", id: c, fields: { state: "done", done_at: when } }] }, cookie);
    expect(body.rejected).toEqual([]);
    expect((await taskRow(t))!.done_at).toBe(when);
    const rows = Object.fromEntries(body.changes.map((x) => [x.entity, x.row]));
    expect(rows.tasks.done_at).toBe(when);
    expect(rows.chunks.done_at).toBe(when);
  });

  it("clears done_at with null and refuses a value that is not a timestamp", async () => {
    const cookie = await newUser();
    const t = uuid();
    const c = uuid();
    await sync({ cursor: 0, ops: [task(t, { state: "active" }), chunk(c, t, { state: "done", done_at: 5 })] }, cookie);

    const cleared = await sync({ cursor: 0, ops: [{ op_id: uuid(), entity: "chunks", id: c, fields: { state: "todo", done_at: null } }] }, cookie);
    expect(cleared.res.status).toBe(200);
    expect(cleared.body.changes.find((x) => x.entity === "chunks")?.row.done_at).toBeNull();

    for (const bad of ["yesterday", -1, 1.5]) {
      const res = await sync({ cursor: 0, ops: [patch(t, { done_at: bad })] }, cookie);
      expect(res.res.status).toBe(400);
    }
  });
});
