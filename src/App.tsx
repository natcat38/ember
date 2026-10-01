import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { capture, remove, rename, restore, triage, type CaptureInput, type State, type Task } from "../core/task";
import { dayOf } from "../core/day";
import { KEY, load, save } from "./store";
import { CaptureForm, formatDue } from "./Capture";
import { TaskView } from "./TaskView";
import { closeOnBackdrop } from "./dialogs";

type View = { name: "today" | "inbox" } | { name: "task"; id: string; from: "today" | "inbox" };

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

const wideQuery = window.matchMedia("(min-width: 768px)");
const useWide = () =>
  useSyncExternalStore(
    (cb) => (wideQuery.addEventListener("change", cb), () => wideQuery.removeEventListener("change", cb)),
    () => wideQuery.matches,
  );

export function App() {
  const [state, setState] = useState<State>(() => load());
  const [saved, setSaved] = useState(true);
  const [view, setView] = useState<View>({ name: "today" });
  const [sent, setSent] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [status, setStatus] = useState("");
  const statusTimer = useRef(0);
  const sheet = useRef<HTMLDialogElement>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const wide = useWide();
  const today = dayOf(Date.now(), tz);

  useEffect(() => setSaved(save(state)), [state]);

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

  const task = view.name === "task" ? state.tasks.find((t) => t.id === view.id) : undefined;
  if (view.name === "task" && !task) setView({ name: view.from }); // e.g. removed from another tab

  const form = (
    <CaptureForm
      draft={state.draft}
      onDraft={(draft) => setState((s) => ({ ...s, draft }))}
      onSend={send}
      today={today}
      showHint={!state.tasks.some((t) => t.state === "inbox")}
    />
  );

  const open = (t: Task) => view.name !== "task" && navigate({ name: "task", id: t.id, from: view.name });

  return (
    <div className="app">
      {view.name === "task" && task ? (
        <TaskView
          key={task.id}
          task={task}
          state={state}
          update={setState}
          today={today}
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
          <header className="header">
            <button className="icon-button" aria-label="Open menu" onClick={() => drawer.current!.showModal()}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <h1 className="title" tabIndex={-1}>
              {view.name === "today" ? "Today" : "Inbox"}
            </h1>
          </header>
          {wide && <div className="capture-inline">{form}</div>}
          <main className="main">
            {view.name === "today" ? (
              <section className="section">
                <p className="empty">Nothing's lined up for today yet.</p>
                <div className="actions">
                  <button className="button primary" onClick={() => navigate({ name: "inbox" })}>
                    Sort a few from Inbox
                  </button>
                  <button className="button" onClick={openCapture}>
                    Capture something
                  </button>
                </div>
              </section>
            ) : (
              <Inbox
                tasks={state.tasks}
                onOpen={open}
                onRestore={(t) => {
                  setState((s) => restore(s, t.id, Date.now()));
                  announce("Back on your list.");
                }}
              />
            )}
          </main>
          {!wide && (
            <div className="capture-bar">
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
        </nav>
      </dialog>
    </div>
  );
}

function Inbox({ tasks, onOpen, onRestore }: { tasks: Task[]; onOpen: (t: Task) => void; onRestore: (t: Task) => void }) {
  const [showRemoved, setShowRemoved] = useState(false);
  const needsSorting = tasks.filter((t) => t.state === "inbox").sort((a, b) => b.created_at - a.created_at);
  // ponytail: soonest deadline first until slice 4 brings the real rank order.
  const waiting = tasks
    .filter((t) => t.state === "active" || t.state === "overdue")
    .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || a.created_at - b.created_at);
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
