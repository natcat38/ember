import { expect, test } from "vitest";
import { decryptLine, encryptLine, ensureKey, MAX_LINE_CHARS } from "./journal";
import { emptyState } from "../core/task";

const B64URL = /^[A-Za-z0-9_-]+$/;

test("ensureKey makes a 256-bit key once and keeps it", () => {
  const s = ensureKey(emptyState());
  expect(s.settings.journal_key).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes, base64url, no padding
  expect(ensureKey(s)).toBe(s); // same object back: nothing to sync, nothing overwritten
  expect(ensureKey(emptyState()).settings.journal_key).not.toBe(s.settings.journal_key);
});

test("a line encrypts to base64url ciphertext with a 12-byte iv, and decrypts back", async () => {
  const key = ensureKey(emptyState()).settings.journal_key!;
  const line = "Finished the cover letter. Tired, but it's done. 🐱";
  const { iv, text } = await encryptLine(key, line);
  expect(iv).toMatch(B64URL);
  expect(iv).toHaveLength(16); // 12 bytes
  expect(text).toMatch(B64URL);
  expect(text).not.toContain("cover");
  expect(await decryptLine(key, { iv, text })).toBe(line);
});

test("the same line encrypts differently each time (fresh iv)", async () => {
  const key = ensureKey(emptyState()).settings.journal_key!;
  const [a, b] = [await encryptLine(key, "same"), await encryptLine(key, "same")];
  expect(a.iv).not.toBe(b.iv);
  expect(a.text).not.toBe(b.text);
});

test("a wrong key gives null, not garbage and not a throw", async () => {
  const [k1, k2] = [ensureKey(emptyState()).settings.journal_key!, ensureKey(emptyState()).settings.journal_key!];
  const entry = await encryptLine(k1, "private");
  expect(await decryptLine(k2, entry)).toBeNull();
});

test("a missing key, a tampered line and malformed input all give null", async () => {
  const key = ensureKey(emptyState()).settings.journal_key!;
  const entry = await encryptLine(key, "private");
  expect(await decryptLine(null, entry)).toBeNull();
  const flipped = entry.text.slice(0, 2) + (entry.text[2] === "A" ? "B" : "A") + entry.text.slice(3);
  expect(await decryptLine(key, { ...entry, text: flipped })).toBeNull();
  expect(await decryptLine(key, { ...entry, iv: "AAAAAAAAAAAAAAAA" })).toBeNull();
  expect(await decryptLine(key, { iv: "!!", text: "!!" })).toBeNull();
  expect(await decryptLine("not-a-key", entry)).toBeNull();
});

test("an empty line round-trips, and one over the cap is refused", async () => {
  const key = ensureKey(emptyState()).settings.journal_key!;
  expect(await decryptLine(key, await encryptLine(key, ""))).toBe("");
  await expect(encryptLine(key, "x".repeat(MAX_LINE_CHARS + 1))).rejects.toThrow(RangeError);
  expect(await decryptLine(key, await encryptLine(key, "x".repeat(MAX_LINE_CHARS)))).toHaveLength(MAX_LINE_CHARS);
});
