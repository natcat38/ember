import { dayOf } from "../core/day";
import { blockSpans, clearOfBlocks, localToMs, slotOffsets } from "../core/messages";
import { addDays } from "../core/today";
import type { State } from "../core/task";

// The browser's half of web push (Tech_Scope.md §10 slice 22, ADR-0002, UX_Flows.md §4 and §5): turning it on and off,
// and the line a notification tap lands on. The server's half is worker/subscriptions.ts.

/** What GET /api/me returns (worker/me.ts). */
export interface Me {
  telegram: boolean; // true only while Telegram is the channel
  passkeys: number;
  push: boolean; // a browser is subscribed
  vapid_public_key: string | null; // null = web push is not set up on this server
}

export type Channel = "telegram" | "push" | null;

/** The user's one channel (UX_Flows.md §5). null = none, or unknown while offline. */
export const channelOf = (me: Pick<Me, "telegram" | "push"> | null): Channel => (me?.telegram ? "telegram" : me?.push ? "push" : null);

// --- Turning it on -------------------------------------------------------------------------------------------------

/** Why web push did not turn on. `dismissed`: the user closed the browser's prompt, which is not a refusal. */
export type PushProblem = "unsupported" | "not_set_up" | "denied" | "home_screen" | "dismissed" | "offline" | "failed";
export type PushOutcome = { ok: true } | { ok: false; problem: PushProblem };

/** base64url (no padding) to bytes: the form the VAPID key arrives in and `applicationServerKey` wants. */
export const bytesOf = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

interface NavigatorLike {
  userAgent: string;
  maxTouchPoints: number;
  standalone?: boolean;
}

/** iPhone or iPad Safari that is not running from the Home Screen: iOS only allows web push for installed apps (UX_Flows.md §4). */
export function needsHomeScreen(nav: NavigatorLike = navigator): boolean {
  // iPadOS 13+ reports a Mac user agent, so a "Mac" with a touch screen is an iPad.
  const ios = /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
  return ios && nav.standalone !== true;
}

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// Waits for the service worker, but not forever: it is registered only in the production build.
const registration = () =>
  Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no service worker")), 8000))]);

/**
 * The whole subscribe flow, to be called from inside the tap. The permission prompt is the first thing awaited (browsers
 * only show it for a gesture, and penalise sites that ask on load), and a refusal is never asked again. `vapidKey` is
 * what /api/me returned: null = the server has no push keys, undefined = the server could not be reached.
 */
export async function enablePush(vapidKey: string | null | undefined): Promise<PushOutcome> {
  if (!supported()) return { ok: false, problem: needsHomeScreen() ? "home_screen" : "unsupported" };
  if (needsHomeScreen()) return { ok: false, problem: "home_screen" };
  if (vapidKey === undefined) return { ok: false, problem: "offline" };
  if (!vapidKey) return { ok: false, problem: "not_set_up" };
  if (Notification.permission === "denied") return { ok: false, problem: "denied" };
  if (Notification.permission !== "granted") {
    const answer = await Notification.requestPermission();
    if (answer !== "granted") return { ok: false, problem: answer === "denied" ? "denied" : "dismissed" };
  }

  let subscription: PushSubscription;
  try {
    const { pushManager } = await registration();
    const options = { userVisibleOnly: true, applicationServerKey: bytesOf(vapidKey) };
    try {
      subscription = await pushManager.subscribe(options);
    } catch (e) {
      // An old subscription made with another key blocks a new one: drop it and subscribe again.
      if (!(e instanceof DOMException && e.name === "InvalidStateError")) throw e;
      await (await pushManager.getSubscription())?.unsubscribe();
      subscription = await pushManager.subscribe(options);
    }
  } catch {
    return { ok: false, problem: "failed" };
  }

  try {
    const res = await post("/api/push/subscribe", subscription.toJSON());
    if (res.ok) return { ok: true };
    await subscription.unsubscribe().catch(() => {}); // the server did not keep it, so neither does the browser
    return { ok: false, problem: res.status === 503 ? "not_set_up" : "failed" };
  } catch {
    await subscription.unsubscribe().catch(() => {});
    return { ok: false, problem: "offline" };
  }
}

/** Turns web push off for this browser. The server is told first, so a failed call leaves nothing half-done. */
export async function disablePush(): Promise<PushOutcome> {
  try {
    const subscription = supported() ? await (await registration()).pushManager.getSubscription() : null;
    if (subscription) {
      const res = await post("/api/push/unsubscribe", { endpoint: subscription.endpoint });
      if (!res.ok) return { ok: false, problem: "failed" };
      await subscription.unsubscribe();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, problem: e instanceof TypeError ? "offline" : "failed" }; // fetch rejects with a TypeError only when the network is unreachable
  }
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });

// --- Arriving from a notification ----------------------------------------------------------------------------------

/**
 * public/sw.js adds `via=push` to the link when a notification is tapped; Telegram's buttons build the same `?h&s&t`
 * link, so without it a Telegram arrival would be taken for a push one. `task` is the one task the message was about.
 */
export function arrivalFrom(search: string): { task: string | null } | null {
  const q = new URLSearchParams(search);
  return q.get("via") === "push" ? { task: q.get("t") } : null;
}

/**
 * When a snoozed task comes back from "Tomorrow": the next day's first slot, which is when quiet hours end, moved past a
 * hard block. The same rule as worker/buttons.ts `snoozeTime("tomorrow")`, which lives in the worker; both read the planner's
 * helpers in core/messages.ts, so a snooze lands where the planner would put a message.
 */
export function tomorrowSlot(s: State, now: number): number {
  const { tz: zone, quiet_start, quiet_end } = s.settings;
  const tz = zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const len = (quiet_start - quiet_end + 1440) % 1440 || 1440; // the waking window
  const day = addDays(dayOf(now, tz, quiet_end), 1);
  const raw = slotOffsets(len)[0];
  const cleared = clearOfBlocks(raw, blockSpans(s.hard_blocks, day, quiet_end));
  return localToMs(day, quiet_end + (cleared < len ? cleared : raw), tz);
}

/** *Not now? Snooze*: the same change Telegram's *Tomorrow* makes, `snoozed_until` and nothing else, on each live task. */
export function snoozeTomorrow(s: State, taskIds: string[], now: number): State {
  const until = tomorrowSlot(s, now);
  return { ...s, tasks: s.tasks.map((t) => (taskIds.includes(t.id) && (t.state === "active" || t.state === "overdue") ? { ...t, snoozed_until: until, updated_at: now } : t)) };
}
