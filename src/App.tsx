import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { capture, type CaptureInput, type State } from "../core/task";
import { dayOf } from "../core/day";
import { KEY, load, save } from "./store";
import { CaptureForm, formatDue } from "./Capture";

type View = "today" | "inbox";

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
  const [view, setView] = useState<View>("today");
  const [sent, setSent] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");
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

  function announce(text: string) {
    setAnnouncement("");
    setTimeout(() => setAnnouncement(text), 50);
  }

  function send(input: CaptureInput) {
    setState((s) => capture(s, input, Date.now(), today));
    setSent((list) => [...list, input.title.trim()]);
    announce("Added");
  }

  function openCapture() {
    if (wide) return document.querySelector<HTMLInputElement>(".capture-inline .field")!.focus();
    setSent([]);
    sheet.current!.showModal();
    // Focus inside the tap itself, or iOS won't raise the keyboard.
    sheet.current!.querySelector<HTMLInputElement>(".field")!.focus();
  }

  function go(v: View) {
    setView(v);
    drawer.current!.close();
  }

  const inbox = state.tasks.filter((t) => t.state === "inbox").sort((a, b) => b.created_at - a.created_at);
  const form = (
    <CaptureForm
      draft={state.draft}
      onDraft={(draft) => setState((s) => ({ ...s, draft }))}
      onSend={send}
      today={today}
      showHint={inbox.length === 0}
    />
  );

  return (
    <div className="app">
      <header className="header">
        <button className="icon-button" aria-label="Open menu" onClick={() => drawer.current!.showModal()}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <h1 className="title">{view === "today" ? "Today" : "Inbox"}</h1>
      </header>
      {/* ponytail: copy not yet in Design_Direction §6; needs Natalie's approval. */}
      {!saved && <p className="status-line">This device isn't saving right now. Keep Ember open so nothing is lost.</p>}

      {wide && <div className="capture-inline">{form}</div>}

      <main className="main">
        {view === "today" ? (
          <section className="section">
            <p className="empty">Nothing's lined up for today yet.</p>
            <div className="actions">
              <button className="button primary" onClick={() => setView("inbox")}>
                Sort a few from Inbox
              </button>
              <button className="button" onClick={openCapture}>
                Capture something
              </button>
            </div>
          </section>
        ) : inbox.length === 0 ? (
          <p className="empty">Nothing waiting here.</p>
        ) : (
          <section className="section" aria-labelledby="h-sort">
            <h2 id="h-sort">Needs sorting</h2>
            <ul className="section" style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {inbox.map((t) => (
                <li key={t.id} className="row">
                  <span>{t.title}</span>
                  {t.deadline && <span className="meta">{formatDue(t.deadline)}</span>}
                  {t.size && <span className="size-tag">{t.size}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {!wide && (
        <div className="capture-bar">
          <button onClick={openCapture}>{state.draft || "What's on your mind?"}</button>
        </div>
      )}

      <dialog ref={sheet} className="sheet" aria-label="Capture" onClick={(e) => e.target === e.currentTarget && sheet.current!.close()}>
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
        </div>
      </dialog>

      <dialog ref={drawer} className="drawer" aria-label="Menu" onClick={(e) => e.target === e.currentTarget && drawer.current!.close()}>
        <nav>
          <p className="brand">Ember</p>
          {(["today", "inbox"] as const).map((v) => (
            <button key={v} className="nav-item" aria-current={view === v ? "page" : undefined} onClick={() => go(v)}>
              {v === "today" ? "Today" : "Inbox"}
            </button>
          ))}
        </nav>
      </dialog>

      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}
