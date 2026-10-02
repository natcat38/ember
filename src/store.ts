import { emptyState, type State } from "../core/task";

// Tech_Scope.md §1: the whole device state is one JSON document in localStorage.
export const KEY = "ember";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

// A row finished before done_at existed gets its last edit time as the finish time, once, here. Without it a rename
// after the upgrade would move updated_at and the old fallback in core/today.ts would count the step as done today.
const stampDone = <R extends { state: string; done_at?: number | null; updated_at: number }>(r: R): R =>
  r.state === "done" && r.done_at == null ? { ...r, done_at: r.updated_at } : r;

export function load(storage: Storage = localStorage, now = Date.now()): State {
  const raw = storage.getItem(KEY);
  if (!raw) return emptyState();
  try {
    const s: State = { ...emptyState(), ...JSON.parse(raw) };
    return { ...s, tasks: s.tasks.map(stampDone), chunks: s.chunks.map(stampDone) };
  } catch {
    // Never overwrite what we can't read: park it beside the live key so it can be recovered by hand.
    storage.setItem(`${KEY}.unreadable.${now}`, raw);
    return emptyState();
  }
}

export function save(s: State, storage: Storage = localStorage): boolean {
  try {
    storage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}
