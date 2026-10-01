import { useEffect, useState } from "react";

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
}

// Wireframes.md §5, phase-1 cut: the ring ticks, then the way on. The cat and the 90-second unlock arrive in phase 3.
export function RewardView({ title, done, total, hasNext, onNext, onToday }: Props) {
  const [shown, setShown] = useState(Math.max(done - 1, 0)); // start one short, so the ring visibly ticks
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(done));
    return () => cancelAnimationFrame(raf);
  }, [done]);

  return (
    <div className="reward">
      <p className="meta">{title}</p>
      <Ring done={shown} total={total} size={104} showCount />
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
    </div>
  );
}
