import { useEffect, useState } from "react";
import { linkTelegram } from "./Settings";
import { Cat } from "./Cat";
import { catPose } from "../core/cat";

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
}

// Wireframes.md §5, phase-1 cut: the ring ticks, then the cat purrs in its circle, then the way on. The 90-second unlock arrives in phase 3.
export function RewardView({ title, done, total, hasNext, onNext, onToday, offerNudges, onOffered }: Props) {
  const [shown, setShown] = useState(Math.max(done - 1, 0)); // start one short, so the ring visibly ticks
  // Decided once per visit: answering the offer marks it shown, and its follow-up line must stay on screen.
  const [offer] = useState(offerNudges);
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
        <h1 id="reward-title" className="lead" tabIndex={-1}>
          {hasNext ? "Step done." : "That's everything for today."}
        </h1>
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
  return (
    <section className="card" aria-label="Reminders">
      {stage === "ask" && (
        <>
          <p>That's a start. Want Ember to nudge you gently while it's closed?</p>
          <div className="actions card-actions">
            <button className="button" onClick={() => setStage("where")}>
              Yes
            </button>
            <button
              className="button"
              onClick={() => {
                setStage("later");
                onOffered();
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
          {problem && (
            <p className="hint" role="status">
              {problem}
            </p>
          )}
        </>
      )}
      {stage === "later" && <p>You can turn this on in Settings any time.</p>}
    </section>
  );
}
