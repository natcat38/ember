# ADR-0004: One Worker serves the app, the API, and the cron, on one origin

**Status:** Accepted (refines ADR-0001)
**Date:** 2026-10-02
**Deciders:** Natalie

## Context

ADR-0001 named Cloudflare Pages for the frontend and Workers for the API. Phase 2 keeps an anonymous user's identity in a cookie so the server backup survives Safari's 7-day wipe. That wipe covers browser storage and cookies created by JavaScript, but not cookies the server sets on its own origin. The exception: a cookie set by a host that resolves to a third-party IP, which Safari caps at 7 days (`webkit.org/tracking-prevention`, fetched 2026-10-02). Cloudflare's docs (2026-09-22) confirm one Worker can serve static assets, API routes, and a cron trigger together.

## Decision

Deploy one Worker, `ember-tasks`: static assets for the PWA, `/api/*` routes, the Telegram webhook, and the `scheduled()` handler. The identity cookie `ember_uid` is `HttpOnly; Secure; SameSite=Lax`, set by that Worker on that origin.

## Options considered

| Option | Why it lost |
|---|---|
| **One Worker with static assets (chosen)** | — |
| Pages for the app + a separate Worker for API and cron | Two deploys. The API on another hostname risks Safari's 7-day cap on its cookie and needs CORS. |
| Pages with Pages Functions for the API, plus a Worker for cron | Same origin, but still two deploys sharing one D1, and Pages Functions cannot hold the cron. |
| Identity in `localStorage` or a JavaScript cookie | Deleted by the 7-day wipe, which is the exact case the backup exists for. |

## Consequences

- One `wrangler deploy` ships everything, and one config lists every binding.
- The API never needs CORS.
- Rule for the codebase: the API never moves to another hostname (`Tech_Scope.md` §11).
