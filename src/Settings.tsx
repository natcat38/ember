import { useEffect, useState, type ReactNode } from "react";
import { addPasskey, cancelled, passkeysSupported, signInWithPasskey } from "./passkeys";
import { channelOf, disablePush, enablePush, type Me, type PushOutcome, type PushProblem } from "./push";

// Settings → Telegram (Tech_Scope.md §6): a one-time link code from the server, opened in Telegram.
export async function linkTelegram(): Promise<string | null> {
  const tab = window.open("", "_blank"); // opened inside the tap, or the browser blocks it as a pop-up
  // ponytail: these three lines are not yet approved copy.
  const fail = (why: string) => (tab?.close(), why);
  try {
    const res = await fetch("/api/tg/link", { method: "POST", credentials: "same-origin" });
    if (res.status === 503) return fail("Telegram isn't set up yet. Try again later.");
    if (!res.ok) return fail("That didn't work. Try again in a moment.");
    const { url } = (await res.json()) as { url: string };
    if (tab) tab.location.href = url;
    else location.assign(url);
    return null;
  } catch {
    return fail("Linking Telegram needs a connection.");
  }
}
import { blockProblem } from "../core/today";
import type { HardBlock, State } from "../core/task";

interface Props {
  state: State;
  update: (fn: (s: State) => State) => void;
  browserTz: string;
  backedUp: boolean;
  onSignedIn: () => void; // this device now has another identity: sync from scratch
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// Wireframes.md §8: reminders, quiet hours, time zone, hard blocks, the focus timer, rewards, and devices. Changes save as you make them.
export function SettingsView({ state, update, browserTz, backedUp, onSignedIn }: Props) {
  const { quiet_start, quiet_end, tz } = state.settings;
  const set = (patch: Partial<State["settings"]>) => update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  const blocks = state.hard_blocks.filter((b) => !b.deleted);
  const zones = Intl.supportedValuesOf?.("timeZone") ?? [browserTz];
  const [deviceNote, setDeviceNote] = useState<string | null>(null);
  // What the server knows about this identity (worker/me.ts); unknown offline, which shows the link button.
  const [me, setMe] = useState<Me | null>(null);
  const refreshMe = () =>
    fetch("/api/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
      .catch(() => null)
      .then((m) => (setMe(m), m));
  useEffect(() => void refreshMe(), []);

  return (
    <>
      <Reminders me={me} refresh={refreshMe} />

      <section className="section" aria-labelledby="h-quiet">
        <h2 id="h-quiet">Quiet hours</h2>
        <p className="empty">
          No nudges between {hhmm(quiet_start)} and {hhmm(quiet_end)}.
        </p>
        <div className="time-row">
          <label className="question">
            <span className="question-label">From</span>
            <input type="time" className="field" value={hhmm(quiet_start)} onChange={(e) => e.target.value && set({ quiet_start: mins(e.target.value) })} />
          </label>
          <label className="question">
            <span className="question-label">To</span>
            <input type="time" className="field" value={hhmm(quiet_end)} onChange={(e) => e.target.value && set({ quiet_end: mins(e.target.value) })} />
          </label>
        </div>
        <p className="hint">Your day starts when quiet hours end, so Today is rebuilt at {hhmm(quiet_end)}.</p>
      </section>

      <section className="section" aria-labelledby="h-tz">
        <h2 id="h-tz">Time zone</h2>
        <label className="question">
          <span className="sr-only">Time zone</span>
          <select className="field" value={tz ?? browserTz} onChange={(e) => set({ tz: e.target.value === browserTz ? null : e.target.value })}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="section" aria-labelledby="h-blocks">
        <h2 id="h-blocks">Hard blocks</h2>
        <p className="empty">Hours you're already busy. Ember plans around them.</p>
        {blocks.length > 0 && (
          <ul className="list" aria-label="Hard blocks">
            {blocks.map((b) => (
              <li key={b.id} className="row">
                <span>
                  {b.weekdays.map((d) => DAYS[d].slice(0, 3)).join(" ")} {hhmm(b.start_min)}–{hhmm(b.end_min)}
                  {b.label ? ` ${b.label}` : ""}
                </span>
                <button
                  className="text-button"
                  aria-label={`Delete block ${b.label ?? ""} ${hhmm(b.start_min)}–${hhmm(b.end_min)}`.replace(/\s+/g, " ")}
                  onClick={() => update((s) => ({ ...s, hard_blocks: s.hard_blocks.map((x) => (x.id === b.id ? { ...x, deleted: true, updated_at: Date.now() } : x)) }))}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        <AddBlock onAdd={(b) => update((s) => ({ ...s, hard_blocks: [...s.hard_blocks, b] }))} />
      </section>

      {/* Wireframes.md §8, "Focus timer": one choice; the per-session switch lives on Focus. */}
      <section className="section" aria-labelledby="h-timer">
        <h2 id="h-timer">Focus timer</h2>
        <Choices
          label="Focus timer"
          value={state.settings.timer_mode}
          onPick={(timer_mode) => set({ timer_mode })}
          options={[
            { value: "pomodoro", label: "25 / 5", note: "25 minutes of focus, then a 5-minute break." },
            { value: "flowtime", label: "Flowtime", note: "Count up and stop when you stop. The break grows with how long you worked." },
          ]}
        />
        <p className="hint">You can switch for one session when you start it.</p>
      </section>

      {/* Wireframes.md §8, "Rewards": every reward stays skippable, so there is no off switch. */}
      <section className="section" aria-labelledby="h-rewards">
        <h2 id="h-rewards">Rewards</h2>
        <p className="empty">After each finished step, Ember offers one quick reward. You can always skip it.</p>
        <Choices
          label="Reward"
          value={state.settings.unlock}
          onPick={(unlock) => set({ unlock })}
          options={[
            { value: "rotate", label: "Surprise me" },
            { value: "puzzle", label: "Chess puzzle" },
            { value: "trivia", label: "Trivia question" },
            { value: "fact", label: "On this day" },
          ]}
        />
      </section>

      <section className="section" aria-labelledby="h-data">
        <h2 id="h-data">Data</h2>
        {backedUp && <p className="empty">Your list is backed up, so it won't get lost.</p>}
        {/* ADR-0005: a passkey on this identity is how a second device opens the same list. */}
        {passkeysSupported() && (
          <div className="actions">
            <button
              className="button"
              onClick={async () => {
                try {
                  await addPasskey();
                  // ponytail: not yet approved copy.
                  setDeviceNote("Done. On your other device, open Ember, go to Settings, and choose Sign in with a passkey.");
                } catch (e) {
                  setDeviceNote(cancelled(e) ? null : "That didn't work. Try again in a moment.");
                }
              }}
            >
              Use Ember on another device
            </button>
            <button
              className="button"
              onClick={async () => {
                try {
                  await signInWithPasskey();
                  setDeviceNote(null);
                  onSignedIn();
                } catch (e) {
                  setDeviceNote(cancelled(e) ? null : "That didn't sign you in. Try again, or keep using Ember on this device.");
                }
              }}
            >
              Sign in with a passkey
            </button>
          </div>
        )}
        {deviceNote && (
          <p className="hint" role="status">
            {deviceNote}
          </p>
        )}
      </section>
    </>
  );
}

// A radio group: one choice, saved as soon as it is made. Native radios, so the arrow keys move the choice.
function Choices<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: { value: T; label: string; note?: string }[]; onPick: (v: T) => void }) {
  const name = `choice-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div role="radiogroup" aria-label={label} className="choices">
      {options.map((o) => (
        <label key={o.value} className="choice">
          <input type="radio" name={name} checked={value === o.value} onChange={() => onPick(o.value)} />
          <span>
            {o.label}
            {o.note && <span className="hint">{o.note}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

// Reminders (Wireframes.md §8 "Send to"; UX_Flows.md §5 Channels): one channel, Telegram or this device (web push).
// ponytail: draft copy, not yet approved: every line below that is not quoted from UX_Flows.md §4 or the wireframe.
const PUSH_COPY: Record<PushProblem, string | null> = {
  unsupported: "This browser can't show notifications. Use Telegram instead.",
  not_set_up: "Web push isn't set up yet. Try again later.",
  denied: "Notifications are off for this browser. You can turn them on in your browser settings, or use Telegram instead.", // UX_Flows.md §4
  home_screen: "To get nudges on iPhone, add Ember to your Home Screen. Tap Share, then Add to Home Screen.", // UX_Flows.md §4
  dismissed: null, // the browser's prompt was closed: nothing was refused, so nothing is said
  offline: "Turning on notifications needs a connection.",
  failed: "That didn't work. Try again in a moment.",
};

function Reminders({ me, refresh }: { me: Me | null; refresh: () => Promise<Me | null> }) {
  const [note, setNote] = useState<ReactNode>(null);
  const [problem, setProblem] = useState<PushProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const channel = channelOf(me);

  const run = async (job: () => Promise<PushOutcome>) => {
    setBusy(true);
    const out = await job();
    setProblem(out.ok ? null : out.problem);
    setNote(null);
    await refresh();
    setBusy(false);
  };
  const linkTg = async () => setNote(await linkTelegram());
  const text = problem && PUSH_COPY[problem];

  return (
    <section className="section" aria-labelledby="h-nudges">
      <h2 id="h-nudges">Nudges</h2>
      <div role="radiogroup" aria-label="Send to" className="choices">
        <label className="choice">
          <input
            type="radio"
            name="send-to"
            checked={channel === "telegram"}
            disabled={busy}
            onChange={() => {
              if (channel === "push") void run(disablePush); // the server hands the channel back to a linked chat
              else void linkTg();
            }}
          />
          <span>Telegram</span>
        </label>
        <label className="choice">
          <input
            type="radio"
            name="send-to"
            checked={channel === "push"}
            disabled={busy}
            // Inside the tap: the permission prompt is only shown for a gesture.
            onChange={() => void run(() => enablePush(me ? me.vapid_public_key : undefined))}
          />
          <span>This device</span>
        </label>
      </div>

      {channel === "telegram" && <p className="empty">Nudges go to Telegram.</p>}
      {channel === "push" && (
        <>
          <p className="empty">Nudges come to this device.</p>
          <button className="button" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => void run(disablePush)}>
            Turn off
          </button>
        </>
      )}
      {channel === null && (
        <>
          <p className="empty">Ember can nudge you on Telegram while the app is closed.</p>
          <button className="button" style={{ alignSelf: "flex-start" }} onClick={linkTg}>
            Link Telegram
          </button>
        </>
      )}

      {text && (
        <p className="hint" role="status">
          {text}
        </p>
      )}
      {problem === "home_screen" && (
        <button className="text-button" style={{ alignSelf: "flex-start" }} onClick={() => setProblem(null)}>
          Got it
        </button>
      )}
      {note && (
        <p className="hint" role="status">
          {note}
        </p>
      )}
    </section>
  );
}

function AddBlock({ onAdd }: { onAdd: (b: HardBlock) => void }) {
  const [open, setOpen] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("12:00");
  const [label, setLabel] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  if (!open)
    return (
      <button className="button" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
        + Add a block
      </button>
    );

  return (
    <form
      className="question add-block"
      aria-label="Add a block"
      onSubmit={(e) => {
        e.preventDefault();
        const b = { weekdays, start_min: mins(from), end_min: mins(to) };
        const p = blockProblem(b);
        setProblem(p);
        if (p) return;
        onAdd({ ...b, id: crypto.randomUUID(), label: label.trim() || null, deleted: false, updated_at: Date.now() });
        setOpen(false);
        setWeekdays([]);
        setLabel("");
      }}
    >
      <div role="group" aria-label="Days" className="question">
        <p className="question-label" aria-hidden="true">
          Days
        </p>
        <div className="actions days">
          {DAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              className="chip"
              aria-label={d}
              aria-pressed={weekdays.includes(i)}
              onClick={() => setWeekdays(weekdays.includes(i) ? weekdays.filter((x) => x !== i) : [...weekdays, i].sort())}
            >
              {d[0]}
            </button>
          ))}
        </div>
      </div>
      <div className="time-row">
        <label className="question">
          <span className="question-label">From</span>
          <input type="time" className="field" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </label>
        <label className="question">
          <span className="question-label">To</span>
          <input type="time" className="field" value={to} onChange={(e) => setTo(e.target.value)} required />
        </label>
      </div>
      <label className="question">
        <span className="question-label">Name (optional)</span>
        <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" />
      </label>
      {problem && (
        <p className="hint" role="status">
          {problem}
        </p>
      )}
      <div className="actions">
        <button className="button primary">Save</button>
        <button type="button" className="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
