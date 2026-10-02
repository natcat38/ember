import { cookieFor, resolveUser } from "./identity";
import { MAX_BODY_CHARS, type Change, type Entity, type Op, type Rejected, type SyncResponse } from "./protocol";
import { applyOp, checkOp, type Ctx, type Row } from "./rules";
import { ENTITIES, ENTITY_NAMES, groupsOf5 } from "./schema";
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
  const headers = { "Set-Cookie": cookieFor(uid) };
  try {
    const result = await sync(env.DB, uid, parsed.value.cursor, parsed.value.ops, now);
    return json(result, 200, headers);
  } catch (e) {
    // Nothing was applied. The client keeps its outbox and sends the same op ids again; the ledger makes that safe.
    if (e instanceof SyncConflict) return json({ error: "conflict", detail: "another request changed your data first; try again" }, 503, { ...headers, "Retry-After": "1" });
    throw e;
  }
}

interface Planned {
  op: Op;
  /** True for a partial patch of a row that exists: UPDATE. False for an op that names every required field: upsert. */
  update: boolean;
}

/** Another request for the same user committed after this one read its rows. The batch rolled back whole. */
export class SyncConflict extends Error {
  constructor(options?: ErrorOptions) {
    super("a concurrent request changed this user's rows between our read and our write", options);
  }
}

// The guard row's batch statement hit a primary key, so some other request wrote the ledger first. The batch rolled back.
const isLedgerCollision = (e: unknown) => e instanceof Error && /UNIQUE constraint failed: ops\./.test(e.message);

const isComplete = (op: Op) => ENTITIES[op.entity].required.every((f) => f in op.fields);

// One request is three steps: lookup (one batch, reads), planOps (pure, judges the ops against what was read), and
// commit (one batch, writes). Another request can run between the first and the last; see the rev guard in commit.
export async function sync(db: D1Database, uid: string, cursor: number, requested: Op[], now: number): Promise<SyncResponse> {
  const seen = new Set<string>(); // the same op_id twice in one body counts once
  const ops = requested.filter((o) => !seen.has(o.op_id) && seen.add(o.op_id));

  const { applied, rows, rev } = await lookup(db, uid, ops);
  const { plan, rejected } = planOps(ops, applied, rows);
  return { ...(await commit(db, uid, plan, cursor, now, rev)), rejected };
}

const rowKey = (entity: Entity, id: string) => `${entity}:${id}`;

// What the rules read from each table, in one shape so the lookup can be a single compound SELECT.
const LOOKUP_COLUMNS: Record<Entity, string> = {
  tasks: "state, NULL AS task_id, NULL AS parent_id, 0 AS deleted",
  chunks: "state, task_id, parent_id, deleted",
  sessions: "NULL AS state, NULL AS task_id, NULL AS parent_id, 0 AS deleted",
  days: "NULL AS state, NULL AS task_id, NULL AS parent_id, 0 AS deleted",
  hard_blocks: "NULL AS state, NULL AS task_id, NULL AS parent_id, 0 AS deleted",
  settings: "NULL AS state, NULL AS task_id, NULL AS parent_id, 0 AS deleted",
  journal: "NULL AS state, NULL AS task_id, NULL AS parent_id, 0 AS deleted",
};

/** What the lookup loads: the rows of an entity by id, or (`children`) the live chunks under the given parent ids. */
type Wanted = Entity | "children";

// The row ids this request needs the stored state of. The tables keyed by id alone (tasks, chunks, sessions,
// hard_blocks) are always loaded for every op: the state rules judge them, a complete op may be an upsert of a row that
// exists, and the id may be another user's row (foreign_id). The per-user tables (days, settings, journal) are loaded only for a
// partial patch, to know whether the row exists. Rows an op refers to are loaded too: a chunk's task and parent, and a
// session's chunk. A chunk op that sets a parent also loads the live children of that chunk (Rule 6: a chunk with
// children of its own cannot take a parent).
function wantedIds(ops: Op[]): Map<Wanted, Set<string>> {
  const wanted = new Map<Wanted, Set<string>>();
  const want = (kind: Wanted, id: unknown) => {
    if (typeof id === "string") (wanted.get(kind) ?? wanted.set(kind, new Set()).get(kind)!).add(id);
  };
  for (const op of ops) {
    if (!ENTITIES[op.entity].perUser || !isComplete(op)) want(op.entity, op.id);
    if (op.entity === "chunks") {
      want("tasks", op.fields.task_id);
      want("chunks", op.fields.parent_id);
      if (typeof op.fields.parent_id === "string") want("children", op.id);
    }
    if (op.entity === "sessions") want("chunks", op.fields.chunk_id);
  }
  return wanted;
}

// One term of the row query. For the tables keyed by id alone the user filter is dropped, so an id that another user
// owns still comes back, with `mine` = 0 (checkOp then answers foreign_id). The per-user tables are always mine.
function lookupTerm(kind: Wanted, param: number): string {
  const ids = `IN (SELECT value FROM json_each(?${param}))`;
  if (kind === "children") return `SELECT 'chunks' AS entity, id, ${LOOKUP_COLUMNS.chunks}, 1 AS mine FROM chunks WHERE user_id = ?1 AND deleted = 0 AND parent_id ${ids}`;
  const { table, key, perUser } = ENTITIES[kind];
  const scope = perUser ? "user_id = ?1 AND " : "";
  return `SELECT '${kind}' AS entity, ${key} AS id, ${LOOKUP_COLUMNS[kind]}, ${perUser ? "1" : "user_id = ?1"} AS mine FROM ${table} WHERE ${scope}${key} ${ids}`;
}

// Which of these op ids are already in the ledger, the user's `rev` as of this read, and the stored state of every row
// the ops touch or refer to. The rev is the snapshot the checks are judged against; commit's guard row uses it.
//
// Statements: the ledger query carries the rev as one more UNION term, so it is 1. D1 allows at most 5 terms in a
// compound SELECT, so the row query is separate, one term per kind needed (the four id-keyed tables and `children`
// make 5; days, settings and journal add up to three more, hence the groups of 5): 1 or 2 more. All in one batch, which D1
// runs as one transaction, so the rev and the rows are from the same moment.
export async function lookup(db: D1Database, uid: string, ops: Op[]) {
  const applied = new Set<string>();
  const rows = new Map<string, Row>();
  if (!ops.length) return { applied, rows, rev: 0 };

  const stmts = [
    db
      .prepare("SELECT op_id AS id, NULL AS rev FROM ops WHERE user_id = ?1 AND op_id IN (SELECT value FROM json_each(?2)) UNION ALL SELECT NULL, rev FROM users WHERE id = ?1")
      .bind(uid, JSON.stringify(ops.map((o) => o.op_id))),
  ];
  for (const group of groupsOf5([...wantedIds(ops)])) {
    const terms = group.map(([kind], i) => lookupTerm(kind, i + 2));
    stmts.push(db.prepare(terms.join(" UNION ALL ")).bind(uid, ...group.map(([, ids]) => JSON.stringify([...ids]))));
  }

  const [ledger, ...found] = await db.batch<{ id: string | null; rev?: number | null; entity?: Entity } & Record<string, unknown>>(stmts);
  let rev = 0;
  for (const r of ledger.results) {
    if (r.id === null) rev = r.rev as number;
    else applied.add(r.id);
  }
  for (const r of found.flatMap((f) => f.results)) {
    rows.set(rowKey(r.entity!, r.id!), {
      state: r.state as string | null,
      task_id: r.task_id as string | null,
      parent_id: r.parent_id as string | null,
      deleted: r.deleted === 1,
      mine: r.mine === 1,
    });
  }
  return { applied, rows, rev };
}

// Drop ops already in the ledger, refuse the ones that cannot be applied, and mark each remaining op as an upsert
// or a patch. Arrival order is preserved: it decides which write wins a conflict, and each accepted op becomes the
// stored state the next op is judged against. A rejected op changes nothing, so it is not part of that state.
export function planOps(ops: Op[], applied: Set<string>, stored: Map<string, Row>) {
  const plan: Planned[] = [];
  const rejected: Rejected[] = [];
  const rows = new Map(stored);
  // task and chunk answer only for this user's rows: a foreign id was loaded so it can be named, not so it can be used.
  const mine = (key: string) => {
    const row = rows.get(key);
    return row?.mine ? row : null;
  };
  const ctx: Ctx = {
    task: (id) => mine(rowKey("tasks", id)),
    chunk: (id) => mine(rowKey("chunks", id)),
    // `rows` holds the children read from the database and every chunk an accepted op created or changed, so a child
    // created, moved or deleted earlier in this request is already counted.
    hasLiveChildren: (id) => [...rows].some(([key, r]) => key.startsWith("chunks:") && r.mine && !r.deleted && r.parent_id === id),
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

// Everything below runs as one db.batch(), which D1 executes as a single transaction: the guard row, the rev bump, the
// ledger rows, the writes, and the pull. Nothing interleaves, so the revs are consecutive, the cursor read matches the
// rows read, and a failure anywhere leaves no trace.
//
// The guard row is what makes the read in lookup safe to act on. lookup and commit are two batches, so two requests for
// the same user can both read the same old rows and both pass a check against them (two devices moving a task out of
// Done, say). Each write request therefore starts by inserting ledger row '#rev:<rev it read>' (plain INSERT, no OR
// IGNORE). Every commit that writes bumps users.rev, so the next request reads a different number; two requests that
// read the same one collide on the primary key, D1 rolls back the loser's whole batch, and we throw SyncConflict, which
// handleSync answers with 503 and Retry-After. We do not retry here: a second lookup and commit would not fit in the 50
// statement budget (protocol.ts). The client resends the same op ids, so the retry is safe. The '#' is outside the
// op_id alphabet (validate.ts), so a client can never produce a guard row's id. Retention prunes guard rows with the
// rest of the ledger after 30 days.
//
// Statements: guard 1 + rev bump 1 + ledger insert 1 + n writes + pull 2 + cursor 1 = n + 6 (the pull is up to 2).
export async function commit(db: D1Database, uid: string, plan: Planned[], cursor: number, now: number, seenRev: number) {
  const stmts: D1PreparedStatement[] = [];
  const n = plan.length;
  if (n) {
    // D1 binds a JS number as a float, so the cast keeps the id '#rev:5', not '#rev:5.0'.
    stmts.push(db.prepare("INSERT INTO ops (user_id, op_id, applied_at) VALUES (?1, '#rev:' || CAST(?2 AS INTEGER), ?3)").bind(uid, seenRev, now));
    stmts.push(db.prepare("UPDATE users SET rev = rev + ?1 WHERE id = ?2").bind(n, uid));
    stmts.push(
      db
        .prepare("INSERT INTO ops (user_id, op_id, applied_at) SELECT ?1, value, ?2 FROM json_each(?3)")
        .bind(uid, now, JSON.stringify(plan.map((p) => p.op.op_id))),
    );
    // The rev bump reserved n numbers, ending at the user's current rev. Op i (arrival order) takes the (i+1)th of them.
    plan.forEach((p, i) => stmts.push(writeStatement(db, uid, p, n - 1 - i)));
  }
  const pulls = pullStatements(db, uid, cursor);
  stmts.push(...pulls);
  stmts.push(db.prepare("SELECT rev FROM users WHERE id = ?1").bind(uid));

  let results;
  try {
    results = await db.batch(stmts);
  } catch (e) {
    if (n && isLedgerCollision(e)) throw new SyncConflict({ cause: e });
    throw e;
  }
  const rows = results
    .slice(results.length - 1 - pulls.length, results.length - 1)
    .flatMap((r) => r.results as { entity: Entity; rev: number; row: string }[])
    .sort((a, b) => a.rev - b.rev);
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
  // that belongs to another user from being overwritten (days and settings are keyed per user, so they need no guard).
  const cols = names.join(", ");
  const marks = names.map(() => "?").join(", ");
  const sets = [...names, "rev"].map((n) => `${n} = excluded.${n}`).join(", ");
  const conflict = def.perUser ? `ON CONFLICT (user_id, ${def.key}) DO UPDATE SET` : "ON CONFLICT (id) DO UPDATE SET";
  const guard = def.perUser ? "" : ` WHERE ${def.table}.user_id = excluded.user_id`;
  return db
    .prepare(`INSERT INTO ${def.table} (${def.key}, user_id, ${cols}, rev) VALUES (?, ?, ${marks}, ${REV}) ${conflict} ${sets}${guard}`)
    .bind(op.id, uid, ...values, uid, back);
}

// The user's rows with rev > cursor, across every synced table; the caller sorts them oldest change first. Each row
// comes back as one JSON object, so the tables need one statement per group of 5, not one each.
function pullStatements(db: D1Database, uid: string, cursor: number): D1PreparedStatement[] {
  return groupsOf5(ENTITY_NAMES).map((names) => {
    const selects = names.map((name) => {
      const { table, key, fields } = ENTITIES[name];
      const pairs = [`'${key}', ${key}`, ...Object.keys(fields).map((f) => `'${f}', ${f}`), `'rev', rev`].join(", ");
      return `SELECT '${name}' AS entity, rev, json_object(${pairs}) AS row FROM ${table} WHERE user_id = ?1 AND rev > ?2`;
    });
    return db.prepare(selects.join(" UNION ALL ")).bind(uid, cursor);
  });
}

// D1 stores booleans as 0/1 and `deferred` as JSON text; the client gets its own entity shape back.
function toChange({ entity, row }: { entity: Entity; row: string }): Change {
  const raw = JSON.parse(row) as Record<string, unknown>;
  const fields = ENTITIES[entity].fields;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = Object.hasOwn(fields, k) && v !== null ? fields[k].read(v) : v;
  return { entity, row: out };
}
