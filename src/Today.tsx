import { useEffect, useState } from "react";
import { tick } from "../core/chunk";
import { band, confirmDay, isConfirmed, notToday, wasDueLabel as wasDue, type Today, type TodayRow } from "../core/today";
import { Ring } from "./Reward";
import { Cat } from "./Cat";
import { catPose } from "../core/cat";
import { closeMenu, toggleMenu } from "./menu";
import { refocus } from "./refocus";
import { pin, type State, type Task } from "../core/task";

interface Props {
  plan: Today;
  state: State;
  update: (fn: (s: State) => State) => void;
  today: string;
  selectedId?: string; // desktop: the task showing on the right
  onOpenTask: (t: Task) => void;
  onStart: (r: TodayRow) => void;
  onInbox: () => void;
  welcome: boolean; // first open after 3+ days away
  firstOpen: boolean; // the first open of this day: the cat starts asleep
  onWelcomeDone: () => void;
  onReset: () => void;
  backedUp: boolean;
}

// How long the cat sleeps on the day's first open before it wakes and starts watching (UX_Flows.md §6).
const WAKE_MS = 1500;
// The day the cat last woke in this page load, so going Inbox then Today does not put it back to sleep.
let wokeOn: string | null = null;

// The cat's pose for the nook (UX_Flows.md §6). It wakes a moment after the day's first open; on the lapse return it
// sits by the door until the first tap or key press after the welcome back.
function useNookCat(today: string, shutdownDone: boolean, firstOpen: boolean, welcome: boolean) {
  const [woken, setWoken] = useState(wokeOn === today);
  const [tapped, setTapped] = useState(false);
  useEffect(() => {
    if (!firstOpen || woken) return;
    const t = setTimeout(() => {
      wokeOn = today;
      setWoken(true);
    }, WAKE_MS);
    return () => clearTimeout(t);
  }, [firstOpen, woken, today]);
  useEffect(() => {
    if (!welcome || tapped) return;
    const done = () => setTapped(true);
    document.addEventListener("pointerdown", done, { once: true });
    document.addEventListener("keydown", done, { once: true });
    return () => {
      document.removeEventListener("pointerdown", done);
      document.removeEventListener("keydown", done);
    };
  }, [welcome, tapped]);
  return catPose({ screen: "today", shutdownDone, firstOpen: firstOpen && !woken, lapseReturn: welcome && !tapped });
}

// Wireframes.md §1.
export function TodayView({ plan, state, update, today, selectedId, onOpenTask, onStart, onInbox, welcome, firstOpen, onWelcomeDone, onReset, backedUp }: Props) {
  const { rows, frog, waiting, lightDay } = plan;
  // The morning confirm shows on the day's first visit to Today and never returns that day, answered or not.
  // On a lapse return the welcome back takes its place.
  const [confirming, setConfirming] = useState(() => !isConfirmed(state, today) && rows.length > 0 && !welcome);
  const [adjusting, setAdjusting] = useState(false);
  useEffect(() => {
    if (confirming || welcome) update((s) => confirmDay(s, today, Date.now()));
  }, [confirming, welcome, today, update]);
  const pose = useNookCat(today, !!state.days.find((d) => d.day === today)?.shutdown_at, firstOpen, welcome);
  const slipped = plan.ranked.some((t) => band(t, today) === "overdue");

  // The row goes: focus moves to the next row (or the one above), else the heading.
  const defer = (key: string) => {
    const li = document.querySelector(`[data-row="${CSS.escape(key)}"]`);
    const near = li?.nextElementSibling ?? li?.previousElementSibling;
    update((s) => notToday(s, today, key));
    refocus(() => near?.querySelector<HTMLElement>(".row-link") ?? document.querySelector<HTMLElement>("h1"));
  };
  // A card with its buttons goes: focus moves to the frog's Do this first, else the heading.
  const cardGone = () => refocus(() => document.querySelector<HTMLElement>(".frog .primary") ?? document.querySelector<HTMLElement>("h1"));
  const rest = rows.filter((r) => r !== frog);
  const open = rest.filter((r) => !r.done);
  const done = rest.filter((r) => r.done);

  if (rows.length === 0) {
    // Inbox is only worth a button when it holds something: tasks to sort, or ranked ones waiting for room.
    const inboxHasTasks = plan.ranked.length > 0 || state.tasks.some((t) => t.state === "inbox");
    return (
      <section className="section">
        {/* The nook with the resting cat, as on a full day; the capture bar below is the way to add something. */}
        <div className="nook" data-pose={pose}>
          <Cat pose={pose} size={pose === "door" ? 92 : 72} />
          <p className="lead">Nothing's lined up for today yet.</p>
        </div>
        {/* The landing disclosure from phase 2 on (UX_Flows.md §7). */}
        {backedUp && <p className="hint">Your list is backed up, so it won't get lost.</p>}
        {inboxHasTasks && (
          <div className="actions">
            <button className="button primary" onClick={onInbox}>
              Sort a few from Inbox
            </button>
          </div>
        )}
        {lightDay && <LightDay task={lightDay} onPin={() => update((s) => pin(s, lightDay.id, today, Date.now()))} onDecline={() => defer(lightDay.id)} />}
      </section>
    );
  }

  const row = (r: TodayRow) => {
    // A smaller step names its parent; an overdue task shows its date (Wireframes.md §1).
    const second = r.parent?.title ?? (band(r.task, today) === "overdue" && r.task.deadline ? wasDue(r.task.deadline, today) : null);
    return (
      <li key={r.key} data-row={r.key} className={`row today-row${r.done ? " done" : ""}${r.task.id === selectedId ? " selected" : ""}`}>
        {r.chunk ? (
          <label className="check">
            <input type="checkbox" checked={r.done} aria-label={title(r)} onChange={(e) => update((s) => tick(s, r.chunk!.id, e.target.checked, Date.now()))} />
          </label>
        ) : (
          <span className="check" aria-hidden="true" />
        )}
        <button className="row-link" aria-current={r.task.id === selectedId ? "true" : undefined} onClick={() => onOpenTask(r.task)}>
          <span>{title(r)}</span>
          {second && <span className="meta">{second}</span>}
        </button>
        {/* A row is a checkbox and a title (EMB-UX-6): Start and Not today live in its "..." menu, so a calm list stays calm. */}
        {!r.done &&
          (adjusting ? (
            <button className="text-button" onClick={() => defer(r.key)} aria-label={`Not today: ${title(r)}`}>
              Not today
            </button>
          ) : (
            <RowMenu id={`row-${r.key}`} label={title(r)} onStart={() => onStart(r)} onNotToday={() => defer(r.key)} onOpen={() => onOpenTask(r.task)} />
          ))}
      </li>
    );
  };

  const doneCount = rows.filter((r) => r.done).length;
  return (
    <>
      {/* The nook (Design_Direction.md §4). Visible count is hidden from screen readers; the ring's label carries it (A4). */}
      <section className="nook" data-pose={pose} aria-label="Progress">
        {/* The window scene fills the nook's height on the lapse return; the cat stands 72 px otherwise */}
        <Cat pose={pose} size={pose === "door" ? 92 : 72} />
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
                    cardGone();
                  }}
                >
                  Reset them
                </button>
                <button
                  className="button"
                  onClick={() => {
                    onWelcomeDone();
                    cardGone();
                  }}
                >
                  Leave them
                </button>
              </div>
            </>
          )}
        </section>
      )}
      {confirming && (
        // A strip, not a card (EMB-UX-5): it was 125 px between the cat and the frog's button. Same words; text buttons, so the
        // frog's Start stays the view's one primary (restraint rule 2).
        <section className="strip" aria-label="Morning confirm">
          <p>
            Here's today: {rows.length} {rows.length === 1 ? "thing" : "things"}. Good to go?
          </p>
          <button
            className="text-button"
            onClick={() => {
              setConfirming(false);
              cardGone();
            }}
          >
            Let's go
          </button>
          <button
            className="text-button"
            onClick={() => {
              setConfirming(false);
              setAdjusting(true);
              cardGone();
            }}
          >
            Adjust
          </button>
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
          <button className="row-link lead" aria-current={frog.task.id === selectedId ? "true" : undefined} onClick={() => onOpenTask(frog.task)}>
            {title(frog)}
          </button>
          {frog.chunk && <p className="meta">from: {[frog.task.title, frog.parent?.title].filter(Boolean).join(" · ")}</p>}
          {frog.task.deadline && band(frog.task, today) === "overdue" && <p className="meta">{wasDue(frog.task.deadline, today)}</p>}
          <div className="actions card-actions">
            {/* The view's one primary, until a session is running (on desktop it sits beside Focus, whose Pause is the primary then).
                Named for what it does, like the Task view's: the label above it already says "Do this first" (EMB-UX-4). */}
            <button className={`button${state.focus ? "" : " primary"} icon-label`} onClick={() => onStart(frog)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5l11 7-11 7z" />
              </svg>
              Start
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
  const below = r.bottom + 160 < innerHeight; // three items: about 150 px
  el.top = below ? `${r.bottom + 4}px` : "auto";
  el.bottom = below ? "auto" : `${innerHeight - r.top + 4}px`;
}

function RowMenu({ id, label, onStart, onNotToday, onOpen }: { id: string; label: string; onStart: () => void; onNotToday: () => void; onOpen: () => void }) {
  const close = (fn: () => void) => () => {
    closeMenu(document.getElementById(id));
    fn();
  };
  return (
    <>
      <button className="icon-button" popoverTarget={id} aria-label={`More actions for ${label}`} onClick={(e) => {
          placeBelow(e.currentTarget, id);
          toggleMenu(id);
        }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      <div id={id} popover="auto" className="menu row-menu">
        <button onClick={close(onStart)}>Start</button>
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
