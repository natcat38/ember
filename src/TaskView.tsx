import { useRef, useState } from "react";
import type { Size, Task, TriageAnswers } from "../core/task";
import { formatDue } from "./Capture";

const SIZES: Size[] = ["XS", "S", "M", "L", "XL"];

// A tap on the dimmed area closes a dialog with nothing changed. Content sits in an inner box, so only the backdrop matches.
export const closeOnBackdrop = (e: React.MouseEvent<HTMLDialogElement>) => e.target === e.currentTarget && e.currentTarget.close();

interface Props {
  task: Task;
  today: string;
  onBack: () => void;
  onTriage: (answers: TriageAnswers) => void;
  onRename: (title: string) => void;
  onRemove: () => void;
}

// Wireframes.md §6. Steps, Start, and Pin to today arrive in slices 3–5.
export function TaskView({ task, today, onBack, onTriage, onRename, onRemove }: Props) {
  // Triage sits open until answered; an already-triaged task opens on the one-line summary.
  const [editing, setEditing] = useState(task.state === "inbox");
  const menu = useRef<HTMLDivElement>(null);
  const renameDialog = useRef<HTMLDialogElement>(null);
  const removeDialog = useRef<HTMLDialogElement>(null);
  const date = useRef<HTMLInputElement>(null);

  function fromMenu(dialog: HTMLDialogElement) {
    menu.current!.hidePopover();
    dialog.showModal();
  }

  const summary = [task.deadline && formatDue(task.deadline), task.holding_up && "Holding things up", task.size].filter(Boolean);

  return (
    <>
      <header className="header">
        <button className="icon-button" aria-label="Back" onClick={onBack}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <h1 className="title task-title" tabIndex={-1}>
          {task.title}
        </h1>
        <button className="icon-button" popoverTarget="task-menu" aria-label={`More actions for ${task.title}`}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>
        <div id="task-menu" ref={menu} popover="auto" className="menu">
          <button onClick={() => fromMenu(renameDialog.current!)}>Rename task</button>
          <button onClick={() => fromMenu(removeDialog.current!)}>Remove from list</button>
        </div>
      </header>

      <main className="main">
        {editing ? (
          <section className="section triage" aria-label="Triage">
            <Question label="Has a deadline?">
              <Pill pressed={!task.deadline} onClick={() => onTriage({ deadline: null })}>
                Not yet
              </Pill>
              <Pill
                pressed={!!task.deadline}
                onClick={() => {
                  try {
                    date.current!.showPicker();
                  } catch {
                    date.current!.focus();
                  }
                }}
              >
                {task.deadline ? formatDue(task.deadline) : "Pick a date"}
              </Pill>
              <input
                ref={date}
                type="date"
                className="date-input"
                tabIndex={-1}
                aria-hidden="true"
                min={today}
                value={task.deadline ?? ""}
                onChange={(e) => onTriage({ deadline: e.target.value || null })}
              />
            </Question>
            <Question label="Is this holding up anything else?">
              <Pill pressed={!task.holding_up} onClick={() => onTriage({ holding_up: false })}>
                No
              </Pill>
              <Pill pressed={task.holding_up} onClick={() => onTriage({ holding_up: true })}>
                Yes
              </Pill>
            </Question>
            <Question label="Size">
              {SIZES.map((size) => (
                <Pill key={size} pressed={task.size === size} onClick={() => onTriage({ size })}>
                  {size}
                </Pill>
              ))}
            </Question>
          </section>
        ) : (
          <section className="row" aria-label="Triage">
            <span>{summary.join(" · ")}</span>
            <button className="text-button" onClick={() => setEditing(true)}>
              Edit
            </button>
          </section>
        )}
      </main>

      <dialog ref={renameDialog} className="prompt" aria-labelledby="rename-title" onClick={closeOnBackdrop}>
        <form
          method="dialog"
          className="capture-form prompt-body"
          onSubmit={(e) => {
            onRename(new FormData(e.currentTarget).get("title") as string);
          }}
        >
          <label className="capture-form">
            <span id="rename-title" className="prompt-title">
              Rename task
            </span>
            <input name="title" className="field" defaultValue={task.title} key={task.title} autoComplete="off" />
          </label>
          <div className="actions prompt-actions">
            <button type="button" className="button" onClick={() => renameDialog.current!.close()}>
              Cancel
            </button>
            <button className="button primary">Save</button>
          </div>
        </form>
      </dialog>

      {/* Focus lands on Keep it, the choice that changes nothing (Wireframes.md §6). */}
      <dialog ref={removeDialog} className="prompt" role="alertdialog" aria-labelledby="remove-title" onClick={closeOnBackdrop}>
        <div className="prompt-body">
        <p id="remove-title" className="prompt-title">
          Remove "{task.title}" from your list?
        </p>
        <div className="actions prompt-actions">
          <button className="button" onClick={() => removeDialog.current!.close()}>
            Keep it
          </button>
          <button
            className="button primary"
            onClick={() => {
              removeDialog.current!.close();
              onRemove();
            }}
          >
            Remove
          </button>
        </div>
        </div>
      </dialog>
    </>
  );
}

function Question({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="question">
      <p className="question-label" aria-hidden="true">
        {label}
      </p>
      <div className="actions">{children}</div>
    </div>
  );
}

function Pill({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}
