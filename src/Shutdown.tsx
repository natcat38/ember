import { useEffect, useRef, useState } from "react";
import { band, wasDueLabel, type Today } from "../core/today";
import { completeTask, remove, triage, type State, type Task } from "../core/task";
import { useAnnounce } from "./announce";
import { DateButton } from "./DateButton";
import { ConfirmDialog } from "./dialogs";
import { refocus } from "./refocus";
import { Cat } from "./Cat";
import { catPose } from "../core/cat";
import { decryptLine, encryptLine, ensureKey, MAX_LINE_CHARS } from "./journal";

interface Props {
  state: State;
  update: (fn: (s: State) => State) => void;
  today: string;
  tomorrow: Today; // tomorrow's list, built now (UX_Flows.md §3.7)
  doneToday: number;
  /** This device has synced, has nothing waiting to upload, and is online: the only time it may make the journal key (see Journal). */
  canMakeKey: boolean;
  onClose: () => void;
}

// The evening shutdown: three step cards (Wireframes.md §9), then the optional journal line and mood under "You're done".
export function ShutdownView({ state, update, today, tomorrow, doneToday, canMakeKey, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [removing, setRemoving] = useState<Task | null>(null);
  const removeDialog = useRef<HTMLDialogElement>(null);

  // Due today or overdue, and not done.
  const urgent = state.tasks.filter((t) => (t.state === "active" || t.state === "overdue") && ["due_today", "overdue"].includes(band(t, today)));
  const n = tomorrow.rows.length;
  const now = () => Date.now();

  // A task leaves the list: focus goes to the next row's first button (or the one above), else the heading.
  const leaveRow = (id: string) => {
    const li = document.getElementById(`urgent-${id}`);
    const near = li?.nextElementSibling ?? li?.previousElementSibling;
    refocus(() => near?.querySelector<HTMLElement>("button") ?? document.querySelector<HTMLElement>("h1"));
  };

  const next = () => {
    setStep(step + 1);
    requestAnimationFrame(() => document.querySelector<HTMLElement>("h1")?.focus());
  };

  return (
    <div className="step-card">
      <button className="text-button" style={{ alignSelf: "flex-start" }} onClick={onClose}>
        Close
      </button>

      {step === 0 && (
        <>
          <h1 className="title" tabIndex={-1}>
            {urgent.length ? "Anything urgent still open?" : "Nothing urgent."}
          </h1>
          {urgent.length > 0 && (
            <ul className="list" aria-label="Still open">
              {urgent.map((t) => (
                <li key={t.id} id={`urgent-${t.id}`} className="row urgent-row">
                  <span>
                    {t.title}
                    <span className="meta">{band(t, today) === "overdue" && t.deadline ? wasDueLabel(t.deadline, today) : "Due today"}</span>
                  </span>
                  <div className="actions">
                    <button
                      className="button"
                      onClick={() => {
                        leaveRow(t.id);
                        update((s) => completeTask(s, t.id, now()));
                      }}
                    >
                      Done
                    </button>
                    <DateButton
                      label={`Reschedule ${t.title}`}
                      className="button"
                      min={today}
                      onPick={(d) => {
                        if (!d) return;
                        leaveRow(t.id);
                        update((s) => triage(s, t.id, { deadline: d }, now(), today));
                      }}
                    >
                      Reschedule
                    </DateButton>
                    <button
                      className="button"
                      onClick={() => {
                        setRemoving(t);
                        removeDialog.current!.showModal();
                      }}
                    >
                      Remove from list
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {step === 1 && (
        <>
          <h1 className="title" tabIndex={-1}>
            Tomorrow's list is ready: {n} {n === 1 ? "thing" : "things"}.
          </h1>
          {n > 0 && (
            <ul className="list" aria-label="Tomorrow">
              {tomorrow.rows.map((r) => (
                <li key={r.key} className="row">
                  {r.chunk?.title ?? r.task.title}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {step === 2 && (
        <>
          {/* The day is over: the cat falls asleep (UX_Flows.md §6). */}
          <div className="cat-sleep" aria-hidden="true">
            <Cat pose={catPose({ screen: "shutdown" })} size={112} />
          </div>
          <h1 className="title" tabIndex={-1}>
            {doneToday > 0 ? "That's it for today. You're done." : "Some days are for resting. Tomorrow's list is ready when you are."}
          </h1>
          <Journal state={state} update={update} today={today} canMakeKey={canMakeKey} />
        </>
      )}

      <div className="step-foot">
        <button className="button primary" onClick={step < 2 ? next : onClose}>
          {step < 2 ? "Next" : "Close"}
        </button>
        <p className="dots">
          <span className="sr-only">{`Step ${step + 1} of 3`}</span>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i === step ? "on" : ""} aria-hidden="true" />
          ))}
        </p>
      </div>

      <ConfirmDialog
        dialog={removeDialog}
        question={`Remove "${removing?.title ?? ""}" from your list?`}
        keep="Keep it"
        confirm="Remove"
        onConfirm={() => {
          if (!removing) return;
          leaveRow(removing.id);
          update((s) => remove(s, removing.id, now()));
        }}
      />
    </div>
  );
}

const MOODS = ["Rough", "Meh", "Okay", "Good", "Great"]; // mood 1-5 (UX_Flows.md §3.7)

// ponytail: draft copy, not yet approved.
const NEEDS_CONNECTION = "Your journal needs a connection the first time.";

// The optional line and mood after "You're done" (UX_Flows.md §3.7). Never required: nothing here blocks Close. Each change
// saves as it is made (a line when the field loses focus, a mood when tapped), as an upsert of today's `journal` row.
//
// Key race: two devices that each make a journal key before either has seen the other's would fight over the one
// `settings.journal_key` (last write wins), leaving one device's lines unreadable. So a device makes the key only when it
// has synced and has nothing waiting to upload; otherwise the line is held and saved the moment that is true.
function Journal({ state, update, today, canMakeKey }: Pick<Props, "state" | "update" | "today" | "canMakeKey">) {
  const entry = state.journal.find((j) => j.day === today);
  const key = state.settings.journal_key;
  const [line, setLine] = useState("");
  const [mood, setMood] = useState<number | null>(null);
  const [held, setHeld] = useState<{ line: string; mood: number | null } | null>(null);
  const touched = useRef(false); // the user has typed or tapped: what arrives from storage or sync no longer replaces it
  const saved = useRef<{ line: string; mood: number | null } | null>(null);
  const madeKey = useRef<string | null>(null); // a key this component made, before the state shows it
  const queue = useRef(Promise.resolve()); // saves run one after another, so an older one never lands last
  const latest = useRef(state);
  latest.current = state;
  useAnnounce(held ? NEEDS_CONNECTION : null);

  // Today's saved line reopens decrypted. A line that won't decrypt (wrong key, no key yet) shows as nothing, never an error.
  useEffect(() => {
    let live = true;
    void (async () => {
      const text = entry ? ((await decryptLine(key, entry)) ?? "") : "";
      if (!live) return;
      saved.current = entry ? { line: text, mood: entry.mood } : { line: "", mood: null };
      if (touched.current) return;
      setLine(text);
      setMood(entry?.mood ?? null);
    })();
    return () => {
      live = false;
    };
  }, [entry, key]);

  const save = (next: { line: string; mood: number | null }) => {
    queue.current = queue.current.then(async () => {
      const was = saved.current ?? { line: "", mood: null };
      if (next.line === was.line && next.mood === was.mood) return; // nothing new to save
      let k = latest.current.settings.journal_key ?? madeKey.current;
      if (!k) {
        if (!canMakeKey) return setHeld(next);
        k = madeKey.current = ensureKey(latest.current).settings.journal_key!;
        const made = k;
        update((s) => (s.settings.journal_key ? s : { ...s, settings: { ...s.settings, journal_key: made } }));
      }
      setHeld(null);
      const sealed = await encryptLine(k, next.line);
      saved.current = next;
      // If another device's key reached the state first, this line was sealed with a key nobody else has: don't store it.
      const sealedWith = k;
      update((s) => {
        if (s.settings.journal_key !== sealedWith) return s;
        const row = { day: today, ...sealed, mood: next.mood, updated_at: Date.now() };
        return { ...s, journal: s.journal.some((j) => j.day === today) ? s.journal.map((j) => (j.day === today ? row : j)) : [...s.journal, row] };
      });
    })
      // A failed save (a key that won't import) is logged and dropped; it must not leave the queue rejected, which would skip every later save.
      .catch((e) => console.error("Ember journal: could not save the line", e instanceof Error ? e.name : e));
  };

  // A held line is saved as soon as there is a key to use or the device may make one.
  useEffect(() => {
    if (held && (key || canMakeKey)) save(held);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the gate opens
  }, [held, key, canMakeKey]);

  return (
    <div className="journal">
      <input
        className="field"
        aria-label="One line about today"
        placeholder="One line about today, whatever comes to mind."
        maxLength={MAX_LINE_CHARS}
        autoComplete="off"
        value={line}
        onChange={(e) => ((touched.current = true), setLine(e.target.value))}
        onBlur={() => save({ line: line.trim(), mood })}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <fieldset className="mood">
        <legend className="sr-only">How was today?</legend>
        {MOODS.map((label, i) => (
          <label key={label}>
            <input
              type="radio"
              name="mood"
              checked={mood === i + 1}
              onChange={() => {
                touched.current = true;
                setMood(i + 1);
                save({ line: line.trim(), mood: i + 1 });
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {held && <p className="hint">{NEEDS_CONNECTION}</p>}
    </div>
  );
}
