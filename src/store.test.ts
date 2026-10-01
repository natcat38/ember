import { expect, test } from "vitest";
import { KEY, load, save } from "./store";
import { capture, emptyState } from "../core/task";

function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

test("an empty device loads an empty state", () => {
  expect(load(fakeStorage())).toEqual(emptyState());
});

test("five captures survive a save and reload", () => {
  const st = fakeStorage();
  let s = emptyState();
  for (let i = 1; i <= 5; i++) s = capture(s, { title: `task ${i}` }, i, "2026-10-05");
  expect(save(s, st)).toBe(true);
  expect(load(st).tasks.map((t) => t.title)).toEqual(["task 1", "task 2", "task 3", "task 4", "task 5"]);
});

test("the draft is kept", () => {
  const st = fakeStorage();
  save({ ...emptyState(), draft: "half a tho" }, st);
  expect(load(st).draft).toBe("half a tho");
});

test("unreadable data is backed up, not thrown away", () => {
  const st = fakeStorage({ [KEY]: "{not json" });
  expect(load(st, 42)).toEqual(emptyState());
  expect(st.m.get(`${KEY}.unreadable.42`)).toBe("{not json");
});

test("a failed write reports false instead of throwing", () => {
  const st = { ...fakeStorage(), setItem: () => { throw new Error("QuotaExceededError"); } };
  expect(save(emptyState(), st)).toBe(false);
});
