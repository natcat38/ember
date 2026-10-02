-- Ember D1 schema: indexes so the per-minute scheduler and the per-tap lookups read only what they need (audit #32, #33).
-- Apply to the remote database before deploying the worker that uses them: the scheduler names two of them with INDEXED BY.

-- The claim reads the rows that are still to go out. Without this it walks every historical send of every linked user
-- through sends_user_day; D1's free plan reads 5M rows a day.
CREATE INDEX sends_pending ON sends (due_at) WHERE sent_at IS NULL AND cancelled = 0;

-- A button tap finds its send by the Telegram message id the scheduler stamped; the webhook finds a user by chat id.
CREATE INDEX sends_tg_message ON sends (tg_message_id) WHERE tg_message_id IS NOT NULL;
CREATE INDEX users_chat ON users (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
