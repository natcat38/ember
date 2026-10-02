import { MAX_TITLE_CHARS } from "../core/task";
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
  /** Column holding the row id from the op: `id`, or `day` for the days and journal tables. */
  key: "id" | "day";
  /** The key is unique per user only (days, settings, journal), so the primary key is (user_id, key) and no guard is needed. */
  perUser?: boolean;
  /** Fields a client may patch. */
  fields: Record<string, Field>;
  /** Fields that must be present for an op to create a row (the table's NOT NULL columns without a default). */
  required: string[];
  /** Check applied to the op's `id`. */
  checkId(id: string): boolean;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar day. toISOString throws on an invalid Date (month 13, day 40), so the NaN check comes first: a bad date
// is a 400, not a 500. A date that rolls over (February 30) parses, then fails the round trip.
const isDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const t = new Date(`${v}T00:00:00Z`).getTime();
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(v);
};
// An IANA time zone the runtime knows; null means "the browser's", resolved on the device.
const isZone = (v: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
};
const isId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;

const passthrough = (v: unknown) => v;

// Builds a field from a check; `nullable` also allows null.
function field(check: (v: unknown) => boolean, nullable = false): Field {
  return { check: (v) => (v === null ? nullable : check(v)), bind: (v) => v as string | number | null, read: passthrough };
}

/** The tasks.title limit: the capture sheet's (UX_Flows §3.1) and Telegram capture's too. */
export { MAX_TITLE_CHARS }; // one limit, in core: the client clamps to it before the server checks it
const title = (max = MAX_TITLE_CHARS) => field((v) => typeof v === "string" && v.trim().length > 0 && v.length <= max);
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

// Base64url without padding, between `min` and `max` characters. The journal's iv, ciphertext and key are all this shape;
// the server checks the shape and the size, never the content, which it cannot read.
const base64url = (min: number, max: number, nullable = false) => field((v) => typeof v === "string" && v.length >= min && v.length <= max && /^[A-Za-z0-9_-]+$/.test(v), nullable);

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
      done_at: int(0, undefined, true),
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
      done_at: int(0, undefined, true),
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
    perUser: true,
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
  // The user's day shape (Tech_Scope.md §4.1, §4.4): one row per user, id 'me'. The scheduler reads it.
  settings: {
    table: "settings",
    key: "id",
    perUser: true,
    required: [],
    checkId: (id) => id === "me",
    fields: {
      tz: field((v) => typeof v === "string" && v.length <= 64 && isZone(v), true),
      quiet_start: int(0, 1439),
      quiet_end: int(0, 1439),
      // Phase 3 (§10, slice 19). The key is 32 bytes: 43 base64url characters.
      timer_mode: enumOf(["pomodoro", "flowtime"]),
      unlock: enumOf(["rotate", "trivia", "puzzle", "fact"]),
      journal_key: base64url(43, 43, true),
    },
  },
  // One sealed line per user and day (§10, slice 19; UX_Flows.md §3.7). Keyed by the local date, like days. `iv` is 12
  // bytes (16 characters); `text` is the AES-GCM ciphertext of a line of at most 500 characters, which is 22 characters
  // for an empty one (the 16-byte tag) up to about 2700, so 4096 leaves room. `mood` is a plain 1-5.
  journal: {
    table: "journal",
    key: "day",
    perUser: true,
    required: ["iv", "text"],
    checkId: isDate,
    fields: {
      iv: base64url(16, 16),
      text: base64url(22, 4096),
      mood: int(1, 5, true),
      updated_at: int(),
    },
  },
};

export const ENTITY_NAMES = Object.keys(ENTITIES) as Entity[];

// D1 refuses a compound SELECT of more than 5 terms; with 7 tables, per-table queries go out in groups of 5.
export const groupsOf5 = <T>(xs: T[]): T[][] => Array.from({ length: Math.ceil(xs.length / 5) }, (_, i) => xs.slice(i * 5, i * 5 + 5));
