import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import { newUserId } from "./identity";
import { runTick } from "./scheduler";

// Worker + D1 tests for POST /api/handoff/redeem (Tech_Scope.md §6, slice 12): real local D1, called through worker.fetch.

const URL_REDEEM = "https://ember.test/api/handoff/redeem";
const HOUR = 3_600_000;

const redeem = (body: unknown, method = "POST") =>
  worker.fetch(
    new Request(URL_REDEEM, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body) }) as Parameters<typeof worker.fetch>[0],
    env,
  );

async function user() {
  const id = newUserId();
  await env.DB.prepare("INSERT INTO users (id, created_at, last_seen_at) VALUES (?1, 0, 0)").bind(id, ).run();
  return id;
}
async function code(uid: string, opts: { purpose?: string; expiresIn?: number } = {}) {
  const c = newUserId();
  await env.DB.prepare("INSERT INTO handoffs (code, user_id, purpose, expires_at) VALUES (?1, ?2, ?3, ?4)").bind(c, uid, opts.purpose ?? "login_link", Date.now() + (opts.expiresIn ?? 24 * HOUR)).run();
  return c;
}
async function send(uid: string) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sends (id, user_id, day, kind, due_at) VALUES (?1, ?2, '2026-10-05', 'morning', 0)").bind(id, uid).run();
  return id;
}
const actedAt = async (id: string) => (await env.DB.prepare("SELECT acted_at FROM sends WHERE id = ?").bind(id).first<{ acted_at: number | null }>())!.acted_at;

describe("POST /api/handoff/redeem", () => {
  it("sets the cookie for the code's user and answers 200", async () => {
    const uid = await user();
    const res = await redeem({ code: await code(uid) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toBe(`ember_uid=${uid}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=34560000`);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("sets the cookie for the right user when several users have codes", async () => {
    const [a, b] = [await user(), await user()];
    const [codeA, codeB] = [await code(a), await code(b)];
    expect((await redeem({ code: codeB })).headers.get("Set-Cookie")).toContain(`ember_uid=${b};`);
    expect((await redeem({ code: codeA })).headers.get("Set-Cookie")).toContain(`ember_uid=${a};`);
  });

  it("can be redeemed again within its 24 hours, since the same Telegram message can be tapped twice", async () => {
    const c = await code(await user());
    expect((await redeem({ code: c })).status).toBe(200);
    expect((await redeem({ code: c })).status).toBe(200);
    expect((await env.DB.prepare("SELECT used_at FROM handoffs WHERE code = ?").bind(c).first<{ used_at: number | null }>())!.used_at).toBeNull();
  });

  it("answers 404, with no cookie, for an expired code", async () => {
    const res = await redeem({ code: await code(await user(), { expiresIn: -1000 }) });
    expect(res.status).toBe(404);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("answers 404 for a code that does not exist, has another purpose, or whose user is gone", async () => {
    const uid = await user();
    expect((await redeem({ code: newUserId() })).status).toBe(404);
    expect((await redeem({ code: await code(uid, { purpose: "tg_link" }) })).status).toBe(404);
    expect((await redeem({ code: await code(uid, { purpose: "install" }) })).status).toBe(404);
    const orphan = await code(await user());
    await env.DB.prepare("DELETE FROM users WHERE id = (SELECT user_id FROM handoffs WHERE code = ?)").bind(orphan).run();
    expect((await redeem({ code: orphan })).status).toBe(404);
  });

  it("answers 404 for a body that is not a code", async () => {
    for (const body of ["not json", "[]", "null", {}, { code: 5 }, { code: "short" }, { code: "x".repeat(2000) }]) expect((await redeem(body)).status).toBe(404);
  });

  it("refuses anything but POST", async () => {
    expect((await redeem({}, "GET")).status).toBe(405);
  });

  it("marks the named send acted, once, and ignores a send that belongs to someone else", async () => {
    const uid = await user();
    const other = await user();
    const mine = await send(uid);
    const theirs = await send(other);
    const c = await code(uid);

    expect((await redeem({ code: c, s: mine })).status).toBe(200);
    const first = await actedAt(mine);
    expect(first).toBeGreaterThan(0);

    await redeem({ code: c, s: mine });
    expect(await actedAt(mine)).toBe(first); // the first tap is the one that counts

    expect((await redeem({ code: c, s: theirs })).status).toBe(200);
    expect(await actedAt(theirs)).toBeNull();
    expect((await redeem({ code: c, s: "no-such-send" })).status).toBe(200);
  });

  it("is not made to act by a send id with no code", async () => {
    const uid = await user();
    const s = await send(uid);
    expect((await redeem({ s })).status).toBe(404);
    expect(await actedAt(s)).toBeNull();
  });
});

describe("the link button end to end", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ok: true, result: { message_id: 1 } }));
  });
  afterEach(() => vi.restoreAllMocks());

  it("a code from a sent message's button signs the tapper in as the message's user and marks the send acted", async () => {
    const uid = await user();
    await env.DB.prepare("UPDATE users SET channel = 'telegram', telegram_chat_id = '8123123', planned_until = 9e15, planned_rev = 0 WHERE id = ?").bind(uid).run();
    const id = await send(uid);
    const now = Date.now();
    await env.DB.prepare("UPDATE sends SET due_at = ?, text = 'Morning' WHERE id = ?").bind(now - 1000, id).run();

    await runTick({ ...env, TG_BOT_TOKEN: "123456:TEST-TOKEN" }, now);

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)) as { reply_markup: { inline_keyboard: { url: string }[][] } };
    const url = new URL(body.reply_markup.inline_keyboard[0][0].url);
    expect(url.searchParams.get("s")).toBe(id);

    const res = await redeem({ code: url.searchParams.get("h"), s: url.searchParams.get("s") });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain(`ember_uid=${uid};`);
    expect(await actedAt(id)).toBeGreaterThan(0);
  });
});
