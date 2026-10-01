import type { Entity } from "./protocol";

// One table describes each synced entity: its D1 table, its key, and the fields a client may patch. The validator,
// the SQL builders, and the pull query all read from here, so a column can only be touched if it is listed.
// Column names are interpolated into SQL, which is safe only because they come from this file, never from a request.

export interface Field {
  /** True when `v` is acceptable for this field. */
  check(v: unknown): boolean;
  /** Value to bind to D1. */
  bind(v: unknown): string | number | null;
  /** Convert a D1 value back to the client's shape. */
  read(v: unknown): unknown;
}

export interface EntityDef {
  table: string;
  /** Column holding the row id from the op: `id`, or `day` for the days table. */
  key: "id" | "day";
  /** Fields a client may patch. */
  fields: Record<string, Field>;
  /** Fields that must be present for an op to create a row (the table's NOT NULL columns without a default). */
  required: string[];
  /** Check applied to the op's `id`. */
  checkId(id: string): boolean;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isDate = (v: unknown): v is string => typeof v === "string" && DATE_RE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const isId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;

const passthrough = (v: unknown) => v;

// Builds a field from a check; `nullable` also allows null.
function field(check: (v: unknown) => boolean, nullable = false): Field {
  return { check: (v) => (v === null ? nullable : check(v)), bind: (v) => v as string | number | null, read: passthrough };
}

const title = (max = 500) => field((v) => typeof v === "string" && v.trim().length > 0 && v.length <= max);
const enumOf = (values: string[], nullable = false) => field((v) => typeof v === "string" && values.includes(v), nullable);
const date = (nullable = false) => field(isDate, nullable);
const id = (nullable = false) => field(isId, nullable);
const int = (min = 0, max = Number.MAX_SAFE_INTEGER, nullable = false) => field((v) => isInt(v, min, max), nullable);
const real = () => field((v) => typeof v === "number" && Number.isFinite(v));

// Booleans are 0/1 in D1 (Tech_Scope.md §3) and true/false on the wire.
const bool = (): Field => ({
  check: (v) => typeof v === "boolean",
  bind: (v) => (v ? 1 : 0),
  read: (v) => v === 1 || v === true,
});

// `hard_blocks.weekdays` is a JSON array of distinct weekdays (0 = Monday) in TEXT.
const weekdays = (): Field => ({
  check: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 7 && v.every((d) => isInt(d, 0, 6)) && new Set(v).size === v.length,
  bind: (v) => JSON.stringify(v),
  read: (v) => JSON.parse(String(v)),
});

// `days.deferred` is a JSON array of ids in TEXT.
const idList = (maxItems = 500): Field => ({
  check: (v) => Array.isArray(v) && v.length <= maxItems && v.every(isId),
  bind: (v) => JSON.stringify(v),
  read: (v) => JSON.parse(String(v)),
});

export const ENTITIES: Record<Entity, EntityDef> = {
  tasks: {
    table: "tasks",
    key: "id",
    required: ["title", "state"],
    checkId: isId,
    fields: {
      title: title(),
      state: enumOf(["inbox", "active", "overdue", "done", "removed"]),
      size: enumOf(["XS", "S", "M", "L", "XL"], true),
      quick: bool(),
      holding_up: bool(),
      deadline: date(true),
      runway_start: date(true),
      pinned_on: date(true),
      snoozed_until: int(0, undefined, true),
      created_at: int(),
      updated_at: int(),
    },
  },
  chunks: {
    table: "chunks",
    key: "id",
    required: ["task_id", "title", "position", "state"],
    checkId: isId,
    fields: {
      task_id: id(),
      parent_id: id(true),
      title: title(),
      position: real(),
      state: enumOf(["todo", "focus", "done"]),
      deleted: bool(),
      updated_at: int(),
    },
  },
  sessions: {
    table: "sessions",
    key: "id",
    required: ["chunk_id", "started_at", "ended_at"],
    checkId: isId,
    fields: {
      chunk_id: id(),
      started_at: int(),
      ended_at: int(),
      completed: bool(),
    },
  },
  days: {
    table: "days",
    key: "day",
    required: [],
    checkId: isDate,
    fields: {
      confirmed_at: int(0, undefined, true),
      shutdown_at: int(0, undefined, true),
      deferred: idList(),
    },
  },
  hard_blocks: {
    table: "hard_blocks",
    key: "id",
    required: ["weekdays", "start_min", "end_min"],
    checkId: isId,
    // One block on one or more days with an optional name (Wireframes.md §8), not one row per weekday as §3 first had it.
    fields: {
      weekdays: weekdays(),
      start_min: int(0, 1439),
      end_min: int(1, 1440),
      label: field((v) => typeof v === "string" && v.length <= 100, true),
      deleted: bool(),
      updated_at: int(),
    },
  },
};

export const ENTITY_NAMES = Object.keys(ENTITIES) as Entity[];
