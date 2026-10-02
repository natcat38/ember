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
  sessions: Session[];
  focus: Focus | null; // the running focus session, if any
  last_seen_at: number | null; // users.last_seen_at: drives the lapse return
  onboarded: boolean; // this device finished (or skipped) the first-run sequence, UX_Flows.md §7; never synced
  nudge_offered: boolean; // the one-time reminder offer after the first Reward has been shown; never synced
  settings: Settings;
  hard_blocks: HardBlock[];
  draft: string; // unsent capture text, kept when the sheet closes (UX_Flows.md §3.1)
}

export const emptyState = (): State => ({ tasks: [], chunks: [], days: [], sessions: [], focus: null, last_seen_at: null, onboarded: false, nudge_offered: false, settings: { tz: null, quiet_start: 1320, quiet_end: 480 }, hard_blocks: [], draft: "" });

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
  const title = input.title.trim();
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
  const trimmed = title.trim();
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
