import { useRef, useState } from "react";
import { band, wasDueLabel, type Today } from "../core/today";
import { completeTask, remove, triage, type State, type Task } from "../core/task";
import { ConfirmDialog } from "./dialogs";
import { Cat } from "./Cat";
import { catPose } from "../core/cat";

interface Props {
  state: State;
  update: (fn: (s: State) => State) => void;
  today: string;
  tomorrow: Today; // tomorrow's list, built now (UX_Flows.md §3.7)
  doneToday: number;
  onClose: () => void;
}

// The evening shutdown: three step cards (Wireframes.md §9). Journal and mood arrive in phase 3.
export function ShutdownView({ state, update, today, tomorrow, doneToday, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [removing, setRemoving] = useState<Task | null>(null);
  const removeDialog = useRef<HTMLDialogElement>(null);
  const dates = useRef<Record<string, HTMLInputElement | null>>({});

  // Due today or overdue, and not done.
  const urgent = state.tasks.filter((t) => (t.state === "active" || t.state === "overdue") && ["due_today", "overdue"].includes(band(t, today)));
  const n = tomorrow.rows.length;
  const now = () => Date.now();

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
                <li key={t.id} className="row urgent-row">
                  <span>
                    {t.title}
                    <span className="meta">{band(t, today) === "overdue" && t.deadline ? wasDueLabel(t.deadline, today) : "Due today"}</span>
                  </span>
                  <div className="actions">
                    <button className="button" onClick={() => update((s) => completeTask(s, t.id, now()))}>
                      Done
                    </button>
                    <button
                      className="button"
                      onClick={() => {
                        try {
                          dates.current[t.id]!.showPicker();
                        } catch {
                          dates.current[t.id]!.focus();
                        }
                      }}
                    >
                      Reschedule
                    </button>
                    <input
                      ref={(el) => {
                        dates.current[t.id] = el;
                      }}
                      type="date"
                      className="date-input"
                      tabIndex={-1}
                      aria-hidden="true"
                      min={today}
                      onChange={(e) => e.target.value && update((s) => triage(s, t.id, { deadline: e.target.value }, now(), today))}
                    />
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
        </>
      )}

      <div className="step-foot">
        <button className="button primary" onClick={step < 2 ? next : onClose}>
          {step < 2 ? "Next" : "Close"}
        </button>
        <p className="dots" aria-label={`Step ${step + 1} of 3`}>
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
        onConfirm={() => removing && update((s) => remove(s, removing.id, now()))}
      />
    </div>
  );
}
