import { presentedUser } from "./identity";
import { pushConfigured, type PushEnv } from "./push";

// GET /api/me: what Settings needs to show about this identity. Read-only: it never creates a user or sets a cookie,
// so opening Settings on a fresh device doesn't make an empty account.
export interface Me {
  telegram: boolean; // nudges go to a linked Telegram chat
  telegram_linked: boolean; // a Telegram chat is linked, whichever channel is active (Settings shows "Linked")
  passkeys: number; // passkeys on this identity (ADR-0005)
  push: boolean; // this identity has a web push subscription (slice 18); `telegram` and `push` can both be true, the channel is one of them
  vapid_public_key: string | null; // what the browser's pushManager.subscribe needs; null = web push is not set up on this server
}

export async function handleMe(request: Request, env: PushEnv & { DB: D1Database }): Promise<Response> {
  if (request.method !== "GET") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "GET" } });
  const uid = presentedUser(request);
  const row = uid
    ? await env.DB.prepare(
        `SELECT channel = 'telegram' AND telegram_chat_id IS NOT NULL AS telegram,
                telegram_chat_id IS NOT NULL AS telegram_linked,
                (SELECT COUNT(*) FROM credentials WHERE user_id = users.id) AS passkeys,
                EXISTS (SELECT 1 FROM push_subscriptions WHERE user_id = users.id) AS push
         FROM users WHERE id = ?1`,
      )
        .bind(uid)
        .first<{ telegram: number; telegram_linked: number; passkeys: number; push: number }>()
    : null;
  const me: Me = {
    telegram: row?.telegram === 1,
    telegram_linked: row?.telegram_linked === 1,
    passkeys: row?.passkeys ?? 0,
    push: row?.push === 1,
    vapid_public_key: pushConfigured(env) ? env.VAPID_PUBLIC_KEY!.trim() : null,
  };
  return Response.json(me, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/channel/telegram: nudges go to the linked chat again, from any device (Settings → Use Telegram). Unsubscribing
// only hands the channel back once no browser is subscribed, so a device without its own subscription could not switch.
// The subscriptions stay: Turn on switches back without a new permission prompt. Like /api/me, it never makes a user.
export async function handleUseTelegram(request: Request, env: { DB: D1Database }): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
  const uid = presentedUser(request);
  const res = uid
    ? await env.DB.prepare("UPDATE users SET channel = 'telegram', planned_until = NULL WHERE id = ?1 AND telegram_chat_id IS NOT NULL").bind(uid).run()
    : null;
  return res?.meta.changes ? Response.json({ ok: true }) : Response.json({ error: "not_linked" }, { status: 409 });
}
