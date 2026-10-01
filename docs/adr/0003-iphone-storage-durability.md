# ADR-0003: Protect iPhone data with an install nudge, then a server backup

**Status:** Accepted
**Date:** 2026-10-02
**Deciders:** Natalie

## Context

Phase 1 stores the list only in the browser. `Product_Scope.md` §7, decision 9 and `UX_Flows.md` §7 assumed Safari wipes a site's stored data after about 7 days without a visit, unless the site is on the Home Screen. The user most hurt is the one Ember is built for: someone who lapses for a week, then comes back.

The spike confirmed it from WebKit's own documentation on 2026-10-02 (`docs/research/tech-spike.md` §3):

- Safari deletes all script-writable storage (IndexedDB, localStorage, sessionStorage, service worker cache) after 7 **days of Safari use** without interaction with the site.
- "The first-party domain of home screen web applications is exempt" ([webkit.org/tracking-prevention](https://webkit.org/tracking-prevention/)).
- Home-screen apps are favoured when granting `navigator.storage.persist()` (WebKit blog, 2023-08-10).

## Decision

Keep decision 9 as written, plus one addition:

- **Phase 1:** on iPhone Safari, not installed, show the install nudge once after the first reward (copy in `UX_Flows.md` §7). Call `navigator.storage.persist()` once the app runs installed.
- **Phase 2 onward:** back up tasks to D1 under an anonymous identity from the first capture, and drop the nudge.

## Options considered

| Option | Why it lost |
|---|---|
| **Nudge in phase 1, anonymous backup from phase 2 (chosen)** | — |
| Require an account from the first visit | Adds sign-up friction before the first win, which the onboarding flow exists to avoid. |
| Server backup from phase 1 | Phase 1 has no server by design. Pulling the backend forward delays the first shippable version. |
| Accept the wipe | Loses data for exactly the lapsed user Ember is for. |

## Consequences

- The phase-1 nudge copy is accurate: "about a week" of Safari use.
- Anonymous backups need a retention rule for users who never return. That rule belongs to `Tech_Scope.md`.
- Desktop and Android are unaffected. The rule is Safari's (WebKit's).
