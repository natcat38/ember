import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { capture, pin, remove, rename, restore, triage, withZone, type CaptureInput, type State, type Task } from "../core/task";
import { addDays, buildToday, doneTodayCount, isLapse, resetOverdue, slotsFor, wrapUp } from "../core/today";
import { SettingsView } from "./Settings";
import { Onboarding } from "./Onboarding";
import { createSync, type SyncStatus } from "./sync";
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
import { AnnounceContext } from "./announce";
import { ArrivalLine } from "./Arrival";
import { arrivalFrom, snoozeTomorrow } from "./push";

type View =
  | { name: "today" | "inbox" | "focus" | "shutdown" | "settings" }
  | { name: "reward"; title: string; fromFocus: boolean } // fromFocus: the unlock card follows steps finished in Focus only (UX_Flows.md §3.6)
  | { name: "task"; id: string; from: "today" | "inbox"; pickDate?: boolean };

const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

// The phone's back gesture (UX_Flows.md §2) does what the visible Back does. Each history entry carries the stack of
// screens open over Today, so a reload or a jump through history still knows what is open. Today is the root and gets no
// entry; Focus, Reward and Shutdown get none either, because they have no way back mid-flow.
const hasEntry = (v: View) => v.name === "inbox" || v.name === "settings" || v.name === "task";
const sameScreen = (a: View, b: View) => a.name === b.name && (a.name !== "task" || a.id === (b as typeof a).id);
const savedStack = (): View[] => history.state?.stack ?? [];
const topOf = (stack: View[]): View => stack.at(-1) ?? { name: "today" };

const useMedia = (query: MediaQueryList) =>
  useSyncExternalStore(
    (cb) => (query.addEventListener("change", cb), () => query.removeEventListener("change", cb)),
    () => query.matches,
  );
const wideQuery = window.matchMedia("(min-width: 768px)");
// Two 560 px columns (Design_Direction.md §3). The same width is in styles.css, in the one media query that lays the panes out.
const twoPaneQuery = window.matchMedia("(min-width: 1180px)");

type Pane = "left" | "right";
type Screen = "today" | "inbox" | "settings";
const titleOf: Record<Screen, string> = { today: "Today", inbox: "Inbox", settings: "Settings" };
const isScreen = (v: View): v is { name: Screen } => v.name === "today" || v.name === "inbox" || v.name === "settings";
// The pane whose content a move changes, on two panes. Focus, Reward and Task live on the right; ending a session or
// leaving Reward lands on Today, which changes the right pane (the left one was already Today).
const paneOf = (to: View, from: View): Pane => (to.name === "today" ? (from.name === "focus" || from.name === "reward" || from.name === "task" ? "right" : "left") : isScreen(to) ? "left" : "right");

export function App() {
  // Stamp this visit as part of loading, so opening the app saves once; the lapse check reads the visit before it.
  const [boot] = useState(() => load());
  const [state, setState] = useState<State>(() => withZone({ ...boot, last_seen_at: Date.now() }, browserTz));
  const [saved, setSaved] = useState(true);
  // Phase 2 backup and sync (Tech_Scope.md §5): every state change becomes ops in an outbox the server applies once.
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ backedUp: false, pending: 0, offline: false });
  // From `boot`, not `state`: a zone withZone just filled in then reaches the server as an ordinary settings op.
  const [sync] = useState(() =>
    createSync(boot, {
      update: setState,
      onStatus: setSyncStatus,
      onRejected: () => announce("This changed on another device, so you're seeing the latest version."),
    }),
  );
  // Reopening the app mid-session goes straight back to Focus; the timer kept running on the wall clock.
  const [view, setView] = useState<View>(() => ({ name: state.focus ? "focus" : "today" }));
  // A reload still opens on Today, but the history entries it landed on are real, so the stack starts from them.
  const stack = useRef<View[]>(savedStack());
  const skipPops = useRef(0); // popstates we caused ourselves with history.go()
  // Focus, Reward and Shutdown are left by their own buttons, never by the gesture.
  const locked = useRef(false);
  const [askFor, setAskFor] = useState<Task | null>(null);
  // First run (UX_Flows.md §7): nothing on this device, never synced, and not arriving from a Telegram sign-in link.
  const [onboarding, setOnboarding] = useState(() => {
    let synced = false;
    try {
      synced = !!localStorage.getItem("ember.sync");
    } catch {
      // storage unavailable: treat as a first run
    }
    return !boot.onboarded && boot.tasks.length === 0 && !synced && !new URLSearchParams(location.search).has("h");
  });
  // Opened from a web push tap (public/sw.js adds the marker): Today or that task shows "Not now? Snooze" until it's used.
  const [arrival, setArrival] = useState(() => arrivalFrom(location.search));
  const nextAction = useRef<HTMLDialogElement>(null);
  const [sent, setSent] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [status, setStatus] = useState("");
  const statusTimer = useRef(0);
  const sheet = useRef<HTMLDialogElement>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const wide = useMedia(wideQuery);
  // Today and Focus side by side (UX_Flows.md §2 "Desktop delta", Wireframes.md §10). Onboarding and the evening close
  // stay one centred column. Below the breakpoint nothing here applies.
  const [selected, setSelected] = useState<string | null>(null); // the right pane's task; null follows the frog
  const leftScreen = useRef<Screen>("today"); // the left pane keeps its screen while Focus, Reward or a task fill the right
  const paneNow = useRef(false);
  const viewNow = useRef(view);
  // The user's time zone and quiet hours set the day boundary (§4.1); hard blocks set the day's capacity (§4.4).
  const tz = state.settings.tz ?? browserTz;
  const quietEndMin = state.settings.quiet_end;
  const today = dayOf(Date.now(), tz, quietEndMin);
  const build = (day: string) => buildToday(state, day, { tz, quietEndMin, sessionsDone: sessionsDone(state), slots: slotsFor(state, day) });
  const plan = build(today);

  // Re-render each minute so an app left open rolls over to the new day at the boundary.
  const [minute, setMinute] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setMinute((m) => m + 1), 60_000);
    return () => clearInterval(i);
  }, []);

  // The lapse return (Product_Scope.md §2) is decided once, from the last visit before this open.
  const [welcome, setWelcome] = useState(() => isLapse(boot.last_seen_at, Date.now(), boot.settings.tz ?? browserTz, boot.settings.quiet_end));
  // The cat sleeps until it has woken on the day's first open (UX_Flows.md §6): the last visit before this open was on an earlier day.
  const [lastVisitDay] = useState(() => (boot.last_seen_at ? dayOf(boot.last_seen_at, boot.settings.tz ?? browserTz, boot.settings.quiet_end) : null));
  useEffect(() => {
    if (minute) setState((s) => ({ ...s, last_seen_at: Date.now() })); // an app left open is still being seen
  }, [minute]);

  useEffect(() => setSaved(save(state)), [state]);
  useEffect(() => sync.record(state), [state, sync]);

  // Sync on open, on coming back to the app, and on reconnecting (§5 "When").
  useEffect(() => {
    // A Telegram link button carries a sign-in code (Tech_Scope.md §6). Redeem it before the first sync, so this
    // browser joins the user's list instead of starting a new one, then open the task the button points at.
    const q = new URLSearchParams(location.search);
    const code = q.get("h");
    const taskId = q.get("t");
    const pickDate = q.get("pick") === "1"; // Telegram's Reschedule → Pick a date
    if (code || taskId || q.has("via")) history.replaceState(history.state, "", location.pathname); // keep the entry's screen stack
    const joined = code
      ? fetch("/api/handoff/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ code, s: q.get("s") }),
        })
          .then((r) => r.ok && sync.restart())
          .catch(() => {}) // offline or expired: carry on as this browser's own list
      : Promise.resolve();
    void joined
      .then(() => sync.push())
      .then(() => taskId && navigate({ name: "task", id: taskId, from: "today", pickDate }));
    const wake = () => document.visibilityState === "visible" && void sync.push();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [sync]);

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
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      const theirs = load();
      sync.rebase(theirs); // the other tab syncs its own changes
      setState(theirs);
    };
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

  // Keep the browser history in step with an in-app move: a screen with an entry is pushed; going to a screen already in
  // the stack (the visible Back, or Today) unwinds to it, so the gesture never revisits a screen the app left.
  function syncHistory(v: View) {
    const open = stack.current;
    const last = open.map((e) => sameScreen(e, v)).lastIndexOf(true);
    if (v.name === "today" || last >= 0) {
      const keep = v.name === "today" ? 0 : last + 1; // entries to keep
      if (keep < open.length) {
        skipPops.current++;
        history.go(keep - open.length);
        stack.current = open.slice(0, keep);
      }
    } else if (hasEntry(v)) {
      stack.current = [...open, v];
      history.pushState({ stack: stack.current }, "");
    }
  }

  // The system back: show the screen the entry it landed on stands for. Not while a flow with no way back is running.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (skipPops.current) return void skipPops.current--;
      stack.current = e.state?.stack ?? [];
      if (!locked.current) show(topOf(stack.current));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function navigate(v: View, pane?: Pane) {
    syncHistory(v);
    show(v, pane);
  }

  function show(v: View, pane?: Pane) {
    if (v.name !== "today") setWelcome(false); // the welcome back is offered once
    setView(v);
    window.scrollTo(0, 0);
    moveFocus(pane ?? paneOf(v, viewNow.current));
  }

  // Move focus to the new content's heading so keyboard and screen-reader users land on it, unless they have
  // already moved on (say, started typing in a field) before the frame came round: never steal focus. On two panes the
  // heading is the changed pane's, and that pane scrolls back to its top.
  function moveFocus(pane: Pane) {
    const before = document.activeElement;
    requestAnimationFrame(() => {
      const el = paneNow.current ? document.querySelector<HTMLElement>(`[data-pane="${pane}"]`) : null;
      el?.scrollTo(0, 0);
      const now = document.activeElement;
      if (!now || now === before || now === document.body) (el ?? document).querySelector<HTMLElement>("h1")?.focus();
    });
  }

  // Desktop: a Today row shows its task on the right instead of navigating away, so it needs no history entry. A task
  // opened by a link or kept across a resize is a View; leave it, so the left pane and the stack are in step again.
  function select(t: Task) {
    setSelected(t.id);
    if (view.name === "task") {
      syncHistory({ name: view.from });
      setView({ name: view.from });
    }
    moveFocus("right");
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

  locked.current = onboarding || view.name === "focus" || view.name === "reward" || view.name === "shutdown";
  const task = view.name === "task" ? state.tasks.find((t) => t.id === view.id) : undefined;
  if (view.name === "task" && !task) setView({ name: view.from }); // e.g. removed from another tab
  if (view.name === "focus" && !state.focus) setView({ name: "today" }); // e.g. ended in another tab
  const focusChunk = state.focus && state.chunks.find((c) => c.id === state.focus!.chunk_id);

  const twoPane = useMedia(twoPaneQuery) && !onboarding && view.name !== "shutdown";
  paneNow.current = twoPane;
  viewNow.current = view;
  if (isScreen(view)) leftScreen.current = view.name;
  else if (view.name === "task") leftScreen.current = view.from;
  if (twoPane && view.name === "task" && selected !== view.id) setSelected(view.id);
  // Right pane, never empty: the running session (or its Reward), else the chosen task, else the frog's.
  const rightTask = state.tasks.find((t) => t.id === selected && t.state !== "removed") ?? plan.frog?.task;
  const right = view.name === "reward" ? "reward" : state.focus ? "focus" : "task";

  const arrivalTask = arrival?.task ? state.tasks.find((t) => t.id === arrival.task) : undefined;
  const showArrival = !!arrivalTask && (arrivalTask.state === "active" || arrivalTask.state === "overdue") && (view.name === "today" || (view.name === "task" && view.id === arrivalTask.id));

  const form = (
    <CaptureForm
      draft={state.draft}
      onDraft={(draft) => setState((s) => ({ ...s, draft }))}
      onSend={send}
      today={today}
      showHint={!state.tasks.some((t) => t.state === "inbox")}
    />
  );

  const open = (t: Task) => (twoPane ? select(t) : (view.name === "today" || view.name === "inbox") && navigate({ name: "task", id: t.id, from: view.name }));

  const reward =
    view.name === "reward" ? (
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
        offerNudges={!state.nudge_offered}
        onOffered={() => setState((s) => ({ ...s, nudge_offered: true }))}
        // The first Reward carries the one-time reminder offer (UX_Flows.md §7, step 7), and no unlock in front of it.
        unlock={view.fromFocus && state.nudge_offered ? state.settings.unlock : null}
      />
    ) : null;

  const focus = (
    <FocusView state={state} update={setState} announce={announce} onFinished={(title) => navigate({ name: "reward", title, fromFocus: true })} onStopped={() => navigate({ name: "today" }, "right")} />
  );

  // The Task view. On the right pane there is no Back: another row replaces it.
  const taskView = (t: Task, inPane: boolean) => (
    <TaskView
      key={t.id}
      task={t}
      pickDate={view.name === "task" && view.id === t.id ? view.pickDate : undefined}
      inPane={inPane}
      state={state}
      update={setState}
      today={today}
      inToday={plan.rows.some((r) => r.task.id === t.id)}
      onPin={() => setState((s) => pin(s, t.id, today, Date.now()))}
      onStart={() => startTask(t)}
      onStartStep={start}
      onBack={() => navigate({ name: view.name === "task" ? view.from : "today" })}
      onTriage={(answers) => setState((s) => triage(s, t.id, answers, Date.now(), today))}
      onRename={(title) => setState((s) => rename(s, t.id, title, Date.now()))}
      onRemove={() => {
        setState((s) => remove(s, t.id, Date.now()));
        setSelected(null);
        if (view.name === "task") navigate({ name: view.from });
        else moveFocus("right");
        announce("Moved out of the way. It's still here if you want it back.");
      }}
    />
  );

  const menuButton = (
    <button className="icon-button" aria-label="Open menu" onClick={() => drawer.current!.showModal()}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
  );

  // Today, Inbox or Settings: the body of the screen, wherever it sits.
  const screen = (name: Screen) =>
    name === "settings" ? (
      <SettingsView
        state={state}
        update={setState}
        browserTz={browserTz}
        backedUp={syncStatus.backedUp}
        onSignedIn={() => {
          sync.restart(); // what's on this device joins that list, and everything of theirs comes down
          void sync.push();
        }}
      />
    ) : name === "today" ? (
      <TodayView
        key={today} // a new day remounts it, so its morning confirm and Adjust mode start fresh
        plan={plan}
        state={state}
        update={setState}
        today={today}
        selectedId={twoPane && right === "task" ? rightTask?.id : undefined}
        onOpenTask={open}
        onStart={(r) => (r.chunk ? start(r.chunk.id) : startTask(r.task))}
        onInbox={() => navigate({ name: "inbox" })}
        onCapture={openCapture}
        welcome={welcome}
        firstOpen={lastVisitDay !== today}
        onWelcomeDone={() => setWelcome(false)}
        onReset={() => setState((s) => resetOverdue(s, today, Date.now()))}
        backedUp={syncStatus.backedUp}
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
    );

  const app = (
    <div className={`app${twoPane ? " two-pane" : ""}`}>
      {showArrival && (
        <ArrivalLine
          onSnooze={() => {
            setState((s) => snoozeTomorrow(s, [arrivalTask.id], Date.now()));
            setArrival(null);
            announce("Snoozed until tomorrow.");
          }}
        />
      )}
      {twoPane ? (
        <div className="panes">
          <main className="pane pane-left" data-pane="left" aria-label={titleOf[leftScreen.current]}>
            <header className="header">
              {menuButton}
              <h1 className="title" tabIndex={-1}>
                {titleOf[leftScreen.current]}
              </h1>
            </header>
            {leftScreen.current !== "settings" && <div className="capture-inline">{form}</div>}
            <div className="main">{screen(leftScreen.current)}</div>
          </main>
          <section className="pane pane-right" data-pane="right" aria-label={right === "task" ? "Task" : "Focus"}>
            {right === "reward" ? (
              <div className="main">{reward}</div>
            ) : right === "focus" ? (
              <div className="main focus-main">{focus}</div>
            ) : rightTask ? (
              taskView(rightTask, true)
            ) : (
              <div className="main">
                <p className="empty">{plan.rows.length ? "That's everything for today." : "Nothing's lined up for today yet."}</p>
              </div>
            )}
          </section>
        </div>
      ) : onboarding ? (
        <main className="main">
          <Onboarding
            state={state}
            update={setState}
            today={today}
            announce={announce}
            onDone={(then) => {
              setOnboarding(false);
              navigate({ name: then });
            }}
          />
        </main>
      ) : view.name === "reward" ? (
        <main className="main">{reward}</main>
      ) : view.name === "shutdown" ? (
        <main className="main">
          <ShutdownView
            state={state}
            update={setState}
            today={today}
            tomorrow={build(addDays(today, 1))}
            doneToday={doneTodayCount(state, today, tz, quietEndMin)}
            canMakeKey={syncStatus.backedUp && syncStatus.pending === 0 && !syncStatus.offline} // the journal key race, Shutdown.tsx
            onClose={() => {
              setState((s) => wrapUp(s, today, Date.now()));
              navigate({ name: "today" });
            }}
          />
        </main>
      ) : view.name === "task" && task ? (
        taskView(task, false)
      ) : (
        <>
          <header className={`header${view.name === "focus" ? " dimmed" : ""}`}>
            {menuButton}
            {view.name === "focus" ? (
              <span className="title">Today</span>
            ) : (
              <h1 className="title" tabIndex={-1}>
                {view.name === "today" ? "Today" : view.name === "inbox" ? "Inbox" : "Settings"}
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
          {wide && view.name !== "settings" && <div className="capture-inline">{form}</div>}
          <main className={`main${view.name === "focus" ? " focus-main" : ""}`}>
            {view.name === "focus" && state.focus ? (
              focus
            ) : (
              screen(isScreen(view) ? view.name : "today")
            )}
          </main>
          {/* Nothing to capture into from Settings (Wireframes.md, Global). */}
          {!wide && view.name !== "settings" && (
            <div className={`capture-bar${view.name === "focus" ? " dimmed" : ""}`}>
              <button onClick={openCapture}>{state.draft || "What's on your mind?"}</button>
            </div>
          )}
        </>
      )}

      {/* ponytail: copy not yet in Design_Direction §6; needs Natalie's approval. */}
      {syncStatus.offline && <p className="status-line">Offline. Your changes will sync when you reconnect.</p>}
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
          {(["today", "inbox", "settings"] as const).map((v) => (
            <button
              key={v}
              className="nav-item"
              aria-current={view.name === v ? "page" : undefined}
              onClick={() => {
                drawer.current!.close();
                navigate({ name: v });
              }}
            >
              {v === "today" ? "Today" : v === "inbox" ? "Inbox" : "Settings"}
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
  return <AnnounceContext value={announce}>{app}</AnnounceContext>;
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
