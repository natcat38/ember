import { childrenOf, setLeafStates } from "./chunk";
import type { State, TimerMode } from "./task";

// UX_Flows.md §3.5: 25/5, on the wall clock. Everything is computed from timestamps, so locking the phone,
// backgrounding the tab, or reloading loses nothing.
export const WORK_MS = 25 * 60_000;
export const BREAK_MS = 5 * 60_000;
export const MAX_FLOW_BREAK_MS = 15 * 60_000; // Tech_Scope.md §10 phase 3: a Flowtime break is a fifth of the time worked, at most 15 minutes
export const SWITCH_WINDOW_MS = 60_000; // the per-session switch stays on offer for the first minute of work

export interface Focus {
  chunk_id: string;
  started_at: number;
  paused_at: number | null;
  paused_ms: number; // total time paused in this work session
  break_started_at: number | null; // set while on the 5-minute break
  length_ms?: number; // a shorter first session (onboarding's "Start with two minutes?"); 25 minutes when absent
  // Flowtime fields (UX_Flows.md §3.5): all absent in a 25/5 session, so its saved shape is unchanged.
  mode?: TimerMode; // "flowtime" counts up with no end; absent means 25/5
  stopped_at?: number; // when the user stopped working: the break is offered, and the time worked is fixed from here
  break_ms?: number; // the break's length, set when it starts
}

// The D1 `sessions` table: one focus session; `completed` means it ran its full length (25, or a starter's 2).
export interface Session {
  id: string;
  chunk_id: string;
  started_at: number;
  ended_at: number;
  completed: boolean;
}

export const isFlowtime = (f: Focus) => f.mode === "flowtime";
const workEnd = (f: Focus, now: number) => f.stopped_at ?? f.paused_at ?? now;
// Time worked in this session, pauses excluded; the count-up Flowtime shows.
export const workedMs = (f: Focus, now: number) => workEnd(f, now) - f.started_at - f.paused_ms;
const lengthOf = (f: Focus) => f.length_ms ?? WORK_MS;
export const workLeft = (f: Focus, now: number) => Math.max(lengthOf(f) - workedMs(f, now), 0);
// The break's length: fixed once taken; until then, what is on offer (Flowtime sizes it to the time worked so far).
const breakLength = (f: Focus, now: number) => f.break_ms ?? (isFlowtime(f) ? breakFor(workedMs(f, now)) : BREAK_MS);
export const breakLeft = (f: Focus, now: number) => (f.break_started_at === null ? breakLength(f, now) : Math.max(breakLength(f, now) - (now - f.break_started_at), 0));
// Whether the work is over and the break can be offered: the timer ran out (25/5), or the user stopped (Flowtime).
export const workOver = (f: Focus, now: number) => (isFlowtime(f) ? f.stopped_at !== undefined : workLeft(f, now) === 0);

// Flowtime's break: a fifth of the time worked, in whole minutes, at most 15; never zero, so the break screen has a clock to show.
export const breakFor = (worked: number) => Math.max(Math.min(Math.round(worked / 5 / 60_000) * 60_000, MAX_FLOW_BREAK_MS), 60_000);

type NewId = () => string;
const uuid: NewId = () => crypto.randomUUID();

// Through chunk.ts's patch, so finishing a step stamps done_at and flips its parent like a tick does.
const setChunk = (s: State, id: string, state: "todo" | "focus" | "done", now: number): State => setLeafStates(s, [id], state, now);

// Log the work session in progress. A full 25 ends when the timer did, however late the user came back.
// A Flowtime session ends when the user stopped it and counts as complete from 25 minutes worked, like a full 25.
function logWork(s: State, f: Focus, now: number, newId: NewId): State {
  const flow = isFlowtime(f);
  const full = flow ? workedMs(f, now) >= WORK_MS : workLeft(f, now) === 0;
  const ended_at = full && !flow ? f.started_at + f.paused_ms + lengthOf(f) : workEnd(f, now);
  return { ...s, sessions: [...s.sessions, { id: newId(), chunk_id: f.chunk_id, started_at: f.started_at, ended_at, completed: full }] };
}

const fresh = (chunk_id: string, now: number, mode?: TimerMode): Focus => {
  const f: Focus = { chunk_id, started_at: now, paused_at: null, paused_ms: 0, break_started_at: null };
  return mode === "flowtime" ? { ...f, mode } : f;
};

// Only a leaf that isn't done can be focused (UX_Flows.md §3.3 rule 3). Starting another step stops the current one.
// `lengthMs` sets a shorter first session (UX_Flows.md §7, step 6); Back to it and Skip break return to 25 minutes.
// A session starts in the mode set in Settings (`timer_mode`); the starter is always a 2-minute countdown.
export function startFocus(s: State, chunkId: string, now: number, newId: NewId = uuid, lengthMs?: number): State {
  const c = s.chunks.find((x) => x.id === chunkId);
  if (!c || c.deleted || c.state === "done" || childrenOf(s, c.id).length) return s;
  const cleared = s.focus ? endFocus(s, now, false, newId) : s;
  const focus = lengthMs ? { ...fresh(chunkId, now), length_ms: lengthMs } : fresh(chunkId, now, s.settings.timer_mode);
  return { ...setChunk(cleared, chunkId, "focus", now), focus };
}

export function pauseFocus(s: State, now: number): State {
  const f = s.focus;
  return !f || f.paused_at !== null || f.break_started_at !== null || f.stopped_at !== undefined ? s : { ...s, focus: { ...f, paused_at: now } };
}

export function resumeFocus(s: State, now: number): State {
  const f = s.focus;
  return !f || f.paused_at === null ? s : { ...s, focus: { ...f, paused_ms: f.paused_ms + now - f.paused_at, paused_at: null } };
}

// "Take 5?" appears only once the 25 is up (Flowtime: once the user has stopped, with the break sized to the time worked).
export function takeBreak(s: State, now: number, newId: NewId = uuid): State {
  const f = s.focus;
  if (!f || f.break_started_at !== null || !workOver(f, now)) return s;
  const break_ms = isFlowtime(f) ? { break_ms: breakFor(workedMs(f, now)) } : {};
  return { ...logWork(s, f, now, newId), focus: { ...f, ...break_ms, break_started_at: now } };
}

export function skipBreak(s: State, now: number, newId: NewId = uuid): State {
  const f = s.focus;
  if (!f || f.break_started_at !== null || !workOver(f, now)) return s;
  return { ...logWork(s, f, now, newId), focus: fresh(f.chunk_id, now, f.mode) };
}

// "Back to it": another 25 (or another Flowtime session) on the same step.
export function backToIt(s: State, now: number): State {
  return s.focus ? { ...s, focus: fresh(s.focus.chunk_id, now, s.focus.mode) } : s;
}

// Flowtime's "stop when you stop": fixes the time worked at this moment (or at the pause, if paused) and offers the break.
export function stopFlow(s: State, now: number): State {
  const f = s.focus;
  if (!f || !isFlowtime(f) || f.stopped_at !== undefined || f.break_started_at !== null) return s;
  return { ...s, focus: { ...f, stopped_at: f.paused_at ?? now } };
}

// The per-session switch (Wireframes.md §4): 25/5 or Flowtime, offered at the start of a session only. The onboarding starter
// has no switch, and a session that has run a minute is committed, so no one flips a 25 into a count-up at minute 40.
export const canSwitchMode = (f: Focus, now: number) => f.length_ms === undefined && f.break_started_at === null && f.stopped_at === undefined && workedMs(f, now) < SWITCH_WINDOW_MS;

export function switchMode(s: State, mode: TimerMode, now: number): State {
  const f = s.focus;
  if (!f || !canSwitchMode(f, now) || isFlowtime(f) === (mode === "flowtime")) return s;
  const { mode: _was, ...pomodoro } = f;
  return { ...s, focus: mode === "flowtime" ? { ...pomodoro, mode } : pomodoro };
}

// Done / I finished it (done = true) or Stop for now / Stop here (done = false). Sessions are logged either way.
export function endFocus(s: State, now: number, done: boolean, newId: NewId = uuid): State {
  const f = s.focus;
  if (!f) return s;
  const logged = f.break_started_at === null ? logWork(s, f, now, newId) : s; // a break means the 25 is already logged
  return { ...setChunk(logged, f.chunk_id, done ? "done" : "todo", now), focus: null };
}

// Completed sessions per task, for "remaining" in the ranking (Tech_Scope.md §4.2).
export function sessionsDone(s: State): (taskId: string) => number {
  const taskOf = new Map(s.chunks.map((c) => [c.id, c.task_id]));
  const counts = new Map<string, number>();
  for (const x of s.sessions) {
    if (!x.completed) continue;
    const t = taskOf.get(x.chunk_id);
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return (taskId) => counts.get(taskId) ?? 0;
}
