# Ember: Tech Scope

Status: **draft, 2026-10-02**, awaiting Natalie's approval. Inputs: `Product_Scope.md` (what), `UX_Flows.md` (how it behaves), `docs/research/tech-spike.md` (what was proven), ADRs in `docs/adr/` (why). This document covers phases 1 and 2 (the cut line) in full and sketches phases 3 and 4.

## 1. Stack

| Layer | Choice | Version (2026-10-02) | Why |
|---|---|---|---|
| Language | TypeScript | 7.0.2 | Product_Scope §1. One language on client and Worker, so the ranking and scheduling code is shared. |
| UI | React + Vite | React 19.3.0, Vite 8.3.2, `@vitejs/plugin-react` 6.1.1 | Natalie's stack. |
| Runtime and hosting | One Cloudflare Worker with static assets, API routes, and cron | wrangler 4.145.0 (pinned; 4.146.0 was unfetchable on release day), `@cloudflare/vite-plugin` 1.62.4 | ADR-0001, refined by ADR-0004: one origin for app and API. |
| Database | Cloudflare D1 (SQLite) | — | ADR-0001. |
| Device storage | `localStorage`, one JSON document | — | A task list is kilobytes; the 5 MB limit is far away. Upgrade path: IndexedDB if it ever is not. |
| Messages | Telegram Bot API (webhook + `sendMessage`) | Bot API, no library | Phase 2 channel (decision 2). Two `fetch` calls do not need an SDK. |
| Sign-in | Passkeys | `@simplewebauthn/server` 14.0.3, `@simplewebauthn/browser` 14.0.0 | ADR-0005. |
| AI breakdown (phase 4) | Workers AI, `@cf/meta/llama-3.1-8b-instruct-awq` | — | ADR-0007. Same vendor, no API key. |
| Tests | Vitest, `@cloudflare/vitest-pool-workers`, Playwright | 5.0.3, 0.22.0, 1.63.0 | §9. |

Versions get pinned in `package.json` in slice 0. If TypeScript 7 (the new native compiler) breaks a tool in the chain, pin the last 5.x and note it here.

## 2. Architecture

```
 iPhone / desktop browser                 Cloudflare (one Worker: ember-tasks)
 ┌───────────────────────────┐            ┌──────────────────────────────────────────┐
 │ React PWA                 │  same      │ static assets  (the built PWA)           │
 │  core/ ranking + planning │  origin    │ /api/sync      push ops, pull changes    │
 │  localStorage: state +    │ ─────────▶ │ /api/auth/*    passkeys, handoff codes   │
 │    outbox of ops          │  cookie:   │ /api/tg/<secret>  Telegram webhook       │
 │  service worker: offline  │  ember_uid │ scheduled()    every minute: plan, send  │
 │    app shell              │  HttpOnly  │ core/ (same code as the client)          │
 └───────────────────────────┘            │ D1: users, tasks, chunks, sessions,      │
                                          │     ops, sends, credentials, handoffs    │
 Telegram app ◀── sendMessage ─────────── │                                          │
             ── button taps (webhook) ──▶ └──────────────────────────────────────────┘
```

- **Phase 1** ships only the static assets and the client. No API, no D1. `core/` runs on the device.
- **Phase 2** adds the API, D1, cron, and Telegram. The client keeps working offline and syncs when it can. The server is the source of truth and enforces every state rule; the client mirrors them for instant feedback.
- **Same origin is load-bearing.** Safari's 7-day wipe covers browser storage and JavaScript-set cookies, but not a cookie the server sets on its own origin (`webkit.org/tracking-prevention`). The anonymous identity therefore lives in an `HttpOnly` cookie from the same host. Moving the API to another host would put it back in the wipe's reach (ADR-0004).

## 3. Data model

D1 schema for phase 2. The phase-1 client stores the same entity shapes in `localStorage`, so phase 2's first sync uploads them unchanged.

```sql
users(
  id TEXT PRIMARY KEY,            -- 128-bit random, base64url; the ember_uid cookie value
  created_at INTEGER, last_seen_at INTEGER,          -- unix ms
  tz TEXT NOT NULL DEFAULT 'Asia/Singapore',         -- IANA name, from the browser
  quiet_start INTEGER DEFAULT 1320, quiet_end INTEGER DEFAULT 480,   -- minutes after local midnight
  channel TEXT,                   -- 'telegram' | 'push' | NULL (in-app only)
  telegram_chat_id TEXT,
  rev INTEGER NOT NULL DEFAULT 0  -- last change number handed out to this user's rows
)
hard_blocks(id TEXT PRIMARY KEY, user_id, weekday INTEGER,  -- 0 = Monday
  start_min INTEGER, end_min INTEGER, rev INTEGER, deleted INTEGER DEFAULT 0)
tasks(
  id TEXT PRIMARY KEY,            -- client-generated UUID
  user_id TEXT NOT NULL, title TEXT NOT NULL,
  state TEXT NOT NULL,            -- inbox | active | overdue | done | removed
  size TEXT,                      -- XS | S | M | L | XL, NULL until triaged
  quick INTEGER DEFAULT 0, holding_up INTEGER DEFAULT 0,
  deadline TEXT,                  -- local date 'YYYY-MM-DD', NULL = none
  runway_start TEXT,              -- local date the deadline was last set
  pinned_on TEXT,                 -- local day the user pinned it into Today
  snoozed_until INTEGER,
  created_at INTEGER, updated_at INTEGER, rev INTEGER NOT NULL
)
chunks(
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, parent_id TEXT,   -- parent_id: two levels max
  title TEXT NOT NULL, position REAL NOT NULL,                  -- REAL so a move rewrites one row
  state TEXT NOT NULL,            -- todo | focus | done (leaves only; parents are derived)
  deleted INTEGER DEFAULT 0, updated_at INTEGER, rev INTEGER NOT NULL
)
sessions(id TEXT PRIMARY KEY, chunk_id, started_at INTEGER, ended_at INTEGER,
  completed INTEGER, rev INTEGER)                               -- one focus session
days(user_id, day TEXT, confirmed_at INTEGER, shutdown_at INTEGER,
  deferred TEXT,                  -- JSON array of chunk ids marked "Not today"
  rev INTEGER, PRIMARY KEY (user_id, day))
ops(op_id TEXT PRIMARY KEY, user_id TEXT, applied_at INTEGER)   -- idempotency ledger
sends(
  id TEXT PRIMARY KEY, user_id TEXT, day TEXT,
  kind TEXT,                      -- morning | light_day | close | deadline_day | overdue | wrap_up
  task_ids TEXT,                  -- JSON array; several when batched
  due_at INTEGER, claimed_at INTEGER, sent_at INTEGER, attempts INTEGER DEFAULT 0,
  tg_message_id INTEGER, acted_at INTEGER, snoozed_at INTEGER,
  cancelled INTEGER DEFAULT 0
)
credentials(id TEXT PRIMARY KEY, user_id, public_key BLOB, counter INTEGER,
  transports TEXT, created_at INTEGER)                          -- passkeys
handoffs(code TEXT PRIMARY KEY, user_id, purpose TEXT,          -- install | tg_link | login_link
  expires_at INTEGER, used_at INTEGER)
```

Rules the schema does not show:

- **Nothing is hard-deleted by the user.** *Remove from list* sets `state = removed`; deleting a step sets `deleted = 1`. Sync needs the tombstone to tell other devices. Only the retention job (§8) deletes rows.
- **A parent chunk's state is never stored.** It is computed from its children (Product_Scope §4).
- **Reminder states are derived, not stored as one column:** Scheduled = planned row, not sent; Sent = `sent_at`; Acted = `acted_at`; Snoozed = `snoozed_at`; Dismissed = sent more than 5 hours ago with neither; Silenced = an `overdue` row exists for the task and the deadline hasn't changed since.

## 4. Core logic

All of this lives in `core/`, plain functions with the clock passed in, shared by the client (phase 1) and the Worker (phase 2).

### 4.1 Day boundary

A day starts when quiet hours end (08:00 default) in the user's time zone. Its name is the local date at that moment. A 01:00 session belongs to the day before.

### 4.2 Size to sessions

| Size | Base sessions (25 min) | Padded: `round(base × 1.2)` |
|---|---|---|
| XS | 1 | 1 |
| S | 2 | 2 |
| M | 4 | 5 |
| L | 8 | 10 |
| XL | 16 | 19 |

`remaining = max(padded − completed sessions, 1)` while the task is not done. These numbers are a proposal; phase 4's estimate-vs-actual replaces them with the user's own history.

### 4.3 Bands

`days_left = deadline − today`, in local days. `runway = max(deadline − runway_start, 1)`. `fraction = days_left / runway`.

| Band | Rule (first match wins) |
|---|---|
| overdue | `days_left < 0` |
| due today | `days_left = 0` |
| getting close | `days_left ≤ 3` or `fraction ≤ 0.3` |
| far | no deadline, or `fraction > 0.5` |
| on track | everything else |

**Holding up** moves a task one band up: far → on track → getting close. It never lifts a task into due today or overdue.

### 4.4 Building Today

1. **Tier** each active or overdue task with at least a size: pinned today (0), due today (1), overdue (2), getting close (3), on track (4), far (5).
2. **Sort** by tier, then holding up first, then `pressure = remaining / max(days_left − 1, 1)` descending (sessions per day still needed, keeping one buffer day), then earlier deadline, then older `runway_start`.
3. **Each task contributes rows:** its first unfinished leaf chunks in list order, `min(unfinished leaves, clamp(ceil(pressure), 1, 2))` of them. The cap of 2 stops one big task from filling the whole day. A task with no chunks contributes one row whose Start asks for the next action (UX_Flows §3.3).
4. **Skip** chunks deferred today (*Not today*). Tier 5 (far) is skipped too, except for the light-day offer.
5. **Capacity:** `slots = min(5, floor(free_minutes / 30))`, where free minutes are the waking window (quiet end to quiet start) minus today's hard blocks. Phase 1 has no hard blocks, so it is always 5.
6. **Take** the first `slots` rows. Leftover non-far rows feed *"N more waiting"*.
7. **Frog** = row 1. A due-today task is tier 1 and an overdue one tier 2, so **due today wins the frog over overdue**. This follows Product_Scope's "on a deadline day, the due-today task's chunk is auto-frog" and closes the open question in `Wireframes.md`.
8. **Light day:** if fewer than `slots` rows were filled, offer the top far task once: *"Light day. Want to get ahead on X?"*

### 4.5 Planning the day's messages (phase 2)

At day start the scheduler plans every message the day can want, then keeps the best 3. This is how slots are held for higher-priority messages later in the day (UX_Flows §5): nothing is sent until the whole day is planned.

**Slots** in the waking window W (08:00–22:00 default): S1 = W start, S2 = W midpoint, S3 = W end − 3 h, S4 = W end − 1 h. A slot that falls inside a hard block moves to that block's end.

| Kind | Candidate when | Preferred slot | Cap priority |
|---|---|---|---|
| overdue | task went overdue at this day boundary, no `overdue` send yet | S1 | 1 |
| deadline_day | task due today | S1 | 2 |
| close | one or more getting-close tasks; all batched into one message | S2, then S3 for a second nudge | 3 |
| morning | always | S1 | 4 |
| light_day | Today has room and a far task exists | S1, sent instead of morning | 4 |
| wrap_up | always | S4 | 5 |

1. **Select:** sort candidates by cap priority and keep the first `3 − already sent today`.
2. **Place** in time-sensitivity order: deadline_day, overdue, morning or light_day, close, wrap_up. Each takes its preferred slot, or the next free slot after it. One message per slot, and never within 30 minutes of the user's last snooze or dismissal.
3. **Replan** (delete the day's unsent, unclaimed rows, then run 1–2 again) whenever a sync, a Telegram button, or a snooze changes a task that has a planned row.

**Snooze** sets `snoozed_until`: *1 hour* = now + 60 min, *This evening* = S3, *Tomorrow* = next day's S1. The replan places the task's message at that time. It still counts against the cap, and the deadline does not move.

### 4.6 Worked example

Mei, Monday 2026-10-05, quiet hours 22:00–08:00, time zone Asia/Singapore. Hard blocks on Mondays: 09:00–12:00 and 14:00–16:00.

| Task | Size → remaining | Deadline (runway start) | Band | Pressure | Rows |
|---|---|---|---|---|---|
| B Cover letter | S → 2 | 10-05 (10-01) | due today, tier 1 | 2 / 1 = 2.0 | B1 (its only step) |
| C Lab report (3 steps left) | L → 10 | 10-04 (09-20) | overdue, tier 2 | 10 / 1 = 10 | C1, C2 (capped at 2) |
| A DSA assignment | M → 5 − 1 done = 4 | 10-08 (09-28) | 3 days left → close, tier 3 | 4 / 2 = 2.0 | A1, A2 |
| E Reply to recruiter | XS → 1 | 10-20 (10-01) | fraction 15/19 = 0.79 → far, holding up → on track, tier 4 | 1 / 14 | E1 |
| D System design ch. 3 | M → 5 | none | far, tier 5 | — | light day only |

Free time: 14 h waking window − 5 h of blocks = 540 min → `floor(540 / 30) = 18`, so the cap of 5 binds.

**Today:** B1 (frog), C1, C2, A1, A2. Overflow line: *"1 more waiting. They'll come up when there's room."* (E1). D is not offered, because the day is full.

**Messages:** candidates are overdue C (1), deadline day B (2), close A (3, wants two nudges), morning (4), wrap-up (5). The first three are kept; morning, A's second nudge, and wrap-up drop. Slots are S1 08:00, S2 15:00 → inside the 14:00–16:00 block → 16:00, S3 19:00, S4 21:00. Placement: deadline day B → 08:00 (*"Cover letter is due today."*), overdue C → S1 taken → 16:00, close A → S2 taken → 19:00. Three messages, deadlines first, nothing during a lecture.

The example becomes the golden test for `core/` (§9).

## 5. Sync (phase 2)

**Push and pull in one call:** `POST /api/sync { cursor, ops: [...] }` → `{ cursor, changes: [...], rejected: [...] }`.

- **An op** is `{ op_id, entity, id, fields }`: a patch of named fields on one row. `op_id` is a client UUID made when the user acts, stored in the outbox, and reused on every retry.
- **No op runs twice.** The server drops ops whose `op_id` is already in `ops`, then applies the rest and records their `op_id`s in one `db.batch()`, which D1 runs as a single transaction. A retry after a lost response finds its ops recorded and skips them. Two concurrent requests carrying the same op collide on the `ops` primary key, so one batch fails as a whole and its retry is filtered.
- **Conflicts: per-field last write wins, in server arrival order.** Device A renames a task while device B marks it done, both offline: both fields land. If both rename it, the rename that reaches the server last wins. Client clocks are never compared.
- **The server enforces the rules.** Each op is checked against the state machines in Product_Scope §4 (for example, nothing leaves `done`). An illegal op is returned in `rejected`, and the client drops its local change and takes the server row. The client runs the same checks first, so in practice this only happens after a two-device race.
- **Pull:** every applied write sets the row's `rev` to `++users.rev`. Changes are the user's rows with `rev > cursor`. One integer per user, no clocks.
- **When:** on app open, on regaining focus or a connection, and about 2 seconds after the last local change. No websockets. Two devices converge within one open or focus.

## 6. Telegram (phase 2)

- **Linking:** Settings → *Telegram* creates a `handoffs` row (`tg_link`, 15 minutes) and opens `t.me/<bot>?start=<code>`. The bot gets `/start <code>`, stores `telegram_chat_id`, and replies *"Linked. Ember will nudge you here."*
- **Webhook** at `/api/tg/<path-secret>`, also checked with Telegram's `X-Telegram-Bot-Api-Secret-Token` header.
- **Capture:** any plain text message to the bot becomes an Inbox task (UX_Flows §3.1, phase-2 seam).
- **Link buttons** (*Start a session*, *Open today*, and so on) are URLs carrying the send id and a sign-in code: `/task/<id>?s=<send>&h=<code>`. On iPhone, Telegram opens links in its own in-app browser, which has **its own cookie jar**, so without the code the page opens as a stranger with an empty list. The code is a `handoffs` row (`login_link`) that expires after 24 hours; redeeming it sets the cookie in whichever browser opened it. Anyone holding the chat could already act on every button, so this adds no new power.
- **State buttons** (*Done*, *Remove from list*, *Snooze*, *Reschedule*) carry `callback_data` like `d:<task>:<send>` (limit 64 bytes; a UUID is 36). The webhook applies the change through the same op path as `/api/sync`, with a deterministic `op_id` (`tg:<callback_query.id>`), so a repeated tap is a no-op. It then edits the message and removes the buttons. A stale button finds the task already done and edits the message to *"Already done."*

## 7. iPhone install handoff

Home Screen apps on iPhone get their own storage and cookies, separate from Safari ([WebKit bug 181849](https://bugs.webkit.org/show_bug.cgi?id=181849), open since 2018-01-19). Installing from the phase-1 nudge would otherwise open an empty app, and in phase 2 the installed app would start as a new anonymous user. Decision (Natalie, 2026-10-02): **carry the list across at install** (ADR-0003).

- When the nudge's *Add to Home Screen* is tapped, Ember rewrites the page address before showing the iOS share-sheet steps:
  - Phase 1: `/#import=<compressed JSON of the whole state>`. The `#` part never leaves the device.
  - Phase 2: `/#handoff=<code>`, a one-time `install` code valid for 1 hour. Redeeming it sets the installed app's cookie to the same user.
- On first open, the installed app reads the fragment, imports or redeems it, and clears the address. Importing twice is harmless: phase 1 skips ids it already has, and a phase-2 code works once.
- ⚠️ **Unverified:** this relies on iOS using the current address for the home-screen icon rather than the manifest's `start_url`. Slice 7 tests it on Natalie's iPhone before building anything else. If it fails, fall back to showing the install step before the first capture (option 2 in the 2026-10-02 decision), which changes `UX_Flows.md` §7.

## 8. Identity, sign-in, retention

- **Anonymous identity (phase 2):** the first sync without a cookie creates a user and sets `ember_uid` (`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=34560000`, which is 400 days, Chrome's cap). Every visit refreshes it.
- **Account = passkey on the same user** (ADR-0005). *Use on another device* in Settings registers a passkey for the existing user id; nothing is migrated. A second device signs in with the passkey (on Windows, by scanning the phone's QR code) and receives the cookie.
- **Retention (Natalie, 2026-10-02): 12 months.** A daily cron (`0 19 * * *` UTC, 03:00 Singapore) deletes users with no passkey and `last_seen_at` older than 365 days, with all their rows. Users with a passkey are kept.

## 9. Test strategy

| Layer | Tool | What it proves |
|---|---|---|
| `core/` | Vitest, plain unit tests, clock injected | Bands, ranking, Today build, message plan. The §4.6 example is the golden test. |
| Worker + D1 | `@cloudflare/vitest-pool-workers` (real D1 in a local simulator), Telegram `fetch` mocked | Same op twice applies once. Concurrent duplicates. Illegal transition rejected. Two overlapping ticks send once. Replan never exceeds the cap. |
| UI | Playwright at 375 × 812 | The phase-1 loop end to end (capture → triage → step → Today → focus → reward → shutdown); offline queueing in phase 2. |
| Device | Natalie's iPhone, by hand | The install handoff (slice 7). Telegram link opens signed in (slice 14). |

CI (GitHub Actions) runs typecheck + Vitest on every PR, and Playwright on PRs that touch `src/`. Each slice runs only the layers it touched.

## 10. Vertical slices

Each slice ends runnable, tested, and merged by PR. No slice starts while the previous one is red.

### Phase 1: the loop, one device

| # | Slice | Done when | Tests |
|---|---|---|---|
| 0 | **Day-1 hygiene.** Vite + React + TS skeleton served by the `ember-tasks` Worker (static assets only), pinned versions, `.gitignore`, README stub, CI, env config via wrangler vars. Production bot and Worker are separate from the spike's. | `wrangler deploy` serves "Ember" at `ember-tasks.<subdomain>.workers.dev`; CI green on a PR | CI runs an empty suite |
| 1 | **Capture → Inbox.** Capture sheet, draft kept on dismiss, empty send ignored, Quick and Deadline chips, `localStorage` store | Five captures in a row survive a reload | unit: store; e2e: capture |
| 2 | **Triage + Task view.** Deadline, holding up, size; Inbox → Active; *Remove from list* with prompt and restore | A triaged task shows as Active | unit: task transitions |
| 3 | **Steps.** Manual next action, list, reorder (drag + *Move up/down*), split once, parent derived, delete-parent prompt | All 8 rules in UX_Flows §3.3 hold | unit: chunk tree rules |
| 4 | **Today.** `core/` bands + ranking + Today build (§4.1–4.4), frog, *Not today*, pin, overflow line, morning confirm, empty state | §4.6 example (minus hard blocks) renders as specified | unit: golden test |
| 5 | **Focus.** 25/5 wall-clock timer, Pause, Done, *Stop for now*, *Take 5?* prompt, restful break screen, sessions logged | Locking the phone mid-session loses nothing | unit: timer from timestamps; e2e: focus |
| 6 | **Reward + shutdown.** Progress ring, bigger last-of-day moment, three-step shutdown, zero-done variant | The loop runs end to end | e2e: full loop at 375 px |
| 7 | **PWA + iPhone safety.** Manifest, service worker (offline shell), lapse return, iPhone install nudge with the §7 handoff, `navigator.storage.persist()` | **First:** the handoff test on Natalie's iPhone passes, or the fallback is agreed. Then: install keeps the list | device test; unit: import idempotent |

**Phase 1 done:** deployed PWA, used daily (the kill criterion in Product_Scope §6 starts counting in phase 2).

### Phase 2: reminders + sync (cut line)

| # | Slice | Done when | Tests |
|---|---|---|---|
| 8 | **Backend + anonymous backup.** D1 schema and migrations, `ember_uid` cookie, `/api/sync` with op ledger and `rev` cursor, client outbox, first sync uploads phase-1 data, landing copy *"Your list is backed up, so it won't get lost."* | Clearing site data and returning restores the list | worker: idempotency, duplicates |
| 9 | **Server rules + conflicts.** State machines enforced server-side, `rejected` handling, per-field last write wins, offline indicator and queue | Two devices editing offline converge as §5 says | worker: illegal ops, two-device race; e2e: offline |
| 10 | **Settings: quiet hours, time zone, hard blocks.** Capacity uses hard blocks (§4.4 step 5) | §4.6 example renders in full, blocks included | unit: capacity |
| 11 | **Telegram link + capture.** Bot (created by Natalie), `/start` handoff, webhook secret, message → Inbox | A message to the bot appears in Inbox | worker: webhook auth, link |
| 12 | **Scheduler.** Day plan (§4.5), claim step, at most 20 sends per tick (each send costs one subrequest and one D1 statement, against limits of 50 each per invocation; 20 a minute is 28,800 a day), retry with give-up after 5 attempts or a Telegram 403, link buttons with sign-in codes | §4.6 messages arrive at 08:00, 16:00, 19:00 | unit: plan golden test; worker: overlapping ticks, cap |
| 13 | **Telegram buttons.** Done, Remove (with *Keep it / Remove*), Snooze (3 choices), Reschedule (3 choices; *Pick a date* links to the app), message edits, stale-safe, reminder states | Every button in UX_Flows §5 behaves as written | worker: repeated tap, stale button |
| 14 | **Passkeys + second device.** Register on the existing user, sign in elsewhere, Telegram links open signed in | Natalie's phone and laptop show the same list | worker: WebAuthn verify; device test |
| 15 | **Retention + overdue + lapse polish.** Daily cleanup cron (§8), overdue sent once then silenced, 3-day welcome back | An anonymous user idle for 366 days (seeded) is gone | worker: retention |

**Cut line reached after slice 15.**

### Phases 3 and 4 (sketch; sliced when phase 2 ships)

- **Phase 3:** the cat's 5 states, unlocks (trivia, Lichess daily puzzle, Wikipedia "on this day"), journal + mood with client-side encryption (WebCrypto AES-GCM, PBKDF2 passphrase key), web push (VAPID, tap-to-open per ADR-0002), Flowtime (Natalie, 2026-10-02).
- **Phase 4:** adaptive slot times, estimate vs actual replacing §4.2, weekly stale nudge, AI breakdown via Workers AI (ADR-0007).

## 11. ⚠️ Gotchas

- **iPhone storage is per container.** Safari, the installed app, and Telegram's in-app browser each have their own storage and cookies. Every path into the app must carry identity (§6, §7).
- **Never move the API off the app's origin.** A cookie set from another host or IP range is capped at 7 days by Safari (ADR-0004).
- **Free-plan limits per invocation:** 10 ms CPU, 50 subrequests, and 50 D1 queries, where every statement inside a `db.batch()` counts separately (D1 limits page, 2026-04-21). The scheduler sends at most 20 messages per tick and plans a bounded number of users per tick, so one tick stays under 50 statements.
- **Send, then mark, is not atomic.** Always claim first (`UPDATE … SET claimed_at … WHERE claimed_at IS NULL … RETURNING`). A claim older than 5 minutes with no `sent_at` counts as a crashed tick and is retried.
- **Cron ticks fire about 31 s past the minute**, so reminders land up to about 61 s late (spike).
- **`Date.now()` in a Worker only advances across I/O**, so timings measured inside one request are coarse.
- **Telegram `callback_data` is 64 bytes max.**
- **Time zones:** cron runs in UTC; every day boundary is local. Use `Intl.DateTimeFormat` with the user's `tz`, and never `new Date().getDate()` on the server.
- **`@simplewebauthn/server` lists Node ≥ 20 and Deno, not Workers.** Slice 14 starts by verifying it under `nodejs_compat`. Fallback: verify ES256 assertions by hand with WebCrypto.
- **wrangler 4.146.0 returned npm 404s on its release day.** Pin versions, and bump on purpose.

## 12. Decisions taken for this scope

| Question (from the spike brief) | Answer | Where |
|---|---|---|
| Frog: overdue vs due today | Due today wins (tier order) | §4.4 step 7 |
| Anonymous backup retention | 12 months idle, then delete; passkey users kept | §8 (Natalie) |
| LLM provider and daily cap | Workers AI; 5 breakdowns per user per day, global stop at 800 a day | ADR-0007 |
| Flowtime / hard blocks phase | Hard blocks phase 2 (slice 10), Flowtime phase 3 | §10 (Natalie) |
| Holding slots for later messages | Plan the whole day at day start, keep the best 3, replan on change | §4.5 |
| Name collision | Publish as `ember-tasks` | §10 slice 0 (Natalie) |
| Second-device sign-in | Passkeys | ADR-0005 (Natalie) |
| Safari → Home Screen data split (new) | Carry the list across at install; test first | §7, ADR-0003 (Natalie) |
