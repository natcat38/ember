# ADR-0002: Web push is tap-to-open only, with no action buttons

**Status:** Accepted
**Date:** 2026-10-02
**Deciders:** Natalie

## Context

Telegram messages carry buttons (*Snooze*, *Done*, *Reschedule*). Web push could too, through the `actions` option of `showNotification`, but `UX_Flows.md` §5 assumed iOS does not support it and designed around that: every web push opens the right screen, which shows one extra line, *"Not now? [Snooze]"*.

The spike checked the assumption on 2026-10-02 (`docs/research/tech-spike.md` §2):

- WebKit `main` (head 2026-10-01) has `actions` commented out of `NotificationOptions.idl`, so no shipping or upcoming Safari supports it.
- MDN browser-compat-data (2026-08-19): `actions` is unsupported on Safari and Safari iOS. Chrome has it since 48, Firefox since 152.
- Declarative Web Push (Safari 18.4) has no actions field either.

## Decision

Web push is tap-to-open on every platform. The screen a notification opens shows *"Not now? [Snooze]"* when the user arrived from a notification. Buttons live only in Telegram.

## Options considered

| Option | Why it lost |
|---|---|
| **Tap-to-open everywhere (chosen)** | — |
| Action buttons where supported (Chrome, Firefox), tap-to-open on iOS | Two behaviours to build, test, and explain, and the iPhone user, Ember's main persona, never sees the better one. |
| Wait for WebKit to ship actions | Not even in WebKit's unreleased source. No date to wait for. |
| Native wrapper (Capacitor) for real iOS buttons | Apple Developer Program costs $99 a year, which breaks the zero-cost rule (`tech-feasibility.md` §4). |

## Consequences

- One notification behaviour and one service-worker click handler.
- Snooze from web push costs one extra tap (open, then *Snooze*) compared with Telegram.
- Revisit if WebKit uncomments `actions`: the snooze line could then go on iOS.
