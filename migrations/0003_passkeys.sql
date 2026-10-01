-- Passkey challenges (Tech_Scope.md §8, ADR-0005, slice 14). The credentials table itself is in 0001.
-- A challenge is made by an options call, consumed by exactly one verify call (DELETE ... RETURNING), and expires
-- after 5 minutes. The row records what the options request was bound to, so a verify that arrives for a different
-- user, origin or kind is refused even when the challenge string is right.

CREATE TABLE passkey_challenges (
  challenge TEXT PRIMARY KEY,                           -- 32 random bytes, base64url, made by the library
  kind TEXT NOT NULL CHECK (kind IN ('register', 'login')),
  user_id TEXT,                                         -- the cookie user a registration attaches to; NULL for login
  origin TEXT NOT NULL,                                 -- the request's origin and hostname when it was issued
  rp_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,                          -- unix ms
  CHECK ((kind = 'register') = (user_id IS NOT NULL))
);
-- The sweep that runs on every options call scans by expiry.
CREATE INDEX passkey_challenges_expires ON passkey_challenges (expires_at);
