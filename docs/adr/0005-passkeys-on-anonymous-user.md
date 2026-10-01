# ADR-0005: Passkeys for a second device, attached to the anonymous user

**Status:** Accepted
**Date:** 2026-10-02
**Deciders:** Natalie

## Context

Ember has no sign-up screen. From phase 2, every user is an anonymous server identity from their first capture (ADR-0003). A real sign-in is needed only to open the same list on a second device (`UX_Flows.md` §7).

## Decision

*Use on another device* registers a passkey (WebAuthn) on the existing anonymous user. No new account is created and no data moves. Another device signs in with that passkey; on Windows, by scanning a QR code with the phone. Library: `@simplewebauthn/server` and `@simplewebauthn/browser` 14.x.

## Options considered

| Option | Why it lost |
|---|---|
| **Passkey (chosen, Natalie 2026-10-02)** | — |
| Pairing code shown on the first device | Simplest to build, but losing the only device loses the account. Passkeys sync through iCloud Keychain or Google Password Manager. |
| Telegram sign-in link | Works only for users who linked Telegram. |
| Email magic link | Sending mail to arbitrary addresses needs an owned sending domain, which costs money. |

## Consequences

- Recovery after a lost phone comes free with the platform's passkey sync.
- More code than a pairing code: registration and assertion endpoints, a `credentials` table, challenge storage.
- Risk: `@simplewebauthn/server` lists Node and Deno, not Workers. Slice 14 verifies it under `nodejs_compat` first; the fallback is verifying ES256 assertions directly with WebCrypto.
- Users with a passkey are exempt from the 12-month anonymous retention rule (`Tech_Scope.md` §8).
