import { handleCallback, type ButtonTap } from "./buttons";
import { cookieFor, newUserId, resolveUser } from "./identity";
import { sync } from "./sync";

// Telegram link and capture (Tech_Scope.md §6, slice 11). Three pieces: POST /api/tg/link makes a one-time code,
// the webhook turns /start <code> into a link and plain text into an Inbox task, and sendMessage calls the Bot API.

// What this file reads from the environment. The Telegram entries are optional on purpose: a secret that was never
// set is `undefined` at run time, every use below checks for it, and `wrangler types` does not generate secrets (they
// are not in wrangler.jsonc), so the global Env has no such property. Values: .dev.vars.example.
export interface TelegramEnv {
  DB: D1Database;
  /** Var: the bot's username without the @, for the t.me/<bot>?start=<code> link. */
  TG_BOT_USERNAME?: string;
  /** Secret: the Bot API token from @BotFather. Never logged. */
  TG_BOT_TOKEN?: string;
  /** Secret: Telegram echoes it in X-Telegram-Bot-Api-Secret-Token (setWebhook's secret_token). */
  TG_WEBHOOK_SECRET?: string;
  /** Secret: the unguessable path segment of the webhook URL, /api/tg/<this>. */
  TG_WEBHOOK_PATH?: string;
  /** Var: the app's origin, for the link buttons a callback restores (buttons.ts). */
  APP_ORIGIN?: string;
}

const LINK_TTL_MS = 15 * 60_000; // §6: the code lives 15 minutes
const MAX_TITLE_CHARS = 500; // the tasks.title limit in schema.ts, also the capture sheet's (UX_Flows §3.1)
const MAX_UPDATE_CHARS = 64 * 1024; // Telegram updates are a few KB; this only stops an oversized body being parsed

// Reply copy. Natalie has not seen these yet; the capture one is UX_Flows §3.1's *Added*.
const COPY = {
  linked: "Linked. Ember will nudge you here.",
  restart: "That link has expired or was already used. Open Settings in Ember and tap Telegram to start again.",
  startBare: "To link this chat, open Settings in Ember and tap Telegram.",
  unlinked: "This chat isn't linked to Ember yet. Open Settings in Ember and tap Telegram to link it.",
  added: "Added",
  addedCut: `Added. Only the first ${MAX_TITLE_CHARS} characters fit.`,
  notAdded: "Couldn't add that. Try again in a moment.",
  command: "I only take plain text. Send what's on your mind and it goes to your Inbox.",
};

const empty = (status: number) => new Response(null, { status });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

// --- Bot API ---------------------------------------------------------------------------------------------------

/** What a Bot API call came back with. `status` 0 means the request got no answer at all (or the token is not set). */
export type BotResult = { ok: true; result: unknown } | { ok: false; status: number; description: string };

/**
 * Calls one Bot API method. Never throws, and never puts the token in anything it returns: the runtime's own network
 * error text can quote the request URL, which contains the token, so it is not passed on. The one sender every Bot API
 * call goes through: the replies here, the scheduler's sends, and the button taps' answers and edits (buttons.ts).
 */
export async function botCall(env: { TG_BOT_TOKEN?: string }, method: string, payload: Record<string, unknown>): Promise<BotResult> {
  if (!env.TG_BOT_TOKEN) return { ok: false, status: 0, description: "TG_BOT_TOKEN is not set" };
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, status: 0, description: `Telegram ${method} request failed` };
  }
  if (!res.ok) {
    const description = await res.json().then((b) => String((b as { description?: unknown }).description ?? "").slice(0, 200), () => "");
    return { ok: false, status: res.status, description };
  }
  const body = (await res.json().catch(() => null)) as { result?: unknown } | null;
  return { ok: true, result: body?.result };
}

/** Sends a message through the Bot API. Throws on any non-2xx answer or network failure, and never puts the token in the error. */
export async function sendMessage(env: TelegramEnv, chatId: number | string, body: string, replyMarkup?: unknown): Promise<void> {
  const r = await botCall(env, "sendMessage", { chat_id: chatId, text: body, ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }) });
  if (r.ok) return;
  throw new Error(r.status ? `Telegram sendMessage failed: ${r.status}${r.description ? ` ${r.description}` : ""}` : r.description);
}

// The user already got what they asked for by the time we reply, and Telegram would retry a non-200 answer, so a
// failed reply is logged and does not fail the webhook.
async function reply(env: TelegramEnv, chatId: number, body: string): Promise<void> {
  try {
    await sendMessage(env, chatId, body);
  } catch (e) {
    console.error("telegram reply failed", e instanceof Error ? e.message : "unknown error");
  }
}

// --- POST /api/tg/link -----------------------------------------------------------------------------------------

// Settings -> Telegram: a one-time code, as a t.me deep link. Needs the ember_uid cookie, and creates the user when
// there is none, exactly as /api/sync does.
export async function handleTgLink(request: Request, env: TelegramEnv): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  if (!env.TG_BOT_USERNAME) return json({ error: "telegram_not_configured" }, 503);

  const now = Date.now();
  const { uid } = await resolveUser(env.DB, request, now);
  const code = newUserId(); // 128 random bits as base64url, the same recipe a handoff code needs
  await env.DB.prepare("INSERT INTO handoffs (code, user_id, purpose, expires_at) VALUES (?1, ?2, 'tg_link', ?3)").bind(code, uid, now + LINK_TTL_MS).run();
  return json({ url: `https://t.me/${env.TG_BOT_USERNAME}?start=${code}` }, 200, { "Set-Cookie": cookieFor(uid) });
}

// --- POST /api/tg/<path secret> --------------------------------------------------------------------------------

// Equal in time whatever the contents. Both sides are hashed first, because timingSafeEqual needs equal lengths and
// comparing lengths directly would reveal the secret's.
async function safeEqual(a: string, b: string): Promise<boolean> {
  const digest = async (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  return crypto.subtle.timingSafeEqual(x, y);
}

export interface Incoming {
  kind: "message";
  updateId: number;
  chatId: number;
  text: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// Boundary validation. null = not a Telegram update at all (400); "ignored" = a well-formed update of a kind we do not
// handle: edits, channel posts, groups, and messages without text. A button tap (callback_query) is always answered,
// so it is kept whenever it has an id, even when it names no usable message.
export function parseUpdate(raw: string): Incoming | ({ kind: "callback" } & ButtonTap) | "ignored" | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(body) || typeof body.update_id !== "number" || !Number.isSafeInteger(body.update_id)) return null;

  const q = body.callback_query;
  if (isRecord(q)) {
    if (typeof q.id !== "string" || !q.id || q.id.length > 100) return "ignored";
    const m = isRecord(q.message) ? q.message : null;
    const chat = m && isRecord(m.chat) ? m.chat : null;
    const chatId = chat && chat.type === "private" && typeof chat.id === "number" && Number.isSafeInteger(chat.id) ? chat.id : null;
    const messageId = m && typeof m.message_id === "number" && Number.isSafeInteger(m.message_id) ? m.message_id : null;
    return { kind: "callback", id: q.id, data: typeof q.data === "string" ? q.data : "", chatId, messageId };
  }

  const m = body.message;
  if (!isRecord(m) || !isRecord(m.chat) || typeof m.text !== "string") return "ignored";
  // Only private chats can be linked, and a private chat's id is the user's id: a positive safe integer.
  if (m.chat.type !== "private" || typeof m.chat.id !== "number" || !Number.isSafeInteger(m.chat.id)) return "ignored";
  return { kind: "message", updateId: body.update_id, chatId: m.chat.id, text: m.text };
}

export async function handleTgWebhook(request: Request, env: TelegramEnv, pathSecret: string): Promise<Response> {
  // Both checks always run, so a wrong path and a wrong header cannot be told apart by timing. Every failure is the
  // same bare 404: nothing says which part was wrong, or that a webhook lives here.
  const header = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  const configured = Boolean(env.TG_WEBHOOK_PATH && env.TG_WEBHOOK_SECRET);
  const [pathOk, headerOk] = await Promise.all([safeEqual(pathSecret, env.TG_WEBHOOK_PATH ?? ""), safeEqual(header, env.TG_WEBHOOK_SECRET ?? "")]);
  if (!configured || !pathOk || !headerOk || request.method !== "POST") return empty(404);

  const raw = await request.text();
  if (raw.length > MAX_UPDATE_CHARS) return json({ error: "body_too_large" }, 413);
  const update = parseUpdate(raw);
  if (!update) return json({ error: "invalid_update" }, 400);
  if (update === "ignored") return json({ ok: true });
  if (update.kind === "callback") await handleCallback(env, update, (method, payload) => botCall(env, method, payload), Date.now());
  else await handleMessage(env, update);
  return json({ ok: true });
}

// /start, /start@bot, /start <code>. `(?=\s|$)` keeps /starting from matching.
const START_RE = /^\/start(?:@\w+)?(?=\s|$)(?:\s+(\S+))?/;
const COMMAND_RE = /^\/\w+(?:@\w+)?(?=\s|$)/;
const CODE_RE = /^[A-Za-z0-9_-]{22}$/;

async function handleMessage(env: TelegramEnv, { updateId, chatId, text: message }: Incoming): Promise<void> {
  const start = START_RE.exec(message);
  if (start) {
    await reply(env, chatId, await redeem(env.DB, chatId, start[1]));
    return;
  }
  if (COMMAND_RE.test(message)) {
    await reply(env, chatId, COPY.command);
    return;
  }

  const user = await env.DB.prepare("SELECT id FROM users WHERE telegram_chat_id = ?1").bind(String(chatId)).first<{ id: string }>();
  if (!user) {
    await reply(env, chatId, COPY.unlinked);
    return;
  }

  const title = clip(message);
  if (!title) return; // blank text is ignored, no reply (UX_Flows §3.1)
  await reply(env, chatId, await capture(env.DB, user.id, updateId, title, message.trim().length > MAX_TITLE_CHARS));
}

// Redeems a tg_link code. The three statements run as one D1 batch (one transaction), so the code is spent exactly when
// the link is made, and two deliveries of the same code cannot both win. The first statement frees the chat from any
// other user who linked it earlier: the latest link wins, so a chat never maps to two users.
async function redeem(db: D1Database, chatId: number, code: string | undefined): Promise<string> {
  if (code === undefined) return COPY.startBare;
  if (!CODE_RE.test(code)) return COPY.restart;

  const now = Date.now();
  const chat = String(chatId);
  const valid = "code = ?2 AND purpose = 'tg_link' AND used_at IS NULL AND expires_at > ?3";
  const [, link] = await db.batch<{ id: string }>([
    db
      .prepare(
        `UPDATE users SET telegram_chat_id = NULL, channel = CASE WHEN channel = 'telegram' THEN NULL ELSE channel END
         WHERE telegram_chat_id = ?1 AND EXISTS (SELECT 1 FROM handoffs WHERE ${valid} AND user_id != users.id)`,
      )
      .bind(chat, code, now),
    db
      .prepare(`UPDATE users SET telegram_chat_id = ?1, channel = 'telegram' WHERE id = (SELECT user_id FROM handoffs WHERE ${valid}) RETURNING id`)
      .bind(chat, code, now),
    db.prepare(`UPDATE handoffs SET used_at = ?3 WHERE ${valid}`).bind(chat, code, now),
  ]);
  return link.results.length ? COPY.linked : COPY.restart;
}

// Trimmed, cut to the title limit without leaving half a surrogate pair, trimmed again.
function clip(message: string): string {
  let t = message.trim();
  if (t.length > MAX_TITLE_CHARS) {
    t = t.slice(0, MAX_TITLE_CHARS);
    const last = t.charCodeAt(t.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) t = t.slice(0, -1);
    t = t.trimEnd();
  }
  return t;
}

// Creates the Inbox task through the same op path as /api/sync. The op id comes from Telegram's update_id, so a retried
// delivery finds its op in the ledger and does nothing; the client pulls the task with its next sync. The cursor is the
// largest safe integer so the pull inside sync() returns no rows: the result here is only the `rejected` list.
async function capture(db: D1Database, uid: string, updateId: number, title: string, cut: boolean): Promise<string> {
  const now = Date.now();
  const op = { op_id: `tg:${updateId}`, entity: "tasks" as const, id: crypto.randomUUID(), fields: { title, state: "inbox", created_at: now, updated_at: now } };
  const { rejected } = await sync(db, uid, Number.MAX_SAFE_INTEGER, [op], now);
  if (rejected.length) return COPY.notAdded;
  return cut ? COPY.addedCut : COPY.added;
}
