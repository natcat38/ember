import { expect, test } from "vitest";
import { backToIt, BREAK_MS, breakLeft, endFocus, pauseFocus, resumeFocus, sessionsDone, skipBreak, startFocus, takeBreak, workLeft, WORK_MS } from "./focus";
import { emptyState, type State } from "./task";
import type { Chunk } from "./chunk";

const MIN = 60_000;
const T0 = 1_760_000_000_000;
const chunk = (id: string, o: Partial<Chunk> = {}): Chunk => ({ id, task_id: "t", parent_id: null, title: id, position: 1, state: "todo", deleted: false, updated_at: 0, ...o });
const base = (): State => ({ ...emptyState(), chunks: [chunk("a"), chunk("b"), chunk("p"), chunk("p1", { parent_id: "p" })] });
const ids = () => {
  let n = 0;
  return () => `s${++n}`;
};
const stateOf = (s: State, id: string) => s.chunks.find((c) => c.id === id)!.state;

test("the timer is wall-clock: time away while locked still counts", () => {
  const s = startFocus(base(), "a", T0);
  expect(stateOf(s, "a")).toBe("focus");
  expect(workLeft(s.focus!, T0)).toBe(WORK_MS);
  expect(workLeft(s.focus!, T0 + 18 * MIN)).toBe(7 * MIN); // the phone was locked; nothing lost
  expect(workLeft(s.focus!, T0 + 40 * MIN)).toBe(0);
});

test("pause stops the clock and resume picks up where it left", () => {
  let s = startFocus(base(), "a", T0);
  s = pauseFocus(s, T0 + 10 * MIN);
  expect(workLeft(s.focus!, T0 + 30 * MIN)).toBe(15 * MIN);
  expect(pauseFocus(s, T0 + 31 * MIN)).toBe(s); // already paused
  s = resumeFocus(s, T0 + 30 * MIN);
  expect(workLeft(s.focus!, T0 + 35 * MIN)).toBe(10 * MIN);
  expect(resumeFocus(s, T0 + 36 * MIN)).toBe(s); // not paused
});

test("a parent, a done step, or a deleted step can't be focused (rule 3)", () => {
  const s = { ...base(), chunks: [...base().chunks, chunk("d", { state: "done" }), chunk("x", { deleted: true })] };
  for (const id of ["p", "d", "x", "nope"]) expect(startFocus(s, id, T0)).toBe(s);
});

test("Done early logs a partial session and finishes the step", () => {
  let s = startFocus(base(), "a", T0);
  s = endFocus(s, T0 + 10 * MIN, true, ids());
  expect(s.focus).toBeNull();
  expect(stateOf(s, "a")).toBe("done");
  expect(s.sessions).toEqual([{ id: "s1", chunk_id: "a", started_at: T0, ended_at: T0 + 10 * MIN, completed: false }]);
});

test("Stop for now returns the step to Todo with the session logged, pauses excluded", () => {
  let s = startFocus(base(), "a", T0);
  s = pauseFocus(s, T0 + 5 * MIN);
  s = endFocus(s, T0 + 50 * MIN, false, ids());
  expect(stateOf(s, "a")).toBe("todo");
  expect(s.sessions[0]).toMatchObject({ started_at: T0, ended_at: T0 + 5 * MIN, completed: false });
});

test("a full 25 is a completed session, ending when the timer did, not when the user came back", () => {
  let s = startFocus(base(), "a", T0);
  s = takeBreak(s, T0 + 70 * MIN, ids());
  expect(s.sessions).toEqual([{ id: "s1", chunk_id: "a", started_at: T0, ended_at: T0 + WORK_MS, completed: true }]);
  expect(breakLeft(s.focus!, T0 + 72 * MIN)).toBe(BREAK_MS - 2 * MIN);
  expect(breakLeft(s.focus!, T0 + 90 * MIN)).toBe(0);
  s = backToIt(s, T0 + 90 * MIN);
  expect(s.focus).toMatchObject({ chunk_id: "a", started_at: T0 + 90 * MIN, paused_ms: 0, break_started_at: null });
  expect(stateOf(s, "a")).toBe("focus");
});

test("Take 5 before the timer ends is refused", () => {
  const s = startFocus(base(), "a", T0);
  expect(takeBreak(s, T0 + 10 * MIN, ids())).toBe(s);
});

test("Skip break logs the 25 and starts another on the same step", () => {
  let s = startFocus(base(), "a", T0);
  s = skipBreak(s, T0 + 26 * MIN, ids());
  expect(s.sessions).toHaveLength(1);
  expect(s.focus).toMatchObject({ chunk_id: "a", started_at: T0 + 26 * MIN, break_started_at: null });
});

test("I finished it after the timer: one completed session, step done", () => {
  let s = startFocus(base(), "a", T0);
  s = endFocus(s, T0 + 30 * MIN, true, ids());
  expect(s.sessions).toEqual([{ id: "s1", chunk_id: "a", started_at: T0, ended_at: T0 + WORK_MS, completed: true }]);
  expect(stateOf(s, "a")).toBe("done");
});

test("ending during the break does not log the 25 twice", () => {
  let s = startFocus(base(), "a", T0);
  s = takeBreak(s, T0 + 25 * MIN, ids());
  s = endFocus(s, T0 + 27 * MIN, false, ids());
  expect(s.sessions).toHaveLength(1);
  expect(stateOf(s, "a")).toBe("todo");
});

test("starting another step stops the current one first", () => {
  let s = startFocus(base(), "a", T0);
  s = startFocus(s, "b", T0 + 5 * MIN, ids());
  expect(stateOf(s, "a")).toBe("todo");
  expect(stateOf(s, "b")).toBe("focus");
  expect(s.sessions).toHaveLength(1);
});

test("sessionsDone counts completed sessions per task", () => {
  let s = startFocus(base(), "a", T0);
  s = skipBreak(s, T0 + 25 * MIN, ids());
  s = endFocus(s, T0 + 30 * MIN, false, ids());
  expect(sessionsDone(s)("t")).toBe(1);
  expect(sessionsDone(s)("other")).toBe(0);
});
