import { emptyState, type State } from "../core/task";

// Tech_Scope.md §1: the whole device state is one JSON document in localStorage.
export const KEY = "ember";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

// Park an unreadable copy beside the live key, keeping only the latest. On a full device the park is skipped rather
// than failing the boot (the old parked copies go first, to make room for one try).
function park(storage: Storage, raw: string, now: number) {
  const mine = `${KEY}.unreadable.${now}`;
  const older = () => Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((k): k is string => !!k && k !== mine && k.startsWith(`${KEY}.unreadable.`));
  try {
    storage.setItem(mine, raw);
  } catch {
    for (const k of older()) storage.removeItem(k);
    try {
      storage.setItem(mine, raw);
    } catch {
      return;
    }
  }
  for (const k of older()) storage.removeItem(k);
}

// A row finished before done_at existed gets its last edit time as the finish time, once, here. Without it a rename
// after the upgrade would move updated_at and the old fallback in core/today.ts would count the step as done today.
const stampDone = <R extends { state: string; done_at?: number | null; updated_at: number }>(r: R): R =>
  r.state === "done" && r.done_at == null ? { ...r, done_at: r.updated_at } : r;

export function load(storage: Storage = localStorage, now = Date.now()): State {
  const raw = storage.getItem(KEY);
  if (!raw) return emptyState();
  try {
    // Settings merge field by field: a saved object from before phase 3 lacks timer_mode, unlock and journal_key.
    const saved = JSON.parse(raw);
    const defaults = emptyState();
    const s: State = { ...defaults, ...saved, settings: { ...defaults.settings, ...saved.settings } };
    return { ...s, tasks: s.tasks.map(stampDone), chunks: s.chunks.map(stampDone) };
  } catch {
    // Never overwrite what we can't read: park it beside the live key so it can be recovered by hand.
    park(storage, raw, now);
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
