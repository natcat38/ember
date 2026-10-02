import { describe, expect, test } from "vitest";
import { localToMs, messageText, planDay, type PlanInput } from "./messages";
import { emptyState, type HardBlock, type State, type Task } from "./task";
import type { Chunk } from "./chunk";

const TODAY = "2026-10-05"; // Mei's Monday, Tech_Scope.md §4.6
const TZ = "Asia/Singapore";
const at = (hhmm: string, day = TODAY) => localToMs(day, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);

function task(id: string, o: Partial<Task>): Task {
  return { id, title: id, state: "active", size: "M", quick: false, holding_up: false, deadline: null, runway_start: null, pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1, ...o };
}
function steps(taskId: string, n: number): Chunk[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${taskId}${i + 1}`, task_id: taskId, parent_id: null, title: `${taskId}${i + 1}`, position: i + 1, state: "todo", deleted: false, updated_at: 1 }));
}
const block = (id: string, start: string, end: string): HardBlock => ({ id, weekdays: [0], start_min: Number(start.slice(0, 2)) * 60, end_min: Number(end.slice(0, 2)) * 60, label: null, deleted: false, updated_at: 1 });

// The §4.6 worked example, with its Monday hard blocks.
function mei(): State {
  return {
    ...emptyState(),
    settings: { ...emptyState().settings, tz: TZ },
    hard_blocks: [block("lecture", "09:00", "12:00"), block("lab", "14:00", "16:00")],
    tasks: [
      task("A", { title: "DSA assignment", size: "M", deadline: "2026-10-08", runway_start: "2026-09-28" }),
      task("B", { title: "Cover letter", size: "S", deadline: "2026-10-05", runway_start: "2026-10-01" }),
      task("C", { title: "Lab report", size: "L", deadline: "2026-10-04", runway_start: "2026-09-20" }),
      task("D", { title: "System design ch. 3", size: "M" }),
      task("E", { title: "Reply to recruiter", size: "XS", deadline: "2026-10-20", runway_start: "2026-10-01", holding_up: true }),
    ],
    chunks: [...steps("A", 3), ...steps("B", 1), ...steps("C", 3), ...steps("D", 2), ...steps("E", 1)],
  };
}

const plan = (o: Partial<PlanInput> = {}, s: State = mei()) => planDay({ state: s, today: TODAY, sentToday: 0, lastQuietAt: null, overdueSentFor: [], ...o });
const brief = (ms: { kind: string; task_ids: string[]; due_at: number }[]) => ms.map((m) => [m.kind, m.task_ids, m.due_at]);

describe("localToMs", () => {
  test("Asia/Singapore is UTC+8 all year", () => {
    expect(localToMs("2026-10-05", 8 * 60, "Asia/Singapore")).toBe(Date.UTC(2026, 9, 5, 0, 0));
    expect(localToMs("2026-01-15", 22 * 60 + 30, "Asia/Singapore")).toBe(Date.UTC(2026, 0, 15, 14, 30));
  });

  test("a DST zone follows the offset on that date (New York, spring forward 2026-03-08)", () => {
    expect(localToMs("2026-03-07", 8 * 60, "America/New_York")).toBe(Date.UTC(2026, 2, 7, 13, 0)); // EST, UTC-5
    expect(localToMs("2026-03-08", 8 * 60, "America/New_York")).toBe(Date.UTC(2026, 2, 8, 12, 0)); // EDT, UTC-4
    expect(localToMs("2026-03-08", 1 * 60, "America/New_York")).toBe(Date.UTC(2026, 2, 8, 6, 0)); // 01:00 is still EST
  });

  test("fall back (2026-11-01) and minutes past midnight roll into the next local day", () => {
    expect(localToMs("2026-10-31", 8 * 60, "America/New_York")).toBe(Date.UTC(2026, 9, 31, 12, 0)); // EDT
    expect(localToMs("2026-11-01", 8 * 60, "America/New_York")).toBe(Date.UTC(2026, 10, 1, 13, 0)); // EST
    expect(localToMs("2026-10-05", 25 * 60, "Asia/Singapore")).toBe(localToMs("2026-10-06", 60, "Asia/Singapore"));
  });
});

describe("planDay", () => {
  test("planned mid-day (now = 10:00), a passed slot is skipped: every message moves on rather than dropping", () => {
    const sg = (hhmm: string) => Date.parse(`${TODAY}T${hhmm}:00+08:00`);
    expect(brief(plan({ now: sg("10:00") }))).toEqual([
      ["deadline_day", ["B"], sg("16:00")],
      ["overdue", ["C"], sg("19:00")],
      ["close", ["A"], sg("21:00")],
    ]);
    expect(plan({ now: sg("07:00") })).toEqual(plan()); // before the day starts, nothing changes
  });

  test("golden: §4.6 keeps three messages, deadlines first; morning, A's second nudge and wrap-up drop", () => {
    const out = plan();
    expect(brief(out)).toEqual([
      ["deadline_day", ["B"], at("08:00")],
      ["overdue", ["C"], at("16:00")], // S2 15:00 sits inside the 14:00-16:00 block, so it moves to 16:00
      ["close", ["A"], at("19:00")], // S2 is taken, so the next free slot
    ]);
  });

  test("a block that starts before the window and runs into it moves S1 to the block's end", () => {
    const early = { ...mei(), hard_blocks: [block("early", "07:00", "09:00")] }; // awake from 08:00
    expect(plan({}, early)[0]).toMatchObject({ kind: "deadline_day", due_at: at("09:00") });
  });

  test("sentToday = 2 leaves one message: the top cap priority (overdue)", () => {
    const out = plan({ sentToday: 2 });
    expect(brief(out)).toEqual([["overdue", ["C"], at("08:00")]]);
  });

  test("sentToday = 3 leaves nothing", () => {
    expect(plan({ sentToday: 3 })).toEqual([]);
  });

  test("overdue already sent for C: no overdue candidate, so A's second nudge (priority 3) takes the freed cap slot", () => {
    const out = plan({ overdueSentFor: ["C"] });
    expect(out.some((m) => m.kind === "overdue")).toBe(false);
    expect(brief(out)).toEqual([
      ["deadline_day", ["B"], at("08:00")],
      ["close", ["A"], at("16:00")], // S2 15:00 sits inside the lab block
      ["close", ["A"], at("19:00")], // the second nudge, S3; morning (priority 4) still drops
    ]);
  });

  test("lastQuietAt at 07:50 pushes nothing earlier than 08:20", () => {
    const out = plan({ lastQuietAt: at("07:50") });
    expect(out.length).toBe(3);
    for (const m of out) expect(m.due_at).toBeGreaterThanOrEqual(at("08:20"));
    // S1 (08:00) is skipped: deadline day takes S2, overdue S3, close S4.
    expect(brief(out)).toEqual([
      ["deadline_day", ["B"], at("16:00")],
      ["overdue", ["C"], at("19:00")],
      ["close", ["A"], at("21:00")],
    ]);
  });

  test("lastQuietAt blocks only the 30 minutes after it", () => {
    const out = plan({ lastQuietAt: at("07:29") });
    expect(out[0]).toMatchObject({ kind: "deadline_day", due_at: at("08:00") }); // 08:00 is 31 minutes on
  });

  test("a snoozed task lands at its snoozed_until, instead of a slot", () => {
    const s = mei();
    s.tasks = s.tasks.map((t) => (t.id === "C" ? { ...t, snoozed_until: at("18:00") } : t));
    expect(brief(plan({}, s))).toEqual([
      ["deadline_day", ["B"], at("08:00")],
      ["close", ["A"], at("16:00")], // C is pinned to 18:00, so S1 is B's alone and close keeps S2 (moved by the block)
      ["overdue", ["C"], at("18:00")],
    ]);
  });

  test("a snoozed task still counts against the cap, and its priority still decides who drops", () => {
    const s = mei();
    s.tasks = s.tasks.map((t) => (t.id === "A" ? { ...t, snoozed_until: at("18:00") } : t));
    const out = plan({ sentToday: 1 }, s);
    expect(brief(out)).toEqual([
      ["deadline_day", ["B"], at("08:00")],
      ["overdue", ["C"], at("16:00")],
    ]); // two left; the snoozed close message ranks third and drops
  });

  test("a snoozed task leaves its close batch and gets a message of its own", () => {
    const s: State = {
      ...emptyState(),
      settings: { ...emptyState().settings, tz: TZ },
      tasks: [task("X", { title: "X", deadline: "2026-10-07", runway_start: "2026-10-01", snoozed_until: at("20:30") }), task("Y", { title: "Y", deadline: "2026-10-08", runway_start: "2026-10-01" })],
    };
    expect(brief(plan({}, s))).toEqual([
      ["close", ["Y"], at("15:00")],
      ["close", ["Y"], at("19:00")], // the second nudge is for the rest of the batch only
      ["close", ["X"], at("20:30")],
    ]);
  });

  test("a task snoozed to tomorrow gets nothing today; one snoozed past quiet start is dropped", () => {
    const s = mei();
    s.tasks = s.tasks.map((t) => (t.id === "C" ? { ...t, snoozed_until: at("08:00", "2026-10-06") } : t.id === "B" ? { ...t, snoozed_until: at("22:30") } : t));
    const out = plan({}, s);
    expect(out.find((m) => m.task_ids.includes("C"))).toBeUndefined();
    expect(out.find((m) => m.task_ids.includes("B"))).toBeUndefined();
  });

  test("a light day replaces the morning message", () => {
    const s: State = { ...emptyState(), settings: { ...emptyState().settings, tz: TZ }, tasks: [task("D", { title: "System design ch. 3" })], chunks: steps("D", 2) };
    const out = plan({}, s);
    expect(brief(out)).toEqual([
      ["light_day", ["D"], at("08:00")],
      ["wrap_up", [], at("21:00")],
    ]);
    expect(out.some((m) => m.kind === "morning")).toBe(false);
  });

  test("no tasks at all: morning and wrap-up only", () => {
    const s: State = { ...emptyState(), settings: { ...emptyState().settings, tz: TZ } };
    expect(brief(plan({}, s))).toEqual([
      ["morning", [], at("08:00")],
      ["wrap_up", [], at("21:00")],
    ]);
  });

  test("two getting-close tasks share one batched message, plus a second nudge when the cap allows", () => {
    const s: State = {
      ...emptyState(),
      settings: { ...emptyState().settings, tz: TZ },
      tasks: [task("X", { title: "X", deadline: "2026-10-08", runway_start: "2026-10-01" }), task("Y", { title: "Y", deadline: "2026-10-07", runway_start: "2026-10-01" })],
      chunks: [...steps("X", 1), ...steps("Y", 1)],
    };
    const out = plan({}, s);
    expect(brief(out)).toEqual([
      ["morning", ["Y"], at("08:00")],
      ["close", ["Y", "X"], at("15:00")], // soonest deadline first
      ["close", ["Y", "X"], at("19:00")],
    ]);
  });

  test("a message that has no slot left is dropped, not stacked", () => {
    const s = mei();
    s.hard_blocks = [block("all day", "08:00", "22:00")]; // every slot lands past the window end
    expect(plan({}, s)).toEqual([]);
  });

  test("sorted by time, and the same input gives the same plan", () => {
    const out = plan();
    expect(out.map((m) => m.due_at)).toEqual([...out.map((m) => m.due_at)].sort((a, b) => a - b));
    expect(plan()).toEqual(out);
  });

  test("slots follow the user's window, not 08:00-22:00 (a late riser, 10:00-24:00 in New York)", () => {
    const s: State = { ...emptyState(), settings: { ...emptyState().settings, tz: "America/New_York", quiet_start: 0, quiet_end: 600 } };
    const out = planDay({ state: s, today: "2026-03-08", sentToday: 0, lastQuietAt: null, overdueSentFor: [] });
    expect(brief(out)).toEqual([
      ["morning", [], localToMs("2026-03-08", 600, "America/New_York")],
      ["wrap_up", [], localToMs("2026-03-08", 23 * 60, "America/New_York")],
    ]);
  });
});

describe("messageText", () => {
  const t = (title: string) => task(title, { title });

  test("fixed copy from UX_Flows §5", () => {
    expect(messageText("deadline_day", [t("Cover letter")])).toBe("Cover letter is due today.");
    expect(messageText("overdue", [t("Lab report")])).toBe("Lab report was due today and isn't marked done. Still relevant?");
    expect(messageText("light_day", [t("System design ch. 3")])).toBe("Light day. Want to get ahead on System design ch. 3?");
    expect(messageText("wrap_up", [])).toBe("Ready to wrap up?");
  });

  test("morning names the count and the first thing", () => {
    expect(messageText("morning", [t("Cover letter")], { things: 5 })).toBe("Today's ready: 5 things. First up: Cover letter.");
    expect(messageText("morning", [t("Cover letter")], { things: 1 })).toBe("Today's ready: 1 thing. First up: Cover letter.");
  });

  test("getting close: with steps, without steps, and batched", () => {
    expect(messageText("close", [t("DSA")], { sessionsLeft: 2, daysLeft: 3 })).toBe("2 sessions left on DSA, 3 days to go. Want to start one now?");
    expect(messageText("close", [t("DSA")], { sessionsLeft: 1, daysLeft: 1 })).toBe("1 session left on DSA, 1 day to go. Want to start one now?");
    expect(messageText("close", [t("DSA")])).toBe("This deadline's getting close. Want help breaking it down?");
    expect(messageText("close", [t("X"), t("Y"), t("Z")])).toBe("A few deadlines are getting close: X, Y, and Z. Want to start with X?");
    expect(messageText("close", [t("X"), t("Y")])).toBe("A few deadlines are getting close: X and Y. Want to start with X?");
  });
});
