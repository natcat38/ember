import { afterEach, describe, expect, it, vi } from "vitest";
import { b64uDecode, b64uEncode, encryptPayload, pushConfigured, rawKey, sendPush, type PushEnv } from "./push";
import { browserSubscription, decryptPayload, vapidKeys } from "./push-testing";

// Slice 18 (Tech_Scope.md §10, ADR-0002): Web Push with WebCrypto alone. The encryption is checked against the worked
// example in RFC 8291 section 5 and appendix A, byte for byte; the VAPID header (RFC 8292) is checked by verifying its
// signature the way a push service would; the send is driven with a stubbed fetch.

afterEach(() => vi.restoreAllMocks());

const text = (s: string) => new TextEncoder().encode(s);
const NOW = Date.parse("2026-10-05T00:00:00Z");

// --- RFC 8291, section 5 and appendix A -----------------------------------------------------------------------------

const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  // The request body of section 5: the 86-byte header, then the ciphertext (appendix A).
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

async function privateKeyFrom(d: string, publicRaw: string, usage: "ECDH" | "ECDSA", usages: string[]): Promise<CryptoKey> {
  const pub = b64uDecode(publicRaw);
  const jwk = { kty: "EC", crv: "P-256", x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), d, ext: true };
  return crypto.subtle.importKey("jwk", jwk, { name: usage, namedCurve: "P-256" }, false, usages);
}

describe("RFC 8291 payload encryption", () => {
  it("reproduces the section 5 example byte for byte, with the example's sender key and salt", async () => {
    const body = await encryptPayload(text(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.authSecret }, {
      salt: b64uDecode(RFC.salt),
      privateKey: await privateKeyFrom(RFC.asPrivate, RFC.asPublic, "ECDH", ["deriveBits"]),
      publicRaw: b64uDecode(RFC.asPublic),
    });
    expect(b64uEncode(body)).toBe(RFC.body);
    expect(body.length).toBe(86 + 41 + 1 + 16); // header + text + delimiter + tag (the RFC's own "Content-Length: 145" is off by one)
  });

  it("uses a fresh salt and sender key each time, and the receiver can read it", async () => {
    const receiver = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const sub = { p256dh: b64uEncode(await rawKey(receiver.publicKey)), auth: b64uEncode(crypto.getRandomValues(new Uint8Array(16))) };
    const message = JSON.stringify({ text: "Today's ready: 5 things.", url: "/?s=abc" });

    const a = await encryptPayload(text(message), sub);
    const b = await encryptPayload(text(message), sub);
    expect(b64uEncode(a)).not.toBe(b64uEncode(b));
    expect(new TextDecoder().decode(await decryptPayload(a, receiver.privateKey, sub))).toBe(message);
    expect(new TextDecoder().decode(await decryptPayload(b, receiver.privateKey, sub))).toBe(message);
  });

  it("refuses a message that does not fit one 4096-byte record", async () => {
    const sub = { p256dh: RFC.uaPublic, auth: RFC.authSecret };
    await expect(encryptPayload(new Uint8Array(4096 - 17 + 1), sub)).rejects.toThrow(/too large/);
    await expect(encryptPayload(new Uint8Array(4096 - 17), sub)).resolves.toHaveLength(86 + 4096);
  });
});

// --- Sending ---------------------------------------------------------------------------------------------------------

interface Seen {
  url: string;
  init: RequestInit;
}
function stubFetch(status: number): Seen[] {
  const seen: Seen[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    seen.push({ url: String(input), init: init ?? {} });
    return new Response(null, { status });
  });
  return seen;
}

const SUBJECT = "mailto:ember@example.com";
const payload = { text: "X is due today.", url: "https://ember.test/?s=1&t=2" };

describe("sendPush", () => {
  it("posts the encrypted payload to the endpoint with a VAPID header a push service can verify", async () => {
    const keys = await vapidKeys();
    const env: PushEnv = { VAPID_PUBLIC_KEY: keys.publicB64, VAPID_PRIVATE_KEY: keys.d, VAPID_SUBJECT: SUBJECT };
    const { sub, privateKey } = await browserSubscription("https://fcm.example.net:443/wpush/v2/token-1");
    const seen = stubFetch(201);

    expect(await sendPush(env, sub, payload, NOW)).toEqual({ ok: true });

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(sub.endpoint);
    const headers = seen[0].init.headers as Record<string, string>;
    expect(seen[0].init.method).toBe("POST");
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(Number(headers.TTL)).toBeGreaterThan(0);

    // RFC 8292: `vapid t=<jwt>, k=<public key>`; the JWT is signed ES256 with the matching private key.
    const [, t, k] = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(headers.Authorization)!;
    expect(k).toBe(keys.publicB64);
    const [h, c, s] = t.split(".");
    expect(JSON.parse(new TextDecoder().decode(b64uDecode(h)))).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(new TextDecoder().decode(b64uDecode(c))) as { aud: string; exp: number; sub: string };
    expect(claims.aud).toBe("https://fcm.example.net"); // the origin only, no path
    expect(claims.sub).toBe(SUBJECT);
    expect(claims.exp).toBeGreaterThan(NOW / 1000);
    expect(claims.exp).toBeLessThanOrEqual(NOW / 1000 + 24 * 3600);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, keys.publicKey, b64uDecode(s), text(`${h}.${c}`))).toBe(true);

    const body = new Uint8Array(seen[0].init.body as ArrayBuffer);
    expect(JSON.parse(new TextDecoder().decode(await decryptPayload(body, privateKey, sub)))).toEqual(payload);
  });

  it("accepts the private key as a JWK too, and trims the newline a piped secret carries", async () => {
    const keys = await vapidKeys();
    const { sub } = await browserSubscription();
    for (const priv of [`${JSON.stringify(keys.jwk)}\r\n`, `${keys.d}\r\n`]) {
      const seen = stubFetch(201);
      expect(await sendPush({ VAPID_PUBLIC_KEY: `${keys.publicB64}\r\n`, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: `${SUBJECT}\r\n` }, sub, payload, NOW)).toEqual({ ok: true });
      expect((seen[0].init.headers as Record<string, string>).Authorization).toMatch(new RegExp(`k=${keys.publicB64}$`));
      vi.restoreAllMocks();
    }
  });

  it("reports 404 and 410 as gone (drop the subscription), and other answers as plain failures", async () => {
    const keys = await vapidKeys();
    const env: PushEnv = { VAPID_PUBLIC_KEY: keys.publicB64, VAPID_PRIVATE_KEY: keys.d, VAPID_SUBJECT: SUBJECT };
    const { sub } = await browserSubscription();
    for (const [status, gone] of [[404, true], [410, true], [400, false], [403, false], [413, false], [429, false], [500, false], [503, false]] as const) {
      stubFetch(status);
      expect(await sendPush(env, sub, payload, NOW)).toEqual({ ok: false, status, gone });
      vi.restoreAllMocks();
    }
  });

  it("reports a network failure as status 0 and never puts the key in what it logs", async () => {
    const keys = await vapidKeys();
    const env: PushEnv = { VAPID_PUBLIC_KEY: keys.publicB64, VAPID_PRIVATE_KEY: keys.d, VAPID_SUBJECT: SUBJECT };
    const { sub } = await browserSubscription();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error(`boom ${keys.d}`));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendPush(env, sub, payload, NOW)).toEqual({ ok: false, status: 0, gone: false });
    expect(JSON.stringify(logged.mock.calls)).not.toContain(keys.d);
  });

  it("sends nothing, and says so, when the VAPID configuration is incomplete or wrong", async () => {
    const keys = await vapidKeys();
    const { sub } = await browserSubscription();
    const seen = stubFetch(201);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(pushConfigured({})).toBe(false);
    expect(pushConfigured({ VAPID_PUBLIC_KEY: keys.publicB64, VAPID_PRIVATE_KEY: keys.d })).toBe(false); // no subject
    expect(await sendPush({ VAPID_PUBLIC_KEY: keys.publicB64, VAPID_PRIVATE_KEY: keys.d }, sub, payload, NOW)).toMatchObject({ ok: false, status: 0 });
    expect(await sendPush({ VAPID_PUBLIC_KEY: keys.publicB64, VAPID_PRIVATE_KEY: "not a key", VAPID_SUBJECT: SUBJECT }, sub, payload, NOW)).toMatchObject({ ok: false, status: 0 });
    expect(seen).toHaveLength(0);
  });
});
