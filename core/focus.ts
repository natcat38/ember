import { childrenOf } from "./chunk";
import type { State } from "./task";

// UX_Flows.md §3.5: 25/5, on the wall clock. Everything is computed from timestamps, so locking the phone,
// backgrounding the tab, or reloading loses nothing.
export const WORK_MS = 25 * 60_000;
export const BREAK_MS = 5 * 60_000;

export interface Focus {
  chunk_id: string;
  started_at: number;
  paused_at: number | null;
  paused_ms: number; // total time paused in this work session
  break_started_at: number | null; // set while on the 5-minute break
  length_ms?: number; // a shorter first session (onboarding's "Start with two minutes?"); 25 minutes when absent
}

// The D1 `sessions` table: one focus session; `completed` means it ran its full length (25, or a starter's 2).
export interface Session {
  id: string;
  chunk_id: string;
  started_at: number;
  ended_at: number;
  completed: boolean;
}

const worked = (f: Focus, now: number) => (f.paused_at ?? now) - f.started_at - f.paused_ms;
const lengthOf = (f: Focus) => f.length_ms ?? WORK_MS;
export const workLeft = (f: Focus, now: number) => Math.max(lengthOf(f) - worked(f, now), 0);
export const breakLeft = (f: Focus, now: number) => (f.break_started_at === null ? BREAK_MS : Math.max(BREAK_MS - (now - f.break_started_at), 0));

type NewId = () => string;
const uuid: NewId = () => crypto.randomUUID();

function setChunk(s: State, id: string, state: "todo" | "focus" | "done", now: number): State {
  return { ...s, chunks: s.chunks.map((c) => (c.id === id ? { ...c, state, updated_at: now } : c)) };
}

// Log the work session in progress. A full 25 ends when the timer did, however late the user came back.
function logWork(s: State, f: Focus, now: number, newId: NewId): State {
  const full = workLeft(f, now) === 0;
  const ended_at = full ? f.started_at + f.paused_ms + lengthOf(f) : (f.paused_at ?? now);
  return { ...s, sessions: [...s.sessions, { id: newId(), chunk_id: f.chunk_id, started_at: f.started_at, ended_at, completed: full }] };
}

const fresh = (chunk_id: string, now: number): Focus => ({ chunk_id, started_at: now, paused_at: null, paused_ms: 0, break_started_at: null });

// Only a leaf that isn't done can be focused (UX_Flows.md §3.3 rule 3). Starting another step stops the current one.
// `lengthMs` sets a shorter first session (UX_Flows.md §7, step 6); Back to it and Skip break return to 25 minutes.
export function startFocus(s: State, chunkId: string, now: number, newId: NewId = uuid, lengthMs?: number): State {
  const c = s.chunks.find((x) => x.id === chunkId);
  if (!c || c.deleted || c.state === "done" || childrenOf(s, c.id).length) return s;
  const cleared = s.focus ? endFocus(s, now, false, newId) : s;
  const focus = lengthMs ? { ...fresh(chunkId, now), length_ms: lengthMs } : fresh(chunkId, now);
  return { ...setChunk(cleared, chunkId, "focus", now), focus };
}

export function pauseFocus(s: State, now: number): State {
  const f = s.focus;
  return !f || f.paused_at !== null || f.break_started_at !== null ? s : { ...s, focus: { ...f, paused_at: now } };
}

export function resumeFocus(s: State, now: number): State {
  const f = s.focus;
  return !f || f.paused_at === null ? s : { ...s, focus: { ...f, paused_ms: f.paused_ms + now - f.paused_at, paused_at: null } };
}

// "Take 5?" appears only once the 25 is up.
export function takeBreak(s: State, now: number, newId: NewId = uuid): State {
  const f = s.focus;
  if (!f || f.break_started_at !== null || workLeft(f, now) > 0) return s;
  return { ...logWork(s, f, now, newId), focus: { ...f, break_started_at: now } };
}

export function skipBreak(s: State, now: number, newId: NewId = uuid): State {
  const f = s.focus;
  if (!f || f.break_started_at !== null || workLeft(f, now) > 0) return s;
  return { ...logWork(s, f, now, newId), focus: fresh(f.chunk_id, now) };
}

// "Back to it": another 25 on the same step.
export function backToIt(s: State, now: number): State {
  return s.focus ? { ...s, focus: fresh(s.focus.chunk_id, now) } : s;
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
