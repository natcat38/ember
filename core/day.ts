import type { Settings } from "./task";

export const DEFAULT_TZ = "Asia/Singapore"; // a null tz means "unset": core cannot see the browser's zone, so it falls back to this
export const DAILY_CAP = 3; // Product_Scope.md §2

// A new Intl.DateTimeFormat costs ~100 µs and a cached one ~1 µs, so one per zone (core/messages.ts caches its clock the same way).
const dayFormats = new Map<string, Intl.DateTimeFormat>();
function dayFormat(tz: string): Intl.DateTimeFormat {
  let f = dayFormats.get(tz);
  if (!f) dayFormats.set(tz, (f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })));
  return f;
}

// Tech_Scope.md §4.1: a day starts when quiet hours end; its name is the local date at that moment.
export function dayOf(now: number, tz: string, quietEndMin = 480): string {
  // ponytail: shifts absolute time, so on a DST-change day the boundary is off by an hour.
  // Upgrade path: compute the local wall-clock time first, if a DST zone ever needs it exact.
  return dayFormat(tz).format(now - quietEndMin * 60_000);
}

// The waking window's length in minutes: quiet end to quiet start, a full 1440 when they are equal.
export const windowLen = ({ quiet_start, quiet_end }: Pick<Settings, "quiet_start" | "quiet_end">) => (quiet_start - quiet_end + 1440) % 1440 || 1440;

// Hard blocks as [from, to) offsets from the window start, laid out so a window past midnight stays straight. A block that
// starts before the window start and runs into it (07:00-09:00 on an 08:00 start) also gets a copy shifted back a day, with a
// negative `from`, so it still covers the window's first minutes. Callers clip to [0, window length].
export function blockSpans(
  blocks: { weekdays: number[]; start_min: number; end_min: number; deleted?: boolean }[],
  day: string,
  windowStart: number,
): (readonly [number, number])[] {
  const weekday = (new Date(Date.parse(day)).getUTCDay() + 6) % 7; // 0 = Monday
  return blocks
    .filter((b) => !b.deleted && b.weekdays.includes(weekday))
    .flatMap((b): (readonly [number, number])[] => {
      const from = (b.start_min - windowStart + 1440) % 1440;
      const to = from + b.end_min - b.start_min;
      return to > 1440 ? [[from, to], [from - 1440, to - 1440]] : [[from, to]];
    });
}
