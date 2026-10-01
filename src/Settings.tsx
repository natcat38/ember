import { useEffect, useState } from "react";
import { addPasskey, cancelled, passkeysSupported, signInWithPasskey } from "./passkeys";

// Settings → Telegram (Tech_Scope.md §6): a one-time link code from the server, opened in Telegram.
async function linkTelegram(): Promise<string | null> {
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

// Wireframes.md §8, phase-1 rows only: quiet hours, time zone, hard blocks. Changes save as you make them.
// Channels (slice 11), the focus timer and rewards (phase 3), and devices (slice 14) join later.
export function SettingsView({ state, update, browserTz, backedUp, onSignedIn }: Props) {
  const { quiet_start, quiet_end, tz } = state.settings;
  const set = (patch: Partial<State["settings"]>) => update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  const blocks = state.hard_blocks.filter((b) => !b.deleted);
  const zones = Intl.supportedValuesOf?.("timeZone") ?? [browserTz];
  const [tgProblem, setTgProblem] = useState<string | null>(null);
  const [deviceNote, setDeviceNote] = useState<string | null>(null);
  // What the server knows about this identity (worker/me.ts); unknown offline, which shows the link button.
  const [me, setMe] = useState<{ telegram: boolean; passkeys: number } | null>(null);
  useEffect(() => {
    fetch("/api/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => {});
  }, []);

  return (
    <>
      <section className="section" aria-labelledby="h-nudges">
        <h2 id="h-nudges">Nudges</h2>
        {me?.telegram ? (
          // ponytail: not yet approved copy (the wireframe's row reads "Send to: Telegram").
          <p className="empty">Nudges go to Telegram.</p>
        ) : (
          <>
            <p className="empty">Ember can nudge you on Telegram while the app is closed.</p>
            <button className="button" style={{ alignSelf: "flex-start" }} onClick={async () => setTgProblem(await linkTelegram())}>
              Link Telegram
            </button>
          </>
        )}
        {tgProblem && (
          <p className="hint" role="status">
            {tgProblem}
          </p>
        )}
      </section>

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
