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
  created_at: number;
  updated_at: number;
}

export interface State {
  tasks: Task[];
  draft: string; // unsent capture text, kept when the sheet closes (UX_Flows.md §3.1)
}

export const emptyState = (): State => ({ tasks: [], draft: "" });

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
  tasks[i] = { ...tasks[i], ...patch, updated_at: now };
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
