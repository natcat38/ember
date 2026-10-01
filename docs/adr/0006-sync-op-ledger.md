# ADR-0006: Sync with an op ledger and per-field last write wins

**Status:** Accepted
**Date:** 2026-10-02
**Deciders:** Natalie

## Context

`UX_Flows.md` §4 promises two things it left to Tech_Scope: a queued action retried after reconnecting never runs twice, and the same task edited on two offline devices resolves sensibly. The server is the source of truth (ADR-0001, Stack A).

## Decision

- The client records each user action as an op (`op_id`, entity, row id, changed fields) in an outbox, and reuses the `op_id` on every retry.
- `POST /api/sync` drops ops whose `op_id` is already recorded, then applies the rest and records them in one `db.batch()`, which D1 runs as a transaction.
- Conflicts are resolved per field, last write wins in **server arrival order**. Client clocks are never compared.
- The server checks every op against the state machines and returns illegal ones as `rejected`.
- Pull uses a per-user change counter (`rev`), not timestamps.

Full protocol: `Tech_Scope.md` §5.

## Options considered

| Option | Why it lost |
|---|---|
| **Op ledger + per-field LWW (chosen)** | — |
| CRDT library (Yjs or Automerge), Stack B | Correct offline merging of text, which a task list barely needs, at the cost of a sync layer to learn and debug on a 3-month runway. Stays open as a v2. |
| Whole-row last write wins by client timestamp | A rename on one device erases a *Done* from the other, and skewed phone clocks pick the wrong winner. |
| Server-only, no offline queue | Breaks the offline promise in `UX_Flows.md` §4. |

## Consequences

- Retries are safe by construction, for app syncs and Telegram button taps alike (taps reuse the same op path with a deterministic `op_id`).
- Two offline edits to the same field: the one that reaches the server last wins, silently. Acceptable for titles and dates in a personal task list.
- The `ops` table grows with every action. Prune entries older than 30 days; no client keeps an op unsent that long.
