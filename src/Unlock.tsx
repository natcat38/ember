import { useEffect, useRef, useState } from "react";
import { parseFact, parseTrivia, type Fact, type ServedKind, type Trivia } from "../core/unlock";
import { useAnnounce } from "./announce";

// The 90-second unlock on Reward (UX_Flows.md §3.6, Wireframes.md §5). Fetched from the browser when the user taps
// the button, never ahead of time. Every string from the network goes in as text, never as HTML.

export const UNLOCK_MS = 90_000;
const FETCH_MS = 8_000;
// ponytail: draft copy
const FAILED = "That didn't load. Skip it this time.";

// UX_Flows.md §3.6: the button names the unlock being served.
export const UNLOCK_BUTTON: Record<ServedKind, string> = {
  puzzle: "Try today's chess puzzle",
  trivia: "Answer a trivia question",
  fact: "See what happened on this day",
};

const TRIVIA_URL = "https://opentdb.com/api.php?amount=1&type=multiple&encode=url3986";
const PUZZLE_URL = "https://lichess.org/training/frame?theme=brown&bg=light";
const factUrl = (today: string) => `https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/selected/${today.slice(5, 7)}/${today.slice(8, 10)}`;

type Loaded = { kind: "trivia"; trivia: Trivia } | { kind: "fact"; fact: Fact } | { kind: "puzzle" };

// One attempt, no retry loop: a failure is shown once and the user moves on (UX_Flows.md §3.6 bail-outs).
async function load(kind: ServedKind, today: string, signal: AbortSignal): Promise<Loaded | null> {
  if (kind === "puzzle") return navigator.onLine ? { kind } : null; // the frame loads itself; offline there is nothing to show
  const res = await fetch(kind === "trivia" ? TRIVIA_URL : factUrl(today), { signal });
  if (!res.ok) return null;
  const body: unknown = await res.json();
  if (kind === "trivia") {
    const trivia = parseTrivia(body);
    return trivia && { kind, trivia };
  }
  const fact = parseFact(body);
  return fact && { kind, fact };
}

interface Props {
  kind: ServedKind;
  today: string; // the local day, YYYY-MM-DD
  onClose: () => void; // Skip or Done
  onElapsed: () => void; // the 90 seconds are up: the hint, not a limit
}

export function Unlock({ kind, today, onClose, onElapsed }: Props) {
  const [got, setGot] = useState<Loaded | "failed" | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const elapsed = useRef(onElapsed);
  elapsed.current = onElapsed;

  useEffect(() => root.current?.focus(), []);
  useAnnounce(got === null ? "Loading…" : got === "failed" ? FAILED : null);

  useEffect(() => {
    let live = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_MS); // not AbortSignal.any/timeout: Safari 17.4 and 16.4
    load(kind, today, ctrl.signal)
      .then((r) => live && setGot(r ?? "failed"))
      .catch(() => live && setGot("failed"))
      .finally(() => clearTimeout(timer));
    return () => {
      live = false;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [kind, today]);

  // The 90 seconds start once there is something to look at.
  const ready = got !== null && got !== "failed";
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => elapsed.current(), UNLOCK_MS);
    return () => clearTimeout(t);
  }, [ready]);

  if (got === "failed") {
    return (
      <div ref={root} tabIndex={-1} className="unlock">
        <p>{FAILED}</p>
        {/* A quiet text button, as everywhere else Skip appears: a failure doesn't promote it to the primary action. */}
        <button className="text-button" style={{ alignSelf: "flex-start" }} onClick={onClose}>
          Skip
        </button>
      </div>
    );
  }

  // Trivia stays "Skip" until it is answered; the fact and the puzzle have nothing further to do.
  const closeLabel = got && got.kind === "trivia" && picked === null ? "Skip" : "Done";
  return (
    <div ref={root} tabIndex={-1} className="unlock">
      {got === null && <p>Loading…</p>}
      {got?.kind === "trivia" && <TriviaBody trivia={got.trivia} picked={picked} onPick={setPicked} />}
      {got?.kind === "fact" && <FactBody fact={got.fact} />}
      {got?.kind === "puzzle" && <iframe className="unlock-puzzle" title="Lichess daily puzzle" src={PUZZLE_URL} />}
      {ready && (
        <>
          <div className="unlock-bar" aria-hidden="true">
            <div className="unlock-bar-fill" />
          </div>
          {/* ponytail: draft copy. The label stays when the bar is hidden under reduced motion. */}
          <p className="hint">Take about ninety seconds. No rush.</p>
        </>
      )}
      <button className="text-button" onClick={onClose}>
        {closeLabel}
      </button>
    </div>
  );
}

function TriviaBody({ trivia, picked, onPick }: { trivia: Trivia; picked: string | null; onPick: (a: string) => void }) {
  return (
    <>
      <p className="unlock-question">{trivia.question}</p>
      <div className="unlock-answers" role="group" aria-label="Answers">
        {trivia.answers.map((a) => (
          <button key={a} className="button" aria-pressed={picked === a} disabled={picked !== null} onClick={() => onPick(a)}>
            {a}
          </button>
        ))}
      </div>
      <p role="status" className="unlock-result">
        {picked === null ? "" : picked === trivia.correct ? "Right." : `Not quite. It was ${trivia.correct}.`}
      </p>
    </>
  );
}

function FactBody({ fact }: { fact: Fact }) {
  return (
    <>
      <p className="unlock-question">
        <strong>{fact.year}</strong>. {fact.text}
      </p>
      {fact.url && (
        <a href={fact.url} target="_blank" rel="noopener">
          Read more on Wikipedia
        </a>
      )}
    </>
  );
}
