import { expect, test } from "vitest";
import { arrivalFrom, bytesOf, channelOf, needsHomeScreen, snoozeTomorrow, tomorrowSlot } from "./push";
import { emptyState, type State, type Task } from "../core/task";

const task = (id: string, o: Partial<Task> = {}): Task => ({ id, title: id, state: "active", size: "M", quick: false, holding_up: false, deadline: null, runway_start: null, pinned_on: null, snoozed_until: null, done_at: null, created_at: 1, updated_at: 1, ...o }) as Task;

test("the channel is Telegram when the server says so, else push when a browser is subscribed, else none", () => {
  expect(channelOf(null)).toBeNull(); // offline: unknown
  expect(channelOf({ telegram: false, push: false })).toBeNull();
  expect(channelOf({ telegram: true, push: false })).toBe("telegram");
  expect(channelOf({ telegram: false, push: true })).toBe("push");
  expect(channelOf({ telegram: true, push: true })).toBe("telegram"); // `telegram` is true only while it is the channel (worker/me.ts)
});

test("the arrival marker is ours, not Telegram's: a push tap carries via=push", () => {
  expect(arrivalFrom("")).toBeNull();
  expect(arrivalFrom("?h=abc&s=1&t=T1")).toBeNull(); // the same link from Telegram's button
  expect(arrivalFrom("?h=abc&s=1&t=T1&via=push")).toEqual({ task: "T1" });
  expect(arrivalFrom("?s=1&via=push")).toEqual({ task: null }); // a morning or batch push opens Today
});

test("only iPhone and iPad Safari outside the Home Screen need the install hint", () => {
  const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", maxTouchPoints: 5 };
  expect(needsHomeScreen({ ...iphone, standalone: false })).toBe(true);
  expect(needsHomeScreen({ ...iphone, standalone: true })).toBe(false);
  // iPadOS reports a Mac user agent; touch points give it away.
  expect(needsHomeScreen({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5, standalone: false })).toBe(true);
  expect(needsHomeScreen({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 })).toBe(false);
  expect(needsHomeScreen({ userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130", maxTouchPoints: 0 })).toBe(false);
});

test("the VAPID key goes to the browser as bytes", () => {
  expect([...bytesOf("AQID")]).toEqual([1, 2, 3]);
  expect([...bytesOf("-_8")]).toEqual([251, 255]); // base64url alphabet, no padding
});

test("tomorrow's snooze is the next day's first slot: quiet hours' end, moved past a hard block", () => {
  const s: State = { ...emptyState(), settings: { ...emptyState().settings, tz: "Asia/Singapore" } };
  const now = Date.parse("2026-10-05T10:00:00+08:00"); // Monday; the day started at 08:00
  expect(tomorrowSlot(s, now)).toBe(Date.parse("2026-10-06T08:00:00+08:00"));
  const blocked: State = { ...s, hard_blocks: [{ id: "b", weekdays: [1], start_min: 480, end_min: 600, label: null, deleted: false, updated_at: 1 }] }; // Tuesday 08:00-10:00
  expect(tomorrowSlot(blocked, now)).toBe(Date.parse("2026-10-06T10:00:00+08:00"));
});

test("snoozing stamps snoozed_until on live tasks only, leaving the deadline alone", () => {
  const s: State = {
    ...emptyState(),
    settings: { ...emptyState().settings, tz: "Asia/Singapore" },
    tasks: [task("A", { deadline: "2026-10-07" }), task("B", { state: "done" }), task("C", { state: "overdue" }), task("D")],
  };
  const now = Date.parse("2026-10-05T10:00:00+08:00");
  const next = snoozeTomorrow(s, ["A", "B", "C", "missing"], now);
  const until = Date.parse("2026-10-06T08:00:00+08:00");
  expect(next.tasks.map((t) => t.snoozed_until)).toEqual([until, null, until, null]);
  expect(next.tasks[0]).toMatchObject({ deadline: "2026-10-07", updated_at: now });
  expect(next.tasks[3]).toBe(s.tasks[3]); // untouched rows are the same objects
});
