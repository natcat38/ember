-- Ember D1 schema, phase 3 data (Tech_Scope.md §3, §10 slice 19).
-- settings gains the timer mode, the default unlock kind and the journal key; journal is a new synced table.
-- Numbered 0006 because 0005 is the web-push table (slice 18), built in parallel.

-- Existing settings rows take the defaults, so a user who synced in phase 2 reads as Pomodoro, rotating unlocks, no key.
ALTER TABLE settings ADD COLUMN timer_mode TEXT NOT NULL DEFAULT 'pomodoro' CHECK (timer_mode IN ('pomodoro', 'flowtime'));
ALTER TABLE settings ADD COLUMN unlock TEXT NOT NULL DEFAULT 'rotate' CHECK (unlock IN ('rotate', 'trivia', 'puzzle', 'fact'));
-- base64url of a raw 256-bit AES-GCM key (43 characters), made on the device; NULL until the first journal line.
ALTER TABLE settings ADD COLUMN journal_key TEXT;

-- One sealed line per user per local day. The server holds iv and text as base64url and cannot read the words (the key
-- is in settings, so a dump of this table alone shows nothing; see src/journal.ts for the threat model). mood is a plain
-- 1-5: Rough, Meh, Okay, Good, Great (UX_Flows.md §3.7). Keyed (user_id, day) like days, so there is no id guard.
CREATE TABLE journal (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,                                    -- local date 'YYYY-MM-DD'
  iv TEXT NOT NULL,                                     -- 12 random bytes, base64url
  text TEXT NOT NULL,                                   -- AES-GCM ciphertext of one line, base64url
  mood INTEGER CHECK (mood BETWEEN 1 AND 5),            -- NULL = no mood tapped
  updated_at INTEGER,
  rev INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX journal_user_rev ON journal (user_id, rev);
