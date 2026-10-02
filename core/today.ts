import { byPosition, type Chunk } from "./chunk";
import { DEFAULT_TZ, blockSpans, dayOf, windowLen } from "./day";
import type { Day, HardBlock, Size, State, Task } from "./task";

// Tech_Scope.md §4.2–4.4. Pure: the day and the clock-derived inputs are passed in.

export type Band = "overdue" | "due_today" | "close" | "on_track" | "far";

const PADDED: Record<Size, number> = { XS: 1, S: 2, M: 5, L: 10, XL: 19 }; // round(base × 1.2)

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export const remaining = (t: Task, sessionsDone: number) => Math.max(PADDED[t.size ?? "XS"] - sessionsDone, 1);

const UP: Partial<Record<Band, Band>> = { far: "on_track", on_track: "close" };

export function band(t: Task, today: string): Band {
  const b = rawBand(t, today);
  // Holding up moves a task one band up, never into due today or overdue.
  return t.holding_up ? (UP[b] ?? b) : b;
}

function rawBand(t: Task, today: string): Band {
  if (!t.deadline) return "far";
  const left = daysBetween(today, t.deadline);
  if (left < 0) return "overdue";
  if (left === 0) return "due_today";
  const fraction = left / Math.max(daysBetween(t.runway_start ?? today, t.deadline), 1);
  if (left <= 3 || fraction <= 0.3) return "close";
  return fraction > 0.5 ? "far" : "on_track";
}

// When a done row was finished. Rows saved before done_at existed have none, so they fall back to updated_at.
const finishedAt = (r: { done_at?: number | null; updated_at: number }) => r.done_at ?? r.updated_at;

const TIER: Record<Band, number> = { due_today: 1, overdue: 2, close: 3, on_track: 4, far: 5 };

export interface TodayRow {
  key: string; // the chunk id, or the task id when the task has no steps yet
  task: Task;
  chunk: Chunk | null; // null: the row's Start asks for the next action (UX_Flows.md §3.3)
  parent: Chunk | null; // a smaller step names its parent
  done: boolean;
  tier: number;
}

export interface Today {
  rows: TodayRow[]; // rank order, at most `slots`
  frog: TodayRow | null; // row 1, until it's done
  waiting: number; // leftover non-far rows: "N more waiting"
  lightDay: Task | null; // "Light day. Want to get ahead on X?"
  ranked: Task[]; // every rankable task, best first (Inbox's Waiting order)
}

export interface TodayOptions {
  sessionsDone?: (taskId: string) => number;
  tz?: string;
  quietEndMin?: number;
  slots?: number; // phase 1 has no hard blocks, so always 5 (§4.4 step 5)
}

// Leaves in list order: a parent is replaced by its smaller steps (Today never shows a parent).
// One pass groups the steps by task (top level) and by parent, so each task's leaves cost its own size, not every step's.
function leavesOf(s: State): (taskId: string) => { chunk: Chunk; parent: Chunk | null }[] {
  const groups = new Map<string, Chunk[]>(); // key: a parent's id, or a task's id for its top-level steps
  for (const c of s.chunks) {
    if (c.deleted) continue;
    const key = c.parent_id ?? c.task_id;
    const g = groups.get(key);
    if (g) g.push(c);
    else groups.set(key, [c]);
  }
  for (const g of groups.values()) g.sort(byPosition);
  return (taskId) =>
    (groups.get(taskId) ?? []).flatMap((c): { chunk: Chunk; parent: Chunk | null }[] => {
      const kids = groups.get(c.id) ?? [];
      return kids.length ? kids.map((k) => ({ chunk: k, parent: c })) : [{ chunk: c, parent: null }];
    });
}

export function buildToday(s: State, today: string, o: TodayOptions): Today {
  const sessionsDone = o.sessionsDone ?? (() => 0);
  const tz = o.tz ?? DEFAULT_TZ;
  const slots = o.slots ?? 5;
  const leaves = leavesOf(s);
  const deferred = new Set(s.days.find((d) => d.day === today)?.deferred ?? []);
  const doneToday = (c: Chunk) => c.state === "done" && dayOf(finishedAt(c), tz, o.quietEndMin) === today;

  const ranked = s.tasks
    // A task pinned into today shows whether or not it was triaged: onboarding places its first task that way (§7).
    .filter((t) => ((t.state === "active" || t.state === "overdue") && t.size) || (t.pinned_on === today && (t.state === "inbox" || t.state === "active" || t.state === "overdue")))
    .map((t) => {
      const left = t.deadline ? daysBetween(today, t.deadline) : null;
      // Sessions per day still needed, keeping one buffer day. No deadline: no pressure.
      const pressure = left === null ? 0 : remaining(t, sessionsDone(t.id)) / Math.max(left - 1, 1);
      return { t, tier: t.pinned_on === today ? 0 : TIER[band(t, today)], pressure };
    })
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        Number(b.t.holding_up) - Number(a.t.holding_up) ||
        b.pressure - a.pressure ||
        (a.t.deadline ?? "9999").localeCompare(b.t.deadline ?? "9999") ||
        (a.t.runway_start ?? "9999").localeCompare(b.t.runway_start ?? "9999"),
    );

  const rowsOf = ({ t, tier, pressure }: (typeof ranked)[number]): TodayRow[] => {
    const all = leaves(t.id);
    if (!all.length) return deferred.has(t.id) ? [] : [{ key: t.id, task: t, chunk: null, parent: null, done: false, tier }];
    // A step finished today keeps its slot, so finishing never pulls in a new one ("done means done").
    const eligible = all.filter(({ chunk }) => (chunk.state !== "done" && !deferred.has(chunk.id)) || doneToday(chunk));
    const cap = Math.min(Math.max(Math.ceil(pressure), 1), 2); // stops one big task filling the day
    return eligible.slice(0, cap).map(({ chunk, parent }) => ({ key: chunk.id, task: t, chunk, parent, done: chunk.state === "done", tier }));
  };

  const candidates = ranked.filter((r) => r.tier < 5).flatMap(rowsOf);
  const rows = candidates.slice(0, slots);
  const frog = rows[0] && !rows[0].done ? rows[0] : null;
  const waiting = candidates.slice(slots).filter((r) => !r.done).length;

  // Light day: offer the top far task once. Declining it ("Not today") defers it, which ends the offer for the day.
  const far = ranked.filter((r) => r.tier === 5).map((r) => r.t);
  const lightDay = rows.length < slots && !far.some((t) => deferred.has(t.id)) ? (far[0] ?? null) : null;

  return { rows, frog, waiting, lightDay, ranked: ranked.map((r) => r.t) };
}

function withDay(s: State, today: string, fn: (d: Day) => Day): State {
  const existing = s.days.find((d) => d.day === today) ?? { day: today, confirmed_at: null, deferred: [] };
  const next = fn(existing);
  return next === existing ? s : { ...s, days: [...s.days.filter((d) => d.day !== today), next] };
}

// "Not today" puts off one row for the rest of the day; the next-ranked row fills the slot.
export const notToday = (s: State, today: string, key: string) =>
  withDay(s, today, (d) => (d.deferred.includes(key) ? d : { ...d, deferred: [...d.deferred, key] }));

// The morning confirm shows once a day, answered or not (UX_Flows.md §3.4).
export const confirmDay = (s: State, today: string, now: number) =>
  withDay(s, today, (d) => (d.confirmed_at ? d : { ...d, confirmed_at: now }));

export const isConfirmed = (s: State, today: string) => !!s.days.find((d) => d.day === today)?.confirmed_at;

export const wrapUp = (s: State, today: string, now: number) =>
  withDay(s, today, (d) => (d.shutdown_at ? d : { ...d, shutdown_at: now }));

// Steps and tasks finished today: zero means the shutdown's resting variant (UX_Flows.md §3.7).
export function doneTodayCount(s: State, today: string, tz = DEFAULT_TZ, quietEndMin?: number) {
  const on = (r: { done_at?: number | null; updated_at: number }) => dayOf(finishedAt(r), tz, quietEndMin) === today;
  return s.chunks.filter((c) => !c.deleted && c.state === "done" && on(c)).length + s.tasks.filter((t) => t.state === "done" && on(t)).length;
}

const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// Overdue is a plain date label, no red (UX_Flows.md §4): "Was due Tue", or the date once it's a week old.
export function wasDueLabel(deadline: string, today: string) {
  const d = Date.parse(deadline);
  return `Was due ${daysBetween(deadline, today) < 7 ? weekday.format(d) : shortDate.format(d)}`;
}

export const addDays = (day: string, n: number) => new Date(Date.parse(day) + n * 86_400_000).toISOString().slice(0, 10);

// Product_Scope.md §2: 3 or more days away is a lapse; one or two days opens as an ordinary day.
export const isLapse = (lastSeenAt: number | null, now: number, tz = DEFAULT_TZ, quietEndMin?: number) =>
  lastSeenAt !== null && daysBetween(dayOf(lastSeenAt, tz, quietEndMin), dayOf(now, tz, quietEndMin)) >= 3;

// "Want to reset them?": the passed dates are dropped, so the "Was due" labels go and each task ranks afresh.
export function resetOverdue(s: State, today: string, now: number): State {
  const passed = (t: Task) => (t.state === "active" || t.state === "overdue") && !!t.deadline && daysBetween(today, t.deadline) < 0;
  if (!s.tasks.some(passed)) return s;
  return { ...s, tasks: s.tasks.map((t) => (passed(t) ? { ...t, state: "active", deadline: null, runway_start: null, updated_at: now } : t)) };
}

// §4.4 step 5: free minutes = the waking window (quiet end → quiet start) minus the day's hard blocks.
export function freeMinutes(s: State, day: string): number {
  const len = windowLen(s.settings);
  // Spans are laid out from quiet end, so a window past midnight is a straight line; clip them to the window.
  const busy = blockSpans(s.hard_blocks, day, s.settings.quiet_end)
    .map(([from, to]) => [Math.max(from, 0), Math.min(to, len)] as const)
    .sort((a, b) => a[0] - b[0]);
  let taken = 0;
  let reach = 0; // merge overlapping blocks so shared minutes count once
  for (const [from, to] of busy) {
    const start = Math.max(from, reach);
    if (to > start) taken += to - start;
    reach = Math.max(reach, to);
  }
  return len - taken;
}

export const slotsFor = (s: State, day: string) => Math.min(5, Math.floor(freeMinutes(s, day) / 30));

// Validated at the edge where blocks are made: at least one day, and it ends after it starts.
export function blockProblem(b: Pick<HardBlock, "weekdays" | "start_min" | "end_min">): string | null {
  if (!b.weekdays.length) return "Pick at least one day.";
  if (b.end_min <= b.start_min) return "End it after it starts.";
  return null;
}
