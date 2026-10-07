import { expect, test, type Page } from "./fixtures";

// Slice 22: the phase-3 settings (focus timer, rewards, reminder channel) and the arrival line. The server is routed by
// hand; Notification and the push manager are stubbed in an init script, because headless Chromium has no push service.
test.use({ timezoneId: "Asia/Singapore" });

const openSettings = async (page: Page) => {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
};

test("the focus timer and the reward choice persist across a reload", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  await expect(page.getByRole("radio", { name: /25 \/ 5/ })).toBeChecked(); // defaults
  await expect(page.getByRole("radio", { name: "Surprise me" })).toBeChecked();

  await page.getByRole("radio", { name: /Flowtime/ }).check();
  await page.getByRole("radio", { name: "Trivia question" }).check();
  await page.reload();
  await openSettings(page);
  await expect(page.getByRole("radio", { name: /Flowtime/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Trivia question" })).toBeChecked();
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem("ember")!).settings);
  expect(settings).toMatchObject({ timer_mode: "flowtime", unlock: "trivia" });
});

// --- Web push ---------------------------------------------------------------------------------------------------------

type Stubs = { asked: number; subscribed: unknown; unsubscribed: boolean };

// `answer` is what the permission prompt returns; `permission` is what the browser reports before anyone asks.
async function stubPush(page: Page, answer: NotificationPermission, permission: NotificationPermission = "default") {
  await page.addInitScript(
    ({ answer, permission }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__asked = 0;
      w.__subscribed = null;
      w.__unsubscribed = false;
      class FakeNotification {
        static permission = permission;
        static requestPermission() {
          (w.__asked as number)++;
          FakeNotification.permission = answer;
          return Promise.resolve(answer);
        }
      }
      Object.defineProperty(window, "Notification", { value: FakeNotification, configurable: true });
      if (!("PushManager" in window)) Object.defineProperty(window, "PushManager", { value: class {}, configurable: true }); // Playwright's WebKit has none
      let sub: object | null = null;
      const pushManager = {
        subscribe(opts: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) {
          w.__subscribed = { userVisibleOnly: opts.userVisibleOnly, key: Array.from(new Uint8Array(opts.applicationServerKey)) };
          sub = {
            endpoint: "https://push.example.test/abc",
            toJSON: () => ({ endpoint: "https://push.example.test/abc", expirationTime: null, keys: { p256dh: "P", auth: "A" } }),
            unsubscribe: () => ((w.__unsubscribed = true), (sub = null), Promise.resolve(true)),
          };
          return Promise.resolve(sub);
        },
        getSubscription: () => Promise.resolve(sub),
      };
      Object.defineProperty(navigator.serviceWorker, "ready", { get: () => Promise.resolve({ pushManager }), configurable: true });
    },
    { answer, permission },
  );
}

// The WebKit project is an iPhone, which gets the Home Screen hint instead of a prompt ("iPhone Safari, not on the Home Screen" below).
const notIPhone = () => test.skip(test.info().project.name === "webkit", "an iPhone in Safari gets the Add to Home Screen hint instead");
const stubs = (page: Page) => page.evaluate(() => ({ asked: (window as any).__asked, subscribed: (window as any).__subscribed, unsubscribed: (window as any).__unsubscribed }) as Stubs);

// /api/me answers from `server`; the subscribe and unsubscribe routes record the bodies and flip `push`.
function routeServer(page: Page, server: { vapid: string | null; push?: boolean; telegram?: boolean }) {
  const posted: { subscribe: unknown[]; unsubscribe: unknown[] } = { subscribe: [], unsubscribe: [] };
  const state = { push: false, telegram: false, ...server };
  void page.route("**/api/me", (r) => r.fulfill({ json: { telegram: state.telegram, telegram_linked: state.telegram, passkeys: 0, push: state.push, vapid_public_key: state.vapid } }));
  void page.route("**/api/push/subscribe", (r) => (posted.subscribe.push(r.request().postDataJSON()), (state.push = true), r.fulfill({ json: { ok: true } })));
  void page.route("**/api/push/unsubscribe", (r) => (posted.unsubscribe.push(r.request().postDataJSON()), (state.push = false), r.fulfill({ json: { ok: true } })));
  return posted;
}

test("This device asks for permission on the tap, subscribes with the server's key, posts the subscription, and can be turned off", async ({ page }) => {
  notIPhone();
  await stubPush(page, "granted");
  const posted = routeServer(page, { vapid: "AQID" });
  await page.goto("/");
  await openSettings(page);
  expect((await stubs(page)).asked).toBe(0); // opening Settings never asks

  await page.getByRole("button", { name: "Turn on nudges on this device" }).click();
  await expect(page.getByText("On · nudges go here")).toBeVisible();
  const s = await stubs(page);
  expect(s.asked).toBe(1);
  expect(s.subscribed).toEqual({ userVisibleOnly: true, key: [1, 2, 3] });
  expect(posted.subscribe).toEqual([{ endpoint: "https://push.example.test/abc", expirationTime: null, keys: { p256dh: "P", auth: "A" } }]);

  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByText("On · nudges go here")).toHaveCount(0);
  expect(posted.unsubscribe).toEqual([{ endpoint: "https://push.example.test/abc" }]);
  expect((await stubs(page)).unsubscribed).toBe(true);
});

test("a refused permission says so, offers Telegram, and is never asked again", async ({ page }) => {
  notIPhone();
  await stubPush(page, "denied");
  const posted = routeServer(page, { vapid: "AQID" });
  await page.goto("/");
  await openSettings(page);
  await page.getByRole("button", { name: "Turn on nudges on this device" }).click();
  await expect(page.getByRole("main").getByText("Notifications are off for this browser. You can turn them on in your browser settings, or use Telegram instead.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Link Telegram", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Turn on nudges on this device" }).click();
  expect((await stubs(page)).asked).toBe(1); // the second tap did not prompt
  expect(posted.subscribe).toEqual([]);
});

test("a server without push keys says it isn't set up, and nothing is asked", async ({ page }) => {
  notIPhone();
  await stubPush(page, "granted");
  routeServer(page, { vapid: null });
  await page.goto("/");
  await openSettings(page);
  await page.getByRole("button", { name: "Turn on nudges on this device" }).click();
  await expect(page.getByRole("main").getByText("Web push isn't set up yet. Try again later.")).toBeVisible();
  expect((await stubs(page)).asked).toBe(0);

  // Verify finding 6: the line sits straight under the channel rows it answers.
  const rows = (await page.getByRole("list", { name: "Where nudges go" }).boundingBox())!;
  const line = (await page.getByRole("main").getByText("Web push isn't set up yet. Try again later.").boundingBox())!;
  expect(line.y).toBeGreaterThanOrEqual(rows.y + rows.height);
  expect(line.y - (rows.y + rows.height)).toBeLessThan(20);
});

// One row per channel (Natalie, 2026-10-07): a chat linked while this device is the channel says Linked, and Use switches back.
test("a linked chat shows as Linked while this device has the nudges, and Use hands them back to Telegram", async ({ page }) => {
  notIPhone();
  await stubPush(page, "granted");
  const me = { telegram: false, telegram_linked: true, passkeys: 0, push: true, vapid_public_key: "AQID" };
  await page.route("**/api/me", (r) => r.fulfill({ json: me }));
  let switched = 0;
  await page.route("**/api/channel/telegram", (r) => (switched++, Object.assign(me, { telegram: true }), r.fulfill({ json: { ok: true } }))); // the subscription stays
  await page.goto("/");
  await openSettings(page);
  const rows = page.getByRole("list", { name: "Where nudges go" });
  await expect(rows).toContainText("TelegramLinked");
  await expect(rows).toContainText("On · nudges go here");
  await page.getByRole("button", { name: "Use Telegram" }).click();
  await expect(rows).toContainText("Linked · nudges go here");
  await expect(page.getByRole("button", { name: "Turn on nudges on this device" })).toBeVisible();
  expect(switched).toBe(1); // no push subscription on this browser was needed
});

test("Unlink asks first, then forgets the chat and offers Link again", async ({ page }) => {
  const me = { telegram: true, telegram_linked: true, passkeys: 0, push: false, vapid_public_key: null };
  let unlinked = 0;
  await page.route("**/api/me", (r) => r.fulfill({ json: me }));
  await page.route("**/api/tg/unlink", (r) => (unlinked++, Object.assign(me, { telegram: false, telegram_linked: false }), r.fulfill({ json: { ok: true } })));
  await page.goto("/");
  await openSettings(page);
  const rows = page.getByRole("list", { name: "Where nudges go" });
  await expect(rows).toContainText("Linked · nudges go here");

  await page.getByRole("button", { name: "Unlink Telegram" }).click();
  const ask = page.getByRole("alertdialog", { name: "Unlink Telegram? Ember will stop messaging that chat." });
  await ask.getByRole("button", { name: "Keep it" }).click();
  expect(unlinked).toBe(0);

  await page.getByRole("button", { name: "Unlink Telegram" }).click();
  await ask.getByRole("button", { name: "Unlink" }).click();
  await expect(rows).toContainText("Not linked");
  await expect(page.getByRole("button", { name: "Link Telegram", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlink Telegram" })).toHaveCount(0);
  expect(unlinked).toBe(1);
});

test("coming back from Telegram shows the new link without reopening Settings", async ({ page }) => {
  const me = { telegram: false, telegram_linked: false, passkeys: 0, push: false, vapid_public_key: null };
  await page.route("**/api/me", (r) => r.fulfill({ json: me }));
  await page.goto("/");
  await openSettings(page);
  await expect(page.getByRole("button", { name: "Link Telegram", exact: true })).toBeVisible();
  Object.assign(me, { telegram: true, telegram_linked: true }); // the user pressed Start in the bot
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("list", { name: "Where nudges go" })).toContainText("Linked · nudges go here");
  await expect(page.getByRole("button", { name: "Link Telegram", exact: true })).toHaveCount(0);
});

test("without a connection, turning on notifications says it needs one", async ({ page }) => {
  notIPhone();
  await stubPush(page, "granted"); // the default fixture leaves /api/me unreachable
  await page.goto("/");
  await openSettings(page);
  await page.getByRole("button", { name: "Turn on nudges on this device" }).click();
  await expect(page.getByRole("main").getByText("Turning on notifications needs a connection.")).toBeVisible();
});

test.describe("iPhone Safari, not on the Home Screen", () => {
  test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });

  test("shows the Add to Home Screen hint instead of asking, and it can be dismissed", async ({ page }) => {
    await stubPush(page, "granted");
    routeServer(page, { vapid: "AQID" });
    await page.goto("/");
    await openSettings(page);
    await page.getByRole("button", { name: "Turn on nudges on this device" }).click();
    await expect(page.getByRole("main").getByText("To get nudges on iPhone, add Ember to your Home Screen. Tap Share, then Add to Home Screen.")).toBeVisible();
    expect((await stubs(page)).asked).toBe(0);
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.getByRole("main").getByText(/add Ember to your Home Screen/)).toHaveCount(0);
  });
});

// --- Arriving from a notification --------------------------------------------------------------------------------------

async function seedTask(page: Page) {
  await page.clock.install({ time: new Date("2026-10-05T10:00:00+08:00") });
  await page.goto("/");
  await page.evaluate(() => {
    const task = { id: "T1", title: "Cover letter", state: "active", size: "S", quick: false, holding_up: false, deadline: "2026-10-05", runway_start: "2026-10-01", pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1 };
    const chunk = { id: "T1a", task_id: "T1", parent_id: null, title: "Open the draft", position: 1, state: "todo", deleted: false, updated_at: 1 };
    localStorage.setItem("ember", JSON.stringify({ onboarded: true, nudge_offered: true, tasks: [task], chunks: [chunk], days: [{ day: "2026-10-05", confirmed_at: 1, deferred: [] }], draft: "" }));
  });
}

test("a push tap opens the task with 'Not now? Snooze', and Snooze moves it to tomorrow's first slot", async ({ page }) => {
  await seedTask(page);
  await page.goto("/?s=SEND1&t=T1&via=push");
  await expect(page.getByRole("heading", { name: "Cover letter" })).toBeVisible();
  await expect(page.getByText("Not now?")).toBeVisible();
  // Verify finding 19: opening on a link is a page load, so the title is not focused (no focus rectangle round it).
  await expect(page.getByRole("heading", { name: "Cover letter" })).not.toBeFocused();
  expect(page.url()).not.toContain("via="); // the marker is used once, like the sign-in code

  await page.getByRole("button", { name: "Snooze" }).click();
  await expect(page.getByText("Not now?")).toHaveCount(0);
  const task = await page.evaluate(() => JSON.parse(localStorage.getItem("ember")!).tasks[0]);
  expect(task.snoozed_until).toBe(Date.parse("2026-10-06T08:00:00+08:00")); // tomorrow, when quiet hours end
  expect(task.deadline).toBe("2026-10-05"); // the deadline never moves
});

test("the same link from a Telegram button has no Snooze line", async ({ page }) => {
  await seedTask(page);
  await page.goto("/?s=SEND1&t=T1");
  await expect(page.getByRole("heading", { name: "Cover letter" })).toBeVisible();
  await expect(page.getByText("Not now?")).toHaveCount(0);
});
