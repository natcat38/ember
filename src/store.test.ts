import { expect, test } from "vitest";
import { KEY, load, save } from "./store";
import { capture, emptyState } from "../core/task";

function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

test("an empty device loads an empty state", () => {
  expect(load(fakeStorage())).toEqual(emptyState());
});

test("five captures survive a save and reload", () => {
  const st = fakeStorage();
  let s = emptyState();
  for (let i = 1; i <= 5; i++) s = capture(s, { title: `task ${i}` }, i, "2026-10-05");
  expect(save(s, st)).toBe(true);
  expect(load(st).tasks.map((t) => t.title)).toEqual(["task 1", "task 2", "task 3", "task 4", "task 5"]);
});

test("the draft is kept", () => {
  const st = fakeStorage();
  save({ ...emptyState(), draft: "half a tho" }, st);
  expect(load(st).draft).toBe("half a tho");
});

test("unreadable data is backed up, not thrown away", () => {
  const st = fakeStorage({ [KEY]: "{not json" });
  expect(load(st, 42)).toEqual(emptyState());
  expect(st.m.get(`${KEY}.unreadable.42`)).toBe("{not json");
});

test("a failed write reports false instead of throwing", () => {
  const st = { ...fakeStorage(), setItem: () => { throw new Error("QuotaExceededError"); } };
  expect(save(emptyState(), st)).toBe(false);
});

test("rows finished before done_at existed take their last edit time as the finish time on load; open rows are left alone", () => {
  const st = fakeStorage();
  const task = { id: "t", title: "T", state: "done", updated_at: 50 };
  const done = { id: "c1", task_id: "t", parent_id: null, title: "x", position: 1, state: "done", deleted: false, updated_at: 70 };
  const open = { ...done, id: "c2", state: "todo", updated_at: 80 };
  const stamped = { ...done, id: "c3", done_at: 60, updated_at: 90 };
  st.setItem(KEY, JSON.stringify({ ...emptyState(), tasks: [task], chunks: [done, open, stamped] }));
  const s = load(st);
  expect(s.tasks[0].done_at).toBe(50);
  expect(s.chunks.map((c) => c.done_at)).toEqual([70, undefined, 60]);
});

test("settings saved before the phase-3 fields existed load with their defaults, keeping what was saved", () => {
  const st = fakeStorage();
  const { journal: _journal, ...old } = { ...emptyState(), settings: { tz: "Europe/London", quiet_start: 1380, quiet_end: 420 } };
  st.setItem(KEY, JSON.stringify(old));
  const s = load(st);
  expect(s.settings).toEqual({ tz: "Europe/London", quiet_start: 1380, quiet_end: 420, timer_mode: "pomodoro", unlock: "rotate", journal_key: null });
  expect(s.journal).toEqual([]);
});

test("saved phase-3 settings are not overwritten by the defaults", () => {
  const st = fakeStorage();
  const settings = { tz: null, quiet_start: 1320, quiet_end: 480, timer_mode: "flowtime" as const, unlock: "puzzle" as const, journal_key: "k".repeat(43) };
  save({ ...emptyState(), settings }, st);
  expect(load(st).settings).toEqual(settings);
});
