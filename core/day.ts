// Tech_Scope.md §4.1: a day starts when quiet hours end; its name is the local date at that moment.
export function dayOf(now: number, tz: string, quietEndMin = 480): string {
  // ponytail: shifts absolute time, so on a DST-change day the boundary is off by an hour.
  // Upgrade path: compute the local wall-clock time first, if a DST zone ever needs it exact.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    now - quietEndMin * 60_000,
  );
}
