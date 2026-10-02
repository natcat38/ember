import { expect, test } from "vitest";
import { noUnlocks, parseFact, parseTrivia, parseUnlocks, pickUnlock, recordServed, shuffled, type Unlocks } from "./unlock";

const TODAY = "2026-10-05";
const mem = (o: Partial<Unlocks> = {}): Unlocks => ({ ...noUnlocks(), ...o });

test("a fixed choice always serves that kind, even the puzzle twice in a day", () => {
  expect(pickUnlock("trivia", mem({ last: "trivia" }), TODAY)).toBe("trivia");
  expect(pickUnlock("fact", mem({ last: "fact" }), TODAY)).toBe("fact");
  expect(pickUnlock("puzzle", mem({ last: "puzzle", puzzleDay: TODAY }), TODAY)).toBe("puzzle");
});

test("rotate starts at trivia, then goes puzzle, fact, trivia", () => {
  expect(pickUnlock("rotate", noUnlocks(), TODAY)).toBe("trivia");
  expect(pickUnlock("rotate", mem({ last: "trivia" }), TODAY)).toBe("puzzle");
  expect(pickUnlock("rotate", mem({ last: "puzzle", puzzleDay: TODAY }), TODAY)).toBe("fact");
  expect(pickUnlock("rotate", mem({ last: "fact", puzzleDay: TODAY }), TODAY)).toBe("trivia");
});

test("rotate skips the puzzle once it has been served today, and brings it back tomorrow", () => {
  expect(pickUnlock("rotate", mem({ last: "trivia", puzzleDay: TODAY }), TODAY)).toBe("fact");
  expect(pickUnlock("rotate", mem({ last: "trivia", puzzleDay: "2026-10-04" }), TODAY)).toBe("puzzle");
});

test("recording what was served moves the rotation on and stamps the puzzle's day", () => {
  const a = recordServed(noUnlocks(), "trivia", TODAY);
  expect(a).toEqual({ last: "trivia", puzzleDay: null });
  const b = recordServed(a, "puzzle", TODAY);
  expect(b).toEqual({ last: "puzzle", puzzleDay: TODAY });
  expect(recordServed(b, "fact", "2026-10-06")).toEqual({ last: "fact", puzzleDay: TODAY }); // the puzzle's day is kept
});

test("a full rotation over a day serves each kind in turn without a second puzzle", () => {
  let m = noUnlocks();
  const served: string[] = [];
  for (let i = 0; i < 5; i++) {
    const k = pickUnlock("rotate", m, TODAY);
    served.push(k);
    m = recordServed(m, k, TODAY);
  }
  expect(served).toEqual(["trivia", "puzzle", "fact", "trivia", "fact"]);
});

test("stored memory that is missing or damaged reads as nothing served", () => {
  expect(parseUnlocks(null)).toEqual(noUnlocks());
  expect(parseUnlocks("not json")).toEqual(noUnlocks());
  expect(parseUnlocks(JSON.stringify({ last: "chess", puzzleDay: 5 }))).toEqual(noUnlocks());
  expect(parseUnlocks(JSON.stringify({ last: "fact", puzzleDay: TODAY }))).toEqual({ last: "fact", puzzleDay: TODAY });
});

test("shuffled keeps every answer and leaves the input alone", () => {
  const input = ["a", "b", "c", "d"];
  const out = shuffled(input, () => 0.5);
  expect([...out].sort()).toEqual(input);
  expect(input).toEqual(["a", "b", "c", "d"]);
  expect(shuffled(input, () => 0)).not.toBe(input);
});

test("trivia: the URL encoding is decoded and the answers keep their right one", () => {
  const body = { response_code: 0, results: [{ question: "What%20is%20the%20capital%20of%20C%C3%B4te%20d%27Ivoire%3F", correct_answer: "Yamoussoukro", incorrect_answers: ["Abidjan", "Bouak%C3%A9", "Daloa"] }] };
  const q = parseTrivia(body, () => 0.3)!;
  expect(q.question).toBe("What is the capital of Côte d'Ivoire?");
  expect(q.correct).toBe("Yamoussoukro");
  expect([...q.answers].sort()).toEqual(["Abidjan", "Bouaké", "Daloa", "Yamoussoukro"]);
});

test("trivia: an error code, no results or a malformed question is refused", () => {
  expect(parseTrivia({ response_code: 5, results: [] })).toBeNull();
  expect(parseTrivia({ response_code: 0, results: [] })).toBeNull();
  expect(parseTrivia({ response_code: 0, results: [{ question: "x" }] })).toBeNull();
  expect(parseTrivia({ response_code: 0, results: [{ question: "%E0%A4%A", correct_answer: "a", incorrect_answers: ["b"] }] })).toBeNull(); // bad escape
  expect(parseTrivia(null)).toBeNull();
});

test("fact: one event with its year, text and a Wikipedia link", () => {
  const page = { content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Apollo_11" } } };
  const body = { selected: [{ text: "No page here", year: 1900, pages: [] }, { text: "Apollo 11 lands.", year: 1969, pages: [page] }] };
  expect(parseFact(body, () => 0)).toEqual({ year: 1969, text: "Apollo 11 lands.", url: "https://en.wikipedia.org/wiki/Apollo_11" });
});

test("fact: a link that is not https Wikipedia is dropped, and an empty feed is refused", () => {
  const bad = { selected: [{ text: "Odd.", year: 1, pages: [{ content_urls: { desktop: { page: "javascript:alert(1)" } } }] }] };
  expect(parseFact(bad)).toEqual({ year: 1, text: "Odd.", url: null });
  const other = { selected: [{ text: "Odd.", year: 1, pages: [{ content_urls: { desktop: { page: "https://evil.example/wiki/x" } } }] }] };
  expect(parseFact(other)!.url).toBeNull();
  expect(parseFact({ selected: [] })).toBeNull();
  expect(parseFact({})).toBeNull();
});
