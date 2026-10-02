import { env, exports } from "cloudflare:workers";
import { expect, it } from "vitest";
import { handleMe } from "./me";

const me = (cookie?: string) => exports.default.fetch(new Request("https://ember.test/api/me", { headers: cookie ? { Cookie: cookie } : {} }));
const configured = { ...env, VAPID_PUBLIC_KEY: "BPUBLIC-KEY", VAPID_PRIVATE_KEY: "private", VAPID_SUBJECT: "mailto:ember@example.com" };
const meWithVapid = (cookie: string) => handleMe(new Request("https://ember.test/api/me", { headers: { Cookie: cookie } }), configured);

async function newUser(): Promise<{ cookie: string; uid: string }> {
  const res = await exports.default.fetch(
    new Request("https://ember.test/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"cursor":0,"ops":[]}' }),
  );
  const cookie = res.headers.get("Set-Cookie")!.split(";")[0];
  return { cookie, uid: cookie.split("=")[1] };
}

it("reports nothing linked for a stranger, and creates no user or cookie", async () => {
  const before = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n;
  const res = await me();
  expect(await res.json()).toEqual({ telegram: false, passkeys: 0, push: false, vapid_public_key: null });
  expect(res.headers.get("Set-Cookie")).toBeNull();
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n).toBe(before);
});

it("reports a linked Telegram chat and the passkey count", async () => {
  const { cookie, uid } = await newUser();
  expect(await (await me(cookie)).json()).toEqual({ telegram: false, passkeys: 0, push: false, vapid_public_key: null });
  await env.DB.prepare("UPDATE users SET channel = 'telegram', telegram_chat_id = '42' WHERE id = ?1").bind(uid).run();
  await env.DB.prepare("INSERT INTO credentials (id, user_id, public_key, counter, transports, created_at) VALUES ('cred-me', ?1, x'00', 0, NULL, 1)").bind(uid).run();
  expect(await (await me(cookie)).json()).toEqual({ telegram: true, passkeys: 1, push: false, vapid_public_key: null });
});

it("reports a web push subscription, and the public key the browser subscribes with once VAPID is set up", async () => {
  const { cookie, uid } = await newUser();
  expect(await (await meWithVapid(cookie)).json()).toEqual({ telegram: false, passkeys: 0, push: false, vapid_public_key: "BPUBLIC-KEY" });
  await env.DB.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?1, 'https://push.example.net/me-test', 'k', 'a', 1)").bind(uid).run();
  expect(await (await meWithVapid(cookie)).json()).toMatchObject({ push: true, vapid_public_key: "BPUBLIC-KEY" });
  expect(await (await me(cookie)).json()).toMatchObject({ push: true, vapid_public_key: null }); // the test env has no VAPID values
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id = ?1").bind(uid).run();
});

it("gives a stranger the public key too, since subscribing is how a new device starts, and holds it back while the private key is missing", async () => {
  const stranger = handleMe(new Request("https://ember.test/api/me"), configured);
  expect(await (await stranger).json()).toEqual({ telegram: false, passkeys: 0, push: false, vapid_public_key: "BPUBLIC-KEY" });
  const half = handleMe(new Request("https://ember.test/api/me"), { ...configured, VAPID_PRIVATE_KEY: undefined });
  expect((await (await half).json() as { vapid_public_key: unknown }).vapid_public_key).toBeNull();
});
