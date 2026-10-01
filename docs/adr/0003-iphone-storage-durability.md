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

**Found while writing `Tech_Scope.md` (2026-10-02):** a Home Screen app gets its own storage **and cookies**, separate from Safari ([WebKit bug 181849](https://bugs.webkit.org/show_bug.cgi?id=181849), "Add to homescreen" apps don't share storage with Safari, open since 2018-01-19). Installing from the nudge would open an empty app, and in phase 2 the installed app would start as a new anonymous user.

## Decision

Keep decision 9 as written, plus one addition:

- **Phase 1:** on iPhone Safari, not installed, show the install nudge once after the first reward (copy in `UX_Flows.md` §7). Call `navigator.storage.persist()` once the app runs installed.
- **Phase 2 onward:** back up tasks to D1 under an anonymous identity from the first capture, and drop the nudge.
- **Carry the list across at install (Natalie, 2026-10-02):** when the nudge's *Add to Home Screen* is tapped, Ember writes a one-time handoff into the page address (phase 1: the list itself, in the `#` fragment; phase 2: a one-time code). The installed app imports it on first open. Mechanism and fallback: `Tech_Scope.md` §7.

## Options considered

| Option | Why it lost |
|---|---|
| **Nudge in phase 1, anonymous backup from phase 2 (chosen)** | — |
| Require an account from the first visit | Adds sign-up friction before the first win, which the onboarding flow exists to avoid. |
| Server backup from phase 1 | Phase 1 has no server by design. Pulling the backend forward delays the first shippable version. |
| Accept the wipe | Loses data for exactly the lapsed user Ember is for. |
| Install before the first capture (for the Home Screen split) | No data to move, but adds a step before the 60-second first-step target. Kept as the fallback if the handoff test fails. |
| Accept the split in phase 1, passkey sign-in in phase 2 (for the Home Screen split) | Phase-1 users who install lose their list, and phase 2 would need an account just to install. |

## Consequences

- The phase-1 nudge copy is accurate: "about a week" of Safari use.
- Anonymous backups are deleted after 12 months idle (Natalie, 2026-10-02; `Tech_Scope.md` §8).
- Desktop and Android are unaffected. The rule is Safari's (WebKit's).
- Unverified: the handoff assumes iOS keeps the current address, fragment included, as the home-screen icon's start address. Slice 7 tests it on a real iPhone before anything else is built.
