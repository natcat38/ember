# Phase 2: parallel build plan

Written 2026-10-02. Phase 2 slices (`Tech_Scope.md` §10, slices 8–15) split into work units that run at the same time, each in its own git worktree, with no two units owning the same file. Sonnet subagents build server and core units; the lead builds client units, reviews every agent branch, rebases it on main, and merges it by PR.

## Why this split

Client slices all edit `src/App.tsx`, `src/store.ts` and `src/styles.css`, so they stay with one owner (the lead) and run in order. Server and pure-core work lives in separate files (`worker/*.ts`, `core/messages.ts`), so it can go to agents in parallel. Shared files have exactly one owner per wave; anyone else needing a change there writes it in their report for the owner.

## Wave 1 (after PR #15, slice 8 server, merges)

| Unit | Owner | Owns (may edit) | Must not edit |
|---|---|---|---|
| **8c** Client sync: outbox, first-sync upload, landing copy; hard_blocks and settings sync shape | Lead | `src/**`, `core/task.ts`, `migrations/0001_init.sql` (not deployed yet, edited in place), `worker/schema.ts`, `wrangler.jsonc` | — |
| **9s** Server rules: state machines enforced on `/api/sync`, `rejected` reasons | Agent | `worker/rules.ts`, `worker/sync.ts`, `worker/rules.test.ts` (new) | `worker/schema.ts`, `migrations/**`, `src/**`, `core/**` |
| **12c** Message planner: §4.5 day plan as a pure `core/` function, §4.6 golden (08:00, 16:00, 19:00) | Agent | `core/messages.ts`, `core/messages.test.ts` (both new) | everything else |
| **11s** Telegram: webhook (path secret + header), `/start <code>` link, plain message → Inbox task, bot API wrapper with fetch mocked in tests | Agent | `worker/telegram.ts`, `worker/telegram.test.ts` (new), one route line in `worker/index.ts`, `.dev.vars.example` (new) | `worker/sync.ts`, `worker/schema.ts`, `migrations/**`, `src/**` |

Merge order: 12c (no overlap), 9s, 11s, then 8c (the lead rebases last and deploys D1).

## Wave 2 (after wave 1 merges)

| Unit | Owner | Depends on |
|---|---|---|
| **12s** Scheduler: `scheduled()` per-minute cron, claim step, ≤ 20 sends per tick, retry/give-up, link buttons with sign-in codes | Agent | 12c, 11s |
| **14s** Passkeys server: register on the existing user, sign in, verify `@simplewebauthn/server` under `nodejs_compat` first (fallback: WebCrypto ES256) | Agent | 8 |
| **15s** Retention cron (`0 19 * * *`), overdue sent once then silenced | Agent | 12s for overdue; retention alone can start in wave 2 |
| **9c / 11c / 14c** Client: rejected handling + offline indicator, Telegram link row in Settings, passkey UI | Lead | the matching server unit |

## Wave 3

| Unit | Owner | Depends on |
|---|---|---|
| **13s** Telegram buttons: Done, Remove, Snooze, Reschedule, stale-safe edits | Agent | 11s, 12s |

## Needs Natalie (not blocking any wave)

- A production Telegram bot (BotFather) before 11s can be tested live; until then the bot API is mocked.
- The iPhone install test and the subdomain choice (slice 7, part 2).
- Slice 14's device test: phone and laptop showing the same list.

## Rules every agent brief carries

- Work only in your worktree; commit locally; no push, no PR, no deploy, no remote Cloudflare resources.
- Stay inside your file list. If a change is needed elsewhere, write it in the report.
- `npm run typecheck` and `npm test` must pass before the final commit; never pipe a test command into `tail`/`grep` when its exit status matters.
- Report to a file in the lead's scratchpad; return at most 5 lines.
