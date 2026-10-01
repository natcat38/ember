import type { Op } from "./protocol";

// Seam for slice 9, "Server rules + conflicts" (Tech_Scope.md §5, §10): the state machines of Product_Scope §4,
// enforced on the server. Slice 8 accepts every well-formed op, so this returns null.
//
// Slice 9 returns a short reason string for an illegal op (for example "nothing leaves done"). sync.ts then puts
// the op in `rejected`, leaves it out of the ledger and the batch, and the client drops its local change and takes
// the server row. To judge an op the rule needs the row's current state, so slice 9 also extends the existence
// lookup in sync.ts to load it, and tracks the state ops earlier in the same request would leave behind.
export function checkOp(_op: Op): string | null {
  return null;
}
