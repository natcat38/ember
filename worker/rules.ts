import type { Op } from "./protocol";

// The state machines of Product_Scope §4, enforced on the server (Tech_Scope.md §5, §10 slice 9). The client runs the
// same checks first (core/task.ts, core/chunk.ts), so in practice a rejection follows a two-device race.
//
// checkOp returns a short, stable reason code for an illegal op, or null. sync.ts then puts the op in `rejected`,
// leaves it out of the ledger and the batch, and the client drops its local change and takes the server row.
// The codes are listed in protocol.ts.

/** The part of a stored row the rules read. */
export interface Row {
  state: string | null;
  task_id: string | null;
  parent_id: string | null;
  deleted: boolean;
  /** False when the row id exists but belongs to another user (the id-keyed tables are unique across users). */
  mine: boolean;
}

/** Lookups for rows other than the one an op targets. `task` and `chunk` return null when the row is not this user's. */
export interface Ctx {
  task(id: string): Row | null;
  chunk(id: string): Row | null;
  /** True when this user's chunk `id` has a child that is not deleted, counting the ops already accepted in this request. */
  hasLiveChildren(id: string): boolean;
}

// Where a task may go from each state (Product_Scope §4). Staying put is always allowed.
const TASK_TRANSITIONS: Record<string, readonly string[]> = {
  inbox: ["active", "removed", "done"],
  active: ["done", "removed", "overdue"],
  overdue: ["active", "done", "removed"],
  done: ["removed"], // nothing else leaves Done
  removed: ["active", "inbox"], // restore
};

// A new task may start in any state but done. Phase-1 data uploaded on first sync can already be removed or overdue;
// only done is refused, because a task has to be finished by the user on a device the server can see.
const TASK_INITIAL = ["inbox", "active", "overdue", "removed"];

export function checkOp(op: Op, current: Row | null, ctx: Ctx): string | null {
  // The id is already another user's row. Writing it would be skipped by the upsert's guard, so say so instead.
  if (current && !current.mine) return "foreign_id";
  switch (op.entity) {
    case "tasks":
      return checkTask(op, current);
    case "chunks":
      return checkChunk(op, current, ctx);
    case "sessions":
      return "chunk_id" in op.fields && !ctx.chunk(op.fields.chunk_id as string) ? "foreign_chunk" : null;
    default:
      return null;
  }
}

function checkTask(op: Op, current: Row | null): string | null {
  const next = op.fields.state;
  if (typeof next !== "string") return null; // a patch that leaves state alone is always allowed
  if (!current) return TASK_INITIAL.includes(next) ? null : "illegal_initial_state";
  return next === current.state || TASK_TRANSITIONS[current.state ?? ""]?.includes(next) ? null : "illegal_transition";
}

function checkChunk(op: Op, current: Row | null, ctx: Ctx): string | null {
  const f = op.fields;
  if ("task_id" in f) {
    if (current && f.task_id !== current.task_id) return "moved_task";
    if (!ctx.task(f.task_id as string)) return "foreign_task";
  }
  if (current?.deleted && f.deleted === false) return "undelete";

  // Rule 6 (UX_Flows §3.3): two levels at most. Only a new or changed parent is checked, so a row re-sent with the
  // parent it already has is not judged again. The parent must be a live top-level chunk of the same task, and the
  // chunk taking a parent must not have live children of its own (it would sit on the second level with a third below).
  if ("parent_id" in f && f.parent_id !== null && f.parent_id !== (current?.parent_id ?? null)) {
    const parent = ctx.chunk(f.parent_id as string);
    const taskId = (f.task_id as string | undefined) ?? current?.task_id;
    if (!parent || f.parent_id === op.id || parent.deleted || parent.parent_id !== null || parent.task_id !== taskId) return "bad_parent";
    if (ctx.hasLiveChildren(op.id)) return "bad_parent";
  }
  return null;
}

// The row as stored after `op` applies, so later ops in the same request judge against it (arrival order).
export function applyOp(current: Row | null, op: Op): Row {
  const f = op.fields;
  return {
    state: typeof f.state === "string" ? f.state : (current?.state ?? null),
    task_id: typeof f.task_id === "string" ? f.task_id : (current?.task_id ?? null),
    parent_id: "parent_id" in f ? (f.parent_id as string | null) : (current?.parent_id ?? null),
    deleted: typeof f.deleted === "boolean" ? f.deleted : (current?.deleted ?? false),
    mine: true, // checkOp refuses an op on a foreign row, so what applies is this user's
  };
}
