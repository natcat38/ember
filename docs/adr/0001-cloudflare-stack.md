# ADR-0001: Cloudflare Pages + Workers + D1 + Cron Triggers

**Status:** Accepted
**Date:** 2026-10-02
**Deciders:** Natalie

## Context

Ember has to send reminders through the day with zero running cost, indefinitely. No browser ships client-side scheduled notifications (the Notification Triggers API never left origin trial), so a server must wake on a schedule and send every reminder. Phase 2's spine is that loop: a scheduler reads due reminders and sends them over Telegram (`Product_Scope.md` §7, decisions 2 and 4). Decision 4 picked Cloudflare provisionally, pending a feasibility spike.

## Decision

Host the frontend on Cloudflare Pages and the API, data, and scheduler on Cloudflare Workers + D1 (SQLite) + Cron Triggers, on the free plan.

The spike proved it on a live deploy on 2026-10-01: a per-minute cron read a due row from D1 and sent it to Telegram, landing 37.5 s after due, with 0.67 s of that spent working (`docs/research/tech-spike.md` §1).

## Options considered

Full comparison in `docs/research/tech-feasibility.md` §6.

| | A: Cloudflare (chosen) | B: Local-first CRDT | C: Go/Python API + Supabase |
|---|---|---|---|
| Shape | Pages + Workers + D1 + cron, one vendor | TinyBase/Dexie + Yjs/Automerge over a relay, plus a Cloudflare cron for sends | Go/Python API on Fly.io or Workers-WASM, Supabase Postgres, Supabase or Cloudflare cron |
| Cost | $0, no pausing | $0 while the free relay lasts | $0, but Supabase pauses after 7 idle days |
| Complexity | Low | High: merge logic, offline persistence, sync debugging | Medium: two vendors |
| Scheduler | 1-minute cron, measured | Same as A (still needs it) | Supabase `pg_cron` collides with the pause; else borrows A's cron |

**Why B lost:** true offline merge is the strongest portfolio story but the highest risk on a 3-month runway. A to-do app with a server of record does not need CRDTs. B stays open as a v2 layered on A.

**Why C lost:** it shows nothing A doesn't, and it brings back the Supabase pause risk. Go on Workers needs a WASM build, and Fly.io's free allowance now requires a card. Natalie's PL/SQL history already covers the "knows SQL" signal.

**Scheduler alternatives that lost** (`tech-feasibility.md` §1): GitHub Actions cron (5-minute floor, 5–30 min jitter), Vercel Hobby cron (once a day), Upstash QStash (about 500 messages a day), Supabase `pg_cron` (pauses with the database).

## Consequences

- One vendor for hosting, API, database, and scheduler. No pause or keep-alive hack.
- Reminders land within about one minute of due. Good enough for "nudge at 3pm"; not for second-precise alarms.
- The code is JavaScript or TypeScript on the Workers runtime (which one is a Build choice). Go and Python do not appear in this repo.
- Free-plan ceilings shape the scheduler: 10 ms CPU and 50 subrequests per cron invocation, 5 cron triggers per account, D1 at 100k row writes a day. Each Telegram send is one subrequest, so the per-tick send loop must be capped.
- Lock-in: D1 is SQLite and Workers are close to standard `fetch` handlers, so a move costs a port, not a rewrite.

## Action items

1. [ ] `Tech_Scope.md`: send loop with a claim step (no double-sends on retry or overlapping ticks), a per-tick cap under 50, and a give-up rule for failed sends (`tech-spike.md` §1, gotchas).
2. [ ] Pin the wrangler version in `package.json` at Build.
3. [ ] Delete the spike Worker, its D1 database, and the misnamed secret before the repo goes public (`tech-spike.md`, cleanup).
