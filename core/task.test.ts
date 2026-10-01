import { expect, test } from "vitest";
import { capture, emptyState } from "./task";

const now = 1_760_000_000_000;
const today = "2026-10-05";
const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

test("blank or whitespace-only capture is ignored", () => {
  const s = emptyState();
  expect(capture(s, { title: "   \n " }, now, today, ids())).toBe(s);
});

test("capture adds a trimmed Inbox task with no triage", () => {
  const s = capture(emptyState(), { title: "  finish DS assignment " }, now, today, ids());
  expect(s.tasks).toEqual([
    {
      id: "id-1",
      title: "finish DS assignment",
      state: "inbox",
      size: null,
      quick: false,
      holding_up: false,
      deadline: null,
      runway_start: null,
      pinned_on: null,
      snoozed_until: null,
      created_at: now,
      updated_at: now,
    },
  ]);
});

test("Quick pre-sets size XS", () => {
  const [t] = capture(emptyState(), { title: "Book dentist", quick: true }, now, today, ids()).tasks;
  expect(t.quick).toBe(true);
  expect(t.size).toBe("XS");
});

test("a deadline starts its runway today", () => {
  const [t] = capture(emptyState(), { title: "Ethics essay", deadline: "2026-10-14" }, now, today, ids()).tasks;
  expect(t.deadline).toBe("2026-10-14");
  expect(t.runway_start).toBe(today);
});

test("capture clears the draft and keeps earlier tasks", () => {
  const id = ids();
  let s = { ...emptyState(), draft: "one" };
  s = capture(s, { title: "one" }, now, today, id);
  s = capture(s, { title: "two" }, now + 1, today, id);
  expect(s.draft).toBe("");
  expect(s.tasks.map((t) => t.title)).toEqual(["one", "two"]);
});
