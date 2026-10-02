// Web Push (Tech_Scope.md §10 slice 18, ADR-0002), written against WebCrypto alone, no library:
//   RFC 8291  the payload: ECDH P-256 with the browser's key, HKDF, AES-128-GCM in one RFC 8188 record.
//   RFC 8292  the sender's identity: an ES256 JWT in `Authorization: vapid t=<jwt>, k=<public key>`.
// The scheduler calls sendPush once per subscription (worker/scheduler.ts); subscriptions.ts stores them.

/** What the sender needs from the environment. Values: .dev.vars.example. */
export interface PushEnv {
  /** Var: the VAPID public key, 65 bytes uncompressed P-256 as base64url. Empty = web push is off. */
  VAPID_PUBLIC_KEY?: string;
  /** Secret: the VAPID private key, as a JWK (JSON) or the bare 32-byte `d` as base64url. Never logged. */
  VAPID_PRIVATE_KEY?: string;
  /** Secret or var: who runs this server, as a `mailto:` or `https:` URL (RFC 8292 §2.1). Push services may use it to contact us. */
  VAPID_SUBJECT?: string;
}

/** A browser's PushSubscription, as stored in `push_subscriptions`. */
export interface PushSub {
  endpoint: string;
  p256dh: string; // base64url, 65 bytes
  auth: string; // base64url, 16 bytes
}

/** What the service worker receives (public/sw.js): the notification body and where a tap goes. */
export interface PushPayload {
  text: string;
  url: string;
}

/** `gone`: the push service says this subscription no longer exists (404 or 410), so drop it. `status` 0: no answer at all. */
export type PushResult = { ok: true } | { ok: false; status: number; gone: boolean };

// A message goes to every subscription of its user and each push is one subrequest, so the number kept per user bounds
// a tick's subrequests: MAX_SENDS x MAX_SUBSCRIPTIONS = 40, under the free plan's 50 (scheduler.ts, "Budget").
export const MAX_SUBSCRIPTIONS = 2;

const RECORD_SIZE = 4096; // RFC 8188 `rs`: one record holds the whole message
const MAX_PLAINTEXT = RECORD_SIZE - 16 - 1; // less the GCM tag and the padding delimiter
const TTL_SECONDS = 3600; // a nudge that is an hour stale is worse than none; the push service drops it
const JWT_LIFETIME_S = 12 * 3600; // RFC 8292 §2: at most 24 hours; half of that, so a cached token is never near its end
const JWT_REUSE_MARGIN_S = 3600;

// --- base64url ---------------------------------------------------------------------------------------------------

export function b64uEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decodes base64url without padding. Throws on anything else, so a malformed key cannot pass as bytes. */
export function b64uDecode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error("not base64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

// --- RFC 8291 payload encryption -------------------------------------------------------------------------------------

/** The sender's side of the ECDH exchange and the salt. Production code never passes this: it exists for the RFC's worked example. */
export interface Ephemeral {
  salt: Uint8Array;
  privateKey: CryptoKey;
  publicRaw: Uint8Array;
}

/** A key's raw bytes (for a public key: the uncompressed point). exportKey's types allow a JWK too, which "raw" never returns. */
export async function rawKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array((await crypto.subtle.exportKey("raw", key)) as ArrayBuffer);
}

/** ECDH parameters for deriveBits. The Workers types name the standard `public` member `$public`; the runtime takes `public`. */
export const ecdhWith = (peer: CryptoKey) => ({ name: "ECDH", public: peer }) as unknown as SubtleCryptoDeriveKeyAlgorithm;

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, bits: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bits);
}

/**
 * Encrypts `plaintext` for one browser and returns the request body: the 86-byte RFC 8188 header (salt, record size,
 * the sender's public key) followed by the ciphertext. Each call makes a new key pair and salt.
 */
export async function encryptPayload(plaintext: Uint8Array, sub: Pick<PushSub, "p256dh" | "auth">, ephemeral?: Ephemeral): Promise<Uint8Array> {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error("payload too large for one record");
  const uaPublic = b64uDecode(sub.p256dh);
  const authSecret = b64uDecode(sub.auth);

  let eph = ephemeral;
  if (!eph) {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    eph = { salt: crypto.getRandomValues(new Uint8Array(16)), privateKey: pair.privateKey, publicRaw: await rawKey(pair.publicKey) };
  }

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhWith(uaKey), eph.privateKey, 256));
  // RFC 8291 §3.4: the auth secret salts the first extraction, so the keys are bound to this subscription.
  const ikm = new Uint8Array(await hkdf(ecdhSecret, authSecret, concat(utf8("WebPush: info\0"), uaPublic, eph.publicRaw), 256));
  // RFC 8188 §2.2 and §2.3.
  const cek = new Uint8Array(await hkdf(ikm, eph.salt, utf8("Content-Encoding: aes128gcm\0"), 128));
  const nonce = new Uint8Array(await hkdf(ikm, eph.salt, utf8("Content-Encoding: nonce\0"), 96));

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02 closes the last (here the only) record.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(plaintext, Uint8Array.of(2))));

  const header = new Uint8Array(21);
  header.set(eph.salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = eph.publicRaw.length;
  return concat(header, eph.publicRaw, cipher);
}

// --- RFC 8292 VAPID --------------------------------------------------------------------------------------------------

/** Whether all three VAPID values are set. The scheduler and the subscribe route check this before they promise anyone a push. */
export function pushConfigured(env: PushEnv): boolean {
  return !!(env.VAPID_PUBLIC_KEY?.trim() && env.VAPID_PRIVATE_KEY?.trim() && env.VAPID_SUBJECT?.trim());
}

// The imported signing key and the tokens already made, per isolate. A token is good for 12 hours and is the same for
// every message to one push service, so a tick of 20 sends signs once per service, not 20 times (CPU: Tech_Scope §11).
let signing: { id: string; key: CryptoKey } | null = null;
const tokens = new Map<string, { jwt: string; exp: number }>();

async function signingKey(env: PushEnv): Promise<CryptoKey> {
  const pub = env.VAPID_PUBLIC_KEY!.trim();
  const priv = env.VAPID_PRIVATE_KEY!.trim();
  const id = `${pub}|${priv}`;
  if (signing?.id === id) return signing.key;

  const publicRaw = b64uDecode(pub);
  if (publicRaw.length !== 65 || publicRaw[0] !== 4) throw new Error("VAPID_PUBLIC_KEY is not an uncompressed P-256 key");
  const jwk: JsonWebKey = priv.startsWith("{")
    ? (JSON.parse(priv) as JsonWebKey)
    : { kty: "EC", crv: "P-256", d: priv, x: b64uEncode(publicRaw.slice(1, 33)), y: b64uEncode(publicRaw.slice(33, 65)) };
  const key = await crypto.subtle.importKey("jwk", { ...jwk, ext: true, key_ops: ["sign"] }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  signing = { id, key };
  tokens.clear();
  return key;
}

async function vapidHeader(env: PushEnv, audience: string, nowMs: number): Promise<string> {
  const key = await signingKey(env);
  const nowS = Math.floor(nowMs / 1000);
  let token = tokens.get(audience);
  if (!token || token.exp - nowS < JWT_REUSE_MARGIN_S) {
    const exp = nowS + JWT_LIFETIME_S;
    const signed = `${b64uEncode(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })))}.${b64uEncode(utf8(JSON.stringify({ aud: audience, exp, sub: env.VAPID_SUBJECT!.trim() })))}`;
    // WebCrypto's ECDSA output is the raw r || s the JWT wants (RFC 7518 §3.4), not DER.
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(signed)));
    token = { jwt: `${signed}.${b64uEncode(sig)}`, exp };
    tokens.set(audience, token);
  }
  return `vapid t=${token.jwt}, k=${env.VAPID_PUBLIC_KEY!.trim()}`;
}

// --- Sending ---------------------------------------------------------------------------------------------------------

/**
 * Sends one message to one subscription. Never throws and never logs a key: whatever goes wrong (configuration, a stored
 * key that will not import, the network) comes back as `status: 0`. 404 and 410 mean the subscription is gone for good
 * (RFC 8030 §7.3); everything else is worth another try.
 */
export async function sendPush(env: PushEnv, sub: PushSub, payload: PushPayload, now: number): Promise<PushResult> {
  let res: Response;
  try {
    if (!pushConfigured(env)) throw new Error("VAPID is not configured");
    const body = await encryptPayload(utf8(JSON.stringify(payload)), sub);
    const authorization = await vapidHeader(env, new URL(sub.endpoint).origin, now);
    res = await fetch(sub.endpoint, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: String(TTL_SECONDS) },
      body,
    });
  } catch (e) {
    // Only the error's name: a message can quote a key or the endpoint, which is a capability to push to that browser.
    console.error("push send failed:", e instanceof Error ? e.name : "unknown error");
    return { ok: false, status: 0, gone: false };
  }
  await res.body?.cancel(); // the answer is not needed; an unread body holds the connection
  if (res.ok) return { ok: true };
  return { ok: false, status: res.status, gone: res.status === 404 || res.status === 410 };
}
