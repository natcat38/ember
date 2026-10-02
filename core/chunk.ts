import type { State } from "./task";

// "Step" on screen, "chunk" in code (Product_Scope.md §4). Shape matches the D1 `chunks` table (Tech_Scope.md §3).
export type ChunkState = "todo" | "focus" | "done";

export interface Chunk {
  id: string;
  task_id: string;
  parent_id: string | null; // two levels max
  title: string;
  position: number; // a move rewrites one row: the new position is a midpoint between neighbours
  state: ChunkState; // meaningful only on leaves; a parent's state is derived
  deleted: boolean; // tombstone, so sync can tell other devices
  updated_at: number;
  // When the step became done (a parent: when its last smaller step did); null while open. Absent on rows saved before
  // done_at existed. An edit never moves it, so "done today" is not fooled by a rename (core/today.ts).
  done_at?: number | null;
}

const byPosition = (a: Chunk, b: Chunk) => a.position - b.position;

const siblings = (s: State, task_id: string, parent_id: string | null) =>
  s.chunks.filter((c) => c.task_id === task_id && c.parent_id === parent_id && !c.deleted).sort(byPosition);

export const topLevel = (s: State, taskId: string) => siblings(s, taskId, null);

export const childrenOf = (s: State, id: string) => s.chunks.filter((c) => c.parent_id === id && !c.deleted).sort(byPosition);

// UX_Flows.md §3.3 rule 8: Done when all smaller steps are Done, otherwise Todo.
export function stateOf(s: State, c: Chunk): ChunkState {
  const kids = childrenOf(s, c.id);
  if (!kids.length) return c.state;
  return kids.every((k) => k.state === "done") ? "done" : "todo";
}

// A change of state moves done_at with it: stamped when the row becomes done, cleared when it leaves, else kept.
const withDoneAt = (c: Chunk, state: ChunkState | undefined, now: number): Pick<Chunk, "done_at"> | null =>
  state === undefined || (state === "done") === (c.state === "done") ? null : { done_at: state === "done" ? now : null };

function patch(s: State, ids: string[], now: number, p: Partial<Chunk>): State {
  const set = new Set(ids);
  if (!set.size) return s;
  const chunks = s.chunks.map((c) => (set.has(c.id) ? { ...c, ...p, ...withDoneAt(c, p.state, now), updated_at: now } : c));
  // A parent's own state is derived (rule 8), so it is stamped here when its smaller steps flip it, not by a tick.
  const parents = new Set(s.chunks.filter((c) => set.has(c.id) && c.parent_id).map((c) => c.parent_id!));
  const next = { ...s, chunks };
  return { ...next, chunks: chunks.map((c) => (parents.has(c.id) ? flipParent(s, next, c, now) : c)) };
}

function flipParent(before: State, after: State, parent: Chunk, now: number): Chunk {
  const was = stateOf(before, parent) === "done";
  const is = stateOf(after, parent) === "done";
  return was === is ? parent : { ...parent, done_at: is ? now : null, updated_at: now };
}

export function addChunk(
  s: State,
  taskId: string,
  title: string,
  parentId: string | null,
  now: number,
  newId: () => string = () => crypto.randomUUID(),
): State {
  const t = title.trim();
  if (!t) return s;
  if (parentId) {
    const parent = s.chunks.find((c) => c.id === parentId);
    if (!parent || parent.deleted || parent.parent_id) return s; // rule 6: no third level
  }
  const last = siblings(s, taskId, parentId).at(-1);
  const chunk: Chunk = {
    id: newId(),
    task_id: taskId,
    parent_id: parentId,
    title: t,
    position: (last?.position ?? 0) + 1,
    state: "todo",
    deleted: false,
    updated_at: now,
    done_at: null,
  };
  const next = { ...s, chunks: [...s.chunks, chunk] };
  // An open smaller step under a finished parent reopens it.
  return parentId ? { ...next, chunks: next.chunks.map((c) => (c.id === parentId ? flipParent(s, next, c, now) : c)) } : next;
}

export function setLeafStates(s: State, ids: string[], state: ChunkState, now: number): State {
  return patch(s, ids, now, { state });
}

// Rule 2: ticking a parent finishes its remaining smaller steps; unticking reopens them all.
// The caller keeps the ids it finished, so an untick straight away can restore exactly those (setLeafStates).
export function tick(s: State, id: string, done: boolean, now: number): State {
  const kids = childrenOf(s, id);
  if (!kids.length) return patch(s, [id], now, { state: done ? "done" : "todo" });
  const targets = kids.filter((k) => (done ? k.state !== "done" : true)).map((k) => k.id);
  return patch(s, targets, now, { state: done ? "done" : "todo" });
}

// Rule 5: a step moves only among its own siblings, so a parent carries its group and nothing changes level.
export function moveTo(s: State, id: string, index: number, now: number): State {
  const c = s.chunks.find((x) => x.id === id);
  if (!c || c.deleted) return s;
  const others = siblings(s, c.task_id, c.parent_id).filter((x) => x.id !== id);
  const i = Math.max(0, Math.min(index, others.length));
  if (siblings(s, c.task_id, c.parent_id).indexOf(c) === i) return s;
  const before = others[i - 1]?.position;
  const after = others[i]?.position;
  const position =
    before === undefined ? (after ?? 1) - 1 : after === undefined ? before + 1 : (before + after) / 2;
  return patch(s, [id], now, { position });
}

export function move(s: State, id: string, delta: -1 | 1, now: number): State {
  const c = s.chunks.find((x) => x.id === id);
  if (!c) return s;
  const list = siblings(s, c.task_id, c.parent_id);
  const i = list.indexOf(c) + delta;
  return i < 0 || i >= list.length ? s : moveTo(s, id, i, now);
}

export function renameChunk(s: State, id: string, title: string, now: number): State {
  const t = title.trim();
  return t ? patch(s, [id], now, { title: t }) : s;
}

// Rule 7: deleting a parent takes its smaller steps with it (the UI asks first).
export function deleteChunk(s: State, id: string, now: number): State {
  return patch(s, [id, ...childrenOf(s, id).map((c) => c.id)], now, { deleted: true });
}

// The Task view's Start begins the first unfinished step in list order, never a parent (rule 3).
export function firstOpenLeaf(s: State, taskId: string): Chunk | null {
  for (const c of topLevel(s, taskId)) {
    const kids = childrenOf(s, c.id);
    const open = (kids.length ? kids : [c]).find((x) => x.state !== "done");
    if (open) return open;
  }
  return null;
}
