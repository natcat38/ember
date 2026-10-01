import { useRef, useState } from "react";
import type { Size, State, Task, TriageAnswers } from "../core/task";
import { formatDue } from "./Capture";
import { ConfirmDialog, TextDialog } from "./dialogs";
import { Steps } from "./Steps";

const SIZES: Size[] = ["XS", "S", "M", "L", "XL"];

interface Props {
  task: Task;
  state: State;
  update: (fn: (s: State) => State) => void;
  today: string;
  inToday: boolean;
  onPin: () => void;
  onStart: () => void;
  onStartStep: (chunkId: string) => void;
  onBack: () => void;
  onTriage: (answers: TriageAnswers) => void;
  onRename: (title: string) => void;
  onRemove: () => void;
}

// Wireframes.md §6. Start and Pin to today arrive in slices 4–5.
export function TaskView({ task, state, update, today, inToday, onPin, onStart, onStartStep, onBack, onTriage, onRename, onRemove }: Props) {
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
        <hr className="divider" />
        <Steps state={state} update={update} taskId={task.id} onStart={onStartStep} />
      </main>

      {/* Start begins the first unfinished step, or asks for one. It works on an untriaged Inbox task too: Today is an offer,
          not a gate (UX_Flows.md §3.4), and Focus runs on a step whatever the task's state. Pin to today needs a rankable task. */}
      {task.state !== "done" && task.state !== "removed" && (
        <div className="bottom-bar">
          <button className="button primary" onClick={onStart}>
            Start
          </button>
          {!inToday && (task.state === "active" || task.state === "overdue") && (
            <button className="button" onClick={onPin}>
              Pin to today
            </button>
          )}
        </div>
      )}

      <TextDialog dialog={renameDialog} label="Rename task" value={task.title} onSave={onRename} />
      <ConfirmDialog dialog={removeDialog} question={`Remove "${task.title}" from your list?`} keep="Keep it" confirm="Remove" onConfirm={onRemove} />
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
