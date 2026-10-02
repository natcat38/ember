import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { b64uEncode, MAX_SUBSCRIPTIONS, rawKey } from "./push";
import { handleSubscriptions, type SubscriptionEnv } from "./subscriptions";

// Slice 18 (Tech_Scope.md §10, ADR-0002): POST /api/push/subscribe and /unsubscribe, on a real local D1. The handlers are
// called with VAPID values added to the env, as scheduler.test.ts adds the bot token; the routing is checked through
// the Worker's own fetch.

const configured: SubscriptionEnv = { ...env, VAPID_PUBLIC_KEY: "BPUBLIC", VAPID_PRIVATE_KEY: "private", VAPID_SUBJECT: "mailto:ember@example.com" };

async function browserKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  return {
    p256dh: b64uEncode(await rawKey(pair.publicKey)),
    auth: b64uEncode(crypto.getRandomValues(new Uint8Array(16))),
  };
}
const newSub = async (n: number | string) => ({ endpoint: `https://push.example.net/send/${n}`, expirationTime: null, keys: await browserKeys() });

const good = await newSub("v"); // one valid subscription the rejection cases below spoil one field of

const call = (action: string, body: unknown, cookie?: string, e: SubscriptionEnv = configured, method = "POST") =>
  handleSubscriptions(
    new Request(`https://ember.test/api/push/${action}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body) }),
    e,
    action,
  );

async function newUser(): Promise<{ cookie: string; uid: string }> {
  const res = await exports.default.fetch(new Request("https://ember.test/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"cursor":0,"ops":[]}' }));
  const cookie = res.headers.get("Set-Cookie")!.split(";")[0];
  return { cookie, uid: cookie.split("=")[1] };
}

const channelOf = async (uid: string) => (await env.DB.prepare("SELECT channel FROM users WHERE id = ?").bind(uid).first<{ channel: string | null }>())!.channel;
const endpointsOf = async (uid: string) =>
  (await env.DB.prepare("SELECT endpoint FROM push_subscriptions WHERE user_id = ? ORDER BY created_at, id").bind(uid).all<{ endpoint: string }>()).results.map((r) => r.endpoint);

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM push_subscriptions").run();
});

describe("POST /api/push/subscribe", () => {
  it("stores the subscription and switches the user's channel to push", async () => {
    const { cookie, uid } = await newUser();
    const sub = await newSub(1);
    const res = await call("subscribe", sub, cookie);
    expect(res.status).toBe(200);
    expect(await endpointsOf(uid)).toEqual([sub.endpoint]);
    expect(await env.DB.prepare("SELECT p256dh, auth FROM push_subscriptions WHERE user_id = ?").bind(uid).first()).toEqual(sub.keys);
    expect(await channelOf(uid)).toBe("push");
  });

  it("makes a user and sets the cookie when there is none, as the other write routes do", async () => {
    const res = await call("subscribe", await newSub("fresh"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toMatch(/^ember_uid=[\w-]{22};/);
  });

  it("switching from Telegram keeps the chat id, so switching back is one tap", async () => {
    const { cookie, uid } = await newUser();
    await env.DB.prepare("UPDATE users SET channel = 'telegram', telegram_chat_id = '42' WHERE id = ?").bind(uid).run();
    await call("subscribe", await newSub(2), cookie);
    expect(await env.DB.prepare("SELECT channel, telegram_chat_id FROM users WHERE id = ?").bind(uid).first()).toEqual({ channel: "push", telegram_chat_id: "42" });
  });

  it("is idempotent: the same browser twice is one row, with the newer keys", async () => {
    const { cookie, uid } = await newUser();
    const first = await newSub(3);
    const again = { ...first, keys: await browserKeys() };
    await call("subscribe", first, cookie);
    await call("subscribe", again, cookie);
    expect(await endpointsOf(uid)).toEqual([first.endpoint]);
    expect(await env.DB.prepare("SELECT p256dh FROM push_subscriptions WHERE user_id = ?").bind(uid).first()).toEqual({ p256dh: again.keys.p256dh });
  });

  it("keeps several browsers, but only the newest MAX_SUBSCRIPTIONS", async () => {
    const { cookie, uid } = await newUser();
    const subs = [await newSub("a"), await newSub("b"), await newSub("c")];
    for (const [i, s] of subs.entries()) {
      await call("subscribe", s, cookie);
      await env.DB.prepare("UPDATE push_subscriptions SET created_at = ?1 WHERE endpoint = ?2").bind(1000 + i, s.endpoint).run(); // the clock is coarse
    }
    expect(MAX_SUBSCRIPTIONS).toBe(2);
    expect(await endpointsOf(uid)).toEqual([subs[1].endpoint, subs[2].endpoint]);
  });

  it("moves a browser's subscription to whoever presents it now, leaving the old owner none", async () => {
    const a = await newUser();
    const b = await newUser();
    const sub = await newSub("shared-browser");
    await call("subscribe", sub, a.cookie);
    await call("subscribe", sub, b.cookie);
    expect(await endpointsOf(a.uid)).toEqual([]);
    expect(await endpointsOf(b.uid)).toEqual([sub.endpoint]);
  });

  it("hands the old owner's channel on when its last browser moves away, and has the next tick replan both users (audit #19, #15)", async () => {
    const a = await newUser(); // chat linked: falls back to Telegram
    const c = await newUser(); // no chat: reminders stay in the app
    const d = await newUser(); // keeps a second browser, so stays on push
    const b = await newUser();
    const [s1, s2, s3, s4] = [await newSub("m1"), await newSub("m2"), await newSub("m3"), await newSub("m4")];
    for (const [user, sub] of [[a, s1], [c, s2], [d, s3], [d, s4]] as const) await call("subscribe", sub, user.cookie);
    await env.DB.prepare("UPDATE users SET telegram_chat_id = '77' WHERE id = ?").bind(a.uid).run();
    await env.DB.prepare("UPDATE users SET planned_until = 9e15").run();

    for (const sub of [s1, s2, s3]) await call("subscribe", sub, b.cookie);

    expect(await channelOf(a.uid)).toBe("telegram");
    expect(await channelOf(c.uid)).toBeNull();
    expect(await channelOf(d.uid)).toBe("push");
    expect(await channelOf(b.uid)).toBe("push");
    const planned = async (uid: string) => (await env.DB.prepare("SELECT planned_until FROM users WHERE id = ?").bind(uid).first<{ planned_until: number | null }>())!.planned_until;
    expect([await planned(a.uid), await planned(c.uid), await planned(b.uid)]).toEqual([null, null, null]);
    expect(await planned(d.uid)).toBe(9e15); // still on push: nothing changed for them
  });

  it("answers 503 when VAPID is not configured, and stores nothing", async () => {
    const { cookie, uid } = await newUser();
    const res = await call("subscribe", await newSub(4), cookie, { ...env, VAPID_PUBLIC_KEY: "" });
    expect(res.status).toBe(503);
    expect(await endpointsOf(uid)).toEqual([]);
    expect(await channelOf(uid)).toBeNull();
  });

  it("is reachable at /api/push/subscribe on the Worker, and is a 503 there while the VAPID var is empty", async () => {
    const res = await exports.default.fetch(new Request("https://ember.test/api/push/subscribe", { method: "POST", body: JSON.stringify(await newSub(5)) }));
    expect(res.status).toBe(503);
    expect((await exports.default.fetch(new Request("https://ember.test/api/push/nope", { method: "POST" }))).status).toBe(404);
  });

  describe("rejects a body that is not a browser's PushSubscription", () => {
    const cases: [string, unknown][] = [
      ["not JSON", "{nope"],
      ["an array", []],
      ["no endpoint", { keys: good.keys }],
      ["an endpoint that is not a string", { ...good, endpoint: 5 }],
      ["an http endpoint", { ...good, endpoint: "http://push.example.net/x" }],
      ["a javascript: endpoint", { ...good, endpoint: "javascript:alert(1)" }],
      ["an endpoint with credentials", { ...good, endpoint: "https://user:pw@push.example.net/x" }],
      ["an endpoint on another port", { ...good, endpoint: "https://push.example.net:8443/x" }],
      ["an IP-address endpoint", { ...good, endpoint: "https://10.0.0.1/x" }],
      ["a localhost endpoint", { ...good, endpoint: "https://localhost/x" }],
      ["a dotless host", { ...good, endpoint: "https://intranet/x" }],
      ["an endpoint over 2048 characters", { ...good, endpoint: `https://push.example.net/${"a".repeat(2050)}` }],
      ["no keys", { endpoint: good.endpoint }],
      ["keys that are not an object", { endpoint: good.endpoint, keys: "x" }],
      ["a p256dh that is not base64url", { endpoint: good.endpoint, keys: { ...good.keys, p256dh: "not base64!" } }],
      ["a p256dh of the wrong length", { endpoint: good.endpoint, keys: { ...good.keys, p256dh: b64uEncode(new Uint8Array(33)) } }],
      ["a p256dh that is not a point on the curve", { endpoint: good.endpoint, keys: { ...good.keys, p256dh: b64uEncode(Uint8Array.of(4, ...new Uint8Array(64).fill(7))) } }],
      ["an auth of the wrong length", { endpoint: good.endpoint, keys: { ...good.keys, auth: b64uEncode(new Uint8Array(8)) } }],
      ["a key that is a number", { endpoint: good.endpoint, keys: { ...good.keys, auth: 5 } }],
      ["a body over 4 KB", { ...good, padding: "x".repeat(5000) }],
    ];
    for (const [name, body] of cases) {
      it(name, async () => {
        const { cookie, uid } = await newUser();
        const res = await call("subscribe", body, cookie);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "bad_request" });
        expect(await endpointsOf(uid)).toEqual([]);
        expect(await channelOf(uid)).toBeNull();
      });
    }
  });

  it("answers 405 to anything but POST", async () => {
    const res = await call("subscribe", "", undefined, configured, "GET");
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });
});

describe("POST /api/push/unsubscribe", () => {
  it("removes the subscription, and with none left sets the channel back to null when Telegram is not linked", async () => {
    const { cookie, uid } = await newUser();
    const sub = await newSub(10);
    await call("subscribe", sub, cookie);
    const res = await call("unsubscribe", { endpoint: sub.endpoint }, cookie);
    expect(res.status).toBe(200);
    expect(await endpointsOf(uid)).toEqual([]);
    expect(await channelOf(uid)).toBeNull();
  });

  it("sets the channel back to telegram when a chat is linked", async () => {
    const { cookie, uid } = await newUser();
    await env.DB.prepare("UPDATE users SET channel = 'telegram', telegram_chat_id = '42' WHERE id = ?").bind(uid).run();
    const sub = await newSub(11);
    await call("subscribe", sub, cookie);
    await call("unsubscribe", { endpoint: sub.endpoint }, cookie);
    expect(await channelOf(uid)).toBe("telegram");
  });

  it("keeps the channel on push while another browser is still subscribed", async () => {
    const { cookie, uid } = await newUser();
    const [one, two] = [await newSub(12), await newSub(13)];
    await call("subscribe", one, cookie);
    await call("subscribe", two, cookie);
    await call("unsubscribe", { endpoint: one.endpoint }, cookie);
    expect(await endpointsOf(uid)).toEqual([two.endpoint]);
    expect(await channelOf(uid)).toBe("push");
  });

  it("never touches another user's subscription, and does not create a user for a stranger", async () => {
    const owner = await newUser();
    const sub = await newSub(14);
    await call("subscribe", sub, owner.cookie);
    const before = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n;
    const stranger = await newUser();
    expect((await call("unsubscribe", { endpoint: sub.endpoint }, stranger.cookie)).status).toBe(200);
    const res = await call("unsubscribe", { endpoint: sub.endpoint });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(await endpointsOf(owner.uid)).toEqual([sub.endpoint]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n).toBe(before + 1); // only `stranger`
  });

  it("leaves a Telegram user's channel alone", async () => {
    const { cookie, uid } = await newUser();
    await env.DB.prepare("UPDATE users SET channel = 'telegram', telegram_chat_id = '42' WHERE id = ?").bind(uid).run();
    await call("unsubscribe", { endpoint: "https://push.example.net/send/none" }, cookie);
    expect(await channelOf(uid)).toBe("telegram");
  });

  it("rejects a body without a usable endpoint, and works with VAPID off so a user can always leave", async () => {
    const { cookie } = await newUser();
    expect((await call("unsubscribe", {}, cookie)).status).toBe(400);
    expect((await call("unsubscribe", { endpoint: 5 }, cookie)).status).toBe(400);
    expect((await call("unsubscribe", { endpoint: "https://push.example.net/x" }, cookie, { ...env, VAPID_PUBLIC_KEY: "" })).status).toBe(200);
  });
});
