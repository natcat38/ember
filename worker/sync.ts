import { cookieFor, resolveUser } from "./identity";
import { MAX_BODY_CHARS, type Change, type Entity, type Op, type Rejected, type SyncResponse } from "./protocol";
import { checkOp } from "./rules";
import { ENTITIES, ENTITY_NAMES } from "./schema";
import { parseSyncBody } from "./validate";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

// POST /api/sync { cursor, ops } -> { cursor, changes, rejected }  (Tech_Scope.md §5, ADR-0006)
export async function handleSync(request: Request, env: { DB: D1Database }): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_CHARS * 4) return json({ error: "body_too_large", detail: "body is too large" }, 413);

  // Validate before touching the database, so a malformed request creates no user and sets no cookie.
  const parsed = parseSyncBody(await request.text());
  if (!parsed.ok) return json({ error: parsed.error, detail: parsed.detail }, parsed.status);

  const now = Date.now();
  const { uid } = await resolveUser(env.DB, request, now);
  const result = await sync(env.DB, uid, parsed.value.cursor, parsed.value.ops, now);
  return json(result, 200, { "Set-Cookie": cookieFor(uid) });
}

interface Planned {
  op: Op;
  /** True for a partial patch of a row that exists: UPDATE. False for an op that names every required field: upsert. */
  update: boolean;
}

// A concurrent request recorded one of our op ids between our check and our batch. The batch rolled back whole, so
// nothing of ours was applied; the check is re-run and now filters those ops out (Tech_Scope.md §5).
const isLedgerCollision = (e: unknown) => e instanceof Error && /UNIQUE constraint failed: ops\./.test(e.message);
const MAX_ATTEMPTS = 3;

const isComplete = (op: Op) => ENTITIES[op.entity].required.every((f) => f in op.fields);

async function sync(db: D1Database, uid: string, cursor: number, requested: Op[], now: number): Promise<SyncResponse> {
  const seen = new Set<string>(); // the same op_id twice in one body counts once
  const ops = requested.filter((o) => !seen.has(o.op_id) && seen.add(o.op_id));

  for (let attempt = 1; ; attempt++) {
    const { applied, existing } = await lookup(db, uid, ops);
    const { plan, rejected } = planOps(ops, applied, existing);
    try {
      return { ...(await commit(db, uid, plan, cursor, now)), rejected };
    } catch (e) {
      if (attempt < MAX_ATTEMPTS && isLedgerCollision(e)) continue;
      throw e;
    }
  }
}

// Which of these op ids are already in the ledger, and which rows that partial patches target exist. A complete op
// needs no existence check because it upserts. D1 allows at most 5 terms in a compound SELECT, so the ledger query
// and the existence query are separate statements, and the existence query has one term per entity named.
async function lookup(db: D1Database, uid: string, ops: Op[]) {
  const applied = new Set<string>();
  const existing = new Set<string>();
  if (!ops.length) return { applied, existing };

  const stmts = [
    db
      .prepare("SELECT op_id AS id FROM ops WHERE user_id = ?1 AND op_id IN (SELECT value FROM json_each(?2))")
      .bind(uid, JSON.stringify(ops.map((o) => o.op_id))),
  ];
  const partial = ops.filter((o) => !isComplete(o));
  if (partial.length) {
    const entities = ENTITY_NAMES.filter((n) => partial.some((o) => o.entity === n));
    const terms = entities.map((name) => {
      const { table, key } = ENTITIES[name];
      return `SELECT '${name}' AS entity, ${key} AS id FROM ${table} WHERE user_id = ?1 AND ${key} IN (SELECT value FROM json_each(?2))`;
    });
    stmts.push(db.prepare(terms.join(" UNION ALL ")).bind(uid, JSON.stringify(partial.map((o) => o.id))));
  }

  const [ledger, rows] = await db.batch<{ id: string; entity?: string }>(stmts);
  for (const r of ledger.results) applied.add(r.id);
  for (const r of rows?.results ?? []) existing.add(`${r.entity}:${r.id}`);
  return { applied, existing };
}

// Drop ops already in the ledger, refuse the ones that cannot be applied, and mark each remaining op as an upsert
// or a patch. Arrival order is preserved: it decides which write wins a conflict.
function planOps(ops: Op[], applied: Set<string>, existing: Set<string>) {
  const plan: Planned[] = [];
  const rejected: Rejected[] = [];
  const exists = new Set(existing); // grows as earlier ops in this request create rows
  for (const op of ops) {
    if (applied.has(op.op_id)) continue;
    const rowKey = `${op.entity}:${op.id}`;
    const complete = isComplete(op);
    const reason = checkOp(op) ?? (complete || exists.has(rowKey) ? null : "incomplete_create");
    if (reason) {
      rejected.push({ op_id: op.op_id, reason });
      continue;
    }
    exists.add(rowKey);
    plan.push({ op, update: !complete });
  }
  return { plan, rejected };
}

// Everything below runs as one db.batch(), which D1 executes as a single transaction: the rev bump, the ledger rows,
// the writes, and the pull. Nothing interleaves, so the revs are consecutive, the cursor read matches the rows read,
// and a failure anywhere leaves no trace.
async function commit(db: D1Database, uid: string, plan: Planned[], cursor: number, now: number) {
  const stmts: D1PreparedStatement[] = [];
  const n = plan.length;
  if (n) {
    stmts.push(db.prepare("UPDATE users SET rev = rev + ?1 WHERE id = ?2").bind(n, uid));
    stmts.push(
      db
        .prepare("INSERT INTO ops (user_id, op_id, applied_at) SELECT ?1, value, ?2 FROM json_each(?3)")
        .bind(uid, now, JSON.stringify(plan.map((p) => p.op.op_id))),
    );
    // The rev bump reserved n numbers, ending at the user's current rev. Op i (arrival order) takes the (i+1)th of them.
    plan.forEach((p, i) => stmts.push(writeStatement(db, uid, p, n - 1 - i)));
  }
  stmts.push(pullStatement(db, uid, cursor));
  stmts.push(db.prepare("SELECT rev FROM users WHERE id = ?1").bind(uid));

  const results = await db.batch(stmts);
  const rows = results[results.length - 2].results as { entity: Entity; row: string }[];
  const newCursor = (results[results.length - 1].results as { rev: number }[])[0].rev;
  return { cursor: newCursor, changes: rows.map(toChange) };
}

const REV = "(SELECT rev FROM users WHERE id = ?) - ?";

// Per-field last write wins: only the fields the op names are written. `back` is how far below the user's current
// rev this op's rev sits.
function writeStatement(db: D1Database, uid: string, { op, update }: Planned, back: number): D1PreparedStatement {
  const def = ENTITIES[op.entity];
  const names = Object.keys(op.fields);
  const values = names.map((n) => def.fields[n].bind(op.fields[n]));
  if (update) {
    const sets = names.map((n) => `${n} = ?`).join(", ");
    return db
      .prepare(`UPDATE ${def.table} SET ${sets}, rev = ${REV} WHERE ${def.key} = ? AND user_id = ?`)
      .bind(...values, uid, back, op.id, uid);
  }
  // Insert, or patch if a concurrent request created the row after our existence check. The WHERE keeps a stray id
  // that belongs to another user from being overwritten (days is keyed per user, so it needs no guard).
  const cols = names.join(", ");
  const marks = names.map(() => "?").join(", ");
  const sets = [...names, "rev"].map((n) => `${n} = excluded.${n}`).join(", ");
  const conflict = op.entity === "days" ? "ON CONFLICT (user_id, day) DO UPDATE SET" : "ON CONFLICT (id) DO UPDATE SET";
  const guard = op.entity === "days" ? "" : ` WHERE ${def.table}.user_id = excluded.user_id`;
  return db
    .prepare(`INSERT INTO ${def.table} (${def.key}, user_id, ${cols}, rev) VALUES (?, ?, ${marks}, ${REV}) ${conflict} ${sets}${guard}`)
    .bind(op.id, uid, ...values, uid, back);
}

// The user's rows with rev > cursor, across every synced table, oldest change first. Each row comes back as one JSON
// object so the five tables need one statement, not five.
function pullStatement(db: D1Database, uid: string, cursor: number): D1PreparedStatement {
  const selects = ENTITY_NAMES.map((name) => {
    const { table, key, fields } = ENTITIES[name];
    const pairs = [`'${key}', ${key}`, ...Object.keys(fields).map((f) => `'${f}', ${f}`), `'rev', rev`].join(", ");
    return `SELECT '${name}' AS entity, rev, json_object(${pairs}) AS row FROM ${table} WHERE user_id = ?1 AND rev > ?2`;
  });
  return db.prepare(`SELECT entity, row FROM (${selects.join(" UNION ALL ")}) ORDER BY rev`).bind(uid, cursor);
}

// D1 stores booleans as 0/1 and `deferred` as JSON text; the client gets its own entity shape back.
function toChange({ entity, row }: { entity: Entity; row: string }): Change {
  const raw = JSON.parse(row) as Record<string, unknown>;
  const fields = ENTITIES[entity].fields;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = Object.hasOwn(fields, k) && v !== null ? fields[k].read(v) : v;
  return { entity, row: out };
}
