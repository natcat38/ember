import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Op, SyncResponse } from "./protocol";

// Slice 9 (server half): the state machines of Product_Scope §4 enforced on POST /api/sync (Tech_Scope.md §5).
// Every test runs against the real local D1 through the Worker's own entry point.

const uuid = () => crypto.randomUUID();

const call = async (body: unknown, cookie?: string) => {
  const res = await exports.default.fetch(
    new Request("https://ember.test/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
  return { res, body: (await res.json()) as SyncResponse, cookie: res.headers.get("Set-Cookie")?.split(";")[0] };
};
const sync = async (ops: Op[], cookie: string, cursor = 0) => (await call({ cursor, ops }, cookie)).body;
const newUser = async () => (await call({ cursor: 0, ops: [] })).cookie!;
const uidOf = (cookie: string) => cookie.split("=")[1];

const taskOp = (id: string, fields: Record<string, unknown> = {}): Op => ({ op_id: uuid(), entity: "tasks", id, fields: { title: "Write cover letter", state: "inbox", ...fields } });
const taskPatch = (id: string, fields: Record<string, unknown>): Op => ({ op_id: uuid(), entity: "tasks", id, fields });
const chunkOp = (id: string, task_id: string, fields: Record<string, unknown> = {}): Op => ({
  op_id: uuid(),
  entity: "chunks",
  id,
  fields: { task_id, parent_id: null, title: "Draft", position: 1, state: "todo", deleted: false, ...fields },
});
const chunkPatch = (id: string, fields: Record<string, unknown>): Op => ({ op_id: uuid(), entity: "chunks", id, fields });
const sessionOp = (id: string, chunk_id: string): Op => ({ op_id: uuid(), entity: "sessions", id, fields: { chunk_id, started_at: 1000, ended_at: 2000, completed: true } });

const row = (table: string, id: string) => env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<Record<string, unknown>>();
const rev = async (cookie: string) => (await env.DB.prepare("SELECT rev FROM users WHERE id = ?").bind(uidOf(cookie)).first<{ rev: number }>())!.rev;
const ledger = async (opId: string) => (await env.DB.prepare("SELECT COUNT(*) AS n FROM ops WHERE op_id = ?").bind(opId).first<{ n: number }>())!.n;

// Product_Scope §4 plus the brief: where each state may go.
const STATES = ["inbox", "active", "overdue", "done", "removed"] as const;
type S = (typeof STATES)[number];
const ALLOWED: Record<S, S[]> = {
  inbox: ["active", "removed", "done"],
  active: ["done", "removed", "overdue"],
  overdue: ["active", "done", "removed"],
  done: ["removed"],
  removed: ["active", "inbox"],
};
const pairs = STATES.flatMap((from) => STATES.filter((to) => to !== from).map((to) => [from, to] as [S, S]));
const legal = pairs.filter(([from, to]) => ALLOWED[from].includes(to));
const illegal = pairs.filter(([from, to]) => !ALLOWED[from].includes(to));

// A task sitting in `state`. Done cannot be created, so it is reached through Active.
async function taskIn(cookie: string, state: S): Promise<string> {
  const id = uuid();
  if (state === "done") await sync([taskOp(id), taskPatch(id, { state: "active" }), taskPatch(id, { state: "done" })], cookie);
  else await sync([taskOp(id, { state })], cookie);
  expect((await row("tasks", id))!.state).toBe(state);
  return id;
}

describe("task state machine", () => {
  it.each(legal)("applies %s -> %s", async (from, to) => {
    const cookie = await newUser();
    const id = await taskIn(cookie, from);
    const op = taskPatch(id, { state: to });
    const { rejected } = await sync([op], cookie);
    expect(rejected).toEqual([]);
    expect((await row("tasks", id))!.state).toBe(to);
    expect(await ledger(op.op_id)).toBe(1);
  });

  it.each(illegal)("rejects %s -> %s and leaves the row and the ledger alone", async (from, to) => {
    const cookie = await newUser();
    const id = await taskIn(cookie, from);
    const before = await row("tasks", id);
    const revBefore = await rev(cookie);

    const op = taskPatch(id, { state: to });
    const { rejected, changes } = await sync([op], cookie, revBefore);
    expect(rejected).toEqual([{ op_id: op.op_id, reason: "illegal_transition" }]);
    expect(changes).toEqual([]);
    expect(await row("tasks", id)).toEqual(before);
    expect(await rev(cookie)).toBe(revBefore);
    expect(await ledger(op.op_id)).toBe(0);
  });

  it.each(STATES)("allows %s -> %s (the same state again)", async (state) => {
    const cookie = await newUser();
    const id = await taskIn(cookie, state);
    const { rejected } = await sync([taskPatch(id, { state })], cookie);
    expect(rejected).toEqual([]);
  });

  it("rejects an illegal move sent as a full create op on an existing row", async () => {
    const cookie = await newUser();
    const id = await taskIn(cookie, "done");
    const op = taskOp(id, { title: "Back from the dead", state: "inbox" });
    expect((await sync([op], cookie)).rejected).toEqual([{ op_id: op.op_id, reason: "illegal_transition" }]);
    expect(await row("tasks", id)).toMatchObject({ title: "Write cover letter", state: "done" });
  });

  it("still lets a done task be renamed or edited, since only state is gated", async () => {
    const cookie = await newUser();
    const id = await taskIn(cookie, "done");
    const { rejected } = await sync([taskPatch(id, { title: "Renamed after done", size: "M" })], cookie);
    expect(rejected).toEqual([]);
    expect(await row("tasks", id)).toMatchObject({ title: "Renamed after done", state: "done" });
  });

  it.each(["inbox", "active", "overdue", "removed"] as const)("creates a new task straight into %s", async (state) => {
    const cookie = await newUser();
    const id = uuid();
    expect((await sync([taskOp(id, { state })], cookie)).rejected).toEqual([]);
    expect((await row("tasks", id))!.state).toBe(state);
  });

  it("refuses to create a new task as done", async () => {
    const cookie = await newUser();
    const op = taskOp(uuid(), { state: "done" });
    const { rejected } = await sync([op], cookie);
    expect(rejected).toEqual([{ op_id: op.op_id, reason: "illegal_initial_state" }]);
    expect(await row("tasks", op.id)).toBeNull();
    expect(await rev(cookie)).toBe(0);
  });

  it("counts earlier ops in the same request as the current state, in arrival order", async () => {
    const cookie = await newUser();
    const id = uuid();
    const done = taskPatch(id, { state: "done" });
    const back = taskPatch(id, { state: "active" });
    const { rejected } = await sync([taskOp(id, { state: "active" }), done, back], cookie);
    expect(rejected).toEqual([{ op_id: back.op_id, reason: "illegal_transition" }]);
    expect((await row("tasks", id))!.state).toBe("done");
    expect(await ledger(done.op_id)).toBe(1);
    expect(await ledger(back.op_id)).toBe(0);
  });

  it("does not count a rejected op as the current state for the ops after it", async () => {
    const cookie = await newUser();
    const id = uuid();
    const jump = taskPatch(id, { state: "overdue" }); // inbox -> overdue is illegal
    const next = taskPatch(id, { state: "done" }); // legal from inbox, illegal from overdue
    const { rejected } = await sync([taskOp(id), jump, next], cookie);
    expect(rejected).toEqual([{ op_id: jump.op_id, reason: "illegal_transition" }]);
    expect((await row("tasks", id))!.state).toBe("done");
  });

  it("applies the legal ops of a request that also holds an illegal one", async () => {
    const cookie = await newUser();
    const [a, b] = [uuid(), uuid()];
    const bad = taskPatch(await taskIn(cookie, "done"), { state: "inbox" });
    const { rejected, changes } = await sync([taskOp(a), bad, taskOp(b)], cookie, await rev(cookie));
    expect(rejected).toEqual([{ op_id: bad.op_id, reason: "illegal_transition" }]);
    expect(changes.map((c) => c.row.id).sort()).toEqual([a, b].sort());
  });
});

describe("the two-device race (Tech_Scope.md section 5)", () => {
  it("lands both when device A marks done and device B renames", async () => {
    const cookie = await newUser();
    const id = uuid();
    await sync([taskOp(id, { state: "active" })], cookie);

    // Both devices were offline from the same starting point; A reaches the server first.
    const a = taskPatch(id, { state: "done" });
    const b = taskPatch(id, { title: "Cover letter, v2" });
    expect((await sync([a], cookie)).rejected).toEqual([]);
    expect((await sync([b], cookie)).rejected).toEqual([]);
    expect(await row("tasks", id)).toMatchObject({ state: "done", title: "Cover letter, v2" });
  });

  it("rejects the second op when A marks done and B moves it back to inbox, and B pulls the done row", async () => {
    const cookie = await newUser();
    const id = uuid();
    const start = await sync([taskOp(id, { state: "active" })], cookie);

    expect((await sync([taskPatch(id, { state: "done" })], cookie, start.cursor)).rejected).toEqual([]);

    const b = taskPatch(id, { state: "inbox" });
    const reply = await sync([b], cookie, start.cursor); // B's cursor predates A's write
    expect(reply.rejected).toEqual([{ op_id: b.op_id, reason: "illegal_transition" }]);
    expect(reply.changes.map((c) => c.row)).toEqual([expect.objectContaining({ id, state: "done" })]);
    expect((await row("tasks", id))!.state).toBe("done");
  });

  it("converges whichever of two conflicting state changes arrives first", async () => {
    const cookie = await newUser();
    const id = uuid();
    await sync([taskOp(id, { state: "active" })], cookie);
    const [remove, done] = [taskPatch(id, { state: "removed" }), taskPatch(id, { state: "done" })];
    // remove then done: removed -> done is illegal, so the task ends removed.
    expect((await sync([remove, done], cookie)).rejected).toEqual([{ op_id: done.op_id, reason: "illegal_transition" }]);
    expect((await row("tasks", id))!.state).toBe("removed");
  });
});

describe("chunk rules", () => {
  async function withTask(cookie: string) {
    const task = uuid();
    await sync([taskOp(task, { state: "active" })], cookie);
    return task;
  }

  it("accepts a top-level chunk and a child under it, and the child may arrive in the same request", async () => {
    const cookie = await newUser();
    const task = await withTask(cookie);
    const [parent, child] = [uuid(), uuid()];
    expect((await sync([chunkOp(parent, task), chunkOp(child, task, { parent_id: parent })], cookie)).rejected).toEqual([]);
    expect((await row("chunks", child))!.parent_id).toBe(parent);
  });

  it("rejects a third level", async () => {
    const cookie = await newUser();
    const task = await withTask(cookie);
    const [parent, child] = [uuid(), uuid()];
    await sync([chunkOp(parent, task), chunkOp(child, task, { parent_id: parent })], cookie);

    const grandchild = chunkOp(uuid(), task, { parent_id: child });
    expect((await sync([grandchild], cookie)).rejected).toEqual([{ op_id: grandchild.op_id, reason: "bad_parent" }]);
    expect(await row("chunks", grandchild.id)).toBeNull();
    expect(await ledger(grandchild.op_id)).toBe(0);
  });

  it("rejects a third level built inside one request", async () => {
    const cookie = await newUser();
    const task = await withTask(cookie);
    const [a, b] = [uuid(), uuid()];
    const deep = chunkOp(uuid(), task, { parent_id: b });
    const { rejected } = await sync([chunkOp(a, task), chunkOp(b, task, { parent_id: a }), deep], cookie);
    expect(rejected).toEqual([{ op_id: deep.op_id, reason: "bad_parent" }]);
  });

  it("rejects re-parenting an existing top-level chunk under a child", async () => {
    const cookie = await newUser();
    const task = await withTask(cookie);
    const [parent, child, other] = [uuid(), uuid(), uuid()];
    await sync([chunkOp(parent, task), chunkOp(child, task, { parent_id: parent }), chunkOp(other, task)], cookie);
    const move = chunkPatch(other, { parent_id: child });
    expect((await sync([move], cookie)).rejected).toEqual([{ op_id: move.op_id, reason: "bad_parent" }]);
    expect((await row("chunks", other))!.parent_id).toBeNull();
  });

  it("rejects a parent that does not exist, is itself, is deleted, or belongs to another task", async () => {
    const cookie = await newUser();
    const [t1, t2] = [await withTask(cookie), await withTask(cookie)];
    const [onT1, gone] = [uuid(), uuid()];
    await sync([chunkOp(onT1, t1), chunkOp(gone, t1, { deleted: true })], cookie);

    const cases = [
      chunkOp(uuid(), t1, { parent_id: uuid() }), // nowhere
      chunkOp(uuid(), t2, { parent_id: onT1 }), // a chunk of a different task
      chunkOp(uuid(), t1, { parent_id: gone }), // a deleted chunk
    ];
    const selfId = uuid();
    cases.push(chunkOp(selfId, t1, { parent_id: selfId })); // itself
    const { rejected } = await sync(cases, cookie);
    expect(rejected).toEqual(cases.map((c) => ({ op_id: c.op_id, reason: "bad_parent" })));
  });

  it("rejects a parent that belongs to another user", async () => {
    const [mine, theirs] = [await newUser(), await newUser()];
    const [myTask, theirTask] = [await withTask(mine), await withTask(theirs)];
    const theirChunk = uuid();
    await sync([chunkOp(theirChunk, theirTask)], theirs);

    const op = chunkOp(uuid(), myTask, { parent_id: theirChunk });
    expect((await sync([op], mine)).rejected).toEqual([{ op_id: op.op_id, reason: "bad_parent" }]);
    expect(await row("chunks", op.id)).toBeNull();
  });

  it("rejects giving a parent to a chunk that has live children of its own", async () => {
    const cookie = await newUser();
    const task = await withTask(cookie);
    const [top, mid, child] = [uuid(), uuid(), uuid()];
    await sync([chunkOp(top, task), chunkOp(mid, task), chunkOp(child, task, { parent_id: mid })], cookie);

    // mid would become a child of top while child hangs under it: three levels.
    const move = chunkPatch(mid, { parent_id: top });
    expect((await sync([move], cookie)).rejected).toEqual([{ op_id: move.op_id, reason: "bad_parent" }]);
    expect((await row("chunks", mid))!.parent_id).toBeNull();
    expect(await ledger(move.op_id)).toBe(0);
  });

  it("allows giving a parent to a chunk whose only child is deleted", async () => {
    const cookie = await newUser();
    const task = await withTask(cookie);
    const [top, mid, child] = [uuid(), uuid(), uuid()];
    await sync([chunkOp(top, task), chunkOp(mid, task), chunkOp(child, task, { parent_id: mid, deleted: true })], cookie);

    const move = chunkPatch(mid, { parent_id: top });
    expect((await sync([move], cookie)).rejected).toEqual([]);
    expect((await row("chunks", mid))!.parent_id).toBe(top);
  });

  it("counts a child created earlier in the same request, and one deleted earlier in it", async () => {
    const cookie = await newUser();
    const task = await withTask(cookie);
    const [top, mid, child] = [uuid(), uuid(), uuid()];
    await sync([chunkOp(top, task), chunkOp(mid, task)], cookie);

    // Created in the same request: mid has a child by the time it is moved.
    const move = chunkPatch(mid, { parent_id: top });
    const { rejected } = await sync([chunkOp(child, task, { parent_id: mid }), move], cookie);
    expect(rejected).toEqual([{ op_id: move.op_id, reason: "bad_parent" }]);
    expect((await row("chunks", mid))!.parent_id).toBeNull();

    // child is live in the database now, so a request that deletes it first frees mid to move.
    const [del, move2] = [chunkPatch(child, { deleted: true }), chunkPatch(mid, { parent_id: top })];
    expect((await sync([del, move2], cookie)).rejected).toEqual([]);
    expect((await row("chunks", mid))!.parent_id).toBe(top);
  });

  it("does not judge a chunk again for re-sending the parent it already has", async () => {
    const cookie = await newUser();
    const task = await withTask(cookie);
    const [top, mid] = [uuid(), uuid()];
    await sync([chunkOp(top, task), chunkOp(mid, task, { parent_id: top })], cookie);
    expect((await sync([chunkPatch(mid, { parent_id: top, title: "Renamed" })], cookie)).rejected).toEqual([]);
  });

  it("rejects a chunk under another user's task, and under a task that does not exist", async () => {
    const [mine, theirs] = [await newUser(), await newUser()];
    const theirTask = await withTask(theirs);
    const [foreign, nowhere] = [chunkOp(uuid(), theirTask), chunkOp(uuid(), uuid())];
    expect((await sync([foreign, nowhere], mine)).rejected).toEqual([
      { op_id: foreign.op_id, reason: "foreign_task" },
      { op_id: nowhere.op_id, reason: "foreign_task" },
    ]);
    expect(await row("chunks", foreign.id)).toBeNull();
  });

  it("accepts a chunk under a task created earlier in the same request", async () => {
    const cookie = await newUser();
    const task = uuid();
    expect((await sync([taskOp(task), chunkOp(uuid(), task)], cookie)).rejected).toEqual([]);
  });

  it("rejects moving a chunk to a different task", async () => {
    const cookie = await newUser();
    const [t1, t2] = [await withTask(cookie), await withTask(cookie)];
    const c = uuid();
    await sync([chunkOp(c, t1)], cookie);
    const move = chunkPatch(c, { task_id: t2 });
    expect((await sync([move], cookie)).rejected).toEqual([{ op_id: move.op_id, reason: "moved_task" }]);
    expect((await row("chunks", c))!.task_id).toBe(t1);
  });

  it("deletes a chunk but refuses to undelete it", async () => {
    const cookie = await newUser();
    const task = await withTask(cookie);
    const c = uuid();
    await sync([chunkOp(c, task)], cookie);

    expect((await sync([chunkPatch(c, { deleted: true })], cookie)).rejected).toEqual([]);
    const undo = chunkPatch(c, { deleted: false });
    expect((await sync([undo], cookie)).rejected).toEqual([{ op_id: undo.op_id, reason: "undelete" }]);
    expect((await row("chunks", c))!.deleted).toBe(1);
    // A deleted chunk can still be sent as deleted again, and edited without being revived.
    expect((await sync([chunkPatch(c, { deleted: true, title: "still gone" })], cookie)).rejected).toEqual([]);
  });

  it("refuses to undelete inside one request", async () => {
    const cookie = await newUser();
    const task = await withTask(cookie);
    const c = uuid();
    const undo = chunkPatch(c, { deleted: false });
    const { rejected } = await sync([chunkOp(c, task), chunkPatch(c, { deleted: true }), undo], cookie);
    expect(rejected).toEqual([{ op_id: undo.op_id, reason: "undelete" }]);
  });

  it("lets a leaf move freely between todo, focus and done, including back (unticking)", async () => {
    const cookie = await newUser();
    const task = await withTask(cookie);
    const c = uuid();
    await sync([chunkOp(c, task)], cookie);
    for (const state of ["focus", "done", "todo", "done", "focus", "todo"]) {
      expect((await sync([chunkPatch(c, { state })], cookie)).rejected).toEqual([]);
      expect((await row("chunks", c))!.state).toBe(state);
    }
  });

  it("does not re-check the parent when a re-sent op names the parent it already has", async () => {
    const cookie = await newUser();
    const task = await withTask(cookie);
    const [parent, child] = [uuid(), uuid()];
    await sync([chunkOp(parent, task), chunkOp(child, task, { parent_id: parent })], cookie);
    expect((await sync([chunkOp(child, task, { parent_id: parent, title: "Renamed" })], cookie)).rejected).toEqual([]);
  });
});

describe("session rules", () => {
  it("accepts a session on the user's own chunk, including one created in the same request", async () => {
    const cookie = await newUser();
    const [task, chunk] = [uuid(), uuid()];
    const { rejected } = await sync([taskOp(task), chunkOp(chunk, task), sessionOp(uuid(), chunk)], cookie);
    expect(rejected).toEqual([]);
  });

  it("rejects a session on another user's chunk, or on a chunk that does not exist", async () => {
    const [mine, theirs] = [await newUser(), await newUser()];
    const [theirTask, theirChunk] = [uuid(), uuid()];
    await sync([taskOp(theirTask), chunkOp(theirChunk, theirTask)], theirs);

    const [foreign, nowhere] = [sessionOp(uuid(), theirChunk), sessionOp(uuid(), uuid())];
    expect((await sync([foreign, nowhere], mine)).rejected).toEqual([
      { op_id: foreign.op_id, reason: "foreign_chunk" },
      { op_id: nowhere.op_id, reason: "foreign_chunk" },
    ]);
    expect(await row("sessions", foreign.id)).toBeNull();
    expect(await ledger(foreign.op_id)).toBe(0);
  });
});

// A row id is unique across users (tasks, chunks, sessions and hard_blocks are keyed by id alone), so reusing one that
// another user owns used to be skipped silently. It is refused now, with a reason the client can see.
describe("foreign ids", () => {
  const blockOp = (id: string, label: string): Op => ({ op_id: uuid(), entity: "hard_blocks", id, fields: { weekdays: [1], start_min: 60, end_min: 120, label } });
  async function withOwnTask(cookie: string) {
    const id = uuid();
    await sync([taskOp(id, { state: "active" })], cookie);
    return id;
  }

  it("rejects a complete op, and a patch, on a task id another user owns, and leaves the row alone", async () => {
    const [a, b] = [await newUser(), await newUser()];
    const id = uuid();
    await sync([taskOp(id, { title: "Mine" })], a);
    const before = await row("tasks", id);
    const revA = await rev(a);

    const [create, edit] = [taskOp(id, { title: "Hijacked" }), taskPatch(id, { state: "done" })];
    const { rejected, changes } = await sync([create, edit], b);
    expect(rejected).toEqual([
      { op_id: create.op_id, reason: "foreign_id" },
      { op_id: edit.op_id, reason: "foreign_id" },
    ]);
    expect(changes).toEqual([]);
    expect(await row("tasks", id)).toEqual(before);
    expect(await rev(a)).toBe(revA);
    expect(await rev(b)).toBe(0);
    expect(await ledger(create.op_id)).toBe(0);
  });

  it("rejects a complete op on a chunk, session or hard block id another user owns", async () => {
    const [a, b] = [await newUser(), await newUser()];
    const [aTask, bTask] = [await withOwnTask(a), await withOwnTask(b)];
    const [chunk, aSession, block, bChunk] = [uuid(), uuid(), uuid(), uuid()];
    await sync([chunkOp(chunk, aTask, { title: "Mine" }), sessionOp(aSession, chunk), blockOp(block, "Mine")], a);
    await sync([chunkOp(bChunk, bTask)], b);

    const attempts = [chunkOp(chunk, bTask, { title: "Hijacked" }), sessionOp(aSession, bChunk), blockOp(block, "Hijacked")];
    const { rejected } = await sync(attempts, b);
    expect(rejected).toEqual(attempts.map((o) => ({ op_id: o.op_id, reason: "foreign_id" })));
    expect(await row("chunks", chunk)).toMatchObject({ title: "Mine", task_id: aTask });
    expect(await row("sessions", aSession)).toMatchObject({ chunk_id: chunk });
    expect(await row("hard_blocks", block)).toMatchObject({ label: "Mine" });
  });

  it("still applies a user's own ops on their own ids", async () => {
    const a = await newUser();
    const id = uuid();
    await sync([taskOp(id)], a);
    expect((await sync([taskOp(id, { title: "Again" }), taskPatch(id, { size: "M" })], a)).rejected).toEqual([]);
    expect(await row("tasks", id)).toMatchObject({ title: "Again", size: "M" });
  });

  it("keeps foreign_task and foreign_chunk for ids that are not the op's own", async () => {
    const [a, b] = [await newUser(), await newUser()];
    const aTask = await withOwnTask(a);
    const aChunk = uuid();
    await sync([chunkOp(aChunk, aTask)], a);
    const [c, s] = [chunkOp(uuid(), aTask), sessionOp(uuid(), aChunk)];
    expect((await sync([c, s], b)).rejected).toEqual([
      { op_id: c.op_id, reason: "foreign_task" },
      { op_id: s.op_id, reason: "foreign_chunk" },
    ]);
  });
});
