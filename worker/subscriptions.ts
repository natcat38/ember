import { isRecord, json } from "./http";
import { cookieFor, presentedUser, resolveUser } from "./identity";
import { b64uDecode, MAX_SUBSCRIPTIONS, pushConfigured, type PushEnv, type PushSub } from "./push";

// POST /api/push/subscribe and /api/push/unsubscribe (Tech_Scope.md §10 slice 18, ADR-0002, UX_Flows.md §4 and §5).
// The Settings screen calls them with the cookie identity after the browser grants permission, sending the
// PushSubscription the browser made (`subscription.toJSON()`). Subscribing makes web push the user's one channel;
// unsubscribing hands the channel back to Telegram when a chat is still linked, else to the app alone.

export interface SubscriptionEnv extends PushEnv {
  DB: D1Database;
}

const MAX_BODY_CHARS = 4 * 1024; // a real subscription is about 500 bytes; the endpoints of the big services are under 300 characters
const MAX_ENDPOINT_CHARS = 2048;
const P256DH_BYTES = 65; // uncompressed P-256 point
const AUTH_BYTES = 16;

const badRequest = () => json({ error: "bad_request" }, 400);

// The server will POST to whatever endpoint is stored, so it is held to what the push services use: https on the default
// port, a named host (no IP literal, no localhost), no embedded credentials. Not an allow-list of services: new ones
// (and Apple's, Mozilla's, Microsoft's regional hosts) appear without notice.
function validEndpoint(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > MAX_ENDPOINT_CHARS) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = url.hostname;
  const named = host.includes(".") && !host.includes(":") && !/^[\d.]+$/.test(host) && host !== "localhost" && !host.endsWith(".localhost");
  return url.protocol === "https:" && url.port === "" && !url.username && !url.password && named;
}

function bytesOf(v: unknown, length: number): boolean {
  if (typeof v !== "string") return false;
  try {
    return b64uDecode(v).length === length;
  } catch {
    return false;
  }
}

// Boundary validation: null = not a subscription we will keep. The browser's public key is imported, which rejects a
// point that is not on the curve, so a key that could never encrypt is refused here and not at the first send.
async function parseSubscription(raw: string): Promise<PushSub | null> {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(body) || !validEndpoint(body.endpoint) || !isRecord(body.keys)) return null;
  const { p256dh, auth } = body.keys;
  if (!bytesOf(p256dh, P256DH_BYTES) || !bytesOf(auth, AUTH_BYTES)) return null;
  try {
    await crypto.subtle.importKey("raw", b64uDecode(p256dh as string), { name: "ECDH", namedCurve: "P-256" }, false, []);
  } catch {
    return null;
  }
  return { endpoint: body.endpoint, p256dh: p256dh as string, auth: auth as string };
}

export async function handleSubscriptions(request: Request, env: SubscriptionEnv, action: string): Promise<Response> {
  if (action !== "subscribe" && action !== "unsubscribe") return json({ error: "not_found" }, 404);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return badRequest();
  return action === "subscribe" ? subscribe(request, env, raw) : unsubscribe(request, env, raw);
}

async function subscribe(request: Request, env: SubscriptionEnv, raw: string): Promise<Response> {
  // A subscription that no message could ever be sent to would only move the user off a working channel.
  if (!pushConfigured(env)) return json({ error: "push_not_configured" }, 503);
  const sub = await parseSubscription(raw);
  if (!sub) return badRequest();

  const now = Date.now();
  const { uid } = await resolveUser(env.DB, request, now);
  // One batch (a transaction). First the old owner of this browser, if another user had it: left with no subscription
  // they would stay on the push channel and get nothing, so the channel is handed on as unsubscribe does (audit #19).
  // Then the upsert moves a browser that now presents a different cookie to its new user; the trim keeps the newest few;
  // the channel flips last, and `planned_until = NULL` has the next tick plan the day afresh, so messages the old channel
  // never sent are not sent in a burst (audit #15). Telegram's chat id is left in place.
  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE users SET channel = CASE WHEN telegram_chat_id IS NOT NULL THEN 'telegram' END, planned_until = NULL
         WHERE channel = 'push' AND id = (SELECT user_id FROM push_subscriptions WHERE endpoint = ?1) AND id != ?2
           AND NOT EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = users.id AND p.endpoint != ?1)`,
      )
      .bind(sub.endpoint, uid),
    env.DB
      .prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = excluded.created_at`,
      )
      .bind(uid, sub.endpoint, sub.p256dh, sub.auth, now),
    env.DB
      .prepare(
        `DELETE FROM push_subscriptions WHERE user_id = ?1
           AND id NOT IN (SELECT id FROM push_subscriptions WHERE user_id = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2)`,
      )
      .bind(uid, MAX_SUBSCRIPTIONS),
    env.DB.prepare("UPDATE users SET channel = 'push', planned_until = NULL WHERE id = ?1").bind(uid),
  ]);
  return json({ ok: true }, 200, { "Set-Cookie": cookieFor(uid) });
}

// Read-only on identity, like /api/me: leaving never makes a user. It works with VAPID off, so a user can always leave.
async function unsubscribe(request: Request, env: SubscriptionEnv, raw: string): Promise<Response> {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return badRequest();
  }
  if (!isRecord(body) || typeof body.endpoint !== "string" || body.endpoint.length > MAX_ENDPOINT_CHARS) return badRequest();

  const uid = presentedUser(request);
  if (uid) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id = ?1 AND endpoint = ?2").bind(uid, body.endpoint),
      // With no subscription left the push channel has nothing to send to. A linked chat takes over; otherwise reminders stay in the app.
      env.DB
        .prepare(
          `UPDATE users SET channel = CASE WHEN telegram_chat_id IS NOT NULL THEN 'telegram' END, planned_until = NULL
           WHERE id = ?1 AND channel = 'push' AND NOT EXISTS (SELECT 1 FROM push_subscriptions WHERE user_id = ?1)`,
        )
        .bind(uid),
    ]);
  }
  return json({ ok: true });
}
