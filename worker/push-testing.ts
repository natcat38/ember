import { expect } from "vitest";
import { b64uDecode, b64uEncode, ecdhWith, rawKey, type PushSub } from "./push";

// Test helpers for slice 18, shared by push.test.ts and scheduler.test.ts. Not imported by the Worker.

const text = (s: string) => new TextEncoder().encode(s);

/** A browser's side of a subscription: the stored fields, and the private key it keeps. */
export async function browserSubscription(endpoint = "https://push.example.net/send/abc"): Promise<{ sub: PushSub; privateKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  return {
    privateKey: pair.privateKey,
    sub: {
      endpoint,
      p256dh: b64uEncode(await rawKey(pair.publicKey)),
      auth: b64uEncode(crypto.getRandomValues(new Uint8Array(16))),
    },
  };
}

/** A VAPID key pair as the secrets hold it: the public key as the var, the private `d`. */
export async function vapidKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return { publicKey: pair.publicKey, jwk, d: jwk.d!, publicB64: b64uEncode(await rawKey(pair.publicKey)) };
}

/**
 * RFC 8291 section 3.4 and RFC 8188 from the receiver's side, written apart from encryptPayload so that it checks it.
 * Returns the plaintext with the padding delimiter taken off.
 */
export async function decryptPayload(body: Uint8Array, uaPrivate: CryptoKey, sub: Pick<PushSub, "p256dh" | "auth">): Promise<Uint8Array> {
  const salt = body.slice(0, 16);
  expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096);
  expect(body[20]).toBe(65);
  const asPublic = body.slice(21, 86);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits(ecdhWith(asKey), uaPrivate, 256));
  const hkdf = async (ikm: Uint8Array, s: Uint8Array, info: Uint8Array, bits: number) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), bits));
  const cat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]));
  const ikm = await hkdf(secret, b64uDecode(sub.auth), cat(text("WebPush: info\0"), b64uDecode(sub.p256dh), asPublic), 256);
  const cek = await hkdf(ikm, salt, text("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(ikm, salt, text("Content-Encoding: nonce\0"), 96);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), body.slice(86)),
  );
  expect(plain[plain.length - 1]).toBe(2); // the last-record padding delimiter
  return plain.slice(0, -1);
}
