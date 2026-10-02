import type { State } from "../core/task";

// The journal line is sealed on the device before it syncs (Tech_Scope.md §10 phase 3, slice 19; UX_Flows.md §3.7).
//
// Threat model, honestly: the key is random and travels in the synced `settings` row beside the journal rows. That keeps
// the words out of a dump of the journal table alone, and out of anything that reads rows without the settings row. It
// does not protect against someone holding the whole database, because the key sits next to the ciphertext.
//
// WebCrypto only. AES-GCM with a fresh 12-byte iv per line; a wrong key or a changed byte fails the auth tag, which
// decryptLine reports as null.

/** One line, not an essay. Enough for the longest sentence that fits a phone screen; the worker caps the ciphertext at 4096 characters. */
export const MAX_LINE_CHARS = 500;

const KEY_BYTES = 32; // 256 bits
const IV_BYTES = 12; // the size AES-GCM is built for

const toB64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => {
  // atob is lenient about stray characters, so check the alphabet first; a malformed input must fail, not decode to junk.
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("not base64url");
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
};

const importKey = (key: string) => {
  const raw = fromB64(key);
  if (raw.length !== KEY_BYTES) throw new Error("journal key is not 256 bits");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
};

/** Makes the journal key the first time it is needed; a state that has one comes back as the same object. */
export function ensureKey(s: State): State {
  if (s.settings.journal_key) return s;
  return { ...s, settings: { ...s.settings, journal_key: toB64(crypto.getRandomValues(new Uint8Array(KEY_BYTES))) } };
}

/** Seals one line. Throws if the key is malformed or the line is over MAX_LINE_CHARS: a refusal the caller can see. */
export async function encryptLine(key: string, text: string): Promise<{ iv: string; text: string }> {
  if (text.length > MAX_LINE_CHARS) throw new RangeError(`a journal line is at most ${MAX_LINE_CHARS} characters`);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(key), new TextEncoder().encode(text));
  return { iv: toB64(iv), text: toB64(new Uint8Array(sealed)) };
}

/** The line, or null when it can't be read: no key, the wrong key, a changed byte, or input that isn't base64url. */
export async function decryptLine(key: string | null, entry: { iv: string; text: string }): Promise<string | null> {
  if (!key) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(entry.iv) }, await importKey(key), fromB64(entry.text));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
