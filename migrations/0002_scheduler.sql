-- Ember D1 schema, slice 12 (Tech_Scope.md §3, §4.5, §6, §11): what the scheduler needs beyond 0001.

-- Which plan a user is on. The scheduler replans a Telegram user when `planned_until` has passed (a new local day) or
-- `users.rev` has moved past `planned_rev` (a sync, a Telegram capture, a settings change). NULL = never planned.
ALTER TABLE users ADD COLUMN planned_until INTEGER;   -- unix ms: the instant the planned local day ends (next day start)
ALTER TABLE users ADD COLUMN planned_rev INTEGER;     -- users.rev when the plan was made
-- Random per planning write. The write is a compare-and-set on planned_rev / planned_until, and its delete and insert
-- check this token, so a tick that lost a race to plan the same user changes nothing.
ALTER TABLE users ADD COLUMN plan_token TEXT;

-- The message body, composed when the day is planned (the plan is redone whenever the state it was built from changes,
-- so the text matches the state). Sending then needs no task lookups.
ALTER TABLE sends ADD COLUMN text TEXT NOT NULL DEFAULT '';
-- For `overdue` rows: the task's deadline when the row was planned. An overdue send is silenced until the deadline
-- changes (Tech_Scope.md §3, "Silenced"), so the scheduler compares this with the task's current deadline.
ALTER TABLE sends ADD COLUMN deadline TEXT;

-- The stale-user scan reads only linked Telegram users, so its cost does not grow with the other users.
CREATE INDEX users_telegram ON users (planned_until) WHERE channel = 'telegram' AND telegram_chat_id IS NOT NULL;
