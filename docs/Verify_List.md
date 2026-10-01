# Verify and Review list

Written 2026-10-02 during Build. Every known gap, deferred check and draft-copy decision from the Build PRs (#6–#26), in one place, so the Verify and Review stages start from a list, not from memory. Tick items off here, or move them to an issue.

## Needs Natalie

- [ ] **Production Telegram bot** (BotFather). Then set `TG_BOT_USERNAME` (var in `wrangler.jsonc`), the secrets `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`, `TG_WEBHOOK_PATH` (see `.dev.vars.example`), and call `setWebhook` with `secret_token` and `allowed_updates: ["message", "callback_query"]`. Until then the scheduler plans but sends nothing.
- [ ] **workers.dev subdomain**: rename `cron-telegram` before anyone installs the app (a rename breaks installed icons) and before the bot's link buttons go out (`APP_ORIGIN` in `wrangler.jsonc`).
- [ ] **Slice 7 part 2: the 5-minute iPhone install test** (`Tech_Scope.md` §7), then the install nudge with the `#import=` handoff, or the agreed fallback.
- [ ] **Slice 14 device check**: phone and laptop show the same list after *Use Ember on another device* / *Sign in with a passkey*. Also look at Worker CPU time on a real sign-in (free plan: 10 ms).
- [ ] **Onboarding** (`UX_Flows.md` §7: first capture, *"That's it for now"*, the one/many branch, starter focus) is in the UX flows but in no Build slice. Decide: add a slice, or move it to a later phase.
- [ ] **Draft copy to approve** (each is marked `ponytail:` or listed in its PR):
  - Save failure: *"This device isn't saving right now. Keep Ember open so nothing is lost."* (#7)
  - Reward: *Next step*, *Back to Today* (#12)
  - Hard-block form: *"Pick at least one day."*, *"End it after it starts."* (#14)
  - Lapse reset buttons *Reset them* / *Leave them*, and what "reset" means: the passed deadline is cleared (#13)
  - Telegram linking: *"Telegram isn't set up yet. Try again later."*, *"That didn't work. Try again in a moment."*, *"Linking Telegram needs a connection."*, *"Nudges go to Telegram."* (#20, #25)
  - Passkeys: *"Done. On your other device, open Ember, go to Settings, and choose Sign in with a passkey."* (#23)
  - Bot replies: expired link, bare `/start`, unlinked chat, over 500 characters, capture refused, other commands (#18)
  - Messages: morning with an empty Today, *"X and Y"* for two batched tasks (#16)
  - Telegram buttons: *"Moved to Fri 10 Oct."*, *"Okay, not today."*, *"Already removed."*, *"That's changed since. Open Ember to see where it stands."*, *"Snoozed until tomorrow, 08:00."* (#27). Also: should the overdue message keep its *Open today / Start a session* links beside *Reschedule / Done / Remove*?
- [ ] **Product questions:**
  - Should a task complete by itself when its last step is ticked? (#12)
  - Should a Quick task rank without one triage tap? (#10)

## Verify (run the real thing)

- [ ] Touch drag-to-reorder on a real phone (Playwright can't long-press-drag). (#9)
- [ ] A screen-reader and keyboard pass over every screen. (Design_Direction §11)
- [ ] The Focus break's breathing circle moves for 5 minutes: check against WCAG 2.2.2, the same finding as A1. (#11)
- [ ] 320 / 375 / 414 / 768 px with no horizontal scroll on every screen.
- [ ] Desktop: Today and Focus side by side (UX_Flows §2) is not built.
- [ ] The phone back gesture (only the in-app *Back* exists). (#8)

## Review (known code gaps)

- [ ] **Silent foreign-id write**: a complete op reusing a row id another user owns is skipped with a 200. It should be rejected as `foreign_id`. (#19, #17)
- [ ] **Rules check-then-write window**: two requests at the same instant can both pass a state check. The fix is guarded `UPDATE … WHERE state IN (…)`. (#17)
- [ ] **Re-parenting** a step that already has smaller steps isn't checked server-side (the client never does it). (#17)
- [x] ~~The scheduler had its own Telegram sender~~: folded into `telegram.ts` `botCall` (#27).
- [x] ~~The scheduler didn't pass `now`~~: it does on a day's first plan, so a user who links Telegram mid-day gets the day's messages at the next free slots (#28).
- [x] ~~The snooze slot math was copied into `worker/buttons.ts`~~: it now uses `core/messages.ts`'s exported slot helpers (#28).
- [ ] **"Done today" reads `updated_at`**: renaming a step finished on an earlier day brings it back as done today. A `done_at` would fix it. (#10)
- [ ] **Old hashed assets** are never evicted from the service worker cache. (#13)
- [ ] **The pull has no paging**; fine for one person's list. (#15)
- [ ] **The ops ledger keeps rows 30 days** (retention prunes them); check that matches real retry behaviour. (#21)
- [ ] **`users.telegram_chat_id` scan**: the planning backlog drains 5 users a minute. (#24)
- [ ] `/code-review high --fix`, `/simplify`, `web-design-guidelines` (ROADMAP Review stage).
