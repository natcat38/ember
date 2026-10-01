CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY,
  chat_id TEXT NOT NULL,
  text TEXT NOT NULL,
  due_at INTEGER NOT NULL,  -- unix ms
  sent_at INTEGER           -- unix ms, NULL until sent
);
