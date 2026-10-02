import { expect, test } from "vitest";
import { allOps, applyChanges, createSync, diff } from "./sync";
import { capture, emptyState, triage, type State } from "../core/task";
import { addChunk, tick } from "../core/chunk";

let n = 0;
const id = () => `id-${++n}`;
const today = "2026-10-05";

function sample(): State {
  n = 0;
  let s = capture(emptyState(), { title: "Cover letter" }, 1, today, id);
  s = addChunk(s, "id-1", "Tailor the opening", null, 2, id);
  s = addChunk(s, "id-1", "Proofread", null, 3, id);
  s = addChunk(s, "id-1", "Read the ad again", "id-2", 4, id); // smaller step under the first
  return { ...s, days: [{ day: today, confirmed_at: 5, deferred: ["id-3"] }] };
}

test("a new row becomes one complete op with every synced field", () => {
  const before = emptyState();
  const after = capture(before, { title: "Cover letter", quick: true }, 1, today, () => "t1");
  const ops = diff(before, after, () => "op1");
  expect(ops).toEqual([
    {
      op_id: "op1",
      entity: "tasks",
      id: "t1",
      fields: { title: "Cover letter", state: "inbox", size: "XS", quick: true, holding_up: false, deadline: null, runway_start: null, pinned_on: null, snoozed_until: null, done_at: null, created_at: 1, updated_at: 1 },
    },
  ]);
});

test("a change sends only the fields that changed", () => {
  const s = sample();
  const t = triage(s, "id-1", { size: "M" }, 9, today);
  expect(diff(s, t, () => "op")).toEqual([{ op_id: "op", entity: "tasks", id: "id-1", fields: { size: "M", state: "active", updated_at: 9 } }]);
  expect(diff(t, t, () => "op")).toEqual([]);
});

test("days are keyed by the date; arrays compare by value", () => {
  const s = sample();
  const same = { ...s, days: [{ day: today, confirmed_at: 5, deferred: ["id-3"] }] };
  expect(diff(s, same, () => "op")).toEqual([]);
  const more = { ...s, days: [{ day: today, confirmed_at: 5, deferred: ["id-3", "id-4"] }] };
  expect(diff(s, more, () => "op")).toEqual([{ op_id: "op", entity: "days", id: today, fields: { deferred: ["id-3", "id-4"] } }]);
});

test("device-only state never syncs: draft, last seen", () => {
  const s = sample();
  expect(diff(s, { ...s, draft: "half a tho", last_seen_at: 99 }, () => "op")).toEqual([]);
});

test("settings sync as the one row 'me', both ways", () => {
  const s = sample();
  const t = { ...s, settings: { ...s.settings, quiet_end: 420 } };
  expect(diff(s, t, () => "op")).toEqual([{ op_id: "op", entity: "settings", id: "me", fields: { quiet_end: 420 } }]);
  const merged = applyChanges(s, [{ entity: "settings", row: { id: "me", tz: "Europe/London", quiet_start: 1380, quiet_end: 360, timer_mode: "pomodoro", unlock: "rotate", journal_key: null, rev: 3 } }], []);
  expect(merged.settings).toEqual({ ...s.settings, tz: "Europe/London", quiet_start: 1380, quiet_end: 360 });
});

test("the phase-3 settings travel as fields of 'me', both ways", () => {
  const s = sample();
  const t = { ...s, settings: { ...s.settings, timer_mode: "flowtime" as const, unlock: "trivia" as const, journal_key: "k".repeat(43) } };
  expect(diff(s, t, () => "op")).toEqual([{ op_id: "op", entity: "settings", id: "me", fields: { timer_mode: "flowtime", unlock: "trivia", journal_key: "k".repeat(43) } }]);
  const row = { id: "me", tz: null, quiet_start: 1320, quiet_end: 480, timer_mode: "flowtime", unlock: "puzzle", journal_key: null, rev: 4 };
  expect(applyChanges(s, [{ entity: "settings", row }], []).settings).toEqual({ tz: null, quiet_start: 1320, quiet_end: 480, timer_mode: "flowtime", unlock: "puzzle", journal_key: null });
});

test("a journal entry is keyed by its day and syncs as ciphertext, iv, mood and updated_at", () => {
  const s = sample();
  const entry = { day: today, iv: "i".repeat(16), text: "c".repeat(40), mood: 4, updated_at: 7 };
  const t = { ...s, journal: [entry] };
  expect(diff(s, t, () => "op")).toEqual([{ op_id: "op", entity: "journal", id: today, fields: { iv: entry.iv, text: entry.text, mood: 4, updated_at: 7 } }]);
  const u = { ...t, journal: [{ ...entry, mood: null, updated_at: 8 }] };
  expect(diff(t, u, () => "op")).toEqual([{ op_id: "op", entity: "journal", id: today, fields: { mood: null, updated_at: 8 } }]);
  // From another device: the row comes in under `day`, and the server's `rev` stays out.
  const merged = applyChanges(s, [{ entity: "journal", row: { ...entry, rev: 9 } }], []);
  expect(merged.journal).toEqual([entry]);
});

test("first upload: every row, parents before children, tasks before steps", () => {
  const ops = allOps(sample(), id);
  expect(ops.map((o) => `${o.entity}:${o.id}`)).toEqual(["tasks:id-1", "chunks:id-2", "chunks:id-3", "chunks:id-4", "days:2026-10-05", "settings:me"]);
  const withLine = { ...sample(), journal: [{ day: today, iv: "i".repeat(16), text: "c".repeat(40), mood: null, updated_at: 7 }] };
  expect(allOps(withLine, id).map((o) => `${o.entity}:${o.id}`)).toContain(`journal:${today}`);
  expect(ops[3].fields.parent_id).toBe("id-2");
});

test("server changes merge in, except fields with a local edit still waiting to send", () => {
  const s = sample();
  const local = { ...s, tasks: s.tasks.map((t) => ({ ...t, title: "Cover letter v2" })) };
  const pending = diff(s, local, () => "p1"); // title is waiting to go
  const merged = applyChanges(
    local,
    [
      { entity: "tasks", row: { ...s.tasks[0], title: "Renamed elsewhere", holding_up: true, rev: 7 } },
      { entity: "chunks", row: { id: "c9", task_id: "id-1", parent_id: null, title: "From the phone", position: 9, state: "todo", deleted: false, updated_at: 1, rev: 8 } },
      { entity: "days", row: { day: "2026-10-06", confirmed_at: null, shutdown_at: null, deferred: [], rev: 9 } },
    ],
    pending,
  );
  expect(merged.tasks[0]).toMatchObject({ title: "Cover letter v2", holding_up: true });
  expect(merged.tasks[0]).not.toHaveProperty("rev");
  expect(merged.chunks.at(-1)).toMatchObject({ id: "c9", title: "From the phone" });
  expect(merged.days.map((d) => d.day)).toEqual([today, "2026-10-06"]);
});

test("applying an echo of what this device already has changes nothing", () => {
  const s = sample();
  const echo = allOps(s, id).map((o) => ({ entity: o.entity, row: o.entity === "days" || o.entity === "journal" ? { day: o.id, ...o.fields, rev: 1 } : { id: o.id, ...o.fields, rev: 1 } }));
  const merged = applyChanges(s, echo, []);
  expect(diff(s, merged, () => "op")).toEqual([]);
});

// The engine against a fake server: storage and fetch injected.
function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("a refused change: the server's version comes back on a full refetch, and the app is told", async () => {
  const s = triage(sample(), "id-1", { size: "M" }, 9, today); // locally Active
  const server = { ...sample().tasks[0], state: "done", rev: 4 }; // another device finished it
  const bodies: { cursor: number; ops: unknown[] }[] = [];
  const responses = [
    reply({ cursor: 3, changes: [], rejected: [] }), // first upload
    reply({ cursor: 5, changes: [], rejected: [{ op_id: "x", reason: "illegal_transition" }] }), // the refused edit
    reply({ cursor: 5, changes: [{ entity: "tasks", row: server }], rejected: [] }), // the refetch from 0
  ];
  let state = sample();
  let told = 0;
  const engine = createSync(state, {
    update: (fn) => (state = fn(state)),
    storage: fakeStorage(),
    fetch: (async (_url: string, init: RequestInit) => (bodies.push(JSON.parse(init.body as string)), responses.shift()!)) as typeof fetch,
    onRejected: () => told++,
  });
  await engine.push();
  engine.record(s);
  state = s;
  await engine.push();
  expect(bodies.map((b) => b.cursor)).toEqual([0, 3, 0]);
  expect(told).toBe(1);
  expect(state.tasks[0].state).toBe("done");
});

test("offline means the network failed; a server error is not offline", async () => {
  const statuses: boolean[] = [];
  const run = async (fail: () => Promise<Response>) => {
    const engine = createSync(sample(), { update: () => {}, storage: fakeStorage(), fetch: fail as typeof fetch, onStatus: (st) => statuses.push(st.offline) });
    await engine.push();
  };
  await run(() => Promise.reject(new TypeError("Failed to fetch")));
  await run(async () => reply({ error: "boom" }, 500));
  expect(statuses).toEqual([true, false]);
});

test("a 503 from a lost server race is resent once after Retry-After; a second one waits for the next trigger", async () => {
  const lost = () => new Response(JSON.stringify({ error: "conflict" }), { status: 503, headers: { "Retry-After": "0" } });
  const run = async (responses: Response[]) => {
    const storage = fakeStorage();
    let calls = 0;
    const engine = createSync(sample(), { update: () => {}, storage, fetch: (async () => (calls++, responses.shift()!)) as typeof fetch });
    await engine.push();
    return { calls, meta: JSON.parse(storage.getItem("ember.sync")!) };
  };
  const won = await run([lost(), reply({ cursor: 3, changes: [], rejected: [] })]);
  expect(won.calls).toBe(2);
  expect(won.meta).toMatchObject({ cursor: 3, outbox: [], uploaded: true });

  const lostTwice = await run([lost(), lost()]);
  expect(lostTwice.calls).toBe(2);
  expect(lostTwice.meta?.uploaded).not.toBe(true); // nothing marked sent: the next open, focus, reconnect or change uploads it
});

test("done_at travels both ways: finishing a step sends it, a server value merges in, a legacy row stays quiet", () => {
  const s = sample();
  const finished = tick(s, "id-4", true, 9);
  expect(diff(s, finished, () => "op")).toContainEqual({ op_id: "op", entity: "chunks", id: "id-4", fields: { state: "done", done_at: 9, updated_at: 9 } });

  // A row saved before done_at has no value; the diff reads that as null, so loading it sends nothing.
  const legacy = structuredClone(s);
  for (const c of legacy.chunks) delete c.done_at;
  expect(diff(legacy, s, () => "op")).toEqual([]);

  const merged = applyChanges(s, [{ entity: "chunks", row: { ...s.chunks[2], state: "done", done_at: 77, updated_at: 77, rev: 4 } }], []);
  expect(merged.chunks[2]).toMatchObject({ state: "done", done_at: 77 });
});
