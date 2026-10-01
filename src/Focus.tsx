import { useEffect, useState } from "react";
import { backToIt, breakLeft, endFocus, pauseFocus, resumeFocus, skipBreak, takeBreak, workLeft } from "../core/focus";
import type { State } from "../core/task";

interface Props {
  state: State;
  update: (fn: (s: State) => State) => void;
  onFinished: (title: string) => void; // the step is done: on to Reward
  onStopped: () => void;
  announce: (text: string) => void;
}

const clock = (ms: number) => {
  const sec = Math.ceil(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};
const spoken = (ms: number) => {
  const sec = Math.ceil(ms / 1000);
  return `${Math.floor(sec / 60)} minutes ${sec % 60} seconds`;
};

// Wireframes.md §4 and the Pomodoro break. The cat's corner nook arrives with the cat in phase 3.
export function FocusView({ state, update, onFinished, onStopped, announce }: Props) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    const wake = () => setNow(Date.now()); // returning from a locked phone shows the true time at once
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearInterval(i);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  const f = state.focus!;
  const chunk = state.chunks.find((c) => c.id === f.chunk_id);
  const task = state.tasks.find((t) => t.id === chunk?.task_id);
  const parent = chunk?.parent_id ? state.chunks.find((c) => c.id === chunk.parent_id) : null;
  const left = workLeft(f, now);
  const onBreak = f.break_started_at !== null;
  const phase = onBreak ? (breakLeft(f, now) > 0 ? "break" : "back") : left > 0 ? "work" : "prompt";

  useEffect(() => {
    if (phase === "prompt") announce("Take 5?");
    if (phase === "back") announce("Back to it?");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- announce once per phase change, not per render
  }, [phase]);

  const act = (fn: (s: State, t: number) => State) => update((s) => fn(s, Date.now()));
  const finish = () => {
    act((s, t) => endFocus(s, t, true));
    onFinished(chunk?.title ?? "");
  };
  const stop = () => {
    act((s, t) => endFocus(s, t, false));
    onStopped();
  };

  return (
    <div className="focus-card">
      <h1 className="focus-title" tabIndex={-1}>
        {chunk?.title}
      </h1>
      <p className="meta">{[task?.title, parent?.title].filter(Boolean).join(" · ")}</p>

      {phase === "work" && (
        <>
          <div className="timer" role="timer" aria-label={`${spoken(left)} left`}>
            {clock(left)}
          </div>
          {f.paused_at === null ? (
            <button className="pause" onClick={() => act(pauseFocus)}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
              Pause
            </button>
          ) : (
            <button className="pause" onClick={() => act(resumeFocus)}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5l11 7-11 7z" />
              </svg>
              Resume
            </button>
          )}
          <div className="actions focus-actions">
            <button className="button" onClick={stop}>
              Stop for now
            </button>
            <button className="button" onClick={finish}>
              Done
            </button>
          </div>
        </>
      )}

      {phase === "prompt" && (
        <section className="focus-prompt" aria-labelledby="take5">
          <p id="take5" className="lead">
            Take 5?
          </p>
          <div className="actions focus-actions">
            <button className="button primary" onClick={() => act((s, t) => takeBreak(s, t))}>
              Take 5
            </button>
            <button className="button" onClick={() => act((s, t) => skipBreak(s, t))}>
              Skip break
            </button>
          </div>
          <button className="text-button" onClick={finish}>
            I finished it
          </button>
        </section>
      )}

      {phase === "break" && (
        <section className="focus-prompt" aria-label="Break">
          <div className="breathe" aria-hidden="true" />
          <div className="timer" role="timer" aria-label={`${spoken(breakLeft(f, now))} of break left`}>
            {clock(breakLeft(f, now))}
          </div>
        </section>
      )}

      {phase === "back" && (
        <section className="focus-prompt" aria-labelledby="back">
          <p id="back" className="lead">
            Back to it?
          </p>
          <div className="actions focus-actions">
            <button className="button primary" onClick={() => act(backToIt)}>
              Back to it
            </button>
            <button className="button" onClick={stop}>
              Stop here
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
