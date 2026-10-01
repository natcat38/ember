import { expect, test, type Page } from "@playwright/test";

test("the manifest and icons are served", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = await (await request.get(href!)).json();
  expect(manifest).toMatchObject({ name: "Ember", display: "standalone", start_url: "/" });
  for (const icon of [...manifest.icons.map((i: { src: string }) => i.src), "/apple-touch-icon.png"]) {
    expect((await request.get(icon)).status(), icon).toBe(200);
  }
});

test("the app opens offline once it has been visited", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the service worker, which caches the assets it serves
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await context.setOffline(false);
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
