-- Ember D1 schema, phase 2 (Tech_Scope.md §3). Booleans are INTEGER 0/1; days.deferred is a JSON array in TEXT.
-- Every per-user table carries user_id, and every synced table has an index on (user_id, rev) for cursor pulls.
-- Deviations from §3, on purpose:
--   * ops is keyed (user_id, op_id), not op_id alone, so one user's op ids can never shadow another's.
--   * hard_blocks, tasks, chunks and sessions carry user_id NOT NULL; the id stays the global primary key because
--     clients generate UUIDs, and every write is guarded by `user_id = excluded.user_id` so a stray id cannot
--     touch another user's row.
--   * CHECK constraints mirror the state machines' value sets, as a last line of defence behind worker/validate.ts.

CREATE TABLE users (
  id TEXT PRIMARY KEY,                                  -- 128-bit random, base64url; the ember_uid cookie value
  created_at INTEGER NOT NULL,                          -- unix ms
  last_seen_at INTEGER NOT NULL,
  tz TEXT NOT NULL DEFAULT 'Asia/Singapore',            -- IANA name, from the browser
  quiet_start INTEGER NOT NULL DEFAULT 1320,            -- minutes after local midnight
  quiet_end INTEGER NOT NULL DEFAULT 480,
  channel TEXT CHECK (channel IN ('telegram', 'push')), -- NULL = in-app only
  telegram_chat_id TEXT,
  rev INTEGER NOT NULL DEFAULT 0                        -- last change number handed out to this user's rows
);
-- Retention job (Tech_Scope.md §8) scans by last_seen_at.
CREATE INDEX users_last_seen ON users (last_seen_at);

CREATE TABLE hard_blocks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Monday
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
);
CREATE INDEX hard_blocks_user_rev ON hard_blocks (user_id, rev);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,                                  -- client-generated UUID
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('inbox', 'active', 'overdue', 'done', 'removed')),
  size TEXT CHECK (size IN ('XS', 'S', 'M', 'L', 'XL')),      -- NULL until triaged
  quick INTEGER NOT NULL DEFAULT 0 CHECK (quick IN (0, 1)),
  holding_up INTEGER NOT NULL DEFAULT 0 CHECK (holding_up IN (0, 1)),
  deadline TEXT,                                        -- local date 'YYYY-MM-DD', NULL = none
  runway_start TEXT,                                    -- local date the deadline was last set
  pinned_on TEXT,                                       -- local day the user pinned it into Today
  snoozed_until INTEGER,
  created_at INTEGER,
  updated_at INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX tasks_user_rev ON tasks (user_id, rev);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  parent_id TEXT,                                       -- two levels max
  title TEXT NOT NULL,
  position REAL NOT NULL,                               -- REAL so a move rewrites one row
  state TEXT NOT NULL CHECK (state IN ('todo', 'focus', 'done')),
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  updated_at INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX chunks_user_rev ON chunks (user_id, rev);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  rev INTEGER NOT NULL
);
CREATE INDEX sessions_user_rev ON sessions (user_id, rev);

CREATE TABLE days (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,                                    -- local date 'YYYY-MM-DD'
  confirmed_at INTEGER,
  shutdown_at INTEGER,
  deferred TEXT NOT NULL DEFAULT '[]',                  -- JSON array of chunk ids marked "Not today"
  rev INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX days_user_rev ON days (user_id, rev);

-- Idempotency ledger (ADR-0006). Entries older than 30 days can be pruned; the index serves that scan.
CREATE TABLE ops (
  user_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, op_id)
);
CREATE INDEX ops_applied_at ON ops (applied_at);

CREATE TABLE sends (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,                                   -- morning | light_day | close | deadline_day | overdue | wrap_up
  task_ids TEXT NOT NULL DEFAULT '[]',                  -- JSON array; several when batched
  due_at INTEGER NOT NULL,
  claimed_at INTEGER,
  sent_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  tg_message_id INTEGER,
  acted_at INTEGER,
  snoozed_at INTEGER,
  cancelled INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1))
);
CREATE INDEX sends_user_day ON sends (user_id, day);
CREATE INDEX sends_due ON sends (due_at);

CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX credentials_user ON credentials (user_id);

CREATE TABLE handoffs (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('install', 'tg_link', 'login_link')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX handoffs_user ON handoffs (user_id);
