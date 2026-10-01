import { MAX_BODY_CHARS, MAX_OPS, type Entity, type Op, type SyncRequest } from "./protocol";
import { ENTITIES } from "./schema";

export type Parsed = { ok: true; value: SyncRequest } | { ok: false; status: 400 | 413; error: string; detail: string };

const fail = (detail: string, status: 400 | 413 = 400, error = "invalid_body"): Parsed => ({ ok: false, status, error, detail });

const OP_ID_RE = /^[A-Za-z0-9_:.-]{1,100}$/; // UUIDs, and Telegram's deterministic `tg:<callback id>` (Tech_Scope.md §6)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// Boundary validation for POST /api/sync. Everything the SQL later interpolates or binds has been checked here:
// entity and field names against the whitelist in schema.ts, values by type and size. Nothing is applied on failure.
export function parseSyncBody(text: string): Parsed {
  if (text.length > MAX_BODY_CHARS) return fail(`body is over ${MAX_BODY_CHARS} characters`, 413, "body_too_large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail("body is not valid JSON");
  }
  if (!isRecord(body)) return fail("body must be a JSON object");
  const { cursor, ops } = body;
  if (typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor < 0) return fail("cursor must be a non-negative integer");
  if (!Array.isArray(ops)) return fail("ops must be an array");
  if (ops.length > MAX_OPS) return fail(`at most ${MAX_OPS} ops per request, got ${ops.length}`, 413, "too_many_ops");

  const out: Op[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const at = `ops[${i}]`;
    if (!isRecord(op)) return fail(`${at} must be an object`);
    const { op_id, entity, id, fields } = op;
    if (typeof op_id !== "string" || !OP_ID_RE.test(op_id)) return fail(`${at}.op_id is missing or malformed`);
    if (typeof entity !== "string" || !Object.hasOwn(ENTITIES, entity)) return fail(`${at}.entity is not a synced entity`);
    const def = ENTITIES[entity as Entity];
    if (typeof id !== "string" || !def.checkId(id)) return fail(`${at}.id is missing or malformed`);
    if (!isRecord(fields)) return fail(`${at}.fields must be an object`);
    const names = Object.keys(fields);
    if (names.length === 0) return fail(`${at}.fields must name at least one field`);
    for (const name of names) {
      const f = Object.hasOwn(def.fields, name) ? def.fields[name] : undefined;
      if (!f) return fail(`${at}.fields.${name} is not a field of ${entity}`);
      if (!f.check(fields[name])) return fail(`${at}.fields.${name} has an invalid value`);
    }
    out.push({ op_id, entity: entity as Entity, id, fields });
  }
  return { ok: true, value: { cursor, ops: out } };
}
