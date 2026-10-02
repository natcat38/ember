import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";

// Audit #34: /api/* is limited per IP address (120 a minute, wrangler.jsonc); the Telegram webhook is not.
it("answers 429 once one address passes the limit, and leaves other addresses and the webhook alone", async () => {
  const call = (path: string, ip: string) => exports.default.fetch(new Request(`https://ember.test${path}`, { headers: { "CF-Connecting-IP": ip } }));
  const statuses: number[] = [];
  for (let i = 0; i < 121; i++) statuses.push((await call("/api/me", "203.0.113.7")).status);
  expect(statuses.slice(0, 120).every((s) => s !== 429)).toBe(true);
  expect(statuses[120]).toBe(429);
  expect((await call("/api/me", "203.0.113.8")).status).not.toBe(429);
  expect((await call("/api/tg/not-the-secret", "203.0.113.7")).status).not.toBe(429);
}, 20_000);
