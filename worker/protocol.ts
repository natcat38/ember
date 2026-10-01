// Wire format of POST /api/sync (Tech_Scope.md §5). The client outbox (integrated later) imports these types.

export type Entity = "tasks" | "chunks" | "sessions" | "days" | "hard_blocks";

// A patch of named fields on one row. `id` is the row id; for `days` it is the local date 'YYYY-MM-DD'.
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
// For `days` the row has `day` instead of `id`.
export interface Change {
  entity: Entity;
  row: Record<string, unknown>;
}

// An op the server refused. `op_id` is not recorded in the ledger, so the same op is refused again if retried.
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
// One request costs: 1 (identity) + up to 2 (ledger check, and an existence check when partial patches are present)
// + MAX_OPS + 2 (rev bump, ledger insert) + 2 (pull, cursor) = MAX_OPS + 7, which is 47 at 40. A request with more ops
// is refused whole with 413, and the client sends its outbox in slices of at most MAX_OPS and loops until it is empty.
// The one path that can pass 50 is a rare retry after a concurrent request wins an op (sync.ts), and only on a body
// near the cap; it fails the request with 500 and the client retries.
export const MAX_OPS = 40;

// Request body cap in characters, checked before parsing.
export const MAX_BODY_CHARS = 256 * 1024;
