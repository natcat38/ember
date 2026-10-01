import { childrenOf, topLevel, type Chunk } from "./chunk";
import { dayOf } from "./day";
import type { Day, Size, State, Task } from "./task";

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
function leaves(s: State, taskId: string): { chunk: Chunk; parent: Chunk | null }[] {
  return topLevel(s, taskId).flatMap((c): { chunk: Chunk; parent: Chunk | null }[] => {
    const kids = childrenOf(s, c.id);
    return kids.length ? kids.map((k) => ({ chunk: k, parent: c })) : [{ chunk: c, parent: null }];
  });
}

export function buildToday(s: State, today: string, o: TodayOptions): Today {
  const sessionsDone = o.sessionsDone ?? (() => 0);
  const tz = o.tz ?? "Asia/Singapore";
  const slots = o.slots ?? 5;
  const deferred = new Set(s.days.find((d) => d.day === today)?.deferred ?? []);
  // ponytail: "done today" reads updated_at, so renaming a step finished earlier brings it back as done today.
  // Upgrade path: a done_at column, if that ever matters.
  const doneToday = (c: Chunk) => c.state === "done" && dayOf(c.updated_at, tz, o.quietEndMin) === today;

  const ranked = s.tasks
    .filter((t) => (t.state === "active" || t.state === "overdue") && t.size)
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
    const all = leaves(s, t.id);
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
export function doneTodayCount(s: State, today: string, tz = "Asia/Singapore", quietEndMin?: number) {
  const on = (at: number) => dayOf(at, tz, quietEndMin) === today;
  return s.chunks.filter((c) => !c.deleted && c.state === "done" && on(c.updated_at)).length + s.tasks.filter((t) => t.state === "done" && on(t.updated_at)).length;
}

const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// Overdue is a plain date label, no red (UX_Flows.md §4): "Was due Tue", or the date once it's a week old.
export function wasDueLabel(deadline: string, today: string) {
  const d = Date.parse(deadline);
  return `Was due ${daysBetween(deadline, today) < 7 ? weekday.format(d) : shortDate.format(d)}`;
}

export const addDays = (day: string, n: number) => new Date(Date.parse(day) + n * 86_400_000).toISOString().slice(0, 10);
