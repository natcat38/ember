import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { SyncResponse } from "./protocol";

// Passkeys (Tech_Scope.md §8, ADR-0005). The authenticator is faked here with WebCrypto: a real ES256 key pair, and the
// attestation (fmt "none") and assertion byte layouts built by hand from the WebAuthn spec, so the library under test
// sees what a phone would send. Helpers stay in this file.

const BASE = "https://ember.test";
const RP = "ember.test";
const EVIL = "https://evil.test";

// --- fake authenticator ----------------------------------------------------------------------------------------

const enc = new TextEncoder();
const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
};
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const sha256 = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

// The CBOR subset the attestation needs: integers, byte strings, text strings, and maps. Lengths stay under 65536.
type Cbor = number | Uint8Array | string | Map<Cbor, Cbor>;
function cbor(v: Cbor): Uint8Array {
  const head = (major: number, n: number) =>
    n < 24 ? Uint8Array.of((major << 5) | n) : n < 256 ? Uint8Array.of((major << 5) | 24, n) : Uint8Array.of((major << 5) | 25, n >> 8, n & 255);
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") return concat(head(3, enc.encode(v).length), enc.encode(v));
  if (v instanceof Uint8Array) return concat(head(2, v.length), v);
  return concat(head(5, v.size), ...[...v].flatMap(([k, val]) => [cbor(k), cbor(val)]));
}

// ECDSA gives r || s; WebAuthn wants an ASN.1 DER SEQUENCE of two INTEGERs.
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    const body = b[i] & 0x80 ? concat(Uint8Array.of(0), b.slice(i)) : b.slice(i);
    return concat(Uint8Array.of(0x02, body.length), body);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(Uint8Array.of(0x30, body.length), body);
}

const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

interface Authenticator {
  id: string;
  credId: Uint8Array;
  privateKey: CryptoKey;
  x: Uint8Array;
  y: Uint8Array;
}

async function makeAuthenticator(): Promise<Authenticator> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const credId = crypto.getRandomValues(new Uint8Array(32));
  return { id: b64u(credId), credId, privateKey: pair.privateKey, x: unb64u(jwk.x!), y: unb64u(jwk.y!) };
}

interface Ceremony {
  challenge: string;
  /** What the browser writes into clientDataJSON; defaults to the real site. */
  origin?: string;
  /** Which RP ID the authenticator hashes into authenticatorData; defaults to the real site's. */
  rpID?: string;
  flags?: number;
}

// navigator.credentials.create(), as @simplewebauthn/browser's startRegistration would hand it back.
async function attestation(a: Authenticator, c: Ceremony) {
  const clientData = enc.encode(JSON.stringify({ type: "webauthn.create", challenge: c.challenge, origin: c.origin ?? BASE, crossOrigin: false }));
  const cose = cbor(new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, a.x], [-3, a.y]]));
  const authData = concat(
    await sha256(enc.encode(c.rpID ?? RP)),
    Uint8Array.of((c.flags ?? UP | UV) | AT),
    u32(0),
    new Uint8Array(16), // AAGUID: all zeros, as for a "none" attestation
    Uint8Array.of(a.credId.length >> 8, a.credId.length & 255),
    a.credId,
    cose,
  );
  const attestationObject = cbor(new Map<Cbor, Cbor>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
  return {
    id: a.id,
    rawId: a.id,
    type: "public-key",
    clientExtensionResults: {},
    response: { clientDataJSON: b64u(clientData), attestationObject: b64u(attestationObject), transports: ["internal", "hybrid"] },
  };
}

// navigator.credentials.get(), as startAuthentication would hand it back.
async function assertion(a: Authenticator, c: Ceremony & { counter: number }) {
  const clientData = enc.encode(JSON.stringify({ type: "webauthn.get", challenge: c.challenge, origin: c.origin ?? BASE, crossOrigin: false }));
  const authData = concat(await sha256(enc.encode(c.rpID ?? RP)), Uint8Array.of(c.flags ?? UP | UV), u32(c.counter));
  const signed = concat(authData, await sha256(clientData));
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, a.privateKey, signed));
  return {
    id: a.id,
    rawId: a.id,
    type: "public-key",
    clientExtensionResults: {},
    response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(rawToDer(raw)) },
  };
}

// --- HTTP helpers ----------------------------------------------------------------------------------------------

interface Reply {
  res: Response;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  /** `ember_uid=<id>` as the browser would send it back, or undefined when no cookie was set. */
  cookie?: string;
}

async function post(path: string, body?: unknown, cookie?: string): Promise<Reply> {
  const res = await exports.default.fetch(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  return { res, body: await res.json(), cookie: res.headers.get("Set-Cookie")?.split(";")[0] };
}

const uidOf = (cookie: string) => cookie.split("=")[1];
const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())!.n;
const credentialRow = (id: string) => env.DB.prepare("SELECT * FROM credentials WHERE id = ?").bind(id).first<Record<string, unknown>>();

// A user the way the app makes one: the first sync, with a task in it so "the same list" can be checked later.
async function userWithTask(): Promise<{ cookie: string; taskId: string }> {
  const taskId = crypto.randomUUID();
  const res = await exports.default.fetch(
    new Request(`${BASE}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cursor: 0, ops: [{ op_id: crypto.randomUUID(), entity: "tasks", id: taskId, fields: { title: "Reply to recruiter", state: "inbox" } }] }),
    }),
  );
  return { cookie: res.headers.get("Set-Cookie")!.split(";")[0], taskId };
}

/** Options, then verify, for a registration on the user `cookie` names (or on a new user when there is none). */
async function register(a: Authenticator, cookie?: string, ceremony: Partial<Ceremony> = {}) {
  const options = await post("/api/passkey/register/options", undefined, cookie);
  const verify = await post("/api/passkey/register/verify", await attestation(a, { challenge: options.body.challenge, ...ceremony }), cookie ?? options.cookie);
  return { options, verify };
}

/** The second device: no cookie, discoverable credential. */
async function login(a: Authenticator, counter: number, ceremony: Partial<Ceremony> = {}) {
  const options = await post("/api/passkey/login/options");
  const verify = await post("/api/passkey/login/verify", await assertion(a, { challenge: options.body.challenge, counter, ...ceremony }));
  return { options, verify };
}

// --- tests -----------------------------------------------------------------------------------------------------

describe("register, then sign in on a second device", () => {
  it("gives the second device the first user's cookie and the same list", async () => {
    const { cookie, taskId } = await userWithTask();
    const phone = await makeAuthenticator();

    const { options, verify } = await register(phone, cookie);
    expect(options.res.status).toBe(200);
    expect(options.cookie).toBeUndefined(); // the existing user keeps their cookie
    expect(options.body.rp).toEqual({ id: RP, name: "Ember" });
    expect(options.body.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "preferred" });
    expect(verify.res.status).toBe(200);
    expect(verify.body).toEqual({ ok: true });

    const stored = await credentialRow(phone.id);
    expect(stored).toMatchObject({ id: phone.id, user_id: uidOf(cookie), counter: 0 });
    expect(JSON.parse(stored!.transports as string)).toEqual(["internal", "hybrid"]);

    // The laptop has no cookie at all.
    const laptop = await login(phone, 1);
    expect(laptop.options.res.status).toBe(200);
    expect(laptop.options.cookie).toBeUndefined();
    expect(laptop.options.body.allowCredentials ?? []).toEqual([]);
    expect(laptop.options.body.rpId).toBe(RP);
    expect(laptop.verify.res.status).toBe(200);
    expect(laptop.verify.cookie).toBe(cookie);
    expect(laptop.verify.res.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect((await credentialRow(phone.id))!.counter).toBe(1);

    const synced = await post("/api/sync", { cursor: 0, ops: [] }, laptop.verify.cookie);
    const body = synced.body as SyncResponse;
    expect(body.changes.some((c) => c.entity === "tasks" && c.row.id === taskId)).toBe(true);
  });

  it("creates the user first when registering with no cookie, and attaches the passkey to it", async () => {
    const users = await count("SELECT COUNT(*) AS n FROM users");
    const phone = await makeAuthenticator();

    const { options, verify } = await register(phone);
    expect(options.cookie).toMatch(/^ember_uid=[A-Za-z0-9_-]{22}$/);
    expect(options.res.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(verify.res.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(users + 1);
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE id = ?", uidOf(options.cookie!))).toBe(1);
    expect((await credentialRow(phone.id))!.user_id).toBe(uidOf(options.cookie!));

    const again = await login(phone, 1);
    expect(again.verify.cookie).toBe(options.cookie);
  });

  it("accepts an assertion without user verification, since the options only prefer it", async () => {
    const { cookie } = await userWithTask();
    const phone = await makeAuthenticator();
    await register(phone, cookie);
    const { verify } = await login(phone, 1, { flags: UP });
    expect(verify.res.status).toBe(200);
  });

  it("refuses to register the same credential twice", async () => {
    const { cookie } = await userWithTask();
    const phone = await makeAuthenticator();
    await register(phone, cookie);
    const second = await register(phone, cookie);
    expect(second.verify.res.status).toBe(400);
    expect(second.verify.body).toEqual({ error: "credential_exists" });
  });

  it("lists the user's existing credentials as excluded, so one device cannot register twice", async () => {
    const { cookie } = await userWithTask();
    const phone = await makeAuthenticator();
    await register(phone, cookie);
    const options = await post("/api/passkey/register/options", undefined, cookie);
    expect(options.body.excludeCredentials.map((c: { id: string }) => c.id)).toEqual([phone.id]);
  });
});

describe("challenges", () => {
  it("refuses a replayed challenge", async () => {
    const { cookie } = await userWithTask();
    const phone = await makeAuthenticator();
    await register(phone, cookie);

    const options = await post("/api/passkey/login/options");
    const response = await assertion(phone, { challenge: options.body.challenge, counter: 1 });
    expect((await post("/api/passkey/login/verify", response)).res.status).toBe(200);

    const replay = await post("/api/passkey/login/verify", response);
    expect(replay.res.status).toBe(400);
    expect(replay.body).toEqual({ error: "challenge_invalid" });
  });

  it("refuses a replayed registration", async () => {
    const { cookie } = await userWithTask();
    const phone = await makeAuthenticator();
    const options = await post("/api/passkey/register/options", undefined, cookie);
    const response = await attestation(phone, { challenge: options.body.challenge });
    expect((await post("/api/passkey/register/verify", response, cookie)).res.status).toBe(200);
    const replay = await post("/api/passkey/register/verify", response, cookie);
    expect(replay.res.status).toBe(400);
    expect(replay.body).toEqual({ error: "challenge_invalid" });
  });

  it("burns a challenge on a failed attempt, so a bad signature cannot be retried", async () => {
    const { cookie } = await userWithTask();
    const phone = await makeAuthenticator();
    await register(phone, cookie);

    const options = await post("/api/passkey/login/options");
    const bad = await assertion(phone, { challenge: options.body.challenge, counter: 1, origin: EVIL });
    expect((await post("/api/passkey/login/verify", bad)).res.status).toBe(400);
    const good = await assertion(phone, { challenge: options.body.challenge, counter: 1 });
    expect((await post("/api/passkey/login/verify", good)).body).toEqual({ error: "challenge_invalid" });
  });

  it("refuses a challenge the server never issued, even when the client signs it", async () => {
    const { cookie } = await userWithTask();
    const phone = await makeAuthenticator();
    await register(phone, cookie);
    const forged = await assertion(phone, { challenge: b64u(crypto.getRandomValues(new Uint8Array(32))), counter: 1 });
    const res = await post("/api/passkey/login/verify", forged);
    expect(res.res.status).toBe(400);
    expect(res.body).toEqual({ error: "challenge_invalid" });
  });

  it("refuses an expired challenge", async () => {
    const { cookie } = await userWithTask();
    const phone = await makeAuthenticator();
    await register(phone, cookie);

    const options = await post("/api/passkey/login/options");
    const row = await env.DB.prepare("SELECT expires_at FROM passkey_challenges WHERE challenge = ?").bind(options.body.challenge).first<{ expires_at: number }>();
    const ttl = row!.expires_at - Date.now();
    expect(ttl).toBeGreaterThan(4 * 60_000);
    expect(ttl).toBeLessThanOrEqual(5 * 60_000);

    await env.DB.prepare("UPDATE passkey_challenges SET expires_at = ? WHERE challenge = ?").bind(Date.now() - 1, options.body.challenge).run();
    const res = await post("/api/passkey/login/verify", await assertion(phone, { challenge: options.body.challenge, counter: 1 }));
    expect(res.res.status).toBe(400);
    expect(res.body).toEqual({ error: "challenge_expired" });
    expect(res.cookie).toBeUndefined();
  });

  it("sweeps expired challenges when a new one is issued", async () => {
    await env.DB.prepare("INSERT INTO passkey_challenges (challenge, kind, origin, rp_id, expires_at) VALUES ('stale', 'login', ?, ?, ?)").bind(BASE, RP, Date.now() - 1).run();
    await post("/api/passkey/login/options");
    expect(await count("SELECT COUNT(*) AS n FROM passkey_challenges WHERE challenge = 'stale'")).toBe(0);
  });

  it("does not let a login challenge complete a registration, or the reverse", async () => {
    const { cookie } = await userWithTask();
    const phone = await makeAuthenticator();
    const loginOptions = await post("/api/passkey/login/options");
    const asRegistration = await post("/api/passkey/register/verify", await attestation(phone, { challenge: loginOptions.body.challenge }), cookie);
    expect(asRegistration.body).toEqual({ error: "challenge_invalid" });

    await register(phone, cookie);
    const registerOptions = await post("/api/passkey/register/options", undefined, cookie);
    const asLogin = await post("/api/passkey/login/verify", await assertion(phone, { challenge: registerOptions.body.challenge, counter: 1 }));
    expect(asLogin.body).toEqual({ error: "challenge_invalid" });
  });

  it("binds a registration challenge to the user who asked for it", async () => {
    const owner = await userWithTask();
    const other = await userWithTask();
    const phone = await makeAuthenticator();
    const options = await post("/api/passkey/register/options", undefined, owner.cookie);
    const res = await post("/api/passkey/register/verify", await attestation(phone, { challenge: options.body.challenge }), other.cookie);
    expect(res.res.status).toBe(400);
    expect(res.body).toEqual({ error: "challenge_mismatch" });
    expect(await credentialRow(phone.id)).toBeNull();
  });

  it("refuses to complete a registration with no cookie, without leaving a new user behind", async () => {
    const { cookie } = await userWithTask();
    const phone = await makeAuthenticator();
    const options = await post("/api/passkey/register/options", undefined, cookie);
    const users = await count("SELECT COUNT(*) AS n FROM users");
    const res = await post("/api/passkey/register/verify", await attestation(phone, { challenge: options.body.challenge }));
    expect(res.res.status).toBe(400);
    expect(res.body).toEqual({ error: "no_session" });
    expect(res.cookie).toBeUndefined();
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(users);
  });
});

describe("refusals", () => {
  it("refuses a wrong origin, on registration and on sign-in", async () => {
    const { cookie } = await userWithTask();
    const phone = await makeAuthenticator();

    const reg = await register(phone, cookie, { origin: EVIL });
    expect(reg.verify.res.status).toBe(400);
    expect(reg.verify.body).toEqual({ error: "origin_mismatch" });
    expect(await credentialRow(phone.id)).toBeNull();

    await register(phone, cookie);
    const signIn = await login(phone, 1, { origin: EVIL });
    expect(signIn.verify.res.status).toBe(400);
    expect(signIn.verify.body).toEqual({ error: "origin_mismatch" });
    expect(signIn.verify.cookie).toBeUndefined();
  });

  it("refuses a wrong rpID, on registration and on sign-in", async () => {
    const { cookie } = await userWithTask();
    const phone = await makeAuthenticator();

    const reg = await register(phone, cookie, { rpID: "evil.test" });
    expect(reg.verify.res.status).toBe(400);
    expect(reg.verify.body).toEqual({ error: "rpid_mismatch" });

    await register(phone, cookie);
    const signIn = await login(phone, 1, { rpID: "evil.test" });
    expect(signIn.verify.res.status).toBe(400);
    expect(signIn.verify.body).toEqual({ error: "rpid_mismatch" });
  });

  it("refuses a counter that goes backwards, and keeps the stored one", async () => {
    const { cookie } = await userWithTask();
    const phone = await makeAuthenticator();
    await register(phone, cookie);

    expect((await login(phone, 5)).verify.res.status).toBe(200);
    for (const stale of [3, 5]) {
      const { verify } = await login(phone, stale);
      expect(verify.res.status).toBe(400);
      expect(verify.body).toEqual({ error: "counter_regression" });
      expect(verify.cookie).toBeUndefined();
    }
    expect((await credentialRow(phone.id))!.counter).toBe(5);
    expect((await login(phone, 6)).verify.res.status).toBe(200);
  });

  it("allows a counter that stays at zero, as synced passkeys do", async () => {
    const { cookie } = await userWithTask();
    const phone = await makeAuthenticator();
    await register(phone, cookie);
    expect((await login(phone, 0)).verify.res.status).toBe(200);
    expect((await login(phone, 0)).verify.res.status).toBe(200);
  });

  it("refuses an unknown credential", async () => {
    const stranger = await makeAuthenticator();
    const { verify } = await login(stranger, 1);
    expect(verify.res.status).toBe(400);
    expect(verify.body).toEqual({ error: "unknown_credential" });
    expect(verify.cookie).toBeUndefined();
  });

  it("refuses a signature from a different key", async () => {
    const { cookie } = await userWithTask();
    const phone = await makeAuthenticator();
    await register(phone, cookie);
    const thief = { ...(await makeAuthenticator()), id: phone.id, credId: phone.credId };
    const { verify } = await login(thief, 1);
    expect(verify.res.status).toBe(400);
    expect(verify.body).toEqual({ error: "verification_failed" });
    expect(verify.cookie).toBeUndefined();
  });

  it("answers malformed input with 400, never 500", async () => {
    const { cookie } = await userWithTask();
    for (const path of ["/api/passkey/register/verify", "/api/passkey/login/verify"]) {
      for (const body of ["not json", "[]", "null", "{}", { id: "x", response: {} }, { id: "x", response: { clientDataJSON: "!!!" } }]) {
        const res = await post(path, body, cookie);
        expect(res.res.status, `${path} ${JSON.stringify(body)}`).toBe(400);
        expect(typeof res.body.error).toBe("string");
      }
    }
  });

  it("answers GET with 405 and an unknown passkey route with 404", async () => {
    const get = await exports.default.fetch(new Request(`${BASE}/api/passkey/login/options`));
    expect(get.status).toBe(405);
    const other = await post("/api/passkey/nope");
    expect(other.res.status).toBe(404);
  });
});
