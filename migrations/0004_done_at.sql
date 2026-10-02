-- Ember D1 schema, done_at (docs/Verify_List.md "Done today"; Tech_Scope.md §3).
-- "Finished today" used to read updated_at, so renaming a step finished yesterday counted it as done today. done_at is
-- stamped when a task or step becomes done and cleared when it leaves done; an edit never moves it. NULL = not done,
-- or done before this column existed and not yet backfilled by a client.

ALTER TABLE tasks ADD COLUMN done_at INTEGER;
ALTER TABLE chunks ADD COLUMN done_at INTEGER;

-- Rows already done get their last edit time, the best finish time the server has (it stores no earlier one).
-- Parent steps are not backfilled: their state is derived on the device and the server holds them as 'todo'.
UPDATE tasks SET done_at = updated_at WHERE state = 'done' AND done_at IS NULL;
UPDATE chunks SET done_at = updated_at WHERE state = 'done' AND done_at IS NULL;
