import { cookieFor, resolveUser } from "./identity";
import { MAX_BODY_CHARS, type Change, type Entity, type Op, type Rejected, type SyncResponse } from "./protocol";
import { applyOp, checkOp, type Ctx, type Row } from "./rules";
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

export async function sync(db: D1Database, uid: string, cursor: number, requested: Op[], now: number): Promise<SyncResponse> {
  const seen = new Set<string>(); // the same op_id twice in one body counts once
  const ops = requested.filter((o) => !seen.has(o.op_id) && seen.add(o.op_id));

  for (let attempt = 1; ; attempt++) {
    const { applied, rows } = await lookup(db, uid, ops);
    const { plan, rejected } = planOps(ops, applied, rows);
    try {
      return { ...(await commit(db, uid, plan, cursor, now)), rejected };
    } catch (e) {
      if (attempt < MAX_ATTEMPTS && isLedgerCollision(e)) continue;
      throw e;
    }
  }
}

const rowKey = (entity: Entity, id: string) => `${entity}:${id}`;

// What the rules read from each table, in one shape so the lookup can be a single compound SELECT.
const LOOKUP_COLUMNS: Record<Entity, string> = {
  tasks: "state, NULL AS task_id, NULL AS parent_id, 0 AS deleted",
  chunks: "state, task_id, parent_id, deleted",
  sessions: "NULL AS state, NULL AS task_id, NULL AS parent_id, 0 AS deleted",
  days: "NULL AS state, NULL AS task_id, NULL AS parent_id, 0 AS deleted",
  hard_blocks: "NULL AS state, NULL AS task_id, NULL AS parent_id, 0 AS deleted",
};

// The row ids this request needs the stored state of. Tasks and chunks are always loaded, because their state rules
// judge every op (and a complete op may be an upsert of a row that exists). The other entities are loaded only for
// partial patches, to know whether the row exists. Rows an op refers to are loaded too: a chunk's task and parent,
// and a session's chunk.
function wantedIds(ops: Op[]): Map<Entity, Set<string>> {
  const wanted = new Map<Entity, Set<string>>();
  const want = (entity: Entity, id: unknown) => {
    if (typeof id === "string") (wanted.get(entity) ?? wanted.set(entity, new Set()).get(entity)!).add(id);
  };
  for (const op of ops) {
    if (op.entity === "tasks" || op.entity === "chunks" || !isComplete(op)) want(op.entity, op.id);
    if (op.entity === "chunks") {
      want("tasks", op.fields.task_id);
      want("chunks", op.fields.parent_id);
    }
    if (op.entity === "sessions") want("chunks", op.fields.chunk_id);
  }
  return wanted;
}

// Which of these op ids are already in the ledger, and the stored state of every row the ops touch or refer to.
// Two statements however many ops there are. D1 allows at most 5 terms in a compound SELECT, so the ledger query and
// the row query are separate, and the row query has one term per entity needed (five at most, one per table).
async function lookup(db: D1Database, uid: string, ops: Op[]) {
  const applied = new Set<string>();
  const rows = new Map<string, Row>();
  if (!ops.length) return { applied, rows };

  const stmts = [
    db
      .prepare("SELECT op_id AS id FROM ops WHERE user_id = ?1 AND op_id IN (SELECT value FROM json_each(?2))")
      .bind(uid, JSON.stringify(ops.map((o) => o.op_id))),
  ];
  const wanted = [...wantedIds(ops)];
  if (wanted.length) {
    const terms = wanted.map(([name], i) => {
      const { table, key } = ENTITIES[name];
      return `SELECT '${name}' AS entity, ${key} AS id, ${LOOKUP_COLUMNS[name]} FROM ${table} WHERE user_id = ?1 AND ${key} IN (SELECT value FROM json_each(?${i + 2}))`;
    });
    stmts.push(db.prepare(terms.join(" UNION ALL ")).bind(uid, ...wanted.map(([, ids]) => JSON.stringify([...ids]))));
  }

  const [ledger, found] = await db.batch<{ id: string; entity?: Entity } & Record<string, unknown>>(stmts);
  for (const r of ledger.results) applied.add(r.id);
  for (const r of found?.results ?? []) {
    rows.set(rowKey(r.entity!, r.id), { state: r.state as string | null, task_id: r.task_id as string | null, parent_id: r.parent_id as string | null, deleted: r.deleted === 1 });
  }
  return { applied, rows };
}

// Drop ops already in the ledger, refuse the ones that cannot be applied, and mark each remaining op as an upsert
// or a patch. Arrival order is preserved: it decides which write wins a conflict, and each accepted op becomes the
// stored state the next op is judged against. A rejected op changes nothing, so it is not part of that state.
function planOps(ops: Op[], applied: Set<string>, stored: Map<string, Row>) {
  const plan: Planned[] = [];
  const rejected: Rejected[] = [];
  const rows = new Map(stored);
  const ctx: Ctx = {
    task: (id) => rows.get(rowKey("tasks", id)) ?? null,
    chunk: (id) => rows.get(rowKey("chunks", id)) ?? null,
  };
  for (const op of ops) {
    if (applied.has(op.op_id)) continue;
    const key = rowKey(op.entity, op.id);
    const current = rows.get(key) ?? null;
    const complete = isComplete(op);
    const reason = !complete && !current ? "incomplete_create" : checkOp(op, current, ctx);
    if (reason) {
      rejected.push({ op_id: op.op_id, reason });
      continue;
    }
    rows.set(key, applyOp(current, op));
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
