import { expect, test } from "vitest";
import { backToIt, BREAK_MS, breakFor, breakLeft, canSwitchMode, endFocus, pauseFocus, resumeFocus, sessionsDone, skipBreak, startFocus, stopFlow, switchMode, takeBreak, workedMs, workLeft, WORK_MS } from "./focus";
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

test("I finished it stamps done_at and finishes the parent, so a later rename doesn't bring the step back", () => {
  let s = startFocus(base(), "p1", T0);
  s = endFocus(s, T0 + 10 * MIN, true, ids());
  const row = (id: string) => s.chunks.find((c) => c.id === id)!;
  expect(row("p1")).toMatchObject({ state: "done", done_at: T0 + 10 * MIN });
  expect(row("p")).toMatchObject({ done_at: T0 + 10 * MIN });
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

test("a starter session runs 2 minutes, is complete at 2, and Back to it returns to 25", () => {
  let s = startFocus(base(), "a", T0, ids(), 2 * MIN);
  expect(workLeft(s.focus!, T0 + MIN)).toBe(MIN);
  expect(workLeft(s.focus!, T0 + 3 * MIN)).toBe(0);
  s = takeBreak(s, T0 + 3 * MIN, ids());
  expect(s.sessions[0]).toMatchObject({ ended_at: T0 + 2 * MIN, completed: true });
  s = backToIt(s, T0 + 9 * MIN);
  expect(workLeft(s.focus!, T0 + 9 * MIN)).toBe(WORK_MS);
});

// Flowtime (Tech_Scope.md §10 phase 3, slice 21): count up, the user decides when to stop, break = min(worked / 5, 15 min).
const flow = (): State => ({ ...base(), settings: { ...base().settings, timer_mode: "flowtime" } });

test("breakFor is a fifth of the time worked, in whole minutes, capped at 15", () => {
  expect(breakFor(10 * MIN)).toBe(2 * MIN);
  expect(breakFor(25 * MIN)).toBe(5 * MIN);
  expect(breakFor(50 * MIN)).toBe(10 * MIN);
  expect(breakFor(90 * MIN)).toBe(15 * MIN); // 18 minutes, capped
  expect(breakFor(75 * MIN)).toBe(15 * MIN); // exactly at the cap
  expect(breakFor(12 * MIN + 30_000)).toBe(3 * MIN); // 2.5 minutes rounds to 3
  expect(breakFor(MIN)).toBe(MIN); // never a zero-length break
});

test("startFocus follows settings.timer_mode; 25/5 state carries no Flowtime fields", () => {
  expect(startFocus(base(), "a", T0).focus).toEqual({ chunk_id: "a", started_at: T0, paused_at: null, paused_ms: 0, break_started_at: null });
  expect(startFocus(flow(), "a", T0).focus).toMatchObject({ mode: "flowtime" });
  expect(startFocus(flow(), "a", T0, ids(), 2 * MIN).focus!.mode).toBeUndefined(); // the onboarding starter stays a 2-minute countdown
});

test("a Flowtime session counts up from its start, pauses excluded, with no end", () => {
  let s = startFocus(flow(), "a", T0);
  expect(workedMs(s.focus!, T0)).toBe(0);
  expect(workedMs(s.focus!, T0 + 30 * MIN)).toBe(30 * MIN);
  s = pauseFocus(s, T0 + 10 * MIN);
  expect(workedMs(s.focus!, T0 + 40 * MIN)).toBe(10 * MIN); // held while paused
  s = resumeFocus(s, T0 + 40 * MIN);
  expect(workedMs(s.focus!, T0 + 100 * MIN)).toBe(70 * MIN); // 10 before the pause + 60 after
  expect(takeBreak(s, T0 + 100 * MIN, ids())).toBe(s); // nothing happens until the user stops
  expect(skipBreak(s, T0 + 100 * MIN, ids())).toBe(s);
});

test.each([
  [10, 2],
  [25, 5],
  [50, 10],
  [90, 15],
])("Flowtime: stopping after %i minutes offers a %i-minute break", (worked, rest) => {
  let s = startFocus(flow(), "a", T0);
  s = stopFlow(s, T0 + worked * MIN);
  expect(s.focus!.stopped_at).toBe(T0 + worked * MIN);
  expect(s.sessions).toHaveLength(0); // logged when the break starts or the step ends
  s = takeBreak(s, T0 + (worked + 3) * MIN, ids()); // the user sat on the prompt for 3 minutes
  expect(s.sessions).toEqual([{ id: "s1", chunk_id: "a", started_at: T0, ended_at: T0 + worked * MIN, completed: worked >= 25 }]);
  expect(breakLeft(s.focus!, T0 + (worked + 3) * MIN)).toBe(rest * MIN);
  expect(breakLeft(s.focus!, T0 + (worked + 3) * MIN + rest * MIN)).toBe(0);
});

test("Flowtime: a pause before stopping is not worked time, and a stop while paused ends at the pause", () => {
  let s = startFocus(flow(), "a", T0);
  s = pauseFocus(s, T0 + 20 * MIN);
  s = stopFlow(s, T0 + 45 * MIN);
  expect(workedMs(s.focus!, T0 + 60 * MIN)).toBe(20 * MIN);
  s = takeBreak(s, T0 + 60 * MIN, ids());
  expect(s.sessions[0]).toMatchObject({ ended_at: T0 + 20 * MIN, completed: false });
  expect(breakLeft(s.focus!, T0 + 60 * MIN)).toBe(4 * MIN);
});

test("Flowtime: Skip break logs the session and starts another Flowtime one; Back to it does too", () => {
  let s = stopFlow(startFocus(flow(), "a", T0), T0 + 30 * MIN);
  const skipped = skipBreak(s, T0 + 31 * MIN, ids());
  expect(skipped.sessions).toHaveLength(1);
  expect(skipped.focus).toEqual({ chunk_id: "a", started_at: T0 + 31 * MIN, paused_at: null, paused_ms: 0, break_started_at: null, mode: "flowtime" });
  s = backToIt(takeBreak(s, T0 + 30 * MIN, ids()), T0 + 36 * MIN);
  expect(s.focus).toMatchObject({ started_at: T0 + 36 * MIN, mode: "flowtime" });
  expect(s.focus!.stopped_at).toBeUndefined();
  expect(s.focus!.break_ms).toBeUndefined();
});

test("Flowtime: I finished it and Stop for now log the time worked; Done mid-session logs it so far", () => {
  const stopped = stopFlow(startFocus(flow(), "a", T0), T0 + 40 * MIN);
  const done = endFocus(stopped, T0 + 45 * MIN, true, ids());
  expect(done.sessions).toEqual([{ id: "s1", chunk_id: "a", started_at: T0, ended_at: T0 + 40 * MIN, completed: true }]);
  expect(stateOf(done, "a")).toBe("done");
  const bail = endFocus(startFocus(flow(), "a", T0), T0 + 12 * MIN, false, ids());
  expect(bail.sessions).toEqual([{ id: "s1", chunk_id: "a", started_at: T0, ended_at: T0 + 12 * MIN, completed: false }]);
  expect(stateOf(bail, "a")).toBe("todo");
  const late = endFocus(takeBreak(stopped, T0 + 41 * MIN, ids()), T0 + 43 * MIN, false, ids());
  expect(late.sessions).toHaveLength(1); // ending during the break does not log it twice
});

test("Flowtime: pause is refused once stopped; stopFlow is a no-op on 25/5, on a break, or twice", () => {
  const p = startFocus(base(), "a", T0);
  expect(stopFlow(p, T0 + MIN)).toBe(p);
  const f = stopFlow(startFocus(flow(), "a", T0), T0 + 10 * MIN);
  expect(pauseFocus(f, T0 + 11 * MIN)).toBe(f);
  expect(stopFlow(f, T0 + 12 * MIN)).toBe(f);
  const b = takeBreak(f, T0 + 12 * MIN, ids());
  expect(stopFlow(b, T0 + 13 * MIN)).toBe(b);
});

test("the per-session switch changes the mode in the first minute only, leaving 25/5 state untouched", () => {
  let s = startFocus(base(), "a", T0);
  expect(canSwitchMode(s.focus!, T0 + 5_000)).toBe(true);
  const flowS = switchMode(s, "flowtime", T0 + 5_000);
  expect(flowS.focus).toMatchObject({ started_at: T0, mode: "flowtime" });
  const back = switchMode(flowS, "pomodoro", T0 + 6_000);
  expect(back.focus).toEqual(s.focus); // same shape as a fresh 25/5: no mode field left behind
  expect(switchMode(s, "pomodoro", T0 + 5_000)).toBe(s); // already in that mode
  expect(canSwitchMode(s.focus!, T0 + 2 * MIN)).toBe(false);
  expect(switchMode(s, "flowtime", T0 + 2 * MIN)).toBe(s);
  const starter = startFocus(base(), "a", T0, ids(), 2 * MIN);
  expect(canSwitchMode(starter.focus!, T0 + 1_000)).toBe(false); // the onboarding starter has no switch
  const pausedS = pauseFocus(s, T0 + 5_000);
  expect(canSwitchMode(pausedS.focus!, T0 + 6_000)).toBe(true);
  s = takeBreak(startFocus(base(), "a", T0), T0 + 30 * MIN, ids());
  expect(canSwitchMode(s.focus!, T0 + 30 * MIN)).toBe(false);
  s = pauseFocus(startFocus(base(), "a", T0), T0 + 10 * MIN); // paused 10 minutes in: worked time, not wall time, counts
  expect(canSwitchMode(s.focus!, T0 + 90 * MIN)).toBe(false);
});
