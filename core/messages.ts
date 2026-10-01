import { dayOf } from "./day";
import { sessionsDone } from "./focus";
import { band, buildToday, slotsFor } from "./today";
import type { State, Task } from "./task";

// Tech_Scope.md §4.5: plan every message the day can want, keep the best 3, place them in slots.
// Pure: the clock-derived inputs (today, how many went out, the last snooze) are passed in.

export type MessageKind = "morning" | "light_day" | "close" | "deadline_day" | "overdue" | "wrap_up";

// One row for the D1 `sends` table (Tech_Scope.md §3).
export interface PlannedMessage {
  kind: MessageKind;
  task_ids: string[]; // several when batched
  due_at: number; // unix ms
}

export interface PlanInput {
  state: State; // tasks (with snoozed_until), chunks, settings (tz, quiet hours), hard_blocks
  today: string; // local day, YYYY-MM-DD
  sentToday: number;
  lastQuietAt: number | null; // unix ms of the last snooze or dismissal
  overdueSentFor: string[]; // task ids with an `overdue` send since their deadline last changed
  now?: number; // unix ms; a slot already past is not free, so a mid-day plan moves its message to the next slot
}

const DAILY_CAP = 3; // Product_Scope.md §2
const QUIET_GAP_MS = 30 * 60_000; // no message within 30 minutes after a snooze or dismissal (UX_Flows.md §5)
const DEFAULT_TZ = "Asia/Singapore"; // same fallback as buildToday: a null tz means "the browser's", which core cannot see

// --- Local time -> unix ms ----------------------------------------------------------------------

const clock = (tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });

// How far the zone's wall clock is ahead of UTC at instant `ms`.
function offsetMs(ms: number, tz: string): number {
  const p = Object.fromEntries(clock(tz).formatToParts(ms).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// The unix ms of `minutes` after local midnight on `day` in `tz`. Minutes past 1440 roll into the next day.
// The offset is looked up twice, so a time on the far side of a DST change still lands on the right side of it.
// A wall-clock time that does not exist (the spring-forward gap) or happens twice (fall back) gets one valid reading.
export function localToMs(day: string, minutes: number, tz: string): number {
  const wall = Date.parse(day) + minutes * 60_000; // the wall clock read as if it were UTC
  const guess = wall - offsetMs(wall, tz);
  return wall - offsetMs(guess, tz);
}

// --- Slots (§4.5) -------------------------------------------------------------------------------

// Slot times as minutes after the waking window's start: S1 start, S2 midpoint, S3 end - 3 h, S4 end - 1 h.
// Exported with the two helpers below so a Telegram snooze (worker/buttons.ts) lands where the planner would put a message.
export const slotOffsets = (len: number) => [0, Math.round(len / 2), Math.max(len - 180, 0), Math.max(len - 60, 0)];

// Hard blocks as [from, to) offsets from the window start, laid out like freeMinutes so a window past midnight stays straight.
export function blockSpans(
  blocks: { weekdays: number[]; start_min: number; end_min: number; deleted?: boolean }[],
  day: string,
  windowStart: number,
): (readonly [number, number])[] {
  const weekday = (new Date(Date.parse(day)).getUTCDay() + 6) % 7; // 0 = Monday
  return blocks
    .filter((b) => !b.deleted && b.weekdays.includes(weekday))
    .map((b) => {
      const from = (b.start_min - windowStart + 1440) % 1440;
      return [from, from + b.end_min - b.start_min] as const;
    });
}

// A slot inside a hard block moves to that block's end. Adjacent blocks chain, hence the loop.
export function clearOfBlocks(offset: number, spans: (readonly [number, number])[]): number {
  let o = offset;
  for (let moved = true; moved; ) {
    const hit = spans.find(([from, to]) => from <= o && o < to);
    moved = !!hit;
    if (hit) o = hit[1];
  }
  return o;
}

// --- Candidates (§4.5 table) --------------------------------------------------------------------

interface Candidate {
  kind: MessageKind;
  task_ids: string[];
  priority: number; // cap priority: 1 wins
  order: number; // placement order: deadlines first, then morning, close, wrap-up
  slot: number; // preferred slot index, 0 = S1
  at?: number; // a snoozed task's own time: it skips the slots
  second?: boolean; // close's second nudge: placed after the first
}

// A snooze that falls today pins the task's message to that time; one that falls on a later day silences it today.
type Snooze = { pinned: number } | "later" | null;

const ORDER: Record<MessageKind, number> = { deadline_day: 0, overdue: 1, morning: 2, light_day: 2, close: 3, wrap_up: 4 };

export function planDay(input: PlanInput): PlannedMessage[] {
  const { state: s, today } = input;
  const tz = s.settings.tz ?? DEFAULT_TZ;
  const { quiet_start, quiet_end } = s.settings;
  const len = (quiet_start - quiet_end + 1440) % 1440 || 1440; // waking window length, as in freeMinutes
  const at = (offset: number) => localToMs(today, quiet_end + offset, tz);

  const snoozeOf = (t: Task): Snooze => {
    if (t.snoozed_until === null) return null;
    const d = dayOf(t.snoozed_until, tz, quiet_end);
    return d > today ? "later" : d === today ? { pinned: t.snoozed_until } : null;
  };
  const cand = (kind: MessageKind, task_ids: string[], priority: number, slot: number, extra: Partial<Candidate> = {}): Candidate => ({ kind, task_ids, priority, order: ORDER[kind], slot, ...extra });

  const live = s.tasks.filter((t) => (t.state === "active" || t.state === "overdue") && snoozeOf(t) !== "later");
  const byDeadline = (a: Task, b: Task) => (a.deadline ?? "").localeCompare(b.deadline ?? "");
  const one = (kind: MessageKind, priority: number, t: Task) => {
    const z = snoozeOf(t);
    return cand(kind, [t.id], priority, 0, { at: z && z !== "later" ? z.pinned : undefined });
  };

  const overdueSent = new Set(input.overdueSentFor);
  const overdue = live.filter((t) => band(t, today) === "overdue" && !overdueSent.has(t.id)).sort(byDeadline);
  const dueToday = live.filter((t) => band(t, today) === "due_today");
  const close = live.filter((t) => band(t, today) === "close").sort(byDeadline);
  const snoozedClose = close.filter((t) => snoozeOf(t));
  const batched = close.filter((t) => !snoozeOf(t)).map((t) => t.id);

  const candidates: Candidate[] = [
    ...overdue.map((t) => one("overdue", 1, t)),
    ...dueToday.map((t) => one("deadline_day", 2, t)),
    ...snoozedClose.map((t) => one("close", 3, t)),
    ...(batched.length ? [cand("close", batched, 3, 1), cand("close", batched, 3, 2, { second: true })] : []),
  ];

  // Morning, or the light-day offer in its place when Today has room and a far task is waiting.
  const view = buildToday(s, today, { sessionsDone: sessionsDone(s), tz, quietEndMin: quiet_end, slots: slotsFor(s, today) });
  candidates.push(view.lightDay ? cand("light_day", [view.lightDay.id], 4, 0) : cand("morning", view.frog ? [view.frog.task.id] : [], 4, 0));
  candidates.push(cand("wrap_up", [], 5, 3));

  // 1. Select: the best `3 - sent`. The sort is stable, so ties keep the order they were built in (close's first nudge before its second).
  const kept = [...candidates].sort((a, b) => a.priority - b.priority).slice(0, Math.max(DAILY_CAP - input.sentToday, 0));

  // 2. Place in time-sensitivity order, one message per slot.
  const offsets = slotOffsets(len);
  const spans = blockSpans(s.hard_blocks, today, quiet_end);
  const slots = offsets.map((o) => clearOfBlocks(o, spans)).map((o) => (o < len ? at(o) : null)); // past the window's end: no slot
  const windowStart = at(0);
  const windowEnd = at(len);

  const used = new Set<number>();
  const placed: { c: Candidate; due_at: number }[] = [];
  // Snoozed tasks go first: their time is the user's choice, so the slots flow around them.
  for (const c of kept.filter((k) => k.at !== undefined)) {
    if (c.at! >= windowStart && c.at! < windowEnd) {
      used.add(c.at!);
      placed.push({ c, due_at: c.at! });
    } // a snooze that lands in quiet hours is dropped: tomorrow's plan picks the task up again
  }

  const quietBlocked = (ms: number) => input.lastQuietAt !== null && ms >= input.lastQuietAt && ms < input.lastQuietAt + QUIET_GAP_MS;
  let firstClose = -1; // slot index the close batch landed on; its second nudge must come after it
  for (const c of kept.filter((k) => k.at === undefined).sort((a, b) => a.order - b.order)) {
    let from = c.slot;
    if (c.second) {
      if (firstClose < 0) continue; // no first nudge, no second
      from = Math.max(from, firstClose + 1);
    }
    const i = slots.findIndex((ms, idx) => idx >= from && ms !== null && ms >= (input.now ?? -Infinity) && !used.has(ms) && !quietBlocked(ms));
    if (i < 0) continue; // nowhere to put it: dropped, never stacked
    used.add(slots[i]!);
    placed.push({ c, due_at: slots[i]! });
    if (c.kind === "close" && !c.second) firstClose = i;
  }

  return placed.sort((a, b) => a.due_at - b.due_at).map(({ c, due_at }) => ({ kind: c.kind, task_ids: c.task_ids, due_at }));
}

// --- Copy (UX_Flows.md §5) ----------------------------------------------------------------------

// What the text needs beyond the tasks. The sender fills it from the state at send time.
export interface TextContext {
  things?: number; // morning: how many rows Today holds
  sessionsLeft?: number; // close, one task with steps: sessions still to go
  daysLeft?: number; // close, one task with steps
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// "X", "X and Y", "X, Y, and Z"
const list = (names: string[]) => (names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`);

// The message body. `tasks` is the message's task_ids resolved in order: the frog's task for morning, the far task for light_day.
export function messageText(kind: MessageKind, tasks: Pick<Task, "title">[], ctx: TextContext = {}): string {
  const name = tasks[0]?.title ?? "";
  switch (kind) {
    case "morning": {
      const things = ctx.things ?? tasks.length;
      // No fixed copy for an empty Today: this is a proposal.
      return tasks.length && things ? `Today's ready: ${plural(things, "thing")}. First up: ${name}.` : "Nothing's lined up yet. Add a task when you're ready.";
    }
    case "light_day":
      return `Light day. Want to get ahead on ${name}?`;
    case "deadline_day":
      return `${name} is due today.`;
    case "overdue":
      return `${name} was due today and isn't marked done. Still relevant?`;
    case "wrap_up":
      return "Ready to wrap up?";
    case "close":
      if (tasks.length > 1) return `A few deadlines are getting close: ${list(tasks.map((t) => t.title))}. Want to start with ${name}?`;
      if (ctx.sessionsLeft !== undefined && ctx.daysLeft !== undefined)
        return `${plural(ctx.sessionsLeft, "session")} left on ${name}, ${plural(ctx.daysLeft, "day")} to go. Want to start one now?`;
      return "This deadline's getting close. Want help breaking it down?"; // never chunked: the title is the task name
  }
}
