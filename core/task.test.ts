import { expect, test } from "vitest";
import { capture, emptyState, remove, rename, restore, triage } from "./task";

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
      done_at: null,
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

// Slice 2: triage and the task state machine (Product_Scope.md §4)

const one = (over = {}) => {
  const s = capture(emptyState(), { title: "Ethics essay" }, now, today, ids());
  return { ...s, tasks: [{ ...s.tasks[0], ...over }] };
};
const later = now + 1000;
const tomorrow = "2026-10-06";

test("setting a size moves an Inbox task to Active", () => {
  const [t] = triage(one(), "id-1", { size: "M" }, later, today).tasks;
  expect(t).toMatchObject({ state: "active", size: "M", updated_at: later });
});

test("triage without a size leaves the task in Inbox", () => {
  const [t] = triage(one(), "id-1", { holding_up: true }, later, today).tasks;
  expect(t).toMatchObject({ state: "inbox", holding_up: true });
});

test("a Quick task becomes Active on its first triage answer", () => {
  const [t] = triage(one({ size: "XS", quick: true }), "id-1", { holding_up: false }, later, today).tasks;
  expect(t.state).toBe("active");
});

test("changing the deadline restarts its runway; clearing it clears the runway", () => {
  let s = triage(one({ deadline: "2026-10-14", runway_start: "2026-10-01" }), "id-1", { deadline: "2026-10-20" }, later, tomorrow);
  expect(s.tasks[0]).toMatchObject({ deadline: "2026-10-20", runway_start: tomorrow });
  s = triage(s, "id-1", { holding_up: true }, later, "2026-10-07");
  expect(s.tasks[0].runway_start).toBe(tomorrow); // other answers leave the runway alone
  s = triage(s, "id-1", { deadline: null }, later, today);
  expect(s.tasks[0]).toMatchObject({ deadline: null, runway_start: null });
});

test("triage on a done or removed task is refused", () => {
  for (const state of ["done", "removed"] as const) {
    const s = one({ state });
    expect(triage(s, "id-1", { size: "S" }, later, today)).toBe(s);
  }
});

test("capture and rename clamp the title to the server's 500-character limit", () => {
  const s = capture(emptyState(), { title: "y".repeat(600) }, now, today, ids());
  expect(s.tasks[0].title).toHaveLength(500);
  expect(rename(s, "id-1", "z".repeat(501), later).tasks[0].title).toHaveLength(500);
});

test("rename trims and ignores blank names", () => {
  expect(rename(one(), "id-1", "  Ethics essay v2 ", later).tasks[0].title).toBe("Ethics essay v2");
  const s = one();
  expect(rename(s, "id-1", "   ", later)).toBe(s);
});

test("remove from list works from any state and is reversible", () => {
  for (const state of ["inbox", "active", "overdue", "done"] as const) {
    expect(remove(one({ state }), "id-1", later).tasks[0].state).toBe("removed");
  }
});

test("restore goes back to Active, or to Inbox if the task was never sized", () => {
  expect(restore(one({ state: "removed", size: "S" }), "id-1", later).tasks[0].state).toBe("active");
  expect(restore(one({ state: "removed" }), "id-1", later).tasks[0].state).toBe("inbox");
  const s = one({ state: "active" });
  expect(restore(s, "id-1", later)).toBe(s);
});

test("an unknown id changes nothing", () => {
  const s = one();
  expect(remove(s, "nope", later)).toBe(s);
});
