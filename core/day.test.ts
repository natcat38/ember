import { expect, test } from "vitest";
import { dayOf } from "./day";

const SG = "Asia/Singapore"; // UTC+8, no DST

test("a day starts when quiet hours end (08:00 default)", () => {
  expect(dayOf(Date.parse("2026-10-05T08:00:00+08:00"), SG)).toBe("2026-10-05");
  expect(dayOf(Date.parse("2026-10-05T07:59:00+08:00"), SG)).toBe("2026-10-04");
});

test("a 01:00 session belongs to the day before", () => {
  expect(dayOf(Date.parse("2026-10-06T01:00:00+08:00"), SG)).toBe("2026-10-05");
});

test("quiet end and time zone are respected", () => {
  const t = Date.parse("2026-10-05T06:30:00Z"); // 07:30 London (BST), 14:30 Singapore
  expect(dayOf(t, "Europe/London", 8 * 60)).toBe("2026-10-04");
  expect(dayOf(t, "Europe/London", 7 * 60)).toBe("2026-10-05");
  expect(dayOf(t, SG)).toBe("2026-10-05");
});
