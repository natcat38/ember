// Anonymous identity (Tech_Scope.md §8, ADR-0004): an HttpOnly cookie set by this Worker on its own origin, which
// Safari's 7-day storage wipe does not cover.

export const COOKIE_NAME = "ember_uid";
const MAX_AGE_SECONDS = 34_560_000; // 400 days, Chrome's cap
const UID_RE = /^[A-Za-z0-9_-]{22}$/; // 16 random bytes, base64url without padding

export const cookieFor = (uid: string) => `${COOKIE_NAME}=${uid}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`;

function cookieValue(request: Request): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return null;
}

// 128 bits from the platform CSPRNG, base64url (RFC 4648 §5) without padding.
export function newUserId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface Identity {
  uid: string;
  created: boolean;
}

// A valid cookie that names an existing user is reused and its last_seen_at refreshed in the same statement.
// Anything else (no cookie, malformed, or a user the retention job already deleted) gets a fresh user: the client
// never chooses its own id. Two first requests in flight at once would create two users; the client serialises its
// first sync, so this does not arise in practice.
export async function resolveUser(db: D1Database, request: Request, now: number): Promise<Identity> {
  const presented = cookieValue(request);
  if (presented && UID_RE.test(presented)) {
    const row = await db.prepare("UPDATE users SET last_seen_at = ?1 WHERE id = ?2 RETURNING id").bind(now, presented).first<{ id: string }>();
    if (row) return { uid: row.id, created: false };
  }
  const uid = newUserId();
  await db.prepare("INSERT INTO users (id, created_at, last_seen_at) VALUES (?1, ?2, ?2)").bind(uid, now).run();
  return { uid, created: true };
}
