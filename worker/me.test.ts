import { env, exports } from "cloudflare:workers";
import { expect, it } from "vitest";

const me = (cookie?: string) => exports.default.fetch(new Request("https://ember.test/api/me", { headers: cookie ? { Cookie: cookie } : {} }));

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
  expect(await res.json()).toEqual({ telegram: false, passkeys: 0 });
  expect(res.headers.get("Set-Cookie")).toBeNull();
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n).toBe(before);
});

it("reports a linked Telegram chat and the passkey count", async () => {
  const { cookie, uid } = await newUser();
  expect(await (await me(cookie)).json()).toEqual({ telegram: false, passkeys: 0 });
  await env.DB.prepare("UPDATE users SET channel = 'telegram', telegram_chat_id = '42' WHERE id = ?1").bind(uid).run();
  await env.DB.prepare("INSERT INTO credentials (id, user_id, public_key, counter, transports, created_at) VALUES ('cred-me', ?1, x'00', 0, NULL, 1)").bind(uid).run();
  expect(await (await me(cookie)).json()).toEqual({ telegram: true, passkeys: 1 });
});
