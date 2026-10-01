import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { cookieFor, resolveUser } from "./identity";

// Passkeys on the anonymous user (ADR-0005, Tech_Scope.md §8, slice 14). Four JSON routes on the app's own origin:
//   register/options  needs the cookie user (made on the spot if absent, as /api/sync does); returns creation options
//   register/verify   stores the credential against that user
//   login/options     needs nothing (the second device has no cookie); returns request options with no allowCredentials
//   login/verify      checks the assertion and counter, then sets ember_uid to the credential's user
// The verify routes take the bare JSON that @simplewebauthn/browser's startRegistration / startAuthentication return.
// rpID is the request's hostname and the expected origin is the request's origin, so dev, preview and production each
// work without configuration, and a response made for another site fails.

export interface PasskeyEnv {
  DB: D1Database;
}

const RP_NAME = "Ember";
const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_BODY_CHARS = 16 * 1024; // an attestation with a certificate chain is a few KB; "none" is under 1 KB

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

// A 400 with a stable reason code. Thrown from anywhere below and turned into a response once, in handlePasskey.
//   bad_request          the body is not the JSON shape the route takes
//   no_session           register/verify without a cookie that names a user
//   challenge_invalid    never issued, already used, or issued for the other ceremony
//   challenge_expired    older than 5 minutes
//   challenge_mismatch   issued to another user or another host
//   origin_mismatch      clientDataJSON names another origin
//   rpid_mismatch        authenticatorData is bound to another rpID
//   counter_regression   the signature counter did not go up
//   unknown_credential   no such passkey (sign-in only)
//   credential_exists    this passkey is already registered (registration only)
//   verification_failed  anything else the library refuses (bad signature, missing flags, unsupported key)
class Refusal extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

// --- Request plumbing -----------------------------------------------------------------------------------------

interface Site {
  rpID: string;
  origin: string;
}

const siteOf = (request: Request): Site => {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin };
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_CHARS * 4) throw new Refusal("bad_request");
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) throw new Refusal("bad_request");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Refusal("bad_request");
  }
  if (!isRecord(body)) throw new Refusal("bad_request");
  return body;
}

const unb64u = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

// The challenge the client says it signed, read from clientDataJSON. It is only a key into passkey_challenges: what
// the library is later told to expect comes from the stored row, never from this value (Tech_Scope.md §8).
function challengeOf(body: Record<string, unknown>): string {
  const response = body.response;
  if (typeof body.id !== "string" || !isRecord(response) || typeof response.clientDataJSON !== "string") throw new Refusal("bad_request");
  try {
    const clientData: unknown = JSON.parse(new TextDecoder().decode(unb64u(response.clientDataJSON)));
    if (isRecord(clientData) && typeof clientData.challenge === "string") return clientData.challenge;
  } catch {
    // falls through to the refusal
  }
  throw new Refusal("bad_request");
}

// --- Challenges -----------------------------------------------------------------------------------------------

type Kind = "register" | "login";

async function storeChallenge(db: D1Database, challenge: string, kind: Kind, userId: string | null, site: Site, now: number): Promise<void> {
  // The sweep rides along on every options call, so expired rows never pile up and no cron is needed.
  await db.batch([
    db.prepare("DELETE FROM passkey_challenges WHERE expires_at <= ?1").bind(now),
    db.prepare("INSERT INTO passkey_challenges (challenge, kind, user_id, origin, rp_id, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(challenge, kind, userId, site.origin, site.rpID, now + CHALLENGE_TTL_MS),
  ]);
}

interface Challenge {
  userId: string | null;
}

// One statement both reads and deletes the row, so two requests racing on a challenge cannot both win, and a failed
// verification still spends it: an attacker gets one guess per challenge.
async function consumeChallenge(db: D1Database, challenge: string, kind: Kind, site: Site, now: number): Promise<Challenge> {
  const row = await db
    .prepare("DELETE FROM passkey_challenges WHERE challenge = ?1 AND kind = ?2 RETURNING user_id, origin, rp_id, expires_at")
    .bind(challenge, kind)
    .first<{ user_id: string | null; origin: string; rp_id: string; expires_at: number }>();
  if (!row) throw new Refusal("challenge_invalid");
  if (row.expires_at <= now) throw new Refusal("challenge_expired");
  if (row.origin !== site.origin || row.rp_id !== site.rpID) throw new Refusal("challenge_mismatch");
  return { userId: row.user_id };
}

// --- Library errors -> reason codes ---------------------------------------------------------------------------

// @simplewebauthn/server reports every refusal as an Error with only a message, so the three we name are matched on the
// start of the message. A reworded message in a future version would fall back to verification_failed, still a 400;
// passkeys.test.ts pins each one.
function refusalFor(e: unknown): Refusal {
  const message = e instanceof Error ? e.message : "";
  console.warn("passkey verification refused:", message);
  if (/^Unexpected (registration|authentication) response origin/.test(message)) return new Refusal("origin_mismatch");
  if (/^Unexpected RP ID hash/.test(message)) return new Refusal("rpid_mismatch");
  if (/^Response counter value/.test(message)) return new Refusal("counter_regression");
  return new Refusal("verification_failed");
}

// --- Credentials ----------------------------------------------------------------------------------------------

interface CredentialRow {
  id: string;
  user_id: string;
  public_key: ArrayBuffer | number[];
  counter: number;
  transports: string | null;
}

const parseTransports = (raw: string | null): string[] | undefined => {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : undefined;
  } catch {
    return undefined;
  }
};

// --- Routes ---------------------------------------------------------------------------------------------------

async function registerOptions(request: Request, env: PasskeyEnv): Promise<Response> {
  const now = Date.now();
  const site = siteOf(request);
  const { uid, created } = await resolveUser(env.DB, request, now);
  const existing = await env.DB.prepare("SELECT id, transports FROM credentials WHERE user_id = ?1").bind(uid).all<{ id: string; transports: string | null }>();
  // No userID: the library makes a random user handle. It must not be the uid, which is the cookie's secret.
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: site.rpID,
    userName: RP_NAME,
    excludeCredentials: existing.results.map((c) => ({ id: c.id, transports: parseTransports(c.transports) })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  await storeChallenge(env.DB, options.challenge, "register", uid, site, now);
  return json(options, 200, created ? { "Set-Cookie": cookieFor(uid) } : {});
}

async function registerVerify(request: Request, env: PasskeyEnv): Promise<Response> {
  const now = Date.now();
  const site = siteOf(request);
  const body = await readJson(request);
  const challenge = challengeOf(body);

  const { uid, created } = await resolveUser(env.DB, request, now);
  if (created) {
    // A caller with no usable cookie has nothing to attach a passkey to. Take back the user resolveUser just made.
    await env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(uid).run();
    throw new Refusal("no_session");
  }

  const stored = await consumeChallenge(env.DB, challenge, "register", site, now);
  if (stored.userId !== uid) throw new Refusal("challenge_mismatch");

  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response: body as unknown as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: site.origin,
      expectedRPID: site.rpID,
      requireUserVerification: false, // the options say "preferred"
    });
  } catch (e) {
    throw refusalFor(e);
  }
  if (!verified.verified) throw new Refusal("verification_failed");

  const { credential } = verified.registrationInfo;
  const transports = credential.transports ?? (body.response as { transports?: string[] }).transports;
  const key = credential.publicKey;
  const inserted = await env.DB
    .prepare("INSERT INTO credentials (id, user_id, public_key, counter, transports, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (id) DO NOTHING RETURNING id")
    .bind(credential.id, uid, key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength), credential.counter, transports ? JSON.stringify(transports) : null, now)
    .first();
  if (!inserted) throw new Refusal("credential_exists");
  return json({ ok: true });
}

async function loginOptions(request: Request, env: PasskeyEnv): Promise<Response> {
  const site = siteOf(request);
  // No allowCredentials: the second device has no idea which passkey is ours, so the browser offers its own.
  const options = await generateAuthenticationOptions({ rpID: site.rpID, userVerification: "preferred" });
  await storeChallenge(env.DB, options.challenge, "login", null, site, Date.now());
  return json(options);
}

async function loginVerify(request: Request, env: PasskeyEnv): Promise<Response> {
  const now = Date.now();
  const site = siteOf(request);
  const body = await readJson(request);
  const challenge = challengeOf(body);
  await consumeChallenge(env.DB, challenge, "login", site, now);

  const row = await env.DB.prepare("SELECT id, user_id, public_key, counter, transports FROM credentials WHERE id = ?1").bind(body.id).first<CredentialRow>();
  if (!row) throw new Refusal("unknown_credential");

  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response: body as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: site.origin,
      expectedRPID: site.rpID,
      requireUserVerification: false, // the options say "preferred"
      credential: {
        id: row.id,
        publicKey: Array.isArray(row.public_key) ? Uint8Array.from(row.public_key) : new Uint8Array(row.public_key),
        counter: row.counter,
        transports: parseTransports(row.transports),
      },
    });
  } catch (e) {
    throw refusalFor(e);
  }
  if (!verified.verified) throw new Refusal("verification_failed");

  // Compare-and-set on the old counter, so two assertions racing on one passkey cannot both move it.
  const advanced = await env.DB
    .prepare("UPDATE credentials SET counter = ?1 WHERE id = ?2 AND counter = ?3 RETURNING id")
    .bind(verified.authenticationInfo.newCounter, row.id, row.counter)
    .first();
  if (!advanced) throw new Refusal("counter_regression");

  const user = await env.DB.prepare("UPDATE users SET last_seen_at = ?1 WHERE id = ?2 RETURNING id").bind(now, row.user_id).first();
  if (!user) throw new Refusal("unknown_credential"); // the user was deleted under a surviving credential
  return json({ ok: true }, 200, { "Set-Cookie": cookieFor(row.user_id) });
}

const ROUTES: Record<string, (request: Request, env: PasskeyEnv) => Promise<Response>> = {
  "register/options": registerOptions,
  "register/verify": registerVerify,
  "login/options": loginOptions,
  "login/verify": loginVerify,
};

/** `route` is the path after /api/passkey/, for example "login/verify". */
export async function handlePasskey(request: Request, env: PasskeyEnv, route: string): Promise<Response> {
  const run = Object.hasOwn(ROUTES, route) ? ROUTES[route] : undefined;
  if (!run) return json({ error: "not_found" }, 404);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  try {
    return await run(request, env);
  } catch (e) {
    if (e instanceof Refusal) return json({ error: e.code }, 400);
    throw e; // a real fault (D1 down): index.ts logs it and answers 500
  }
}
