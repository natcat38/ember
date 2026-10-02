import { useEffect, useRef, useState } from "react";
import { useAnnounce } from "./announce";
import { refocus } from "./refocus";
import { linkTelegram } from "./Settings";
import { Cat } from "./Cat";
import { Unlock, UNLOCK_BUTTON } from "./Unlock";
import { catPose } from "../core/cat";
import type { UnlockKind } from "../core/task";
import { parseUnlocks, pickUnlock, recordServed } from "../core/unlock";

// The progress ring (Design_Direction.md §4): decorative lavender on a white track. It fills in 400 ms;
// the day's last step gets one slower 700 ms fill, and nothing more (restraint rule 6).
export function Ring({ done, total, size = 40, showCount = false }: { done: number; total: number; size?: number; showCount?: boolean }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const frac = total ? Math.min(done / total, 1) : 0;
  return (
    <div role="img" aria-label={`${done} of ${total} done today`} className="ring">
      <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--ring-track, #fff)" strokeWidth="4" />
        <circle
          className={`ring-fill${total && done >= total ? " last" : ""}`}
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="var(--color-lavender)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          transform="rotate(-90 18 18)"
        />
        {showCount && (
          <text x="18" y="20.6" textAnchor="middle" fontSize="7.5" fontWeight="800" fontFamily="Nunito, sans-serif" fill="var(--color-ink)">
            {done}/{total}
          </text>
        )}
      </svg>
    </div>
  );
}

interface Props {
  title: string; // the step just finished
  done: number;
  total: number;
  hasNext: boolean;
  onNext: () => void;
  onToday: () => void;
  offerNudges: boolean; // the one-time reminder offer, after the first Reward on this device (UX_Flows.md §7, step 7)
  onOffered: () => void;
  unlock: UnlockKind | null; // the Settings choice, or null when the step was not finished in Focus: no unlock card then (UX_Flows.md §3.6)
}

// This device's calendar date, YYYY-MM-DD. Not Ember's day, which turns over at quiet-hours end: "on this day" and the
// daily puzzle follow the calendar.
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Where the rotation stands lives on this device only (Tech_Scope.md §10 slice 20), outside the synced State.
const UNLOCKS_KEY = "ember.unlock";
const readUnlocks = () => {
  try {
    return parseUnlocks(localStorage.getItem(UNLOCKS_KEY));
  } catch {
    return parseUnlocks(null);
  }
};

// Wireframes.md §5: the ring ticks, the cat purrs, then (after a step finished in Focus) the 90-second unlock is offered,
// then the way on. Skip goes straight to the way on; playing shows it once the 90-second bar runs out.
export function RewardView({ title, done, total, hasNext, onNext, onToday, offerNudges, onOffered, unlock }: Props) {
  const [shown, setShown] = useState(Math.max(done - 1, 0)); // start one short, so the ring visibly ticks
  // Decided once per visit: answering the offer marks it shown, and its follow-up line must stay on screen.
  const [offer] = useState(offerNudges);
  // Decided once per visit too: the kind to serve, then offer → play → after. The rotation moves on when it is offered.
  const [today] = useState(localDay);
  const [kind] = useState(() => (unlock ? pickUnlock(unlock, readUnlocks(), today) : null));
  const [phase, setPhase] = useState<"offer" | "play" | "after">(kind ? "offer" : "after");
  const [elapsed, setElapsed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!kind) return;
    try {
      localStorage.setItem(UNLOCKS_KEY, JSON.stringify(recordServed(readUnlocks(), kind, today)));
    } catch {
      // storage unavailable: the rotation just starts over next time
    }
  }, [kind, today]);
  const finish = () => {
    setPhase("after");
    requestAnimationFrame(() => heading.current?.focus()); // the button that had focus is gone
  };
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(done));
    return () => cancelAnimationFrame(raf);
  }, [done]);

  return (
    <div className="reward">
      <p className="meta">{title}</p>
      <Ring done={shown} total={total} size={104} showCount />
      <div className="cat-circle" aria-hidden="true">
        <Cat pose={catPose({ screen: "reward" })} size={176} />
      </div>
      <section className="card reward-card" aria-labelledby="reward-title">
        <h1 id="reward-title" ref={heading} className="lead" tabIndex={-1}>
          {phase === "offer" ? "Step done. Ninety seconds, if you want it." : hasNext ? "Step done." : "That's everything for today."}
        </h1>
        {kind && phase === "offer" && (
          <div className="reward-actions">
            <button className="button primary" onClick={() => setPhase("play")}>
              {UNLOCK_BUTTON[kind]}
            </button>
            <button className="text-button" onClick={finish}>
              Skip
            </button>
          </div>
        )}
        {kind && phase === "play" && <Unlock kind={kind} today={today} onElapsed={() => setElapsed(true)} onClose={finish} />}
        {(phase === "after" || (phase === "play" && elapsed)) && (
          <div className="reward-actions">
            {hasNext && (
              <button className="button primary" onClick={onNext}>
                Next step
              </button>
            )}
            <button className={hasNext ? "text-button" : "button primary"} onClick={onToday}>
              Back to Today
            </button>
          </div>
        )}
      </section>
      {offer && <NudgeOffer onOffered={onOffered} />}
    </div>
  );
}

// "That's a start. Want Ember to nudge you gently while it's closed?" Yes → where; Not now → where to find it later.
// Telegram is the only channel until web push (phase 3), so "This device" isn't offered yet.
function NudgeOffer({ onOffered }: { onOffered: () => void }) {
  const [stage, setStage] = useState<"ask" | "where" | "later">("ask");
  const [problem, setProblem] = useState<string | null>(null);
  useAnnounce(problem);
  const card = useRef<HTMLElement>(null);
  return (
    <section ref={card} tabIndex={-1} className="card" aria-label="Reminders">
      {stage === "ask" && (
        <>
          <p>That's a start. Want Ember to nudge you gently while it's closed?</p>
          <div className="actions card-actions">
            <button
              className="button"
              onClick={() => {
                setStage("where");
                refocus(() => card.current?.querySelector("button"));
              }}
            >
              Yes
            </button>
            <button
              className="button"
              onClick={() => {
                setStage("later");
                onOffered();
                refocus(() => card.current);
              }}
            >
              Not now
            </button>
          </div>
        </>
      )}
      {stage === "where" && (
        <>
          <p>Where should nudges go?</p>
          <div className="actions card-actions">
            <button
              className="button"
              onClick={async () => {
                const why = await linkTelegram();
                setProblem(why);
                if (!why) onOffered();
              }}
            >
              Telegram
            </button>
          </div>
          {problem && <p className="hint">{problem}</p>}
        </>
      )}
      {stage === "later" && <p>You can turn this on in Settings any time.</p>}
    </section>
  );
}
