# Tech Feasibility Research — Cross-Device Task/Deadline App with Reminders, Zero Cost

Researched 2026-09-09. All limits below are dated where a source gave a date; where sources only say "2026" I've kept that granularity. Free-tier terms change without notice — re-verify before committing to a stack.

---

## 1. Web push in 2026

### iOS Safari / PWA (the hard constraint)

- **Home-screen install is mandatory.** Push only works for a PWA added to the Home Screen via Safari's "Add to Home Screen" — not for a page open in a regular Safari tab. This has been true since push landed in iOS 16.4 and is still true in 2026.
- **Permission must follow a user gesture**, and iOS requires the permission prompt to be triggered from inside the installed home-screen app, not the browser tab.
- **No silent push, no background wake.** Apple's iOS web push does not support silent/background pushes the way native push does — every push must show a user-visible notification. There is no equivalent of a native app waking up in the background to sync data quietly.
- **Badging API**: supported since iOS 16.4 (`navigator.setAppBadge`), but requires notification permission to have been granted first.
- **Safari 18.4 (2025)** added *Declarative Web Push* — a simplified push mechanism that doesn't require a running service worker to construct the notification (the payload itself declares title/body/icon), which improves reliability somewhat since the OS/browser can render the notification without spinning up your JS.
- **EU carve-out**: under the Digital Markets Act, Apple removed standalone PWA (home-screen, full-screen) behavior in the EU — PWAs there open in a Safari tab and lose push entirely. Not relevant to a Singapore/Malaysia user base, but worth knowing if the portfolio audience is global.
- **Storage**: iOS enforces a rolling ~7-day eviction on any storage tied to a web app not opened recently (Safari's ITP), which can wipe IndexedDB/cache for infrequently-opened PWAs — relevant for local-first sync design, not just push.
- **Reachable audience caveat** (from Mobiloud, 2026): due to the multi-step "install then grant permission" funnel, opt-in web push reach on iOS runs roughly 10-15x lower than native app push. For a personal app with one user (you), irrelevant; worth knowing if you pitch this for others.

### Android Chrome

- Push is delivered via the OS notification system even when the browser/PWA is fully closed — Android's implementation is materially more reliable than desktop because the OS, not the browser process, owns delivery.
- Chrome will not kill an active service worker while a client (open tab/window) exists; a background-only service worker (no open window) is time-limited and can be suspended by the OS after a period of inactivity (roughly minutes), though a push event itself will still wake it to display the notification — the OS treats incoming push as a wake trigger, distinct from a worker just idling.

### Desktop (Chrome/Edge/Firefox/Safari)

- Push API is supported across all four in 2026. Delivery quality varies with whether the browser process is running at all — on desktop, a closed browser generally will **not** receive push (unlike Android, where the OS handles it independently of whether the browser app is "open").
- Desktop Safari push (macOS) requires the site/PWA to be added via the Dock in recent Safari versions, similar spirit to iOS's install requirement.

### Client-side scheduled notifications (Notification Triggers API)

- The **Notification Triggers API** (`showTrigger` + `TimestampTrigger`) would let a service worker show a notification at a future time without a server push — exactly what you want for "reminders through the day." **Status: not shipped.** It ran two origin trials in Chrome (versions 80–83 and 86–88) and was never promoted to a stable, unflagged feature. As of 2026 there's no browser (including Chrome) shipping it by default.
- **Practical conclusion: a server must send every push.** There's no cross-browser way to schedule client-side notifications that fire while the app/tab is closed. This is the single most important constraint for your architecture — you need something, somewhere, waking up on a schedule and calling the Push API for each due reminder.

### Cost of sending web push

- **Confirmed free.** Web Push over VAPID (the standard `web-push` library flow) sends directly to the browser vendor's own push service (Mozilla autopush for Firefox, Google's FCM-backed endpoint for Chrome/Edge, Apple's push service for Safari) using a self-signed VAPID keypair — no third-party push service, no per-message cost, no API key needed. Firebase Cloud Messaging (FCM) is also free with no published usage cap, but pulls in a Firebase project as a dependency you don't otherwise need.

### Free cron/trigger options to fire the sends

| Option | Free-tier limit (2026) | Reliability notes |
|---|---|---|
| **GitHub Actions `schedule` (cron)** | Unlimited on public repos; 2,000 min/month included on private repos. 5-minute floor on cron expressions (`*/2 * * * *` is rejected). | Best-effort scheduler — documented delays of 5-30 min are normal, worse (15-60 min) at peak load, especially around :00/:30. Not safe for "remind me at exactly 3pm." Mitigate by scheduling a few minutes off the hour and adding a `workflow_dispatch` fallback. |
| **Vercel Cron (Hobby/free)** | Up to 2 cron jobs per project, each capped at **once per day**; timing only guaranteed within the hour it's scheduled; UTC only. | Too coarse for multiple reminders/day on the free tier — would need Pro ($20/mo) for higher frequency. |
| **Cloudflare Workers Cron Triggers** | Included in the free Workers plan; **1-minute minimum interval** (far better than Vercel/GH). | Cloudflare's own infra, generally reliable; still shares the free-plan compute caps (100k requests/day, 10ms CPU/request) but a lightweight fan-out-and-push job fits comfortably. |
| **Supabase `pg_cron`** | Available on the free tier as a Postgres extension inside your own project. | Ties scheduling to your DB being awake — collides with Supabase's inactivity pause (see §2) unless you're already pinging it. |
| **Upstash QStash** | Free tier ~500-1,000 messages/day (sources disagree; treat 500/day as the safe planning number). | Designed exactly for "deliver this HTTP call at time X" scheduling/delay use cases — a good fit for per-reminder scheduling rather than a single polling cron, since you can schedule one QStash message per reminder instead of polling a DB every N minutes. |

**Recommendation for the cron layer**: Cloudflare Workers Cron Triggers (1-minute granularity, free, reliable) polling a D1/KV table of due reminders is the strongest free combination; GitHub Actions cron is an acceptable fallback but its 5-30+ minute jitter makes it unsuitable if reminders need to land within a few minutes of the deadline.

---

## 2. Free backend/sync options (2026 limits)

| Service | Hard free-tier limits (2026) | Pause/expiry behavior | Push-sending ability | Sync quality | Portfolio signal |
|---|---|---|---|---|---|
| **Supabase** | 500MB DB, 1GB file storage, 5GB bandwidth, 50k MAU, 2 free projects, 7-day log retention | **Pauses after 7 days of no database activity**; restore takes ~30s from dashboard or first request. Workaroundable with a keep-alive ping (ironic, since that ping itself needs free cron). | Can trigger web-push sends from an Edge Function; needs `pg_cron` or external cron to schedule. | Postgres + realtime (websocket) subscriptions; not offline-first — no built-in local-first/conflict resolution. | High — Postgres + RLS + Edge Functions is a widely recognized, employable stack. |
| **Firebase (Firestore + FCM)** | Firestore free tier: 1GB storage, 50k reads/20k writes/20k deletes per day. FCM itself: free, uncapped. | No pausing; project stays live indefinitely on Spark (free) plan as long as usage is under quota. | FCM is purpose-built for push and free — strong option for delivery specifically. | Firestore has offline persistence and merge-based conflict handling, decent but not full CRDT-grade local-first. | Medium — common but less differentiated than Postgres/Cloudflare on a resume aimed at backend roles. |
| **Cloudflare Workers + D1 + KV + Durable Objects** | Workers: 100k req/day, 10ms CPU/req. D1: 5GB storage, 5M rows read/day, 100k rows written/day. KV: 1GB storage, 100k reads/day, 1k writes/day. Durable Objects: 100k req/day, SQLite-backed DOs only on free plan. | No inactivity pause — stays live indefinitely. | Yes — Workers can call the Push API directly from the same cron trigger, no separate service needed. | DIY — you write the sync logic; Durable Objects give you a natural per-user stateful coordination point for conflict handling, but it's your code, not an out-of-box CRDT. | High — edge compute + DO is a distinctive, less-commodity stack that stands out in a portfolio, and it's a single vendor for hosting, DB, KV, cron, and push trigger (operational simplicity). |
| **PocketBase on a free host** | PocketBase itself is free (single Go binary, embedded SQLite). Hosting is the constraint: **Fly.io** has an official "host for free" guide but Fly's free allowances now require a card on file and can incur small charges past included resources; **Render**'s free tier has no persistent disk — an SQLite file gets wiped on every restart, which breaks PocketBase; **Koyeb** was acquired by Mistral AI in early 2026 and closed its free Starter tier to new signups (existing minimal free instance capped at 512MB RAM/0.1 vCPU is not meant for production). | Depends on host — Render will lose data on restart; Fly/Koyeb availability is shifting. | You'd bolt on your own push-sending code; PocketBase doesn't include it natively. | Realtime subscriptions and a decent admin UI, but single-node SQLite — no built-in multi-device conflict resolution beyond last-write-wins. | Medium-low in 2026 given the hosting churn — riskier to depend on for a "zero running cost forever" claim. |
| **Convex** | 1GB storage/free tier (exact request quotas not fully surfaced by search, but positioned as generous hobby tier); Pro is $25/seat. | No pausing reported. | Can trigger from scheduled functions (Convex has built-in cron/scheduling) and call push from there. | Reactive queries, strong DX, but it's a hosted proprietary sync engine, not local-first/offline-native. | Medium-high — trendy, TypeScript-native, recognizable to some interviewers, less so to others. |
| **Turso (libSQL)** | 5GB storage, 500M row reads/month, 10M row writes/month, up to 100 databases. | No pausing reported. | No push primitive — you'd still need your own cron/worker. | Edge-replicated SQLite, good read latency; multi-writer conflict handling is limited (embedded replicas, not full CRDT). | Medium — good "edge SQLite" signal, less differentiated for sync-heavy apps. |
| **Neon** | 0.5GB storage, 100 compute-hours/month, up to 20 projects, autoscale to 2 compute units. | Auto-suspends compute after idle (cold start delay), not full "pause" like Supabase but similar practical effect for a rarely-used personal app. | No — needs an external worker. | Standard Postgres, no offline/local-first features built in. | Medium — "serverless Postgres" is a fine but common signal. |
| **InstantDB** | Free tier: no project pausing reported, no cap on number of active apps, no restriction for commercial use (per vendor's own framing — verify directly before relying on it). | None reported. | No native push; you'd still need a cron+push layer. | Real-time, offline-capable client with conflict handling built for exactly this kind of app — closest to "local-first out of the box" among the hosted options here. | Medium-high — newer/less common, shows you evaluated beyond the obvious Supabase/Firebase choices. |
| **Dexie Cloud** | Free tier: 3 users, 100MB storage; paid from ~€0.12/user/month past that. | Not reported to pause, but the 3-user/100MB caps are tight even for solo + testing. | No. | Dexie (IndexedDB wrapper) + Dexie Cloud gives genuine offline-first sync with real conflict resolution — strong technical fit for "local-first." | Medium — smaller community than Yjs/Automerge, but directly solves your offline+sync problem with minimal code. |
| **PowerSync** | Free tier exists ("start building free, no credit card"), specific caps not confirmed by search — verify on powersync.com/pricing before committing. | Not confirmed. | No. | Purpose-built for local-first sync on top of Postgres/SQLite backends (including Supabase) — arguably the most "correct" local-first sync layer for a task app, but adds a second vendor on top of your Postgres choice. | High — recognized in local-first circles, a differentiated pick. |
| **Replicache / Zero** | Replicache's free/OSS status has shifted; Zero (its successor from Rocicorp) is open-source-first — self-hosted, so "free" means you run the sync server yourself (on your own free compute, e.g. Cloudflare/Fly). Not a hosted free-tier SaaS. | N/A (self-hosted). | No. | Strong local-first/offline sync with real conflict resolution when self-hosted correctly — but real infra work, more than a time-boxed solo build should take on. | High signal if it works, but highest implementation risk/time cost. |
| **TinyBase** | Fully free, MIT-licensed, no hosted product, no sign-up, no telemetry. | N/A — it's a client-side reactive store, not a backend. | No — it's local state management; you'd pair it with any sync backend (or none). | Only "sync" if you pair it with a persister (e.g., to a server, or to Yjs/CRDT layer) — on its own it's local-only. | Low-medium — useful building block, not a sync solution by itself. |
| **Yjs / Automerge + free relay** | Yjs/Automerge libraries are free (MIT). A managed relay like **Y-Sweet** offers a free tier reported around 10GB storage. Self-hosting `y-websocket` costs real money at scale ($20-100/mo per source) but is trivially cheap (near-zero) at the scale of one user, run on Cloudflare's free tier. | Depends on relay chosen. | No — separate concern. | Best-in-class CRDT conflict resolution, true offline-first, works with IndexedDB persistence on the client. Highest technical ceiling of everything in this table. | High — CRDTs are a strong, differentiated signal for a backend/full-stack portfolio piece, but add real complexity for what's fundamentally a to-do/deadline app (probably overkill unless the portfolio narrative specifically wants to showcase CRDT skills). | 

**Ranking for your situation (solo dev, zero-cost-forever, portfolio value, TS/React+Go/Python background):**

1. **Cloudflare Workers + D1 (+ KV for cheap key-value bits)** — no pausing, generous enough free tier, 1-minute cron granularity, and it can run the whole thing (API, DB, scheduled push sends) from one vendor with no "will this get paused" risk. Best fit for "zero cost forever" and decent portfolio signal (edge compute is not the default choice, stands out).
2. **Supabase**, if you want Postgres/SQL and the pausing is tolerable (a single free Cloudflare cron ping every few days keeps it awake) — best "everyone recognizes this stack" signal for job applications, at the cost of the pause risk.
3. **InstantDB or PowerSync**, if genuine offline-first local-first sync (not just "cloud DB with a websocket") is the point you want to prove for the portfolio — more differentiated, less battle-tested by you personally, higher learning-curve risk on a time-boxed solo build.

---

## 3. Hosting comparison

| | Vercel Hobby | Cloudflare Pages (+Workers) | GitHub Pages |
|---|---|---|---|
| Cost | Free | Free | Free |
| API routes / serverless functions | Yes — ~100k function invocations/month, 10-second timeout; every API call/SSR render/middleware execution counts toward the quota | Yes — via Pages Functions/Workers, 100k requests/day free | **No** — static files only, no server-side code at all |
| Bandwidth | 100GB/month | Unlimited | Soft ~100GB/month (GitHub's fair-use guidance) |
| Commercial use | **Hobby plan is personal/non-commercial only** — a portfolio piece is fine, but read this literally if you ever monetize | Allowed from day one, including free tier | Allowed |
| Cron | 2 jobs/project, 1/day max on free tier | 1-minute-granularity Cron Triggers included free | None (no compute at all) |
| Service worker support | Yes (it's just a static asset + your code) | Yes | Yes |
| Fit for this project | Workable, but the daily-cron cap and non-commercial clause are real constraints if the API needs to run more than once/day | **Best fit** — supports API routes, has real cron, no pausing, generous free tier, commercial-friendly | **Not viable alone** — fine only as a pure static frontend host paired with a separate API host (e.g., Cloudflare Workers) |

**Recommendation**: Cloudflare Pages + Workers for both the frontend and the API/cron layer — one vendor, no pausing, real cron, commercial-clean license, and it's the only one of the three whose free cron is fine-grained enough to matter for same-day reminders.

---

## 4. Alternatives if web push proves too flaky on iPhone

| Option | Cost | Reliability | Install friction | Notes |
|---|---|---|---|---|
| **Capacitor native wrapper** | **Apple Developer Program is $99/year** — real, unavoidable cost if you want an actual App Store / TestFlight-distributed iOS app with native push (APNs). Android side is free (Google Play one-time $25, or sideload for free). | High — native push (APNs/FCM) doesn't have the silent-push and install-gesture restrictions web push has on iOS. | Higher — app store review, or TestFlight for personal use. | Breaks your "zero running cost" goal by $99/yr unless you only ever sideload for yourself (possible without the paid program via Xcode's free personal-team signing, but the app has to be re-signed every 7 days, which is painful for a "just works" daily reminder app). |
| **Email reminders** | Free (any SMTP provider with a free tier — e.g., Resend, SendGrid free tiers, or even a free Gmail account via nodemailer with app password) | High — email delivery is mature and boring-reliable; no install, no permission dance | None — works on literally every device with no PWA install step | Not as immediate/naggy as a push notification, and can land in spam if using a fresh sending domain. |
| **Telegram bot** | Free (Bot API has no cost) | Very high — Telegram's push delivery to its own app is native and reliable, and you already have a phone with the app or can install it once | Low — one-time bot chat setup, no PWA install/permission friction at all | Strong pick for a personal reminder system: a free cron job hits the Telegram Bot API, message lands with a real native push notification on iOS and Android, zero web-push complexity. |
| **Discord bot / webhook DM** | Free | High, similar to Telegram | Low, if you already use Discord | Same shape as Telegram; pick whichever platform you actually check daily. |
| **.ics calendar subscription with alarms** | Free | High for the alarm itself (native Calendar app notification), but the calendar only reflects state at whatever point you last regenerated the feed — not real-time interactive | None — subscribe once | Good for genuinely fixed deadlines, weak for a living, editable task list, since most calendar apps poll/refresh a subscribed feed on their own schedule (sometimes hours), not on your changes. |
| **OS-level Shortcuts (iOS)/Tasker (Android)** | Free | Medium — depends on the automation staying scheduled and the OS not restricting background execution | None, but iOS-only automations don't help Android and vice versa | More of a personal hack than a portfolio-worthy architecture; useful as a backstop, not a primary channel. |

**Honest recommendation**: given the Notification Triggers API isn't shipped and iOS web push requires the full install-and-permission funnel, **pair web push (for the "real PWA" portfolio story) with a Telegram bot as the actual reliable delivery channel** — cron job fires both. This also sidesteps the Notification Trigger gap entirely, costs nothing, and is more reliable than iOS web push on its own. If the portfolio goal is specifically "prove I can ship real web push," keep it as the primary and Telegram as fallback; if the goal is "an app I actually use daily," make Telegram (or email) the primary and web push the bonus feature you demo.

---

## 5. Auth and privacy

### Auth (single user now, multi-user later)

- **Passkeys**: free, no third-party dependency, phishing-resistant, and directly usable from any modern browser's `navigator.credentials` WebAuthn API — strong pick for a solo-user app where you don't want to manage passwords at all, and it upgrades cleanly to multi-user later without re-architecting.
- **Magic link**: simplest to build (send a signed token by email), free with any email-sending free tier, but depends on your reminder emails/deliverability infra already existing if you go the "email fallback" route in §4 — reuse that infra.
- **Supabase Auth**: free tier covers 50,000 MAU — wildly more than you'll ever need solo, handles email/password, OAuth, magic links, and phone auth out of the box. If you're already on Supabase for data, this is the path of least resistance.
- **Clerk free tier**: raised to 50,000 MRU (monthly *retained* users, a narrower metric than MAU) as of February 2026 — also more than sufficient, includes passkeys, but it's a separate vendor/dependency you don't need if you're single-user; better suited if you want a polished pre-built UI for the eventual multi-user version.
- **Shared secret**: a single hardcoded passphrase/token gate — free, zero dependencies, appropriate only while it's genuinely just you, and the wrong call the moment "multi-user later" becomes real, since it has no per-user identity to hang data ownership off of.

**Recommendation**: start with **passkeys** (or a shared secret if you want to ship in an afternoon and upgrade later) rather than pulling in a third auth vendor for a one-user app — add Supabase Auth or Clerk only when "multi-user later" actually arrives, since both are easy retrofits onto a Postgres-backed user table.

### Privacy for journal/task data

- **Client-side encryption via WebCrypto** (`SubtleCrypto`, AES-GCM) with a passphrase-derived key (PBKDF2 or Argon2-via-WASM to derive the AES key from the passphrase) is the standard free, dependency-free approach — the server only ever stores ciphertext, so a compromised backend (or a paused/leaked Supabase project) doesn't expose plaintext journal entries.
- Trade-off: full-text search and any server-side processing become impossible on encrypted fields unless you accept searchable-encryption complexity, which is not worth it for a solo portfolio app — encrypt the free-text/journal fields, leave structured fields (due date, status, priority) in plaintext so the UI can filter/sort server-side.

---

## 6. Three candidate stacks

### Stack A — Cheapest-and-simplest
Cloudflare Pages (frontend) + Cloudflare Workers/D1 (API + data) + Cloudflare Cron Trigger (1-min granularity) firing both web push (VAPID) and a Telegram bot message + passkey or shared-secret auth.

### Stack B — Local-first-best-sync
React + TinyBase or Dexie (client-side reactive store, IndexedDB-backed) + Yjs/Automerge CRDT sync layer over a free Y-Sweet relay (or self-hosted y-websocket on Cloudflare's free compute) for true offline-first multi-device merge + a lightweight Cloudflare Worker cron for push/Telegram delivery, since sync layer alone doesn't send notifications + WebCrypto client-side encryption for journal fields.

### Stack C — Best-portfolio-signal
Go or Python API (matches your stated stack strengths, differentiates from the all-TS crowd) on Cloudflare Workers (via a WASM/edge-compatible build) or a small always-on free-tier compute (Fly.io) + Postgres via Supabase (recognizable, SQL, RLS) + Supabase Edge Functions or Cloudflare cron for scheduled push/Telegram sends + passkey auth + a documented ADR set (matches your "portfolio-quality repo" and OKF-standard practice) explaining the push/Telegram dual-channel decision and the CRDT-vs-simple-sync trade-off you evaluated.

| | Stack A: Cheapest-and-simplest | Stack B: Local-first-best-sync | Stack C: Best-portfolio-signal |
|---|---|---|---|
| Cost | $0, indefinitely | $0, indefinitely (Y-Sweet free tier or self-host on Cloudflare) | $0, indefinitely (watch Supabase pause) |
| Complexity | Low — one vendor, standard REST+cron | High — CRDT merge logic, offline persistence, sync debugging | Medium — two vendors (compute + Postgres), more moving parts than A |
| Sync quality | Basic — server is source of truth, client re-fetches; fine for a to-do app, not true offline-editing-then-merge | Best — genuine offline-first, conflict-free multi-device edits, works on a plane | Good — Postgres + realtime subscriptions, not full offline-first but solid for intermittent connectivity |
| Push reliability on iPhone | Web push (flaky) + Telegram (reliable) dual-channel | Same dual-channel, layered on top of a harder sync problem | Same dual-channel pattern, layered on Supabase Edge Functions |
| What breaks if a free tier changes | Cloudflare tightening its free plan (unlikely near-term, but not contractually guaranteed) | Y-Sweet's free relay could shrink/vanish — fallback is self-hosting the relay yourself on already-free compute | Supabase pause behavior worsening, or the 50k MAU/500MB caps tightening — you're more exposed here than A/B since Supabase's business model depends on free-tier conversion pressure |
| Best if | You want it working and shippable fast, with the fewest things that can silently break | You specifically want to demonstrate CRDT/local-first engineering chops for senior/backend roles | You want the stack to read as "recognizable production tooling" (Postgres, RLS) to a recruiter skimming the repo in 30 seconds |

**My recommendation, given the goals**: Stack A first — ship something that works end-to-end in days, not weeks, using tooling (Cloudflare) with the least free-tier risk. If time and interest allow after it's working, layer Stack B's CRDT sync on top as a v2 for the portfolio depth story (it's the single most differentiated technical decision on this list for a senior-engineer application). Stack C is the weakest fit for you specifically — it doesn't showcase anything Stack A doesn't, while re-introducing Supabase's pause risk for no clear benefit unless you specifically want Postgres/SQL on the resume, which your existing PL/SQL background may make redundant.

---

## Sources

- [Do Progressive Web Apps Work on iOS? The Complete Guide for 2026 | MobiLoud](https://www.mobiloud.com/blog/progressive-web-apps-ios/)
- [PWA iOS Limitations and Safari Support [2026]](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [How to Set Up Push Notifications for Your PWA (iOS and Android)](https://www.mobiloud.com/blog/pwa-push-notifications)
- [iOS special requirements for web push notifications - Pushpad](https://pushpad.xyz/blog/ios-special-requirements-for-web-push-notifications)
- [PWA Push Notifications on iOS in 2026: What Really Works](https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en)
- [Web Push Support for Mobile Safari - Insider One](https://academy.insiderone.com/docs/web-push-support-for-mobile-safari)
- [PWA on iOS: Install Guide & Limits for Advertisers 2026](https://deepclick.com/resources/blog/progressive-web-apps-on-ios/)
- [Notification Triggers API | Chrome for Developers](https://developer.chrome.com/docs/web-platform/notification-triggers)
- [Intent to Implement: Notification Triggers](https://groups.google.com/a/chromium.org/g/blink-dev/c/sFb2H2pwEug/m/rKue2Dy_DwAJ)
- [GitHub - beverloo/notification-triggers](https://github.com/beverloo/notification-triggers)
- [Supabase Free Tier Limits 2026 | Automation Atlas](https://automationatlas.io/answers/supabase-free-tier-limits-2026/)
- [Prevent Supabase Free Tier Pausing (2026 Guide) | Medium](https://shadhujan.medium.com/how-to-keep-supabase-free-tier-projects-active-d60fd4a17263)
- [Supabase Free Tier Limits in 2026: Hidden Pauses & Caps](https://www.itpathsolutions.com/supabase-free-tier-limits)
- [Pricing & Fees | Supabase](https://supabase.com/pricing)
- [GitHub Actions Scheduled Workflows: A Complete Guide | Cronuru](https://cronuru.com/guides/github-actions-scheduled-workflows)
- [GitHub Actions Cron Schedule — Syntax, UTC, 5-Min Limit & Examples](https://cronbuilder.dev/blog/github-actions-cron-schedule.html)
- [GitHub Actions Cron Not Running On Time? Here's the Fix | Runhooks](https://runhooks.app/blog/github-actions-scheduled-workflows-unreliable/)
- [Vercel Hobby Plan](https://vercel.com/docs/plans/hobby)
- [Vercel cron jobs limit: Hobby plan caps and how to beat them](https://crontap.com/blog/vercel-cron-hourly-limit-and-how-to-beat-it)
- [Vercel Hobby Cron Limits Explained | Runhooks](https://runhooks.app/blog/vercel-hobby-cron-job-limits-explained/)
- [Cloudflare Workers Cron Triggers: limits, minimum interval | crontap](https://crontap.com/blog/cloudflare-workers-cron-minute-limit)
- [Cloudflare Workers Free Tier 2026 | AgentDeals](https://agentdeals.dev/vendor/cloudflare-workers)
- [Workers KV - free to try, with increased limits! | Cloudflare Blog](https://blog.cloudflare.com/workers-kv-free-tier/)
- [Pricing · Cloudflare Workers docs](https://developers.cloudflare.com/workers/platform/pricing/)
- [Push Notifications: APNs, FCM, Device Tokens, Web Push (2026)](https://www.back4app.com/glossary/push-notifications-apns-fcm/)
- [web-push vs OneSignal vs firebase-admin 2026 — PkgPulse Guides](https://www.pkgpulse.com/guides/web-push-vs-onesignal-vs-firebase-push-notifications-2026)
- [web-push - npm](https://www.npmjs.com/package/web-push)
- [Upstash QStash Pricing & Limits](https://upstash.com/docs/qstash/overall/pricing)
- [Upstash Free Tier 2026 | AgentDeals](https://agentdeals.dev/vendor/upstash)
- [Free options where it can be released to production · pocketbase/pocketbase Discussion #328](https://github.com/pocketbase/pocketbase/discussions/328)
- [Host PocketBase in Render for free · pocketbase/pocketbase Discussion #6992](https://github.com/pocketbase/pocketbase/discussions/6992)
- [Koyeb Free Tier 2026: Pricing, Limits & Credit Card](https://www.srvrlss.io/provider/koyeb/)
- [Hosting Pocketbase On Fly.io](https://www.frontend-devops.com/blog/hosting-pocketbase-on-fly)
- [Database Free Tier Comparison 2026 — Supabase vs Neon vs Firebase vs Turso vs PlanetScale](https://agentdeals.dev/database-free-tier-comparison-2026)
- [Neon vs Supabase vs Turso for MVPs | 2026 Comparison](https://www.buildmvpfast.com/blog/neon-vs-supabase-vs-turso-serverless-postgres-mvp-2026)
- [Dexie Cloud Pricing - Free Tier Available](https://dexie.org/pricing)
- [Doolpa: TinyBase](https://doolpa.com/article/tinybase)
- [Instant Pricing](https://www.instantdb.com/pricing)
- [PowerSync Pricing](https://powersync.com/pricing)
- [Yjs WebSocket Server Guide Updated July 2026 | Velt](https://velt.dev/blog/yjs-websocket-server-real-time-collaboration)
- [Yjs vs Automerge vs Liveblocks: CRDT Frameworks for Real-Time Apps in 2026 - Kanopy](https://kanopylabs.com/blog/yjs-vs-automerge-vs-liveblocks)
- [Push Notifications on the Open Web | Chrome for Developers](https://developer.chrome.com/blog/push-notifications-on-the-open-web)
- [Service Worker Push Notification in Practice: 5 Patterns for 2026](https://www.toolsku.com/en/blog/service-worker-push-notification-2026/)
- [Vercel Free Tier Limits 2026: Every Hobby Plan Limit Explained](https://deploywise.dev/blog/vercel-free-tier-limits-2026)
- [Cloudflare Pages vs Vercel 2026: Cost, Edge, DX](https://gautamkhorana.com/blog/cloudflare-pages-vs-vercel-2026/)
- [Clerk Pricing Explained](https://clerk.com/articles/clerk-pricing-explained)
- [Authentication Pricing Comparison (June 2026) | Clerk, Auth0, Supabase Auth](https://www.buildmvpfast.com/api-costs/authentication)
- [Clerk vs Supabase Auth for Solo Developers | SoloDevStack](https://solodevstack.com/blog/clerk-vs-supabase-auth-solo-developers)
