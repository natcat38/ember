import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

// Passkeys on the anonymous user (ADR-0005): a passkey is added to the identity this device already has, and a second
// device signs in with it and receives the same identity. The server routes are in worker/passkeys.ts.

export const passkeysSupported = () => typeof window !== "undefined" && "PublicKeyCredential" in window;

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json() as Promise<T>;
}

// The browser's own passkey sheet was dismissed: not a failure worth a message.
export const cancelled = (e: unknown) => e instanceof Error && e.name === "NotAllowedError";

export async function addPasskey(): Promise<void> {
  const optionsJSON = await post<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/passkey/register/options");
  await post("/api/passkey/register/verify", await startRegistration({ optionsJSON }));
}

export async function signInWithPasskey(): Promise<void> {
  const optionsJSON = await post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/passkey/login/options");
  await post("/api/passkey/login/verify", await startAuthentication({ optionsJSON }));
}
