import { expect, test } from "vitest";
import { band, blockProblem, buildToday, confirmDay, daysBetween, doneTodayCount, freeMinutes, isConfirmed, isLapse, notToday, remaining, resetOverdue, slotsFor, wrapUp } from "./today";
import { completeTask, emptyState, pin, placeFirst, remove, rename, restore, triage, type State, type Task } from "./task";
import type { Chunk } from "./chunk";

const TODAY = "2026-10-05"; // Mei's Monday, Tech_Scope.md §4.6

function task(id: string, o: Partial<Task>): Task {
  return { id, title: id, state: "active", size: "M", quick: false, holding_up: false, deadline: null, runway_start: null, pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1, ...o };
}
function steps(taskId: string, n: number, o: Partial<Chunk> = {}): Chunk[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${taskId}${i + 1}`, task_id: taskId, parent_id: null, title: `${taskId}${i + 1}`, position: i + 1, state: "todo", deleted: false, updated_at: 1, ...o }));
}

// The §4.6 worked example, minus hard blocks (slice 10).
function mei(): State {
  return {
    ...emptyState(),
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
const meiSessions = (id: string) => (id === "A" ? 1 : 0);
const ids = (rows: { key: string }[]) => rows.map((r) => r.key);

test("golden: §4.6 Today is B1 (frog), C1, C2, C3, A1, with 3 more waiting and no light-day offer", () => {
  const t = buildToday(mei(), TODAY, { sessionsDone: meiSessions });
  expect(ids(t.rows)).toEqual(["B1", "C1", "C2", "C3", "A1"]);
  expect(t.frog?.key).toBe("B1");
  expect(t.waiting).toBe(3); // A2, A3, E1
  expect(t.lightDay).toBeNull(); // the day is full, so D is not offered
});

test("golden: §4.6 bands and remaining sessions", () => {
  const s = mei();
  const get = (id: string) => s.tasks.find((t) => t.id === id)!;
  expect(band(get("B"), TODAY)).toBe("due_today");
  expect(band(get("C"), TODAY)).toBe("overdue");
  expect(band(get("A"), TODAY)).toBe("close"); // 3 days left
  expect(band(get("E"), TODAY)).toBe("on_track"); // fraction 15/19 = 0.79 → far, holding up → on track
  expect(band(get("D"), TODAY)).toBe("far"); // no deadline
  expect(remaining(get("A"), 1)).toBe(4);
  expect(remaining(get("C"), 0)).toBe(10);
  expect(remaining(get("B"), 9)).toBe(1); // never below 1 while not done
});

test("bands: first match wins; holding up never lifts into due today or overdue", () => {
  const t = (deadline: string, runway_start: string, holding_up = false) => band(task("x", { deadline, runway_start, holding_up }), TODAY);
  expect(t("2026-10-30", "2026-09-01")).toBe("on_track"); // fraction 25/59 = 0.42
  expect(t("2026-10-30", "2026-09-01", true)).toBe("close");
  expect(t("2026-10-15", "2026-08-01")).toBe("close"); // fraction 10/75 ≤ 0.3
  expect(t("2026-10-06", "2026-10-05", true)).toBe("close"); // ≤ 3 days left
  expect(daysBetween("2026-10-05", "2026-11-05")).toBe(31);
});

test("Not today defers a step and the next-ranked one fills the slot", () => {
  const s = { ...mei(), days: [{ day: TODAY, confirmed_at: null, deferred: ["C2"] }] };
  const t = buildToday(s, TODAY, { sessionsDone: meiSessions });
  expect(ids(t.rows)).toEqual(["B1", "C1", "C3", "A1", "A2"]);
});

test("pinning a task takes a slot and bumps the lowest-ranked step out", () => {
  const s = mei();
  s.tasks = s.tasks.map((t) => (t.id === "D" ? { ...t, pinned_on: TODAY } : t));
  const t = buildToday(s, TODAY, { sessionsDone: meiSessions });
  expect(ids(t.rows)).toEqual(["D1", "D2", "B1", "C1", "C2"]);
  expect(t.frog?.key).toBe("D1");
});

test("done means done: a step finished today keeps its slot, nothing refills", () => {
  const s = mei();
  const doneToday = Date.parse("2026-10-05T10:00:00+08:00");
  s.chunks = s.chunks.map((c) => (c.id === "B1" || c.id === "C1" ? { ...c, state: "done", updated_at: doneToday } : c));
  const t = buildToday(s, TODAY, { sessionsDone: meiSessions, tz: "Asia/Singapore" });
  expect(ids(t.rows)).toEqual(["B1", "C1", "C2", "C3", "A1"]);
  expect(t.frog).toBeNull(); // the frog is eaten
});

test("a lone task shows all its steps: no per-task cap leaves slots empty", () => {
  const s = { ...emptyState(), tasks: [task("L", { size: "L", deadline: "2026-10-07", runway_start: "2026-10-01" })], chunks: steps("L", 3) };
  expect(ids(buildToday(s, TODAY, {}).rows)).toEqual(["L1", "L2", "L3"]);
});

test("a step finished on an earlier day leaves Today", () => {
  const s = mei();
  s.chunks = s.chunks.map((c) => (c.id === "C1" ? { ...c, state: "done", updated_at: Date.parse("2026-10-04T10:00:00+08:00") } : c));
  expect(ids(buildToday(s, TODAY, { sessionsDone: meiSessions, tz: "Asia/Singapore" }).rows)).toEqual(["B1", "C2", "C3", "A1", "A2"]);
});

test("a task with no steps contributes one row that asks for the next action", () => {
  const s = mei();
  s.chunks = s.chunks.filter((c) => c.task_id !== "B");
  const t = buildToday(s, TODAY, { sessionsDone: meiSessions });
  expect(t.rows[0]).toMatchObject({ key: "B", chunk: null });
});

test("Today surfaces smaller steps, never the parent, and names the parent", () => {
  const s: State = {
    ...emptyState(),
    tasks: [task("A", { deadline: "2026-10-06", runway_start: "2026-10-01" })],
    chunks: [...steps("A", 1), { ...steps("A", 1)[0], id: "A1a", title: "A1a", parent_id: "A1" }, { ...steps("A", 1)[0], id: "A1b", title: "A1b", parent_id: "A1", position: 2 }],
  };
  const t = buildToday(s, TODAY, {});
  expect(ids(t.rows)).toEqual(["A1a", "A1b"]);
  expect(t.rows[0].parent?.id).toBe("A1");
});

test("light day: few rows, so the top far task is offered once", () => {
  const s: State = { ...emptyState(), tasks: [task("A", { deadline: "2026-10-06", runway_start: "2026-10-01", size: "XS" }), task("D", { size: "M" })], chunks: [...steps("A", 1), ...steps("D", 1)] };
  expect(buildToday(s, TODAY, {}).lightDay?.id).toBe("D");
  const declined = { ...s, days: [{ day: TODAY, confirmed_at: null, deferred: ["D"] }] };
  expect(buildToday(declined, TODAY, {}).lightDay).toBeNull();
});

test("untriaged, done, and removed tasks never rank", () => {
  const s: State = {
    ...emptyState(),
    tasks: [task("A", { state: "inbox", size: null }), task("B", { state: "done" }), task("C", { state: "removed" })],
    chunks: [...steps("A", 1), ...steps("B", 1), ...steps("C", 1)],
  };
  const t = buildToday(s, TODAY, {});
  expect(t.rows).toEqual([]);
  expect(t.waiting).toBe(0);
});

test("Not today, confirm, and pin are recorded once per day", () => {
  let s = notToday(mei(), TODAY, "C2");
  expect(notToday(s, TODAY, "C2")).toBe(s);
  expect(isConfirmed(s, TODAY)).toBe(false);
  s = confirmDay(s, TODAY, 5);
  expect(confirmDay(s, TODAY, 6)).toBe(s);
  expect(s.days).toEqual([{ day: TODAY, confirmed_at: 5, deferred: ["C2"] }]);
  expect(isConfirmed(s, "2026-10-06")).toBe(false);
  expect(pin(s, "D", TODAY, 7).tasks.find((t) => t.id === "D")?.pinned_on).toBe(TODAY);
  const inbox = { ...s, tasks: [task("X", { state: "inbox" })] };
  expect(pin(inbox, "X", TODAY, 7)).toBe(inbox);
});

test("wrap-up is recorded once; done-today counts steps finished today only", () => {
  let s = wrapUp(mei(), TODAY, 9);
  expect(wrapUp(s, TODAY, 10)).toBe(s);
  expect(s.days[0].shutdown_at).toBe(9);
  const at = (iso: string) => Date.parse(iso);
  s.chunks = s.chunks.map((c) =>
    c.id === "A1" ? { ...c, state: "done", updated_at: at("2026-10-05T12:00:00+08:00") } : c.id === "A2" ? { ...c, state: "done", updated_at: at("2026-10-04T12:00:00+08:00") } : c,
  );
  expect(doneTodayCount(s, TODAY)).toBe(1);
  expect(doneTodayCount(mei(), TODAY)).toBe(0);
  expect(doneTodayCount(completeTask(mei(), "B", at("2026-10-05T21:00:00+08:00")), TODAY)).toBe(1); // finishing a task counts too
});

test("a task completes from Active or Overdue only, and stays done", () => {
  const s = mei();
  const done = completeTask(s, "A", 5);
  expect(done.tasks.find((t) => t.id === "A")?.state).toBe("done");
  expect(completeTask(done, "A", 6)).toBe(done);
  const inbox = { ...s, tasks: [task("X", { state: "inbox" })] };
  expect(completeTask(inbox, "X", 5)).toBe(inbox);
  expect(triage(done, "A", { size: "S" }, 7, TODAY)).toBe(done); // nothing leaves done
});

test("lapse: 3+ days away by the local day, not 72 hours", () => {
  const at = (iso: string) => Date.parse(iso);
  expect(isLapse(null, at("2026-10-05T09:00:00+08:00"))).toBe(false); // first ever open
  expect(isLapse(at("2026-10-03T09:00:00+08:00"), at("2026-10-05T09:00:00+08:00"))).toBe(false); // 2 days
  expect(isLapse(at("2026-10-02T23:00:00+08:00"), at("2026-10-05T08:30:00+08:00"))).toBe(true); // days 10-02 → 10-05
  expect(isLapse(at("2026-10-03T07:00:00+08:00"), at("2026-10-05T09:00:00+08:00"))).toBe(true); // 07:00 still belongs to 10-02
});

test("reset clears passed dates only, once", () => {
  const s = resetOverdue(mei(), TODAY, 9);
  expect(s.tasks.find((t) => t.id === "C")).toMatchObject({ deadline: null, runway_start: null, state: "active", updated_at: 9 });
  expect(s.tasks.find((t) => t.id === "B")?.deadline).toBe("2026-10-05"); // due today is not overdue
  expect(resetOverdue(s, TODAY, 10)).toBe(s);
});

const block = (weekdays: number[], from: string, to: string) => {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  return { id: from, weekdays, start_min: m(from), end_min: m(to), label: null, deleted: false, updated_at: 0 };
};

test("golden, in full: Mei's Monday blocks leave 540 free minutes, so the cap of 5 still binds", () => {
  const s = { ...mei(), hard_blocks: [block([0], "09:00", "12:00"), block([0], "14:00", "16:00")] };
  expect(freeMinutes(s, TODAY)).toBe(540);
  expect(slotsFor(s, TODAY)).toBe(5);
  const t = buildToday(s, TODAY, { sessionsDone: meiSessions, slots: slotsFor(s, TODAY) });
  expect(ids(t.rows)).toEqual(["B1", "C1", "C2", "C3", "A1"]);
  expect(freeMinutes(s, "2026-10-06")).toBe(840); // Tuesday: no blocks
});

test("capacity: a packed day gets fewer slots; overlaps count once; blocks outside the window don't count", () => {
  const packed = { ...mei(), hard_blocks: [block([0], "08:00", "21:00")] }; // 60 minutes free
  expect(slotsFor(packed, TODAY)).toBe(2);
  expect(ids(buildToday(packed, TODAY, { sessionsDone: meiSessions, slots: 2 }).rows)).toEqual(["B1", "C1"]);
  const overlap = { ...mei(), hard_blocks: [block([0], "09:00", "12:00"), block([0], "11:00", "13:00")] };
  expect(freeMinutes(overlap, TODAY)).toBe(840 - 240);
  const night = { ...mei(), hard_blocks: [block([0], "23:00", "23:30"), block([0], "06:00", "07:00")] };
  expect(freeMinutes(night, TODAY)).toBe(840);
});

test("capacity follows quiet hours, including a window that runs past midnight", () => {
  const late = { ...mei(), settings: { ...emptyState().settings, quiet_start: 120, quiet_end: 600 } }; // awake 10:00 → 02:00
  expect(freeMinutes(late, TODAY)).toBe(960);
  expect(freeMinutes({ ...late, hard_blocks: [block([0], "23:00", "23:59")] }, TODAY)).toBe(960 - 59);
});

test("buildToday groups steps once instead of scanning every step per step", () => {
  const s = { ...mei(), chunks: [...mei().chunks, ...steps("D", 300).map((c) => ({ ...c, id: `big${c.id}` }))] };
  let scans = 0;
  const chunks = new Proxy(s.chunks, { get: (t, k, r) => (k === "filter" || k === "find" || k === "some" ? (scans++, Reflect.get(t, k, r)) : Reflect.get(t, k, r)) });
  buildToday({ ...s, chunks }, TODAY, { sessionsDone: meiSessions });
  expect(scans).toBeLessThan(10); // it was one scan per step
});

test("a block that starts before the window and runs into it still takes its minutes", () => {
  const early = { ...mei(), hard_blocks: [block([0], "07:00", "09:00")] }; // awake from 08:00
  expect(freeMinutes(early, TODAY)).toBe(840 - 60);
});

test("a block needs a day and must end after it starts", () => {
  expect(blockProblem({ weekdays: [], start_min: 60, end_min: 120 })).toBe("Pick at least one day.");
  expect(blockProblem({ weekdays: [1], start_min: 120, end_min: 120 })).toBe("End it after it starts.");
  expect(blockProblem({ weekdays: [1], start_min: 60, end_min: 120 })).toBeNull();
});

test("onboarding: the picked task is the first Today, untriaged; others stay in Inbox", () => {
  let s = { ...emptyState(), tasks: [task("X", { state: "inbox", size: null }), task("Y", { state: "inbox", size: null })], chunks: steps("X", 1) };
  expect(buildToday(s, TODAY, {}).rows).toEqual([]);
  s = placeFirst(s, "X", TODAY, 5);
  const t = buildToday(s, TODAY, {});
  expect(t.rows.map((r) => r.key)).toEqual(["X1"]);
  expect(t.frog?.task.id).toBe("X");
  expect(s.tasks.find((x) => x.id === "X")).toMatchObject({ state: "inbox", size: null, pinned_on: TODAY });
  expect(buildToday(s, "2026-10-06", {}).rows).toEqual([]); // the pin is for today only
  const done = { ...s, tasks: s.tasks.map((x) => ({ ...x, state: "done" as const })) };
  expect(placeFirst(done, "X", TODAY, 6)).toBe(done);
});

// done_at (Verify_List "Done today"): "finished today" reads done_at, so a rename on a later day changes nothing.
test("a step finished yesterday and renamed today is not done today", () => {
  const s = mei();
  const yesterday = Date.parse("2026-10-04T10:00:00+08:00");
  const renamed = Date.parse("2026-10-05T09:00:00+08:00");
  s.chunks = s.chunks.map((c) => (c.id === "C1" ? { ...c, state: "done", done_at: yesterday, updated_at: renamed } : c));
  expect(ids(buildToday(s, TODAY, { sessionsDone: meiSessions, tz: "Asia/Singapore" }).rows)).toEqual(["B1", "C2", "C3", "A1", "A2"]);
  expect(doneTodayCount(s, TODAY)).toBe(0);
});

test("a step finished today keeps its slot even when updated_at is later", () => {
  const s = mei();
  const finished = Date.parse("2026-10-05T10:00:00+08:00");
  s.chunks = s.chunks.map((c) => (c.id === "C1" ? { ...c, state: "done", done_at: finished, updated_at: finished + 60_000 } : c));
  expect(ids(buildToday(s, TODAY, { sessionsDone: meiSessions, tz: "Asia/Singapore" }).rows)).toContain("C1");
  expect(doneTodayCount(s, TODAY)).toBe(1);
});

test("doneTodayCount reads done_at for steps and tasks", () => {
  const s = mei();
  const at = (iso: string) => Date.parse(iso);
  s.chunks = s.chunks.map((c) =>
    c.id === "A1" ? { ...c, state: "done", done_at: at("2026-10-05T12:00:00+08:00"), updated_at: at("2026-10-05T12:00:00+08:00") } : c.id === "A2" ? { ...c, state: "done", done_at: at("2026-10-04T12:00:00+08:00"), updated_at: at("2026-10-05T12:00:00+08:00") } : c,
  );
  s.tasks = s.tasks.map((t) => (t.id === "B" ? { ...t, state: "done", done_at: at("2026-10-03T12:00:00+08:00"), updated_at: at("2026-10-05T12:00:00+08:00") } : t));
  expect(doneTodayCount(s, TODAY)).toBe(1); // A1 only: A2 and task B were finished earlier and merely edited today
});

test("rows saved before done_at (no value) fall back to updated_at", () => {
  const s = mei();
  const at = (iso: string) => Date.parse(iso);
  s.chunks = s.chunks.map((c) =>
    c.id === "A1" ? { ...c, state: "done", updated_at: at("2026-10-05T12:00:00+08:00") } : c.id === "A2" ? { ...c, state: "done", done_at: null, updated_at: at("2026-10-04T12:00:00+08:00") } : c,
  );
  s.tasks = s.tasks.map((t) => (t.id === "B" ? { ...t, state: "done", updated_at: at("2026-10-05T20:00:00+08:00") } : t));
  expect(doneTodayCount(s, TODAY)).toBe(2); // A1 and task B
});

test("completing a task stamps done_at, an edit keeps it, and removing it clears it", () => {
  const done = completeTask(mei(), "B", 5000);
  expect(done.tasks.find((t) => t.id === "B")).toMatchObject({ state: "done", done_at: 5000 });
  const renamed = rename(done, "B", "Cover letter, final", 6000);
  expect(renamed.tasks.find((t) => t.id === "B")).toMatchObject({ done_at: 5000, updated_at: 6000 });
  const removed = remove(renamed, "B", 7000);
  expect(removed.tasks.find((t) => t.id === "B")).toMatchObject({ state: "removed", done_at: null });
  expect(restore(removed, "B", 8000).tasks.find((t) => t.id === "B")?.done_at).toBeNull();
});
