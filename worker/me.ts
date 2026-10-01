import { presentedUser } from "./identity";

// GET /api/me: what Settings needs to show about this identity. Read-only: it never creates a user or sets a cookie,
// so opening Settings on a fresh device doesn't make an empty account.
export interface Me {
  telegram: boolean; // nudges go to a linked Telegram chat
  passkeys: number; // passkeys on this identity (ADR-0005)
}

export async function handleMe(request: Request, env: { DB: D1Database }): Promise<Response> {
  if (request.method !== "GET") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "GET" } });
  const uid = presentedUser(request);
  const row = uid
    ? await env.DB.prepare(
        `SELECT channel = 'telegram' AND telegram_chat_id IS NOT NULL AS telegram,
                (SELECT COUNT(*) FROM credentials WHERE user_id = users.id) AS passkeys
         FROM users WHERE id = ?1`,
      )
        .bind(uid)
        .first<{ telegram: number; passkeys: number }>()
    : null;
  const me: Me = { telegram: row?.telegram === 1, passkeys: row?.passkeys ?? 0 };
  return Response.json(me, { headers: { "Cache-Control": "no-store" } });
}
