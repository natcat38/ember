import { expect, test } from "vitest";
import { catPose } from "./cat";

// One test per row of the UX_Flows.md §6 table, plus its "Transitions worth spelling out".

test("Today with nothing else going on: watching", () => {
  expect(catPose({ screen: "today" })).toBe("watching");
});

test("asleep: the day's first open, until the wake-up", () => {
  expect(catPose({ screen: "today", firstOpen: true })).toBe("asleep");
  expect(catPose({ screen: "today", firstOpen: false })).toBe("watching"); // the wake-up has happened
});

test("a 1 or 2 day absence is an ordinary day: asleep, then watching, never the door", () => {
  // The caller passes lapseReturn only for 3+ days (isLapse); a short absence is just firstOpen.
  expect(catPose({ screen: "today", firstOpen: true, lapseReturn: false })).toBe("asleep");
});

test("by the door: the lapse return, until the first tap after the welcome back", () => {
  expect(catPose({ screen: "today", lapseReturn: true })).toBe("door");
  expect(catPose({ screen: "today", lapseReturn: false })).toBe("watching");
});

test("the lapse return is also a first open, and the door wins over asleep", () => {
  expect(catPose({ screen: "today", firstOpen: true, lapseReturn: true })).toBe("door");
});

test("after shutdown the cat stays asleep on Today, even on a reopen", () => {
  expect(catPose({ screen: "today", shutdownDone: true })).toBe("asleep");
  expect(catPose({ screen: "today", shutdownDone: true, firstOpen: false, lapseReturn: false })).toBe("asleep");
  expect(catPose({ screen: "today", shutdownDone: true, firstOpen: true, lapseReturn: true })).toBe("asleep");
});

test("Today ignores a running session: the pose follows the screen, not the timer", () => {
  expect(catPose({ screen: "today", session: "running" })).toBe("watching");
});

test("stretching: a focus session is running", () => {
  expect(catPose({ screen: "focus", session: "running" })).toBe("stretching");
});

test("pause leaves stretching for watching", () => {
  expect(catPose({ screen: "focus", session: "paused" })).toBe("watching");
});

test("no session on the Focus screen (exiting): watching", () => {
  expect(catPose({ screen: "focus", session: null })).toBe("watching");
  expect(catPose({ screen: "focus" })).toBe("watching");
});

test("a session started after shutdown still stretches: it is explicit activity", () => {
  expect(catPose({ screen: "focus", session: "running", shutdownDone: true })).toBe("stretching");
});

test("curled up, purring: a step is done", () => {
  expect(catPose({ screen: "reward" })).toBe("purring");
  expect(catPose({ screen: "reward", shutdownDone: true })).toBe("purring");
});

test("shutdown's You're done: asleep", () => {
  expect(catPose({ screen: "shutdown" })).toBe("asleep");
  expect(catPose({ screen: "shutdown", shutdownDone: true })).toBe("asleep");
});
