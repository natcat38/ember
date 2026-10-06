import { useEffect, useRef, useState } from "react";
import { backToIt, breakLeft, canSwitchMode, endFocus, isFlowtime, pauseFocus, resumeFocus, skipBreak, stopFlow, switchMode, takeBreak, workedMs, workLeft, workOver } from "../core/focus";
import type { State } from "../core/task";
import { catPose } from "../core/cat";
import { Cat } from "./Cat";
import { refocus } from "./refocus";

interface Props {
  state: State;
  update: (fn: (s: State) => State) => void;
  onFinished: (title: string) => void; // the step is done: on to Reward
  onStopped: () => void;
  announce: (text: string) => void;
}

// A countdown rounds up (0:01 left is still a second left); Flowtime counts up and rounds down (0:00 at the start).
const clock = (ms: number, up = false) => {
  const sec = up ? Math.floor(ms / 1000) : Math.ceil(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};
const spoken = (ms: number, up = false) => {
  const sec = up ? Math.floor(ms / 1000) : Math.ceil(ms / 1000);
  return `${Math.floor(sec / 60)} minutes ${sec % 60} seconds`;
};

// Wireframes.md §4 and the Pomodoro break, with the cat's corner nook (Design_Direction.md §4).
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
  const flow = isFlowtime(f);
  const onBreak = f.break_started_at !== null;
  const phase = onBreak ? (breakLeft(f, now) > 0 ? "break" : "back") : workOver(f, now) ? "prompt" : "work";
  // "Take 5" in 25/5 (approved copy). Flowtime's break grows with the time worked and can be 1, so it names the unit.
  // ponytail: draft copy for the Flowtime wording.
  const offer = `Take ${Math.round(breakLeft(f, now) / 60_000)}${flow ? " min" : ""}`;
  const canSwitch = canSwitchMode(f, now);

  useEffect(() => {
    if (phase === "prompt") announce(`${offer}?`);
    if (phase === "back") announce("Back to it?");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- announce once per phase change, not per render
  }, [phase]);

  // A phase change removes the button that had focus (Take 5, Skip break, Back to it, or the timer running out). Focus moves
  // to the new phase's heading: the question, or the step's title while working or on a break. Never on mount.
  const title = useRef<HTMLHeadingElement>(null);
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (lastPhase.current !== phase) refocus(() => (phase === "prompt" || phase === "back" ? document.getElementById(phase === "prompt" ? "take5" : "back") : title.current));
    lastPhase.current = phase;
  }, [phase]);

  // The action and the clock share one instant: a session started now would otherwise sit ahead of the last tick and
  // count up from -1:-1 until the next one.
  const act = (fn: (s: State, t: number) => State) => {
    const t = Date.now();
    setNow(t);
    update((s) => fn(s, t));
  };
  // The switch leaves after its minute; a keyboard user standing on it would otherwise drop to the page body.
  // Only on that change, never on mount, so opening Focus still lands on its heading.
  const pause = useRef<HTMLButtonElement>(null);
  const hadSwitch = useRef(canSwitch);
  useEffect(() => {
    if (hadSwitch.current && !canSwitch && document.activeElement === document.body) pause.current?.focus();
    hadSwitch.current = canSwitch;
  }, [canSwitch]);
  const finish = () => {
    act((s, t) => endFocus(s, t, true));
    onFinished(chunk?.title ?? "");
  };
  const stop = () => {
    act((s, t) => endFocus(s, t, false));
    onStopped();
  };

  const pose = catPose({ screen: "focus", session: f.paused_at === null ? "running" : "paused" });

  return (
    <>
      <div className="focus-card">
        <h1 ref={title} className="focus-title" tabIndex={-1}>
          {chunk?.title}
        </h1>
        <p className="meta">{[task?.title, parent?.title].filter(Boolean).join(" · ")}</p>

        {phase === "work" && (
          <>
            {canSwitch && (
              // ponytail: draft copy. The per-session switch (Wireframes.md §4); wording not yet approved.
              <div className="mode-switch" role="group" aria-label="Timer for this session">
                <button className="chip" aria-pressed={!flow} onClick={() => act((s, t) => switchMode(s, "pomodoro", t))}>
                  25/5
                </button>
                <button className="chip" aria-pressed={flow} onClick={() => act((s, t) => switchMode(s, "flowtime", t))}>
                  Flowtime
                </button>
              </div>
            )}
            {flow ? (
              <div className="timer" role="timer" aria-label={`${spoken(workedMs(f, now), true)} worked`}>
                {clock(workedMs(f, now), true)}
              </div>
            ) : (
              <div className="timer" role="timer" aria-label={`${spoken(left)} left`}>
                {clock(left)}
              </div>
            )}
            {f.paused_at === null ? (
              <button ref={pause} className="pause" onClick={() => act(pauseFocus)}>
                <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
                Pause
              </button>
            ) : (
              <button ref={pause} className="pause" onClick={() => act(resumeFocus)}>
                <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5l11 7-11 7z" />
                </svg>
                Resume
              </button>
            )}
            {flow && (
              // ponytail: draft copy. Flowtime has no timer to run out, so the user says when to stop for a break.
              <div className="actions focus-actions">
                {/* Outlined: the round Pause button is this view's one primary (restraint rule 2). */}
                <button className="button" onClick={() => act(stopFlow)}>
                  Take a break
                </button>
              </div>
            )}
            <div className={`actions focus-actions${flow ? " tight" : ""}`}>
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
            <p id="take5" className="lead" tabIndex={-1}>
              {offer}?
            </p>
            <div className="actions focus-actions">
              <button className="button primary" onClick={() => act((s, t) => takeBreak(s, t))}>
                {offer}
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
            <p id="back" className="lead" tabIndex={-1}>
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
      <div className="cat-corner" aria-hidden="true">
        <Cat pose={pose} size={pose === "stretching" ? 88 : 80} />
      </div>
    </>
  );
}
