
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { SyncResponse } from "./protocol";
import { sendMessage } from "./telegram";

// Worker + D1 tests for slice 11 (Tech_Scope.md §6, §9): real local D1, outbound Telegram fetch mocked with
// vi.spyOn (vitest-pool-workers 0.22 has no fetchMock). The secrets are not bound in vitest.config.ts, so the
// handlers are called through `worker.fetch` with an env that adds them.

const TOKEN = "123456:TEST-TOKEN";
const WEBHOOK_PATH = "path-secret";
const WEBHOOK_SECRET = "header-secret";
const testEnv = { ...env, TG_BOT_USERNAME: "ember_test_bot", TG_BOT_TOKEN: TOKEN, TG_WEBHOOK_SECRET: WEBHOOK_SECRET, TG_WEBHOOK_PATH: WEBHOOK_PATH };

const ORIGIN = "https://ember.test";
const HEADER = "X-Telegram-Bot-Api-Secret-Token";

interface Sent {
  chat_id: number | string;
  text: string;
  reply_markup?: unknown;
}
let sent: Sent[] = [];
let answers: { callback_query_id: string }[] = [];
let botStatus = 200;

beforeEach(() => {
  sent = [];
  answers = [];
  botStatus = 200;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    // Button taps are answered (slice 13); buttons.test.ts covers what they do. Here only the answer is recorded.
    if (url === `https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`) {
      answers.push(JSON.parse(String(init?.body)) as { callback_query_id: string });
      return Response.json({ ok: true, result: true });
    }
    if (url !== `https://api.telegram.org/bot${TOKEN}/sendMessage`) throw new Error(`unexpected outbound fetch: ${url}`);
    sent.push(JSON.parse(String(init?.body)) as Sent);
    return botStatus === 200 ? Response.json({ ok: true, result: { message_id: 1 } }) : Response.json({ ok: false, description: "nope" }, { status: botStatus });
  });
});
afterEach(() => vi.restoreAllMocks());

const callWorker = (request: Request) => worker.fetch(request as Parameters<typeof worker.fetch>[0], testEnv);

function link(cookie?: string): Promise<Response> {
  return callWorker(new Request(`${ORIGIN}/api/tg/link`, { method: "POST", headers: cookie ? { Cookie: cookie } : {} }));
}

// Posts a raw body to the webhook. `path` and `header` default to the right values; pass null to omit the header.
function hook(body: unknown, opts: { path?: string; header?: string | null; method?: string } = {}): Promise<Response> {
  const { path = WEBHOOK_PATH, header = WEBHOOK_SECRET, method = "POST" } = opts;
  return callWorker(
    new Request(`${ORIGIN}/api/tg/${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(header === null ? {} : { [HEADER]: header }) },
      body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

let nextUpdate = 1000;
const update = (text: string | undefined, chatId = 4242, overrides: Record<string, unknown> = {}) => ({
  update_id: nextUpdate++,
  message: { message_id: 7, date: 0, chat: { id: chatId, type: "private" }, ...(text === undefined ? {} : { text }) },
  ...overrides,
});

// A fresh chat id per test, so tests never share a linked chat.
let nextChat = 5_000_000;
const freshChat = () => nextChat++;

// Creates a user and a tg_link code through the real route, as Settings would.
async function startLink(cookie?: string) {
  const res = await link(cookie);
  const url = ((await res.json()) as { url: string }).url;
  const code = new URL(url).searchParams.get("start")!;
  return { res, url, code, cookie: res.headers.get("Set-Cookie")?.split(";")[0] ?? cookie! };
}

// A user whose chat is linked, ready to capture.
async function linkedUser(chat = freshChat()) {
  const { code, cookie } = await startLink();
  await hook(update(`/start ${code}`, chat));
  sent = [];
  return { chat, cookie };
}

const uidOf = (cookie: string) => cookie.split("=")[1];
const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())!.n;
const userRow = (uid: string) => env.DB.prepare("SELECT telegram_chat_id, channel FROM users WHERE id = ?").bind(uid).first<{ telegram_chat_id: string | null; channel: string | null }>();

async function pull(cookie: string): Promise<SyncResponse> {
  const res = await exports.default.fetch(
    new Request(`${ORIGIN}/api/sync`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ cursor: 0, ops: [] }) }),
  );
  return (await res.json()) as SyncResponse;
}

describe("POST /api/tg/link", () => {
  it("creates a user when there is no cookie, as sync does, and returns a t.me deep link", async () => {
    const usersBefore = await count("SELECT COUNT(*) AS n FROM users");
    const { res, url, code, cookie } = await startLink();
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toMatch(/^ember_uid=[A-Za-z0-9_-]{22}; HttpOnly; Secure; SameSite=Lax/);
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(usersBefore + 1);
    expect(url).toBe(`https://t.me/ember_test_bot?start=${code}`);
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/); // 128 bits, base64url

    const row = await env.DB.prepare("SELECT * FROM handoffs WHERE code = ?").bind(code).first<{ user_id: string; purpose: string; expires_at: number; used_at: number | null }>();
    expect(row).toMatchObject({ user_id: uidOf(cookie), purpose: "tg_link", used_at: null });
    const ttl = row!.expires_at - Date.now();
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000);
  });

  it("reuses the user named by a valid cookie", async () => {
    const first = await startLink();
    const usersBefore = await count("SELECT COUNT(*) AS n FROM users");
    const second = await startLink(first.cookie);
    expect(second.res.headers.get("Set-Cookie")).toContain(uidOf(first.cookie));
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(usersBefore);
    expect(second.code).not.toBe(first.code);
  });

  it("refuses anything but POST", async () => {
    const res = await callWorker(new Request(`${ORIGIN}/api/tg/link`, { method: "GET" }));
    expect(res.status).toBe(405);
  });
});

describe("webhook authentication", () => {
  it("answers 404 with no body when the path secret is wrong", async () => {
    const res = await hook(update("hello"), { path: "wrong-path" });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(sent).toEqual([]);
  });

  it("answers 404 when the path is right but the header is wrong", async () => {
    const res = await hook(update("hello"), { header: "wrong-secret" });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });

  it("answers 404 when the path is right but the header is missing", async () => {
    const res = await hook(update("hello"), { header: null });
    expect(res.status).toBe(404);
  });

  it("answers 404 when the header is right but the path is not", async () => {
    expect((await hook(update("hello"), { path: "other-path" })).status).toBe(404);
  });

  it("answers 404 for every request when the secrets are not configured", async () => {
    const bare = { ...testEnv, TG_WEBHOOK_PATH: undefined, TG_WEBHOOK_SECRET: undefined };
    const res = await worker.fetch(new Request(`${ORIGIN}/api/tg/undefined`, { method: "POST", headers: { [HEADER]: "undefined" }, body: "{}" }), bare);
    expect(res.status).toBe(404);
  });

  it("answers 404 to a GET on the right path with the right header", async () => {
    expect((await hook("", { method: "GET" })).status).toBe(404);
  });
});

describe("/start <code>", () => {
  it("links the user, marks the code used, and replies", async () => {
    const { code, cookie } = await startLink();
    const chat = freshChat();
    const res = await hook(update(`/start ${code}`, chat));
    expect(res.status).toBe(200);

    expect(await userRow(uidOf(cookie))).toEqual({ telegram_chat_id: String(chat), channel: "telegram" });
    expect(await count("SELECT COUNT(*) AS n FROM handoffs WHERE code = ? AND used_at IS NOT NULL", code)).toBe(1);
    expect(sent).toEqual([{ chat_id: chat, text: "Linked. Ember will nudge you here." }]);
  });

  it("has the next tick plan the day afresh, so what the old channel never sent does not go out in a burst (audit #15)", async () => {
    const { code, cookie } = await startLink();
    await env.DB.prepare("UPDATE users SET planned_until = 9e15, planned_rev = 0 WHERE id = ?").bind(uidOf(cookie)).run();
    await hook(update(`/start ${code}`, freshChat()));
    expect(await env.DB.prepare("SELECT planned_until FROM users WHERE id = ?").bind(uidOf(cookie)).first()).toEqual({ planned_until: null });
  });

  it("refuses the same code a second time and leaves the first link alone", async () => {
    const { code, cookie } = await startLink();
    const first = freshChat();
    await hook(update(`/start ${code}`, first));
    sent = [];

    const second = freshChat();
    const res = await hook(update(`/start ${code}`, second));
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chat_id: second });
    expect(sent[0].text).not.toMatch(/^Linked/);
    expect(await userRow(uidOf(cookie))).toEqual({ telegram_chat_id: String(first), channel: "telegram" });
  });

  it("refuses an expired code", async () => {
    const { code, cookie } = await startLink();
    await env.DB.prepare("UPDATE handoffs SET expires_at = ? WHERE code = ?").bind(Date.now() - 1, code).run();
    const res = await hook(update(`/start ${code}`));
    expect(res.status).toBe(200);
    expect(sent[0].text).toMatch(/Settings/);
    expect(await userRow(uidOf(cookie))).toEqual({ telegram_chat_id: null, channel: null });
    expect(await count("SELECT COUNT(*) AS n FROM handoffs WHERE code = ? AND used_at IS NOT NULL", code)).toBe(0);
  });

  it("refuses a code that does not exist, a malformed one, and a bare /start", async () => {
    for (const text of ["/start AAAAAAAAAAAAAAAAAAAAAA", "/start not-a-code", "/start"]) {
      sent = [];
      expect((await hook(update(text))).status).toBe(200);
      expect(sent).toHaveLength(1);
      expect(sent[0].text).toMatch(/Settings/);
    }
  });

  it("refuses a code of another purpose", async () => {
    const { cookie } = await startLink();
    await env.DB.prepare("INSERT INTO handoffs (code, user_id, purpose, expires_at) VALUES (?, ?, 'install', ?)").bind("INSTALLCODE-INSTALLCO", uidOf(cookie), Date.now() + 60_000).run();
    await hook(update("/start INSTALLCODE-INSTALLCO"));
    expect(await userRow(uidOf(cookie))).toEqual({ telegram_chat_id: null, channel: null });
  });

  it("moves a chat to the user who linked it last", async () => {
    const chat = freshChat();
    const a = await startLink();
    await hook(update(`/start ${a.code}`, chat));
    const b = await startLink();
    await hook(update(`/start ${b.code}`, chat));

    expect(await userRow(uidOf(a.cookie))).toEqual({ telegram_chat_id: null, channel: null });
    expect(await userRow(uidOf(b.cookie))).toEqual({ telegram_chat_id: String(chat), channel: "telegram" });
  });

  it("answers 200 even when the Bot API refuses the reply", async () => {
    botStatus = 500;
    const { code, cookie } = await startLink();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await hook(update(`/start ${code}`));
    expect(res.status).toBe(200);
    expect(await userRow(uidOf(cookie))).toMatchObject({ channel: "telegram" });
    expect(errors).toHaveBeenCalled();
    expect(JSON.stringify(errors.mock.calls)).not.toContain(TOKEN);
  });
});

describe("capture", () => {
  const tasksOf = (uid: string) => env.DB.prepare("SELECT * FROM tasks WHERE user_id = ?").bind(uid).all<{ id: string; title: string; state: string; created_at: number }>();

  it("turns plain text from a linked chat into one Inbox task, even when the update is delivered twice", async () => {
    const { chat, cookie } = await linkedUser();
    const body = update("  Email the landlord  ", chat);

    expect((await hook(body)).status).toBe(200);
    expect((await hook(body)).status).toBe(200); // Telegram's retry: same update_id

    const { results } = await tasksOf(uidOf(cookie));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ title: "Email the landlord", state: "inbox" });
    expect(await count("SELECT COUNT(*) AS n FROM ops WHERE user_id = ? AND op_id = ?", uidOf(cookie), `tg:${body.update_id}`)).toBe(1);
    expect(sent[0]).toEqual({ chat_id: chat, text: "Added" });

    // The client gets it with its next sync.
    const pulled = await pull(cookie);
    expect(pulled.changes).toHaveLength(1);
    expect(pulled.changes[0]).toMatchObject({ entity: "tasks", row: { id: results[0].id, title: "Email the landlord", state: "inbox" } });
  });

  it("makes two tasks from two different updates with the same text", async () => {
    const { chat, cookie } = await linkedUser();
    await hook(update("Buy milk", chat));
    await hook(update("Buy milk", chat));
    expect((await tasksOf(uidOf(cookie))).results).toHaveLength(2);
  });

  it("cuts a long message to 500 characters and says so", async () => {
    const { chat, cookie } = await linkedUser();
    await hook(update("x".repeat(600), chat));
    const { results } = await tasksOf(uidOf(cookie));
    expect(results[0].title).toBe("x".repeat(500));
    expect(sent[0].text).toMatch(/^Added/);
    expect(sent[0].text).toMatch(/500/);
  });

  it("does not leave half a surrogate pair at the cut", async () => {
    const { chat, cookie } = await linkedUser();
    await hook(update("x".repeat(499) + "\u{1F600}", chat)); // the emoji straddles character 500
    const { results } = await tasksOf(uidOf(cookie));
    expect(results[0].title).toBe("x".repeat(499));
  });

  it("ignores blank text, creates nothing, and sends no reply", async () => {
    const { chat, cookie } = await linkedUser();
    expect((await hook(update("   \n ", chat))).status).toBe(200);
    expect((await tasksOf(uidOf(cookie))).results).toHaveLength(0);
    expect(sent).toEqual([]);
  });

  it("does not capture other commands as tasks", async () => {
    const { chat, cookie } = await linkedUser();
    await hook(update("/help", chat));
    expect((await tasksOf(uidOf(cookie))).results).toHaveLength(0);
    expect(sent).toHaveLength(1);
  });

  it("creates nothing for text from an unlinked chat and says the chat is not linked", async () => {
    const tasksBefore = await count("SELECT COUNT(*) AS n FROM tasks");
    const opsBefore = await count("SELECT COUNT(*) AS n FROM ops");
    const chat = freshChat();
    expect((await hook(update("Remember the milk", chat))).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM tasks")).toBe(tasksBefore);
    expect(await count("SELECT COUNT(*) AS n FROM ops")).toBe(opsBefore);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chat_id: chat });
    expect(sent[0].text).toMatch(/isn't linked/);
  });

  it("answers 200 and still creates the task when the Bot API refuses the reply", async () => {
    const { chat, cookie } = await linkedUser();
    botStatus = 502;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await hook(update("Book dentist", chat))).status).toBe(200);
    expect((await tasksOf(uidOf(cookie))).results).toHaveLength(1);
  });
});

describe("update shape", () => {
  it("answers 400 to a body that is not JSON or has no update_id", async () => {
    expect((await hook("not json")).status).toBe(400);
    expect((await hook([])).status).toBe(400);
    expect((await hook({ message: {} })).status).toBe(400);
    expect((await hook({ update_id: "1" })).status).toBe(400);
  });

  it("answers 200 and does nothing for update kinds it does not handle", async () => {
    const chat = freshChat();
    const ignored: unknown[] = [
      { update_id: nextUpdate++, edited_message: { message_id: 1, chat: { id: chat, type: "private" }, text: "edited" } },
      update(undefined, chat), // a photo or sticker: no text
      update("hello group", chat, { message: { message_id: 1, chat: { id: chat, type: "group" }, text: "hello group" } }),
      update("odd", chat, { message: { message_id: 1, chat: { id: "not-a-number", type: "private" }, text: "odd" } }),
      update("odd", chat, { message: { message_id: 1, chat: { id: chat, type: "private" }, text: 42 } }),
    ];
    for (const body of ignored) expect((await hook(body)).status).toBe(200);
    expect(sent).toEqual([]);
  });
});

describe("button taps", () => {
  it("answers a tap that names no usable message, and does nothing else", async () => {
    const bodies = [
      { update_id: nextUpdate++, callback_query: { id: "abc", data: "d" } }, // an inline-mode tap: no message
      { update_id: nextUpdate++, callback_query: { id: "def", data: "d", message: { message_id: 1, chat: { id: -100, type: "group" } } } },
      { update_id: nextUpdate++, callback_query: { id: "ghi" } }, // no data
    ];
    for (const body of bodies) expect((await hook(body)).status).toBe(200);
    expect(answers.map((a) => a.callback_query_id)).toEqual(["abc", "def", "ghi"]);
    expect(sent).toEqual([]);
  });

  it("ignores a callback_query without an id", async () => {
    expect((await hook({ update_id: nextUpdate++, callback_query: { data: "d" } })).status).toBe(200);
    expect(answers).toEqual([]);
  });
});

describe("sendMessage", () => {
  it("posts chat_id, text and reply_markup to the Bot API", async () => {
    const markup = { inline_keyboard: [[{ text: "Open today", url: "https://ember.test/" }]] };
    await sendMessage(testEnv, 99, "hello", markup);
    expect(sent).toEqual([{ chat_id: 99, text: "hello", reply_markup: markup }]);
  });

  it("throws on a non-2xx answer, and the error does not carry the token", async () => {
    botStatus = 403;
    const err = await sendMessage(testEnv, 99, "hello").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/403/);
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it("throws when the request itself fails, without the token in the message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/sendMessage`));
    const err = await sendMessage(testEnv, 99, "hello").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain(TOKEN);
  });
});
