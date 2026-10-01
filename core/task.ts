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
