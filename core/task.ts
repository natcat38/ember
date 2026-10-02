import type { Chunk } from "./chunk";
import type { Focus, Session } from "./focus";

// Entity shapes match the D1 `tasks` table (Tech_Scope.md §3), so phase 2's first sync uploads them unchanged.
export type Size = "XS" | "S" | "M" | "L" | "XL";
export type TaskState = "inbox" | "active" | "overdue" | "done" | "removed";

export interface Task {
  id: string;
  title: string;
  state: TaskState;
  size: Size | null;
  quick: boolean;
  holding_up: boolean;
  deadline: string | null; // local date YYYY-MM-DD
  runway_start: string | null; // local day the deadline was last set
  pinned_on: string | null;
  snoozed_until: number | null;
  done_at?: number | null; // when the task became done; null otherwise; absent on rows saved before it existed
  created_at: number;
  updated_at: number;
}

// The D1 `days` table (Tech_Scope.md §3): per local day, the morning confirm and what was put off.
export interface Day {
  day: string;
  confirmed_at: number | null;
  shutdown_at?: number | null; // the evening wrap-up ran
  deferred: string[]; // chunk ids marked "Not today" (a task id for a task with no steps yet)
}

// The user's day shape (users row + hard_blocks, Tech_Scope.md §3). Minutes after local midnight.
export interface Settings {
  tz: string | null; // IANA name; null = the browser's
  quiet_start: number;
  quiet_end: number; // the day starts here (§4.1)
  // Phase 3 (Tech_Scope.md §10, slice 19). All three sync with the row; `load()` fills them in for settings saved before.
  timer_mode: TimerMode; // the focus timer: 25/5 Pomodoro, or Flowtime (count-up, break = a fifth of the time worked)
  unlock: UnlockKind; // the reward unlock the Reward screen offers: one kind, or `rotate` through them
  journal_key: string | null; // base64url of the raw 256-bit AES-GCM key that seals journal lines; null until the first line
}

export type TimerMode = "pomodoro" | "flowtime";
export type UnlockKind = "rotate" | "trivia" | "puzzle" | "fact";

// The D1 `journal` table (Tech_Scope.md §3, UX_Flows.md §3.7): one line per local day, sealed on the device. The server
// holds `iv` and `text` as base64url and never the words; `mood` is a plain 1-5 (Rough · Meh · Okay · Good · Great).
export interface JournalEntry {
  day: string; // local date YYYY-MM-DD
  iv: string; // 12 random bytes, base64url
  text: string; // AES-GCM ciphertext of the line, base64url
  mood: number | null;
  updated_at: number;
}

// One busy stretch on one or more weekdays (0 = Monday). Ember plans around these; steps are never clock-pinned.
export interface HardBlock {
  id: string;
  weekdays: number[];
  start_min: number;
  end_min: number;
  label: string | null;
  deleted: boolean;
  updated_at: number;
}

export interface State {
  tasks: Task[];
  chunks: Chunk[];
  days: Day[];
  journal: JournalEntry[];
  sessions: Session[];
  focus: Focus | null; // the running focus session, if any
  last_seen_at: number | null; // users.last_seen_at: drives the lapse return
  onboarded: boolean; // this device finished (or skipped) the first-run sequence, UX_Flows.md §7; never synced
  nudge_offered: boolean; // the one-time reminder offer after the first Reward has been shown; never synced
  settings: Settings;
  hard_blocks: HardBlock[];
  draft: string; // unsent capture text, kept when the sheet closes (UX_Flows.md §3.1)
}

export const defaultSettings = (): Settings => ({ tz: null, quiet_start: 1320, quiet_end: 480, timer_mode: "pomodoro", unlock: "rotate", journal_key: null });

export const emptyState = (): State => ({ tasks: [], chunks: [], days: [], journal: [], sessions: [], focus: null, last_seen_at: null, onboarded: false, nudge_offered: false, settings: defaultSettings(), hard_blocks: [], draft: "" });

// The server refuses a title over 500 characters with a 400 that costs the whole sync batch (worker/schema.ts), so core clamps.
export const MAX_TITLE_CHARS = 500;
export const clampTitle = (title: string) => title.trim().slice(0, MAX_TITLE_CHARS);

export interface CaptureInput {
  title: string;
  deadline?: string | null;
  quick?: boolean;
}

// UX_Flows.md §3.1: only text is required; blank sends are ignored; no dedup; Quick pre-sets XS.
export function capture(
  s: State,
  input: CaptureInput,
  now: number,
  today: string,
  newId: () => string = () => crypto.randomUUID(),
): State {
  const title = clampTitle(input.title);
  if (!title) return s;
  const deadline = input.deadline || null;
  const task: Task = {
    id: newId(),
    title,
    state: "inbox",
    size: input.quick ? "XS" : null,
    quick: !!input.quick,
    holding_up: false,
    deadline,
    runway_start: deadline ? today : null,
    pinned_on: null,
    snoozed_until: null,
    done_at: null,
    created_at: now,
    updated_at: now,
  };
  return { ...s, tasks: [...s.tasks, task], draft: "" };
}

// Apply fn to one task; unknown ids and refused changes (fn returns null) leave the state untouched.
function update(s: State, id: string, now: number, fn: (t: Task) => Partial<Task> | null): State {
  const i = s.tasks.findIndex((t) => t.id === id);
  const patch = i < 0 ? null : fn(s.tasks[i]);
  if (!patch) return s;
  const tasks = s.tasks.slice();
  // done_at follows the state: stamped when the task becomes done, cleared when it leaves, untouched by other edits.
  const was = tasks[i].state === "done";
  const doneAt = patch.state === undefined || (patch.state === "done") === was ? {} : { done_at: patch.state === "done" ? now : null };
  tasks[i] = { ...tasks[i], ...patch, ...doneAt, updated_at: now };
  return { ...s, tasks };
}

export type TriageAnswers = Partial<Pick<Task, "deadline" | "holding_up" | "size">>;

// UX_Flows.md §3.2: size alone makes a task rankable, so the first answer that leaves a size moves Inbox → Active.
export function triage(s: State, id: string, answers: TriageAnswers, now: number, today: string): State {
  return update(s, id, now, (t) => {
    if (t.state === "done" || t.state === "removed") return null;
    const patch: Partial<Task> = { ...answers };
    if ("deadline" in answers) patch.runway_start = answers.deadline ? today : null;
    if (t.state === "inbox" && (answers.size ?? t.size)) patch.state = "active";
    return patch;
  });
}

export function rename(s: State, id: string, title: string, now: number): State {
  const trimmed = clampTitle(title);
  return update(s, id, now, () => (trimmed ? { title: trimmed } : null));
}

// Product_Scope.md §4: Removed is reachable from any state and never deletes.
export function remove(s: State, id: string, now: number): State {
  return update(s, id, now, (t) => (t.state === "removed" ? null : { state: "removed" }));
}

// Restored tasks re-enter ranking; one that was never sized can't rank, so it goes back to Inbox.
export function restore(s: State, id: string, now: number): State {
  return update(s, id, now, (t) => (t.state === "removed" ? { state: t.size ? "active" : "inbox" } : null));
}

// Pin to today: the task takes a slot in Today and bumps the lowest-ranked step out (UX_Flows.md §3.4).
export function pin(s: State, id: string, today: string, now: number): State {
  return update(s, id, now, (t) => (t.state === "active" || t.state === "overdue" ? { pinned_on: today } : null));
}

// Product_Scope.md §4: Done is reached from Active or Overdue, and nothing leaves it.
export function completeTask(s: State, id: string, now: number): State {
  return update(s, id, now, (t) => (t.state === "active" || t.state === "overdue" ? { state: "done" } : null));
}

// Onboarding (UX_Flows.md §7): the picked task becomes the first Today directly, not ranked and not triaged.
export function placeFirst(s: State, id: string, today: string, now: number): State {
  return update(s, id, now, (t) => (t.state === "done" || t.state === "removed" ? null : { pinned_on: today }));
}
