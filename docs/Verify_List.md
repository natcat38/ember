# Verify and Review list

Written 2026-10-02 during Build. Every known gap, deferred check and draft-copy decision from the Build PRs (#6–#26), in one place, so the Verify and Review stages start from a list, not from memory. Tick items off here, or move them to an issue.

## Needs Natalie

- [ ] **Before the next deploy: apply migration 0007** (`npx wrangler d1 migrations apply DB --remote`). It adds the scheduler and button-lookup indexes from the improvement audit (#32, #33). A missing index only costs speed, but the daily read cap is the reason it exists.
- [ ] **Rate limiting for `/api/*`: a call.** Audit #34: an empty cookie-less sync no longer writes, but `/api/tg/link` and passkey sign-in options still write a row per call, so a script could use up D1's free 100k writes a day. A dashboard WAF rule needs a zone, and Ember is on `workers.dev`, which has none. Options: a custom domain plus one WAF rule; Workers' rate-limiting binding in code (check it is on the free plan first); or accept it until there are real users.
- [ ] **Production Telegram bot** (BotFather), then `powershell -ExecutionPolicy Bypass -File scripts\set-telegram.ps1` with the token on the clipboard: it does all of the following. It sets `TG_BOT_USERNAME` (var in `wrangler.jsonc`), the secrets `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`, `TG_WEBHOOK_PATH` (see `.dev.vars.example`), and call `setWebhook` with `secret_token` and `allowed_updates: ["message", "callback_query"]`. Until then the scheduler plans but sends nothing.
- [x] ~~workers.dev subdomain~~: Natalie keeps `cron-telegram` (2026-10-02). (Was: rename `cron-telegram` before anyone installs the app (a rename breaks installed icons) and before the bot's link buttons go out (`APP_ORIGIN` in `wrangler.jsonc`).)
- [ ] **Slice 7 part 2: the 5-minute iPhone install test** (`Tech_Scope.md` §7), then the install nudge with the `#import=` handoff, or the agreed fallback.
- [ ] **Slice 14 device check**: phone and laptop show the same list after *Use Ember on another device* / *Sign in with a passkey*. Also look at Worker CPU time on a real sign-in (free plan: 10 ms).
- [x] ~~Onboarding~~: added as slice 16 and built (#29).
- [ ] **Onboarding calls to confirm** (#29): a second device needs a way past the first run, so step 1 has *"Already use Ember? Sign in"* (draft copy); the 2-minute starter ends with the usual *Take 5?* prompt; the reminder offer only has Telegram until web push (phase 3); the picked task shows in Today *and* in Inbox's *Needs sorting*, since it's still untriaged.
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
  - Improvement audit fixes (#49, #54): overdue for an older deadline, *"Lab report was due Friday and isn't marked done. Still relevant?"* (2–6 days) and *"…was due 20 Sept…"* (a week or more); a batch of more than 3, *"A few deadlines are getting close: X, Y, Z, and 5 more. Want to start with X?"*, titles cut at 80 characters; the crash screen, *"Something went wrong"*, *"Your list is still on this device. Reload to carry on."*, *Reload*; the accessible name *"Reschedule <task title>"* on Shutdown's fallback date field (#52).
- [ ] **Product questions:**
  - Should a task complete by itself when its last step is ticked? (#12)
  - An overdue message for a deadline of *yesterday* still says *"was due today"* (it goes out the morning after). Keep it, or say *"yesterday"*? (#49)
  - A journal line written on a fresh browser before it joins an existing list is sealed with that browser's key and won't decrypt after joining. Rare. Drop such lines, or re-seal them on join? (#51)
  - Status text now shows twice for about 5 seconds: inline, and in the announcement line at the top (#52). Keep, or show it inline only and announce it off-screen?
  - Should a Quick task rank without one triage tap? (#10)

- [x] ~~Web push keys~~: set 2026-10-02; the public key is committed and goes live with the next deploy. (Was: run `powershell -ExecutionPolicy Bypass -File scripts\set-vapid.ps1` once, commit the `VAPID_PUBLIC_KEY` line it writes into `wrangler.jsonc`, then deploy. Until then web push is offered as *"Web push isn't set up yet."*)
- [ ] **Phase 3 calls** (#37–#42):
  - The two new cat drawings, **asleep** and **by the door**, are draft art (`src/Cat.tsx`). The day's last step has no bigger moment yet.
  - Journal: there's no screen to read past entries (none is specified). Want one? A line still held for its first sync when Shutdown closes is lost.
  - Draft copy: the Flowtime switch labels and *Take a break*; *"That didn't load. Skip it this time."*; *"Web push isn't set up yet. Try again later."*; *"Your journal needs a connection the first time."*.
  - The first Reward shows the reminder offer and no unlock (onboarding stays as §7 says).
  - The Flowtime switch stays for the session's first minute; a Flowtime session counts as completed from 25 minutes.

## Verify (run the real thing)

- [ ] Touch drag-to-reorder on a real phone (Playwright can't long-press-drag). (#9)
- [ ] A screen-reader and keyboard pass over every screen. (Design_Direction §11)
- [ ] The Focus break's breathing circle moves for 5 minutes: check against WCAG 2.2.2, the same finding as A1. (#11)
- [ ] 320 / 375 / 414 / 768 px with no horizontal scroll on every screen.
- [ ] Desktop: Today and Focus side by side from 1180 px, built (#34). Use it on a real laptop: selection, Focus on the right, Inbox and Settings on the left.
- [ ] Phase 3 on the deployed app: the Lichess frame embeds on the real origin; a web push arrives on desktop Chrome and, after the install test, on iPhone; the tap opens the right screen with *Not now? Snooze*.
- [ ] **Web push CPU:** each push generates a P-256 key pair and runs ECDH (about 0.8 ms in Node). Check a real tick's CPU time against the free plan's 10 ms before more than a few users subscribe.
- [ ] **iPhone on iOS 16** (the newest an iPhone 8 or X gets): the row menu and the Task view menu open through the `data-open` fallback (`src/menu.ts`), rewards load, and an error shows the Reload screen. (#54)
- [ ] **Service worker** (#54): after one online visit, airplane mode and reopen shows the app; on a weak signal the cached shell appears within about 3 seconds.
- [ ] The phone back gesture: built (#33); check it on a real iPhone and Android. A reload opens on Today, so the first back press after a reload from a deeper screen may do nothing visible.

## Review (known code gaps)

- [x] ~~Silent foreign-id write~~: rejected as `foreign_id` (#31).
- [x] ~~Rules check-then-write window~~: closed with a rev guard row; the losing request gets a 503 and the client resends (#31).
- [x] ~~Re-parenting a step with smaller steps~~: refused as `bad_parent` server-side (#31).
- [x] ~~The scheduler had its own Telegram sender~~: folded into `telegram.ts` `botCall` (#27).
- [x] ~~The scheduler didn't pass `now`~~: it does on a day's first plan, so a user who links Telegram mid-day gets the day's messages at the next free slots (#28).
- [x] ~~The snooze slot math was copied into `worker/buttons.ts`~~: it now uses `core/messages.ts`'s exported slot helpers (#28).
- [x] ~~"Done today" reads `updated_at`~~: `done_at` (#32).
- [x] ~~Old hashed assets never evicted~~: each fresh page load drops the ones it no longer reaches (#33).
- [ ] **The pull has no paging**; fine for one person's list. (#15)
- [ ] **The ops ledger keeps rows 30 days** (retention prunes them); check that matches real retry behaviour. (#21)
- [ ] **`users.telegram_chat_id` scan**: the planning backlog drains 5 users a minute. (#24)
- [ ] `/code-review high --fix`, `/simplify`, `web-design-guidelines` (ROADMAP Review stage).
- [ ] **Snooze "tomorrow" is computed twice:** `src/push.ts` `tomorrowSlot` repeats `worker/buttons.ts` `snoozeTime("tomorrow")` (both on core slot helpers). Move `snoozeTime` into `core/messages.ts` and use it from both. (#42)
- [ ] **A push without a task** (morning, wrap-up, batches) shows no *Not now? Snooze* line. (#42)
- [ ] **Left open by the improvement-audit fixes** (#49–#54; `docs/Improvement_Audit.md`):
  - A device whose cookie was lost learns it on its next edit, not on an empty pull (the edit's reply carries `created: true` and the device re-uploads). (#51)
  - Two offline devices deferring different tasks the same day still resolve last-write-wins; the Telegram tap is atomic now. (#50)
  - A reload within 500 ms of typing in the capture field can drop the last characters. (#54)
  - A device with nothing local shows *Loading today.* for up to 2 s before first-run onboarding, because the session cookie is HttpOnly. (#54)
  - The iOS 16 menu fallback has no tap-outside-to-close. (#54)
  - `migrations/0001_init.sql` still says `days.deferred` holds chunk ids; task ids are stored too. An applied migration is never edited; Tech_Scope is correct. (#50)
