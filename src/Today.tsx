import { useEffect, useState } from "react";
import { tick } from "../core/chunk";
import { band, confirmDay, isConfirmed, notToday, wasDueLabel as wasDue, type Today, type TodayRow } from "../core/today";
import { Ring } from "./Reward";
import { pin, type State, type Task } from "../core/task";

interface Props {
  plan: Today;
  state: State;
  update: (fn: (s: State) => State) => void;
  today: string;
  onOpenTask: (t: Task) => void;
  onStart: (r: TodayRow) => void;
  onInbox: () => void;
  onCapture: () => void;
  welcome: boolean; // first open after 3+ days away
  onWelcomeDone: () => void;
  onReset: () => void;
  backedUp: boolean;
}

// Wireframes.md §1. The cat joins the nook in phase 3.
export function TodayView({ plan, state, update, today, onOpenTask, onStart, onInbox, onCapture, welcome, onWelcomeDone, onReset, backedUp }: Props) {
  const { rows, frog, waiting, lightDay } = plan;
  // The morning confirm shows on the day's first visit to Today and never returns that day, answered or not.
  // On a lapse return the welcome back takes its place.
  const [confirming, setConfirming] = useState(() => !isConfirmed(state, today) && rows.length > 0 && !welcome);
  const [adjusting, setAdjusting] = useState(false);
  useEffect(() => {
    if (confirming || welcome) update((s) => confirmDay(s, today, Date.now()));
  }, [confirming, welcome, today, update]);
  const slipped = plan.ranked.some((t) => band(t, today) === "overdue");

  const defer = (key: string) => update((s) => notToday(s, today, key));
  const rest = rows.filter((r) => r !== frog);
  const open = rest.filter((r) => !r.done);
  const done = rest.filter((r) => r.done);

  if (rows.length === 0) {
    return (
      <section className="section">
        <p className="empty">Nothing's lined up for today yet.</p>
        {/* The landing disclosure from phase 2 on (UX_Flows.md §7). */}
        {backedUp && <p className="hint">Your list is backed up, so it won't get lost.</p>}
        <div className="actions">
          <button className="button primary" onClick={onInbox}>
            Sort a few from Inbox
          </button>
          <button className="button" onClick={onCapture}>
            Capture something
          </button>
        </div>
        {lightDay && <LightDay task={lightDay} onPin={() => update((s) => pin(s, lightDay.id, today, Date.now()))} onDecline={() => defer(lightDay.id)} />}
      </section>
    );
  }

  const row = (r: TodayRow) => {
    // A smaller step names its parent; an overdue task shows its date (Wireframes.md §1).
    const second = r.parent?.title ?? (band(r.task, today) === "overdue" && r.task.deadline ? wasDue(r.task.deadline, today) : null);
    return (
      <li key={r.key} className={`row today-row${r.done ? " done" : ""}`}>
        {r.chunk ? (
          <label className="check">
            <input type="checkbox" checked={r.done} aria-label={title(r)} onChange={(e) => update((s) => tick(s, r.chunk!.id, e.target.checked, Date.now()))} />
          </label>
        ) : (
          <span className="check" aria-hidden="true" />
        )}
        <button className="row-link" onClick={() => onOpenTask(r.task)}>
          <span>{title(r)}</span>
          {second && <span className="meta">{second}</span>}
        </button>
        {!r.done && (
          <button className="icon-button" aria-label={`Start ${title(r)}`} onClick={() => onStart(r)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 5l11 7-11 7z" />
            </svg>
          </button>
        )}
        {!r.done &&
          (adjusting ? (
            <button className="text-button" onClick={() => defer(r.key)} aria-label={`Not today: ${title(r)}`}>
              Not today
            </button>
          ) : (
            <RowMenu id={`row-${r.key}`} label={title(r)} onNotToday={() => defer(r.key)} onOpen={() => onOpenTask(r.task)} />
          ))}
      </li>
    );
  };

  const doneCount = rows.filter((r) => r.done).length;
  return (
    <>
      {/* The nook (Design_Direction.md §4). Visible count is hidden from screen readers; the ring's label carries it (A4). */}
      <section className="nook" aria-label="Progress">
        <span className="lead" aria-hidden="true">
          {doneCount} of {rows.length} done
        </span>
        <Ring done={doneCount} total={rows.length} />
      </section>
      {welcome && (
        <section className="card" aria-label="Welcome back">
          <p className="lead">Welcome back. Here's what's on today.</p>
          {slipped && (
            <>
              <p>A couple of these slipped past their date. Want to reset them?</p>
              <div className="actions card-actions">
                <button
                  className="button"
                  onClick={() => {
                    onReset();
                    onWelcomeDone();
                  }}
                >
                  Reset them
                </button>
                <button className="button" onClick={onWelcomeDone}>
                  Leave them
                </button>
              </div>
            </>
          )}
        </section>
      )}
      {confirming && (
        <section className="card" aria-label="Morning confirm">
          <p className="lead">
            Here's today: {rows.length} {rows.length === 1 ? "thing" : "things"}. Good to go?
          </p>
          <div className="actions card-actions">
            {/* Outlined: the frog's Do this first is the view's one primary button (restraint rule 2). */}
            <button className="button" onClick={() => setConfirming(false)}>
              Let's go
            </button>
            <button
              className="button"
              onClick={() => {
                setConfirming(false);
                setAdjusting(true);
              }}
            >
              Adjust
            </button>
          </div>
        </section>
      )}

      {frog && (
        <section className="card frog" aria-labelledby="frog-label">
          <p id="frog-label" className="frog-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 3l2.8 6 6.2.3-4.8 4.1 1.6 6.6-5.8-3.6-5.8 3.6 1.6-6.6L3 9.3 9.2 9z" />
            </svg>
            Do this first
          </p>
          <button className="row-link lead" onClick={() => onOpenTask(frog.task)}>
            {title(frog)}
          </button>
          {frog.chunk && <p className="meta">from: {[frog.task.title, frog.parent?.title].filter(Boolean).join(" · ")}</p>}
          {frog.task.deadline && band(frog.task, today) === "overdue" && <p className="meta">{wasDue(frog.task.deadline, today)}</p>}
          <div className="actions card-actions">
            <button className="button primary icon-label" onClick={() => onStart(frog)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5l11 7-11 7z" />
              </svg>
              Do this first
            </button>
            <button className="button" onClick={() => defer(frog.key)}>
              Not today
            </button>
          </div>
        </section>
      )}

      {(open.length > 0 || done.length > 0) && (
        <ul className="list" aria-label="Today">
          {open.map(row)}
          {done.map(row)}
        </ul>
      )}

      {open.length === 0 && !frog && <p className="empty">That's everything for today.</p>}

      {adjusting && (
        <button className="text-button" style={{ alignSelf: "flex-start" }} onClick={onInbox}>
          Pin a task
        </button>
      )}

      {waiting > 0 && (
        <button className="overflow" onClick={onInbox}>
          {waiting} more waiting. They'll come up when there's room.
        </button>
      )}

      {lightDay && <LightDay task={lightDay} onPin={() => update((s) => pin(s, lightDay.id, today, Date.now()))} onDecline={() => defer(lightDay.id)} />}
    </>
  );
}

const title = (r: TodayRow) => r.chunk?.title ?? r.task.title;

// Open the popover beside its button, flipping above it near the bottom of the screen.
function placeBelow(button: HTMLElement, id: string) {
  const r = button.getBoundingClientRect();
  const el = document.getElementById(id)!.style;
  el.right = `${innerWidth - r.right}px`;
  const below = r.bottom + 120 < innerHeight;
  el.top = below ? `${r.bottom + 4}px` : "auto";
  el.bottom = below ? "auto" : `${innerHeight - r.top + 4}px`;
}

function RowMenu({ id, label, onNotToday, onOpen }: { id: string; label: string; onNotToday: () => void; onOpen: () => void }) {
  const close = (fn: () => void) => () => {
    document.getElementById(id)?.hidePopover();
    fn();
  };
  return (
    <>
      <button className="icon-button" popoverTarget={id} aria-label={`More actions for ${label}`} onClick={(e) => placeBelow(e.currentTarget, id)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      <div id={id} popover="auto" className="menu row-menu">
        <button onClick={close(onNotToday)}>Not today</button>
        <button onClick={close(onOpen)}>Open task</button>
      </div>
    </>
  );
}

function LightDay({ task, onPin, onDecline }: { task: Task; onPin: () => void; onDecline: () => void }) {
  return (
    <section className="card" aria-label="Light day">
      <p>Light day. Want to get ahead on {task.title}?</p>
      <div className="actions card-actions">
        <button className="button" onClick={onPin}>
          Pin to today
        </button>
        <button className="button" onClick={onDecline}>
          Not today
        </button>
      </div>
    </section>
  );
}
