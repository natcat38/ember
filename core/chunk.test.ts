import { expect, test } from "vitest";
import { addChunk, childrenOf, deleteChunk, firstOpenLeaf, move, moveTo, renameChunk, setLeafStates, stateOf, tick, topLevel } from "./chunk";
import { emptyState, type State } from "./task";

const T = "task-1";
let n = 0;
const id = () => `c${++n}`;
const now = 1000;

// A: plain step; B: parent with B1, B2; C: plain step
function sample(): State {
  n = 0;
  let s = emptyState();
  for (const title of ["A", "B", "C"]) s = addChunk(s, T, title, null, now, id);
  s = addChunk(s, T, "B1", "c2", now, id);
  s = addChunk(s, T, "B2", "c2", now, id);
  return s;
}
const titles = (s: State, parent: string | null = null) =>
  (parent ? childrenOf(s, parent) : topLevel(s, T)).map((c) => c.title);
const get = (s: State, cid: string) => s.chunks.find((c) => c.id === cid)!;

test("manual add appends to the bottom; blank is ignored", () => {
  const s = sample();
  expect(titles(s)).toEqual(["A", "B", "C"]);
  expect(titles(s, "c2")).toEqual(["B1", "B2"]);
  expect(addChunk(s, T, "   ", null, now, id)).toBe(s);
  expect(get(s, "c1")).toMatchObject({ task_id: T, parent_id: null, state: "todo", deleted: false });
});

test("rule 6: no third level", () => {
  const s = sample();
  expect(addChunk(s, T, "B1a", "c4", now, id)).toBe(s);
});

test("rule 8: a parent's state is derived from its smaller steps", () => {
  let s = sample();
  expect(stateOf(s, get(s, "c2"))).toBe("todo");
  s = tick(s, "c4", true, now);
  expect(stateOf(s, get(s, "c2"))).toBe("todo");
  s = tick(s, "c5", true, now);
  expect(stateOf(s, get(s, "c2"))).toBe("done"); // rule 2: ticks itself when the last is done
});

test("rule 2: ticking a parent finishes the rest; unticking straight away restores them", () => {
  let s = tick(sample(), "c4", true, now); // B1 already done
  const remaining = childrenOf(s, "c2").filter((c) => c.state !== "done").map((c) => c.id);
  expect(remaining).toEqual(["c5"]);
  s = tick(s, "c2", true, now);
  expect(childrenOf(s, "c2").map((c) => c.state)).toEqual(["done", "done"]);
  s = setLeafStates(s, remaining, "todo", now);
  expect(childrenOf(s, "c2").map((c) => c.state)).toEqual(["done", "todo"]);
});

test("unticking a parent later reopens all its smaller steps", () => {
  let s = tick(sample(), "c2", true, now);
  s = tick(s, "c2", false, now);
  expect(childrenOf(s, "c2").map((c) => c.state)).toEqual(["todo", "todo"]);
});

test("rule 5: moving a parent moves its group; smaller steps move only within their parent", () => {
  let s = move(sample(), "c2", -1, now);
  expect(titles(s)).toEqual(["B", "A", "C"]);
  expect(titles(s, "c2")).toEqual(["B1", "B2"]);
  s = move(s, "c5", -1, now);
  expect(titles(s, "c2")).toEqual(["B2", "B1"]);
  expect(move(s, "c5", -1, now)).toBe(s); // already first among its siblings
  expect(move(s, "c3", 1, now)).toBe(s); // already last
});

test("moveTo rewrites only the moved row", () => {
  const s = sample();
  const moved = moveTo(s, "c3", 0, now);
  expect(titles(moved)).toEqual(["C", "A", "B"]);
  const changed = moved.chunks.filter((c, i) => c !== s.chunks[i]).map((c) => c.id);
  expect(changed).toEqual(["c3"]);
  expect(titles(moveTo(s, "c1", 1, now))).toEqual(["B", "A", "C"]);
  expect(titles(moveTo(s, "c1", 2, now))).toEqual(["B", "C", "A"]);
});

test("two devices that add a step at once get the same order: equal positions break ties by id", () => {
  const row = (cid: string) => ({ id: cid, task_id: T, parent_id: null, title: cid, position: 4, state: "todo" as const, deleted: false, updated_at: now });
  const ab = { ...emptyState(), chunks: [row("a"), row("b")] };
  const ba = { ...emptyState(), chunks: [row("b"), row("a")] };
  expect(topLevel(ab, T).map((c) => c.id)).toEqual(["a", "b"]);
  expect(topLevel(ba, T).map((c) => c.id)).toEqual(["a", "b"]);
});

test("a gap under 1e-6 renumbers the siblings instead of halving it again", () => {
  const row = (cid: string, position: number) => ({ id: cid, task_id: T, parent_id: null, title: cid, position, state: "todo" as const, deleted: false, updated_at: 1 });
  const s = { ...emptyState(), chunks: [row("a", 1), row("b", 1 + 1e-7), row("c", 3)] };
  const moved = moveTo(s, "c", 1, now); // between a and b
  expect(topLevel(moved, T).map((c) => c.id)).toEqual(["a", "c", "b"]);
  const p = topLevel(moved, T).map((c) => c.position);
  expect(p[1] - p[0]).toBeGreaterThanOrEqual(1e-6);
  expect(p[2] - p[1]).toBeGreaterThanOrEqual(1e-6);
});

test("steps are clamped to the server's 500-character title limit", () => {
  const long = "x".repeat(600);
  const s = addChunk(emptyState(), T, long, null, now, id);
  expect(s.chunks[0].title).toHaveLength(500);
  expect(get(renameChunk(s, s.chunks[0].id, `${long}y`, now), s.chunks[0].id).title).toHaveLength(500);
});

test("rename trims and ignores blank", () => {
  const s = sample();
  expect(get(renameChunk(s, "c1", " A2 ", now), "c1").title).toBe("A2");
  expect(renameChunk(s, "c1", " ", now)).toBe(s);
});

test("rule 7: deleting a parent deletes its smaller steps; deleting the last smaller step makes the parent plain", () => {
  let s = deleteChunk(sample(), "c2", now);
  expect(titles(s)).toEqual(["A", "C"]);
  expect(s.chunks.filter((c) => c.deleted).map((c) => c.id)).toEqual(["c2", "c4", "c5"]); // tombstones for sync

  s = deleteChunk(deleteChunk(sample(), "c4", now), "c5", now);
  expect(childrenOf(s, "c2")).toEqual([]);
  expect(stateOf(s, get(s, "c2"))).toBe("todo");
});

test("a deleted step's row stays deleted and can't gain children", () => {
  const s = deleteChunk(sample(), "c1", now);
  expect(addChunk(s, T, "x", "c1", now, id)).toBe(s);
});

test("firstOpenLeaf skips done steps and parents", () => {
  let s = tick(sample(), "c1", true, now);
  expect(firstOpenLeaf(s, T)?.id).toBe("c4"); // B's first smaller step, not B
  s = tick(s, "c2", true, now);
  expect(firstOpenLeaf(s, T)?.id).toBe("c3");
  s = tick(s, "c3", true, now);
  expect(firstOpenLeaf(s, T)).toBeNull();
});

// done_at (Verify_List "Done today"): set when a row becomes done, cleared when it leaves, untouched by edits.
test("finishing a step sets done_at; ticking it off clears it; a rename leaves it alone", () => {
  let s = sample();
  expect(get(s, "c1").done_at).toBeNull();
  s = tick(s, "c1", true, 2000);
  expect(get(s, "c1")).toMatchObject({ state: "done", done_at: 2000, updated_at: 2000 });
  s = renameChunk(s, "c1", "A renamed", 3000);
  expect(get(s, "c1")).toMatchObject({ done_at: 2000, updated_at: 3000 });
  s = tick(s, "c1", true, 4000); // already done: not a new finish
  expect(get(s, "c1").done_at).toBe(2000);
  s = tick(s, "c1", false, 5000);
  expect(get(s, "c1")).toMatchObject({ state: "todo", done_at: null });
});

test("setLeafStates sets done_at on the steps it finishes and clears it on the steps it reopens", () => {
  let s = setLeafStates(sample(), ["c1", "c3"], "done", 2000);
  expect([get(s, "c1").done_at, get(s, "c3").done_at]).toEqual([2000, 2000]);
  s = setLeafStates(s, ["c1"], "focus", 3000);
  expect([get(s, "c1").done_at, get(s, "c3").done_at]).toEqual([null, 2000]);
});

test("ticking a parent stamps only the smaller steps it finishes; an earlier finish keeps its time", () => {
  let s = tick(sample(), "c4", true, 2000); // B1 done at 2000
  s = tick(s, "c2", true, 3000); // finishes B2 only
  expect([get(s, "c4").done_at, get(s, "c5").done_at]).toEqual([2000, 3000]);
  s = tick(s, "c2", false, 4000);
  expect([get(s, "c4").done_at, get(s, "c5").done_at]).toEqual([null, null]);
});

test("a parent that completes through its last smaller step gets done_at, and loses it when one reopens", () => {
  let s = tick(sample(), "c4", true, 2000);
  expect(get(s, "c2").done_at).toBeNull(); // B2 is still open
  s = tick(s, "c5", true, 3000);
  expect(get(s, "c2")).toMatchObject({ done_at: 3000, updated_at: 3000 });
  s = tick(s, "c4", false, 4000);
  expect(get(s, "c2")).toMatchObject({ done_at: null, updated_at: 4000 });
  s = tick(sample(), "c2", true, 5000); // ticking the parent finishes both, so the parent completes too
  expect(get(s, "c2").done_at).toBe(5000);
});

test("adding an open smaller step under a finished parent reopens it and clears its done_at", () => {
  let s = tick(sample(), "c2", true, 2000);
  expect(get(s, "c2").done_at).toBe(2000);
  s = addChunk(s, T, "B3", "c2", 3000, id);
  expect(get(s, "c2")).toMatchObject({ done_at: null, updated_at: 3000 });
  expect(get(s, "c6").done_at).toBeNull();
});
