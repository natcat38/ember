import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { capture, pin, remove, rename, restore, triage, type CaptureInput, type State, type Task } from "../core/task";
import { addDays, buildToday, doneTodayCount, isLapse, resetOverdue, wrapUp } from "../core/today";
import { RewardView } from "./Reward";
import { ShutdownView } from "./Shutdown";
import { TodayView } from "./Today";
import { dayOf } from "../core/day";
import { KEY, load, save } from "./store";
import { CaptureForm, formatDue } from "./Capture";
import { TaskView } from "./TaskView";
import { closeOnBackdrop, TextDialog } from "./dialogs";
import { FocusView } from "./Focus";
import { sessionsDone, startFocus } from "../core/focus";
import { addChunk, firstOpenLeaf } from "../core/chunk";

type View =
  | { name: "today" | "inbox" | "focus" | "shutdown" }
  | { name: "reward"; title: string }
  | { name: "task"; id: string; from: "today" | "inbox" };

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

const wideQuery = window.matchMedia("(min-width: 768px)");
const useWide = () =>
  useSyncExternalStore(
    (cb) => (wideQuery.addEventListener("change", cb), () => wideQuery.removeEventListener("change", cb)),
    () => wideQuery.matches,
  );

export function App() {
  // Stamp this visit as part of loading, so opening the app saves once; the lapse check reads the visit before it.
  const [boot] = useState(() => load());
  const [state, setState] = useState<State>(() => ({ ...boot, last_seen_at: Date.now() }));
  const [saved, setSaved] = useState(true);
  // Reopening the app mid-session goes straight back to Focus; the timer kept running on the wall clock.
  const [view, setView] = useState<View>(() => ({ name: state.focus ? "focus" : "today" }));
  const [askFor, setAskFor] = useState<Task | null>(null);
  const nextAction = useRef<HTMLDialogElement>(null);
  const [sent, setSent] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [status, setStatus] = useState("");
  const statusTimer = useRef(0);
  const sheet = useRef<HTMLDialogElement>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const wide = useWide();
  const today = dayOf(Date.now(), tz);
  const plan = buildToday(state, today, { tz, sessionsDone: sessionsDone(state) });

  // Re-render each minute so an app left open rolls over to the new day at the boundary.
  const [minute, setMinute] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setMinute((m) => m + 1), 60_000);
    return () => clearInterval(i);
  }, []);

  // The lapse return (Product_Scope.md §2) is decided once, from the last visit before this open.
  const [welcome, setWelcome] = useState(() => isLapse(boot.last_seen_at, Date.now(), tz));
  useEffect(() => {
    if (minute) setState((s) => ({ ...s, last_seen_at: Date.now() })); // an app left open is still being seen
  }, [minute]);

  useEffect(() => setSaved(save(state)), [state]);

  // The ring moving is announced through the live region (Wireframes.md, accessibility targets).
  const doneCount = plan.rows.filter((r) => r.done).length;
  const prevDone = useRef(doneCount);
  useEffect(() => {
    if (doneCount > prevDone.current) announce(`${doneCount} of ${plan.rows.length} done today`);
    prevDone.current = doneCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the count moves
  }, [doneCount]);

  // Another tab saved: take its version, so this tab never writes stale data over it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === KEY && setState(load());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Status messages go through one polite live region and never move focus (Design_Direction.md §6).
  function announce(text: string) {
    setStatus("");
    clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => {
      setStatus(text);
      statusTimer.current = window.setTimeout(() => setStatus(""), 5000);
    }, 50);
  }

  function navigate(v: View) {
    if (v.name !== "today") setWelcome(false); // the welcome back is offered once
    setView(v);
    window.scrollTo(0, 0);
    // Move focus to the new screen's heading so keyboard and screen-reader users land on it.
    requestAnimationFrame(() => document.querySelector<HTMLElement>("h1")?.focus());
  }

  function send(input: CaptureInput) {
    setState((s) => capture(s, input, Date.now(), today));
    setSent((list) => [...list, input.title.trim()]);
    announce("Added");
  }

  function openCapture() {
    if (wide) return document.querySelector<HTMLInputElement>(".capture-inline .field")!.focus();
    setSent([]);
    setSheetOpen(true);
    sheet.current!.showModal();
    // Focus inside the tap itself, or iOS won't raise the keyboard.
    sheet.current!.querySelector<HTMLInputElement>(".field")!.focus();
  }

  // Focus on one step. A task with no open step asks for the next action first, then starts (UX_Flows.md §3.3).
  function start(chunkId: string) {
    setState((s) => startFocus(s, chunkId, Date.now()));
    navigate({ name: "focus" });
  }
  function startTask(t: Task) {
    const leaf = firstOpenLeaf(state, t.id);
    if (leaf) return start(leaf.id);
    setAskFor(t);
    nextAction.current!.showModal();
  }

  const task = view.name === "task" ? state.tasks.find((t) => t.id === view.id) : undefined;
  if (view.name === "task" && !task) setView({ name: view.from }); // e.g. removed from another tab
  if (view.name === "focus" && !state.focus) setView({ name: "today" }); // e.g. ended in another tab
  const focusChunk = state.focus && state.chunks.find((c) => c.id === state.focus!.chunk_id);

  const form = (
    <CaptureForm
      draft={state.draft}
      onDraft={(draft) => setState((s) => ({ ...s, draft }))}
      onSend={send}
      today={today}
      showHint={!state.tasks.some((t) => t.state === "inbox")}
    />
  );

  const open = (t: Task) => (view.name === "today" || view.name === "inbox") && navigate({ name: "task", id: t.id, from: view.name });

  return (
    <div className="app">
      {view.name === "reward" ? (
        <main className="main">
          <RewardView
            title={view.title}
            done={doneCount}
            total={plan.rows.length}
            hasNext={plan.rows.some((r) => !r.done)}
            onNext={() => {
              const r = plan.rows.find((x) => !x.done)!;
              if (r.chunk) start(r.chunk.id);
              else startTask(r.task);
            }}
            onToday={() => navigate({ name: "today" })}
          />
        </main>
      ) : view.name === "shutdown" ? (
        <main className="main">
          <ShutdownView
            state={state}
            update={setState}
            today={today}
            tomorrow={buildToday(state, addDays(today, 1), { tz, sessionsDone: sessionsDone(state) })}
            doneToday={doneTodayCount(state, today, tz)}
            onClose={() => {
              setState((s) => wrapUp(s, today, Date.now()));
              navigate({ name: "today" });
            }}
          />
        </main>
      ) : view.name === "task" && task ? (
        <TaskView
          key={task.id}
          task={task}
          state={state}
          update={setState}
          today={today}
          inToday={plan.rows.some((r) => r.task.id === task.id)}
          onPin={() => setState((s) => pin(s, task.id, today, Date.now()))}
          onStart={() => startTask(task)}
          onStartStep={start}
          onBack={() => navigate({ name: view.from })}
          onTriage={(answers) => setState((s) => triage(s, task.id, answers, Date.now(), today))}
          onRename={(title) => setState((s) => rename(s, task.id, title, Date.now()))}
          onRemove={() => {
            setState((s) => remove(s, task.id, Date.now()));
            navigate({ name: view.from });
            announce("Moved out of the way. It's still here if you want it back.");
          }}
        />
      ) : (
        <>
          <header className={`header${view.name === "focus" ? " dimmed" : ""}`}>
            <button className="icon-button" aria-label="Open menu" onClick={() => drawer.current!.showModal()}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            {view.name === "focus" ? (
              <span className="title">Today</span>
            ) : (
              <h1 className="title" tabIndex={-1}>
                {view.name === "today" ? "Today" : "Inbox"}
              </h1>
            )}
          </header>
          {/* Peeking away mid-session: one tap returns to the running timer. */}
          {state.focus && view.name !== "focus" && focusChunk && (
            <div className="return-bar">
              <span>Focusing on {focusChunk.title}</span>
              <button className="text-button" onClick={() => navigate({ name: "focus" })}>
                Back to focus
              </button>
            </div>
          )}
          {wide && <div className="capture-inline">{form}</div>}
          <main className={`main${view.name === "focus" ? " focus-main" : ""}`}>
            {view.name === "focus" && state.focus ? (
              <FocusView
                state={state}
                update={setState}
                announce={announce}
                onFinished={(title) => navigate({ name: "reward", title })}
                onStopped={() => navigate({ name: "today" })}
              />
            ) : view.name === "today" ? (
              <TodayView
                key={today} // a new day remounts it, so its morning confirm and Adjust mode start fresh
                plan={plan}
                state={state}
                update={setState}
                today={today}
                onOpenTask={open}
                onStart={(r) => (r.chunk ? start(r.chunk.id) : startTask(r.task))}
                onInbox={() => navigate({ name: "inbox" })}
                onCapture={openCapture}
                welcome={welcome}
                onWelcomeDone={() => setWelcome(false)}
                onReset={() => setState((s) => resetOverdue(s, today, Date.now()))}
              />
            ) : (
              <Inbox
                tasks={state.tasks}
                waiting={plan.ranked.filter((t) => !plan.rows.some((r) => r.task.id === t.id))}
                onOpen={open}
                onRestore={(t) => {
                  setState((s) => restore(s, t.id, Date.now()));
                  announce("Back on your list.");
                }}
              />
            )}
          </main>
          {!wide && (
            <div className={`capture-bar${view.name === "focus" ? " dimmed" : ""}`}>
              <button onClick={openCapture}>{state.draft || "What's on your mind?"}</button>
            </div>
          )}
        </>
      )}

      {/* ponytail: copy not yet in Design_Direction §6; needs Natalie's approval. */}
      {!saved && <p className="status-line">This device isn't saving right now. Keep Ember open so nothing is lost.</p>}
      {/* The open sheet makes the page inert, which mutes a live region outside it, so the sheet carries its own. */}
      <p className="status-line status" aria-live="polite">
        {sheetOpen ? "" : status}
      </p>

      <dialog ref={sheet} className="sheet" aria-label="Capture" onClick={closeOnBackdrop} onClose={() => setSheetOpen(false)}>
        <div className="sheet-body capture-form">
          <button className="text-button" style={{ alignSelf: "flex-start" }} onClick={() => sheet.current!.close()}>
            Close
          </button>
          {sent.length > 0 && (
            <ul className="sent" aria-label="Added just now">
              {sent.map((title, i) => (
                <li key={i}>{title}</li>
              ))}
            </ul>
          )}
          {form}
          <p className="sr-only" aria-live="polite">
            {sheetOpen ? status : ""}
          </p>
        </div>
      </dialog>

      <TextDialog
        dialog={nextAction}
        label="What's the very next physical action?"
        placeholder="Type one step"
        confirm="Start"
        onSave={(title) => {
          if (!askFor || !title.trim()) return;
          const id = crypto.randomUUID();
          const now = Date.now();
          setState((s) => startFocus(addChunk(s, askFor.id, title, null, now, () => id), id, now));
          navigate({ name: "focus" });
        }}
      />

      <dialog ref={drawer} className="drawer" aria-label="Menu" onClick={closeOnBackdrop}>
        <nav>
          <p className="brand">Ember</p>
          {(["today", "inbox"] as const).map((v) => (
            <button
              key={v}
              className="nav-item"
              aria-current={view.name === v ? "page" : undefined}
              onClick={() => {
                drawer.current!.close();
                navigate({ name: v });
              }}
            >
              {v === "today" ? "Today" : "Inbox"}
            </button>
          ))}
          <button
            className="nav-item wrap-up"
            onClick={() => {
              drawer.current!.close();
              navigate({ name: "shutdown" });
            }}
          >
            Wrap up the day
          </button>
        </nav>
      </dialog>
    </div>
  );
}

function Inbox({ tasks, waiting, onOpen, onRestore }: { tasks: Task[]; waiting: Task[]; onOpen: (t: Task) => void; onRestore: (t: Task) => void }) {
  const [showRemoved, setShowRemoved] = useState(false);
  const needsSorting = tasks.filter((t) => t.state === "inbox").sort((a, b) => b.created_at - a.created_at);
  const removed = tasks.filter((t) => t.state === "removed").sort((a, b) => b.updated_at - a.updated_at);

  return (
    <>
      {needsSorting.length + waiting.length === 0 && <p className="empty">Nothing waiting here.</p>}
      <TaskList id="h-sort" heading="Needs sorting" tasks={needsSorting} onOpen={onOpen} />
      <TaskList id="h-wait" heading="Waiting" tasks={waiting} onOpen={onOpen} />
      {removed.length > 0 && (
        <section className="section">
          <button className="text-button disclosure" aria-expanded={showRemoved} onClick={() => setShowRemoved(!showRemoved)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
            Removed
          </button>
          {showRemoved && (
            <ul className="list" aria-label="Removed">
              {removed.map((t) => (
                <li key={t.id} className="row">
                  <span>{t.title}</span>
                  <button className="button" aria-label={`Restore ${t.title}`} onClick={() => onRestore(t)}>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

function TaskList({ id, heading, tasks, onOpen }: { id: string; heading: string; tasks: Task[]; onOpen: (t: Task) => void }) {
  if (tasks.length === 0) return null;
  return (
    <section className="section" aria-labelledby={id}>
      <h2 id={id}>{heading}</h2>
      <ul className="list">
        {tasks.map((t) => (
          <li key={t.id}>
            <button className="row row-button" onClick={() => onOpen(t)}>
              <span>{t.title}</span>
              {t.deadline && <span className="meta">{formatDue(t.deadline)}</span>}
              {t.size && <span className="size-tag">{t.size}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
