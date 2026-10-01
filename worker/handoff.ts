import { cookieFor } from "./identity";

// POST /api/handoff/redeem { code, s? } (Tech_Scope.md §6): the page a Telegram link button opens carries a sign-in code
// (`?h=`) and the send it came from (`?s=`). On iPhone, Telegram's in-app browser has its own cookie jar, so the page
// POSTs the code here, and this sets the ember_uid cookie in whichever browser asked.

const MAX_BODY_CHARS = 1024; // a code and an id; anything longer is not one
const CODE_RE = /^[A-Za-z0-9_-]{22}$/; // newUserId()'s shape, as in telegram.ts
const SEND_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

// A valid, unexpired login_link code answers 200 and sets the cookie for the code's user. Anything else, from a wrong
// purpose to an expired code to a body that is not JSON, is the same bare 404, so nothing says which part was wrong.
// The code is not spent: the same Telegram message can be tapped twice within its 24 hours. If the page names the send,
// that send is marked acted (UX_Flows §5: opening the link counts); a send of another user is left alone.
export async function handleHandoffRedeem(request: Request, env: { DB: D1Database }): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  const notFound = () => json({ error: "not_found" }, 404);

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return notFound();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return notFound();
  }
  const { code, s } = (typeof body === "object" && body !== null ? body : {}) as { code?: unknown; s?: unknown };
  if (typeof code !== "string" || !CODE_RE.test(code)) return notFound();

  const now = Date.now();
  // The join drops a code whose user the retention job has since deleted.
  const row = await env.DB
    .prepare(
      `SELECT h.user_id FROM handoffs h JOIN users u ON u.id = h.user_id
       WHERE h.code = ?1 AND h.purpose = 'login_link' AND h.expires_at > ?2`,
    )
    .bind(code, now)
    .first<{ user_id: string }>();
  if (!row) return notFound();

  if (typeof s === "string" && SEND_ID_RE.test(s)) {
    await env.DB.prepare("UPDATE sends SET acted_at = ?1 WHERE id = ?2 AND user_id = ?3 AND acted_at IS NULL").bind(now, s, row.user_id).run();
  }
  return json({ ok: true }, 200, { "Set-Cookie": cookieFor(row.user_id) });
}
