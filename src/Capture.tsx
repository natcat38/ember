import { useEffect, useRef, useState } from "react";
import { MAX_TITLE_CHARS, type CaptureInput } from "../core/task";
import { DateButton } from "./DateButton";

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

  // The text lives here while it is typed. Handing every keystroke to the app would rebuild Today, rewrite all of
  // localStorage and re-diff for sync each time (audit #30), so App gets it 500 ms after typing stops, on blur, when the
  // page is hidden, and on unmount.
  const [text, setText] = useState(draft);
  const typed = useRef(draft); // the latest text, readable from a timer
  const known = useRef(draft); // the text App last had
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hand = useRef(onDraft);
  hand.current = onDraft;
  const flush = () => {
    clearTimeout(timer.current);
    if (typed.current === known.current) return;
    known.current = typed.current;
    hand.current(typed.current);
  };
  // A draft that changes under us (another tab saved, a send cleared it) replaces what is shown.
  useEffect(() => {
    if (draft === known.current) return;
    clearTimeout(timer.current);
    known.current = typed.current = draft;
    setText(draft);
  }, [draft]);
  useEffect(() => {
    const hidden = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      flush();
    };
  }, []);

  return (
    <form
      className="capture-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        clearTimeout(timer.current);
        typed.current = known.current = ""; // the send clears App's draft
        setText("");
        onSend({ title: text, deadline, quick });
        setDeadline(null);
        setQuick(false);
        field.current!.focus();
      }}
    >
      <div className="actions">
        <DateButton label="Deadline" className="chip" pressed={!!deadline} value={deadline ?? ""} min={today} onPick={(d) => setDeadline(d || null)}>
          {deadline ? formatDue(deadline) : "Deadline"}
        </DateButton>
        {deadline && (
          <button type="button" className="icon-button" aria-label="Clear deadline" onClick={() => setDeadline(null)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
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
            maxLength={MAX_TITLE_CHARS}
            enterKeyHint="send"
            value={text}
            onChange={(e) => {
              typed.current = e.target.value;
              setText(e.target.value);
              clearTimeout(timer.current);
              timer.current = setTimeout(flush, 500);
            }}
            onBlur={flush}
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
