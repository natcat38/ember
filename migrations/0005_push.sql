-- Ember D1 schema, slice 18 (Tech_Scope.md §10, ADR-0002, UX_Flows.md §5): web push subscriptions.

-- One row per browser that said yes to notifications. A user may have several browsers; the app keeps the two newest
-- (worker/push.ts MAX_SUBSCRIPTIONS), because a message goes to every subscription and each push is one subrequest.
-- `endpoint` is UNIQUE: re-subscribing from the same browser updates the row, and a browser that now presents a
-- different cookie moves the row to that user. p256dh and auth are the browser's keys (base64url) for RFC 8291.
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,                                 -- the browser's public key, 65 bytes uncompressed P-256
  auth TEXT NOT NULL,                                   -- the browser's 16-byte authentication secret
  created_at INTEGER NOT NULL                           -- unix ms; the newest subscriptions are the ones kept
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id, created_at);

-- The stale-user scan reads linked Telegram users through users_telegram (0002); this is the same for push users.
CREATE INDEX users_push ON users (planned_until) WHERE channel = 'push';
