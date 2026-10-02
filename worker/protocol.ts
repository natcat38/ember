// Wire format of POST /api/sync (Tech_Scope.md §5). The client outbox (integrated later) imports these types.

export type Entity = "tasks" | "chunks" | "sessions" | "days" | "hard_blocks" | "settings" | "journal";

// A patch of named fields on one row. `id` is the row id; for `days` and `journal` it is the local date 'YYYY-MM-DD'.
// `op_id` is made once when the user acts and reused on every retry.
export interface Op {
  op_id: string;
  entity: Entity;
  id: string;
  fields: Record<string, unknown>;
}

export interface SyncRequest {
  cursor: number;
  ops: Op[];
}

// One changed row, in the client's entity shape (booleans as booleans, `days.deferred` as an array) plus `rev`.
// For `days` and `journal` the row has `day` instead of `id`.
export interface Change {
  entity: Entity;
  row: Record<string, unknown>;
}

// An op the server refused. `op_id` is not recorded in the ledger, so the same op is refused again if retried.
// `reason` is one of these stable codes (the rules live in rules.ts; Product_Scope §4, UX_Flows §3.3):
//   incomplete_create      a partial patch of a row that does not exist
//   illegal_transition     a task state change the state machine forbids (for example, done to inbox)
//   illegal_initial_state  a new task created as done
//   foreign_task           a chunk's task_id is not one of this user's tasks (or does not exist)
//   moved_task             a chunk was pointed at a different task than the one it belongs to
//   bad_parent             a chunk's parent_id is not a live, top-level chunk of the same task, or the chunk taking a
//                          parent has live children of its own (two levels at most)
//   undelete               a deleted chunk was set back to deleted = false
//   foreign_chunk          a session's chunk_id is not one of this user's chunks (or does not exist)
//   foreign_id             the op's own row id already belongs to another user (tasks, chunks, sessions and hard_blocks
//                          are keyed by id alone), for a complete op or a patch alike
export interface Rejected {
  op_id: string;
  reason: string;
}

export interface SyncResponse {
  cursor: number;
  changes: Change[];
  rejected: Rejected[];
}

// D1 allows 50 queries per invocation on the free plan and every statement in a db.batch() counts (Tech_Scope.md §11).
// D1 also caps a compound SELECT at 5 terms, and there are 7 synced tables (8 kinds of row in the lookup, counting a
// chunk's children), so the row lookup and the pull each take up to 2 statements; an eighth table would still fit. One request costs: up to 2 (identity: a stale cookie's lookup, then the new user) + up to 3 (ledger
// and rev read, row lookup) + MAX_OPS + 3 (rev guard row, rev bump, ledger insert) + 3 (pull, cursor) = MAX_OPS + 11,
// which is 49 at 38. A request with more ops is refused whole with 413, and the client sends its outbox in slices of at
// most MAX_OPS and loops until it is empty. A request that loses a race with another of the same user's (the rev guard
// in sync.ts) is not retried in the Worker, because a second pass would not fit: it answers 503 with Retry-After and
// the client sends the same ops again.
export const MAX_OPS = 38;

// Request body cap in characters, checked before parsing.
export const MAX_BODY_CHARS = 256 * 1024;
