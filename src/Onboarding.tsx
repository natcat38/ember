import { useEffect, useRef, useState } from "react";
import { addChunk } from "../core/chunk";
import { startFocus } from "../core/focus";
import { capture, placeFirst, type CaptureInput, type State, type Task } from "../core/task";
import { CaptureForm } from "./Capture";

// UX_Flows.md §7: a real step ready to start within 60 seconds. No tour, no signup, no account screen.
// Step cards (Wireframes.md §9) without progress dots, since the number of steps depends on the branch.

type Step = { name: "dump" } | { name: "many" } | { name: "one" } | { name: "today"; task: Task } | { name: "first-step"; task: Task } | { name: "starter"; task: Task; chunkId: string };

interface Props {
  state: State;
  update: (fn: (s: State) => State) => void;
  today: string;
  onDone: (then: "today" | "focus" | "settings") => void;
  announce: (text: string) => void;
}

const STARTER_MS = 2 * 60_000; // "Start with two minutes?"
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number) => WORDS[n] ?? String(n);

export function Onboarding({ state, update, today, onDone, announce }: Props) {
  const [step, setStep] = useState<Step>({ name: "dump" });
  const [captured, setCaptured] = useState<string[]>([]); // task ids, in the order they were dumped
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (step.name !== "dump") heading.current?.focus();
  }, [step]);

  // Finishing places the picked task as today's first, untriaged (§7, "Decisions the app makes silently").
  const finish = (then: "today" | "focus" | "settings", fn: (s: State) => State = (s) => s) => {
    update((s) => ({ ...fn(s), onboarded: true }));
    onDone(then);
  };

  // A returning user whose device storage was wiped gets their list back from the server on the first sync:
  // that's not a first run, so the sequence steps aside, even if they had already started typing. Tasks made here
  // don't count; their own stay on the list. (Not once a starter session is running: that is a step they chose.)
  useEffect(() => {
    if (step.name !== "starter" && state.tasks.some((t) => !captured.includes(t.id))) finish("today");
  });

  const tasks = captured.map((id) => state.tasks.find((t) => t.id === id)).filter((t): t is Task => !!t);

  if (step.name === "dump") {
    return (
      <div className="step-card onboarding">
        <h1 className="sr-only">Welcome to Ember</h1>
        {tasks.length > 0 && (
          <ul className="sent" aria-label="Added just now">
            {tasks.map((t) => (
              <li key={t.id}>{t.title}</li>
            ))}
          </ul>
        )}
        <CaptureForm
          draft={state.draft}
          onDraft={(draft) => update((s) => ({ ...s, draft }))}
          onSend={(input: CaptureInput) => {
            const id = crypto.randomUUID();
            update((s) => capture(s, input, Date.now(), today, () => id));
            setCaptured((c) => [...c, id]);
            announce("Added");
          }}
          today={today}
          showHint
          autoFocus
        />
        <div className="step-foot">
          {tasks.length === 0 ? (
            <>
              {/* A quiet text button: with nothing typed it is a way out, not an action to weigh against the field above. */}
              <button className="text-button" onClick={() => finish("today")}>
                Close
              </button>
              {/* ponytail: not yet approved copy. A second device needs a way past the first run to sign in (ADR-0005). */}
              <button className="text-button" onClick={() => finish("settings")}>
                Already use Ember? Sign in
              </button>
            </>
          ) : (
            <button className="button primary" onClick={() => setStep(tasks.length === 1 ? { name: "one" } : { name: "many" })}>
              That's it for now
            </button>
          )}
        </div>
      </div>
    );
  }

  if (step.name === "one") {
    const task = tasks[0];
    return (
      <Card heading={heading} title="Want me to break that one down?">
        <p className="lead">{task.title}</p>
        <div className="step-foot">
          <button className="button primary" onClick={() => setStep({ name: "first-step", task })}>
            Break it down
          </button>
          <button className="button" onClick={() => finish("today", (s) => placeFirst(s, task.id, today, Date.now()))}>
            Not now
          </button>
        </div>
      </Card>
    );
  }

  if (step.name === "many") {
    return (
      <Card heading={heading} title={`Got it, ${count(tasks.length)} things. Let's make today small.`}>
        <p className="question-label" id="weighing">
          Which one's weighing on you most?
        </p>
        <ul className="list" aria-labelledby="weighing">
          {tasks.map((t) => (
            <li key={t.id}>
              <button className="row row-button" onClick={() => setStep({ name: "today", task: t })}>
                <span>{t.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  if (step.name === "today") {
    return (
      <Card heading={heading} title="Today">
        <section className="card frog" aria-label="Do this first">
          <p className="lead">{step.task.title}</p>
        </section>
        <div className="step-foot">
          <button className="button primary" onClick={() => setStep({ name: "first-step", task: step.task })}>
            Break this down
          </button>
          <button className="button" onClick={() => setStep({ name: "first-step", task: step.task })}>
            Start
          </button>
        </div>
      </Card>
    );
  }

  if (step.name === "first-step") {
    return (
      <Card heading={heading} title={step.task.title}>
        <form
          className="question"
          onSubmit={(e) => {
            e.preventDefault();
            const title = String(new FormData(e.currentTarget).get("step") ?? "").trim();
            if (!title) return;
            const chunkId = crypto.randomUUID();
            update((s) => addChunk(s, step.task.id, title, null, Date.now(), () => chunkId));
            setStep({ name: "starter", task: step.task, chunkId });
          }}
        >
          <label className="question">
            <span className="question-label">What's the very next physical action?</span>
            <input name="step" className="field step-field" placeholder="Type one step" autoComplete="off" />
          </label>
          <div className="step-foot">
            <button className="button primary">Next</button>
          </div>
        </form>
      </Card>
    );
  }

  // step.name === "starter"
  const { task, chunkId } = step;
  return (
    <Card heading={heading} title="Start with two minutes?">
      <p className="lead">{state.chunks.find((c) => c.id === chunkId)?.title}</p>
      <div className="step-foot">
        <button
          className="button primary"
          onClick={() => finish("focus", (s) => startFocus(placeFirst(s, task.id, today, Date.now()), chunkId, Date.now(), undefined, STARTER_MS))}
        >
          Start
        </button>
        <button className="button" onClick={() => finish("today", (s) => placeFirst(s, task.id, today, Date.now()))}>
          Not now
        </button>
      </div>
    </Card>
  );
}

function Card({ heading, title, children }: { heading: React.RefObject<HTMLHeadingElement | null>; title: string; children: React.ReactNode }) {
  return (
    <div className="step-card onboarding">
      <h1 ref={heading} className="title" tabIndex={-1}>
        {title}
      </h1>
      {children}
    </div>
  );
}
