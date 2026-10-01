import { emptyState, type State } from "../core/task";

// Tech_Scope.md §1: the whole device state is one JSON document in localStorage.
export const KEY = "ember";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function load(storage: Storage = localStorage, now = Date.now()): State {
  const raw = storage.getItem(KEY);
  if (!raw) return emptyState();
  try {
    return { ...emptyState(), ...JSON.parse(raw) };
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
