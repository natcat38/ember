import { expect, test, vi } from "vitest";
import { dayOf } from "./day";
import { localToMs } from "./messages";

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

test("half-hour offsets work (no DST, so the shift is exact)", () => {
  expect(dayOf(Date.parse("2026-10-05T08:00:00+05:30"), "Asia/Kolkata")).toBe("2026-10-05");
  expect(dayOf(Date.parse("2026-10-05T07:59:00+05:30"), "Asia/Kolkata")).toBe("2026-10-04");
});

test("the zone's formatter is built once, not per call", () => {
  const Real = Intl.DateTimeFormat;
  const ctor = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (...args: ConstructorParameters<typeof Real>) {
    return new Real(...args);
  } as never);
  for (let i = 0; i < 50; i++) dayOf(i * 86_400_000, "Pacific/Auckland");
  for (let i = 0; i < 50; i++) localToMs("2026-10-05", i, "Pacific/Fiji");
  expect(ctor.mock.calls.length).toBeLessThanOrEqual(2); // one per zone, however many calls
  ctor.mockRestore();
});
