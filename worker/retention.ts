// Retention job (Tech_Scope.md §8, slice 15): called once a day by the cron at `0 19 * * *` UTC (03:00 Singapore).
// It deletes anonymous users who have been idle for 12 months, and prunes three tables that only grow.
//
// "Anonymous" means no row in `credentials`: a user with a passkey is kept however long they have been idle.

const DAY_MS = 86_400_000;
export const IDLE_DAYS = 365;
const OPS_KEEP_DAYS = 30; // the idempotency ledger (ADR-0006); a retry cannot arrive later than this
const HANDOFF_GRACE_MS = DAY_MS; // an expired handoff code is kept for a day, then deleted
const SENDS_KEEP_DAYS = 14; // sent and planned messages: only today's matter to the planner and the buttons (audit #32)
const OVERDUE_SENDS_KEEP_DAYS = 60; // an overdue message stays, because it silences the task until its deadline changes (scheduler.ts, buildPlan)

export const MAX_STATEMENTS = 40; // below the free plan's 50 D1 queries per invocation (§11), with margin
export const USERS_PER_BATCH = 100;

// Every table that holds a user_id, except `credentials` (an idle anonymous user has none) and `users` itself,
// which is deleted last so the subquery below still finds the batch's users while the child rows go. A new per-user
// table (its user column called `user_id`) is added to this list and nothing else changes: BATCHES below shrinks by
// itself as the list grows. A passkey table is not listed here (those users are never deleted).
const USER_TABLES = ["tasks", "chunks", "sessions", "days", "hard_blocks", "settings", "journal", "ops", "sends", "handoffs", "push_subscriptions"] as const;

// Statement arithmetic (the cap is MAX_STATEMENTS = 40 per call):
//   housekeeping   3   one DELETE on ops, one on handoffs, one on sends
//   more check     1   one SELECT, after the last full batch
//   one batch     12   one DELETE per table in USER_TABLES (11), plus one on users
//   batches        3   floor((40 - 3 - 1) / 12), so 3 + 3 x 12 + 1 = 40 statements at most
// 3 batches x 100 users clears 300 users a day, far above the rate at which anonymous users go idle. The cap is
// on statements, not rows, so a batch may be larger; a batch that loses a race with a returning user simply
// deletes fewer.
const HOUSEKEEPING_STATEMENTS = 3;
const MORE_CHECK_STATEMENTS = 1;
const BATCHES = Math.floor((MAX_STATEMENTS - HOUSEKEEPING_STATEMENTS - MORE_CHECK_STATEMENTS) / (USER_TABLES.length + 1));

export interface RetentionResult {
  /** Idle anonymous users deleted. */
  users: number;
  /** Rows deleted from the other tables because their user went. */
  userRows: number;
  /** Idempotency-ledger rows older than 30 days deleted. */
  opsPruned: number;
  /** Handoff codes that expired more than a day ago, deleted. */
  handoffsPruned: number;
  /** Sends older than 14 days (overdue ones: 60) deleted. */
  sendsPruned: number;
  /** True when idle users remain; tomorrow's run picks them up. */
  more: boolean;
}

// One idle user per row of this subquery; it is bound to ?1 (cutoff) and ?2 (limit). Evaluated afresh by each
// statement of a batch, and a batch is one transaction, so every statement sees the same users.
const IDLE_USERS = `SELECT id FROM users
  WHERE last_seen_at < ?1 AND NOT EXISTS (SELECT 1 FROM credentials WHERE credentials.user_id = users.id)
  ORDER BY last_seen_at, id LIMIT ?2`;

export async function runRetention(db: D1Database, now: number, opts: { batchSize?: number } = {}): Promise<RetentionResult> {
  const batchSize = opts.batchSize ?? USERS_PER_BATCH;
  const cutoff = now - IDLE_DAYS * DAY_MS;
  const result: RetentionResult = { users: 0, userRows: 0, opsPruned: 0, handoffsPruned: 0, sendsPruned: 0, more: false };

  // Housekeeping first, so the ops, handoffs and sends of the users deleted below count as user rows, not as pruned.
  const [ops, handoffs, sends] = await db.batch([
    db.prepare("DELETE FROM ops WHERE applied_at < ?1").bind(now - OPS_KEEP_DAYS * DAY_MS),
    db.prepare("DELETE FROM handoffs WHERE expires_at < ?1").bind(now - HANDOFF_GRACE_MS),
    db
      .prepare("DELETE FROM sends WHERE due_at < ?1 AND (kind != 'overdue' OR due_at < ?2)")
      .bind(now - SENDS_KEEP_DAYS * DAY_MS, now - OVERDUE_SENDS_KEEP_DAYS * DAY_MS),
  ]);
  result.opsPruned = ops.meta.changes;
  result.handoffsPruned = handoffs.meta.changes;
  result.sendsPruned = sends.meta.changes;

  let lastBatchFull = false;
  for (let i = 0; i < BATCHES; i++) {
    const statements = [
      ...USER_TABLES.map((table) => db.prepare(`DELETE FROM ${table} WHERE user_id IN (${IDLE_USERS})`).bind(cutoff, batchSize)),
      db.prepare(`DELETE FROM users WHERE id IN (${IDLE_USERS})`).bind(cutoff, batchSize),
    ];
    const results = await db.batch(statements);
    const users = results[results.length - 1].meta.changes;
    result.users += users;
    for (const r of results.slice(0, -1)) result.userRows += r.meta.changes;

    lastBatchFull = users === batchSize;
    if (!lastBatchFull) break; // the queue is empty; the remaining batches would be no-ops
  }

  // Only a full last batch can leave idle users behind, and then only a look tells whether it did.
  if (lastBatchFull) {
    const left = await db.prepare(`SELECT 1 AS n FROM (${IDLE_USERS})`).bind(cutoff, 1).first();
    result.more = left !== null;
  }
  return result;
}
