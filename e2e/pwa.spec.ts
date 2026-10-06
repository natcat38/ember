import { expect, test, type Page } from "./fixtures";

test.use({ serviceWorkers: "allow" }); // the worker is what this file tests

test("the manifest and icons are served", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = await (await request.get(href!)).json();
  expect(manifest).toMatchObject({ name: "Ember", display: "standalone", start_url: "/" });
  expect(manifest.icons.map((i: { purpose: string }) => i.purpose)).toContain("maskable");
  // An image, not just a 200: a missing file gets the app's HTML from the SPA fallback, also with a 200.
  for (const icon of [...manifest.icons.map((i: { src: string }) => i.src), "/apple-touch-icon.png", "/favicon.ico"]) {
    const res = await request.get(icon);
    expect(res.status(), icon).toBe(200);
    expect(res.headers()["content-type"], icon).toMatch(/^image\//);
  }
});

test("the app opens offline once it has been visited", async ({ page, context }) => {
  test.skip(test.info().project.name === "webkit", "Playwright's WebKit fails an offline reload under a service worker with an internal error");
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the service worker, which caches the assets it serves
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await context.setOffline(false);
});

// The install step caches the shell's JS and CSS, so an offline open right after the first visit is not blank (audit #36).
test("the first visit precaches the shell's JS and CSS without a second load", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cached = () => page.evaluate(async () => (await (await caches.open("ember-shell")).keys()).map((r) => new URL(r.url).pathname));
  await expect.poll(async () => (await cached()).filter((p) => /^\/assets\/.*\.(js|css)$/.test(p)).length).toBeGreaterThanOrEqual(2);
});

// Hashed /assets/* are cached for good, so a new shell page must drop the ones it no longer references (public/sw.js).
test("a fresh page load drops cached assets from older deploys and keeps the current ones", async ({ page }) => {
  const cached = () => page.evaluate(async () => (await (await caches.open("ember-shell")).keys()).map((r) => new URL(r.url).pathname).filter((p) => p.startsWith("/assets/")));
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // controlled now: the assets and fonts it serves get cached
  await expect.poll(async () => (await cached()).some((p) => p.endsWith(".woff2"))).toBe(true);
  const current = await cached();
  const stale = ["/assets/index-OLD11111.js", "/assets/index-OLD22222.css", "/assets/karla-latin-400-normal-OLD33333.woff2"];
  await page.evaluate(async (stale) => {
    const c = await caches.open("ember-shell");
    for (const p of stale) await c.put(p, new Response("old"));
  }, stale);
  await page.reload(); // a navigation: the SW fetches a fresh "/" and reads what it references
  await expect.poll(async () => (await cached()).filter((p) => stale.includes(p))).toEqual([]);
  expect(await cached()).toEqual(expect.arrayContaining(current));
});

test.describe("lapse return", () => {
  test.use({ timezoneId: "Asia/Singapore" });

  async function seed(page: Page, lastSeen: string) {
    await page.clock.install({ time: new Date("2026-10-12T09:00:00+08:00") });
    await page.goto("/");
    await page.evaluate((lastSeen) => {
      const task = (id: string, title: string, deadline: string) => ({ id, title, state: "active", size: "S", quick: false, holding_up: false, deadline, runway_start: "2026-10-01", pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1 });
      const step = (id: string, task_id: string) => ({ id, task_id, parent_id: null, title: id, position: 1, state: "todo", deleted: false, updated_at: 1 });
      localStorage.setItem("ember", JSON.stringify({ tasks: [task("C", "Lab report", "2026-10-06"), task("B", "Cover letter", "2026-10-13")], chunks: [step("C1", "C"), step("B1", "B")], last_seen_at: Date.parse(lastSeen), draft: "" }));
    }, lastSeen);
    await page.reload();
  }

  test("after a week away: a normal day, the welcome back, and a one-tap reset", async ({ page }) => {
    await seed(page, "2026-10-05T20:00:00+08:00");
    const card = page.getByRole("region", { name: "Welcome back" });
    await expect(card).toContainText("Welcome back. Here's what's on today.");
    await expect(card).toContainText("A couple of these slipped past their date. Want to reset them?");
    await expect(page.getByText("Here's today:")).toHaveCount(0); // the welcome replaces the morning confirm
    await expect(page.getByText(/Was due/)).toBeVisible();
    await page.getByRole("button", { name: "Reset them" }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByText(/Was due/)).toHaveCount(0);

    await page.reload(); // offered once
    await expect(page.getByRole("region", { name: "Welcome back" })).toHaveCount(0);
  });

  test("after two days away: an ordinary morning", async ({ page }) => {
    await seed(page, "2026-10-10T20:00:00+08:00");
    await expect(page.getByRole("region", { name: "Welcome back" })).toHaveCount(0);
    await expect(page.getByText(/Here's today: \d things?\. Good to go\?/)).toBeVisible();
  });
});
