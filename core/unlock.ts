import type { UnlockKind } from "./task";

// Which unlock Reward serves, and the shape of what the two feeds send back (UX_Flows.md §3.6, Tech_Scope.md §10
// slice 20). Pure: the caller owns localStorage and the network.

export type ServedKind = Exclude<UnlockKind, "rotate">;

// Where the rotation stands. Device-only (never synced): the sequence is a convenience, and two devices drifting
// apart does no harm.
export interface Unlocks {
  last: ServedKind | null; // the kind offered most recently
  puzzleDay: string | null; // the local day (YYYY-MM-DD) the puzzle was last offered: Lichess serves one a day
}

export const noUnlocks = (): Unlocks => ({ last: null, puzzleDay: null });

const ORDER: ServedKind[] = ["trivia", "puzzle", "fact"];
const isKind = (v: unknown): v is ServedKind => ORDER.includes(v as ServedKind);

// A fixed choice always serves that kind. `rotate` steps trivia → puzzle → fact, and passes over the puzzle once it
// has been offered today, since the daily puzzle would be the same one again.
export function pickUnlock(setting: UnlockKind, mem: Unlocks, today: string): ServedKind {
  if (setting !== "rotate") return setting;
  const at = mem.last ? ORDER.indexOf(mem.last) : -1;
  for (let i = 1; i <= ORDER.length; i++) {
    const kind = ORDER[(at + i) % ORDER.length];
    if (kind !== "puzzle" || mem.puzzleDay !== today) return kind;
  }
  return "trivia"; // unreachable: trivia and fact are never skipped
}

export const recordServed = (mem: Unlocks, kind: ServedKind, today: string): Unlocks => ({ last: kind, puzzleDay: kind === "puzzle" ? today : mem.puzzleDay });

// Damaged or foreign storage reads as "nothing served yet" rather than throwing.
export function parseUnlocks(raw: string | null): Unlocks {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<Unlocks> | null;
    return { last: isKind(v?.last) ? v.last : null, puzzleDay: typeof v?.puzzleDay === "string" ? v.puzzleDay : null };
  } catch {
    return noUnlocks();
  }
}

// Fisher–Yates on a copy. `rand` is injectable so the test is deterministic.
export function shuffled<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface Trivia {
  question: string;
  correct: string;
  answers: string[]; // all four, shuffled
}

const text = (v: unknown): string | null => (typeof v === "string" ? decodeURIComponent(v) : null);

// Open Trivia DB with `encode=url3986`: every string is percent-encoded, which sidesteps HTML entities entirely.
// Anything unexpected returns null and the caller shows the failure line. A bad escape makes decodeURIComponent throw.
export function parseTrivia(body: unknown, rand: () => number = Math.random): Trivia | null {
  try {
    const b = body as { response_code?: number; results?: { question?: unknown; correct_answer?: unknown; incorrect_answers?: unknown }[] } | null;
    const r = b?.response_code === 0 ? b.results?.[0] : undefined;
    if (!r || !Array.isArray(r.incorrect_answers) || r.incorrect_answers.length === 0) return null;
    const question = text(r.question);
    const correct = text(r.correct_answer);
    const wrong = r.incorrect_answers.map(text);
    if (!question || !correct || wrong.some((w) => !w)) return null;
    return { question, correct, answers: shuffled([correct, ...(wrong as string[])], rand) };
  } catch {
    return null;
  }
}

export interface Fact {
  year: number;
  text: string;
  url: string | null; // the event's Wikipedia page, when the feed gave a safe one
}

// Only an https link on Wikipedia is ever put in an href.
const wikiUrl = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && /(^|\.)wikipedia\.org$/.test(u.hostname) ? u.href : null;
  } catch {
    return null;
  }
};

// Wikimedia "on this day", selected events: pick one at random, preferring an event that has a page to link to.
export function parseFact(body: unknown, rand: () => number = Math.random): Fact | null {
  const events = (body as { selected?: { text?: unknown; year?: unknown; pages?: { content_urls?: { desktop?: { page?: unknown } } }[] }[] } | null)?.selected;
  if (!Array.isArray(events)) return null;
  const valid = events.flatMap((e) => (typeof e?.text === "string" && e.text && typeof e.year === "number" ? [{ year: e.year, text: e.text, url: wikiUrl(e.pages?.[0]?.content_urls?.desktop?.page) }] : []));
  const linked = valid.filter((e) => e.url);
  const from = linked.length ? linked : valid;
  return from.length ? from[Math.floor(rand() * from.length)] : null;
}
