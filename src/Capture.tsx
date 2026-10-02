import { useRef, useState } from "react";
import type { CaptureInput } from "../core/task";

const dueLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
export const formatDue = (d: string) => `Due ${dueLabel.format(Date.parse(d))}`;

interface FormProps {
  draft: string;
  onDraft: (text: string) => void;
  onSend: (input: CaptureInput) => void;
  today: string;
  showHint: boolean;
  autoFocus?: boolean; // onboarding's first screen: the field is ready to type into (UX_Flows.md §7)
}

// The field, the Deadline and Quick chips, and Send. Used inside the phone sheet and inline on desktop.
export function CaptureForm({ draft, onDraft, onSend, today, showHint, autoFocus }: FormProps) {
  const [deadline, setDeadline] = useState<string | null>(null);
  const [quick, setQuick] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const date = useRef<HTMLInputElement>(null);

  function openPicker() {
    try {
      date.current!.showPicker();
    } catch {
      date.current!.focus();
    }
  }

  return (
    <form
      className="capture-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.trim()) return;
        onSend({ title: draft, deadline, quick });
        setDeadline(null);
        setQuick(false);
        field.current!.focus();
      }}
    >
      <div className="actions">
        <button type="button" className="chip" aria-pressed={!!deadline} onClick={openPicker}>
          {deadline ? formatDue(deadline) : "Deadline"}
        </button>
        {deadline && (
          <button type="button" className="icon-button" aria-label="Clear deadline" onClick={() => setDeadline(null)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
        <input
          ref={date}
          type="date"
          className="date-input"
          tabIndex={-1}
          aria-hidden="true"
          min={today}
          value={deadline ?? ""}
          onChange={(e) => setDeadline(e.target.value || null)}
        />
        <button type="button" className="chip" aria-pressed={quick} onClick={() => setQuick(!quick)}>
          Quick
        </button>
      </div>
      <div className="field-row">
        <label className="field-label" style={{ flexGrow: 1, display: "flex" }}>
          <span className="sr-only">Capture a thought</span>
          <input
            ref={field}
            className="field"
            placeholder="What's on your mind?"
            autoFocus={autoFocus}
            autoComplete="off"
            enterKeyHint="send"
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
          />
        </label>
        <button type="submit" className="send" aria-label="Send">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 2L11 13" />
            <path d="M22 2l-7 20-4-9-9-4z" />
          </svg>
        </button>
      </div>
      {showHint && <p className="hint">One thing or ten. Just get it out of your head.</p>}
    </form>
  );
}
