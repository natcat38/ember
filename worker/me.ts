import { presentedUser } from "./identity";
import { pushConfigured, type PushEnv } from "./push";

// GET /api/me: what Settings needs to show about this identity. Read-only: it never creates a user or sets a cookie,
// so opening Settings on a fresh device doesn't make an empty account.
export interface Me {
  telegram: boolean; // nudges go to a linked Telegram chat
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
                (SELECT COUNT(*) FROM credentials WHERE user_id = users.id) AS passkeys,
                EXISTS (SELECT 1 FROM push_subscriptions WHERE user_id = users.id) AS push
         FROM users WHERE id = ?1`,
      )
        .bind(uid)
        .first<{ telegram: number; passkeys: number; push: number }>()
    : null;
  const me: Me = {
    telegram: row?.telegram === 1,
    passkeys: row?.passkeys ?? 0,
    push: row?.push === 1,
    vapid_public_key: pushConfigured(env) ? env.VAPID_PUBLIC_KEY!.trim() : null,
  };
  return Response.json(me, { headers: { "Cache-Control": "no-store" } });
}
