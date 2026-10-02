// The one extra line on the screen a notification tap opens (UX_Flows.md §5, "Web push is tap-to-open only"): web push has
// no action buttons on iOS, so Snooze lives here instead. App.tsx decides when it shows (src/push.ts `arrivalFrom`).
export function ArrivalLine({ onSnooze }: { onSnooze: () => void }) {
  return (
    <p className="arrival-line">
      <span>Not now?</span>
      <button className="text-button" onClick={onSnooze}>
        Snooze
      </button>
    </p>
  );
}
