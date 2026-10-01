# Tech spike results

Run 2026-10-02 against `tech-feasibility.md` (desk research, 2026-09-09). Each question gets a yes/no and the source it rests on. Brief: `docs/Tech_Spike_Session_Brief.md`.

## 1. Cloudflare free tier runs the phase-2 spine (cron → D1 → Telegram)

**Pending.** Worker `ember-spike` is deployed on the free plan with a `* * * * *` cron trigger and a D1 database (`ember-spike`, region APAC). Code: `spike/cron-telegram/`. Waiting on a Telegram bot token to send the first message.

## 2. iOS web push has no action buttons

**Yes, confirmed. No device test needed.**

- WebKit source, `main` branch, head commit 2026-10-01: in `Source/WebCore/Modules/notifications/NotificationOptions.idl` the `actions` member is commented out (`// sequence<NotificationAction> actions = [];`), as are `Notification.actions`, `maxActions`, and `requireInteraction` in `Notification.idl`. The feature is absent even from unreleased WebKit, so no shipping Safari or iOS version has it. [NotificationOptions.idl](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/notifications/NotificationOptions.idl)
- MDN browser-compat-data (`main`, last changed 2026-08-19): `ServiceWorkerRegistration.showNotification` `options.actions` is `version_added: false` for Safari and Safari iOS. Chrome has had it since 48, Firefox since 152. [browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/api/ServiceWorkerRegistration.json)
- Declarative Web Push (WebKit blog, 2025-03-27) lists `title`, `body`, `navigate`, `lang`, `dir`, `silent`, `app_badge`. No actions. [Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)

**Consequence:** the *"Not now? [Snooze]"* line in the Task view (`UX_Flows.md` §5) stays. Web push stays tap-to-open on every platform, as designed. Android Chrome supports actions, but building two behaviours was already rejected.

## 3. Safari's 7-day wipe of script-writable storage

**Yes, confirmed, and installed home-screen web apps are exempt.**

- WebKit Tracking Prevention policy (living page, undated, fetched 2026-10-02): ITP deletes "all other script-writeable storage after 7 days of no user interaction with the website", covering IndexedDB, LocalStorage, SessionStorage, media keys, and service worker registrations and cache. Same page: "The first-party domain of home screen web applications is exempt from ITP's 7-day cap on all script-writeable storage." [webkit.org/tracking-prevention](https://webkit.org/tracking-prevention/)
- Origin of the rule, WebKit blog 2020-03-24: the 7 days count **days of Safari use**, not calendar days. A user who does not open Safari for two weeks loses nothing; a user who browses daily without visiting Ember loses everything on day 8. [Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)
- WebKit blog 2023-08-10: a home-screen web app gets the same quota as Safari, and `navigator.storage.persist()` is granted by heuristics that favour home-screen apps. [Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)

**Consequence:** `UX_Flows.md` §7 is correct as written. The phase-1 install nudge copy (*"if you don't open Ember for about a week"*) is accurate enough: "about a week" of Safari use. Phase 1 should also call `navigator.storage.persist()` after install; it costs one line and can only help.

## Cleanup before the repo goes public

- **Revoke the spike bot token** (`@ember_natalie_bot`, BotFather `/revoke`). On 2026-10-02 the token was stored by mistake as a Worker secret's *name*, so it appears in plain text in the Cloudflare dashboard and in that session's transcript. It was never committed to git. Natalie chose to defer revoking while the repo is private.
- Delete the misnamed secret on Worker `ember-spike`, or delete the whole spike Worker and the `ember-spike` D1 database once Build has its own.
- Rename or remove the workers.dev subdomain `cron-telegram`, which wrangler registered automatically on the first deploy.
