import { expect, openFold, test, type Page } from "./fixtures";

// The sticky header, the wordmark, the desktop tabs, the status line's place and the folded Settings rows from the
// 2026-10-23 UX pass (EMB-UX-1, 2, 13, 10). Each test is named for its finding.
test.use({ timezoneId: "Asia/Singapore" });

async function seedInbox(page: Page, n = 40) {
  await page.goto("/");
  await page.evaluate((count) => {
    const t = (i: number) => ({ id: `i${i}`, title: `Inbox item ${i}`, state: "inbox", size: null, quick: false, holding_up: false, deadline: null, runway_start: null, pinned_on: null, snoozed_until: null, created_at: 100 + i, updated_at: 100 + i });
    localStorage.setItem("ember", JSON.stringify({ tasks: Array.from({ length: count }, (_, i) => t(i)), chunks: [], days: [], draft: "", onboarded: true, nudge_offered: true }));
  }, n);
  await page.reload();
}

test("EMB-UX-1: the header stays put while a long Inbox scrolls, 60 px tall, with the menu in reach", async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) >= 768, "the phone layout");
  await seedInbox(page);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await page.evaluate(() => window.scrollTo({ top: 1500, behavior: "instant" }));
  await expect(page.getByText("Inbox item 39", { exact: true })).not.toBeInViewport(); // the page did scroll
  const box = (await page.locator(".header").boundingBox())!;
  expect(box.y).toBe(0);
  expect(box.height).toBeLessThanOrEqual(64);
  await expect(page.getByRole("button", { name: "Open menu" })).toBeInViewport();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click(); // one tap from anywhere on the page
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
});

test("EMB-UX-1: the name sits beside the menu on every screen that has one", async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) >= 768, "the phone layout");
  await seedInbox(page, 2);
  const header = page.locator(".header");
  await expect(header.getByText("Ember", { exact: true })).toBeVisible();
  const [menu, name] = await Promise.all([header.getByRole("button", { name: "Open menu" }).boundingBox(), header.getByText("Ember", { exact: true }).boundingBox()]);
  expect(name!.x).toBeGreaterThanOrEqual(menu!.x + menu!.width);
  expect(Math.abs(name!.y + name!.height / 2 - (menu!.y + menu!.height / 2))).toBeLessThanOrEqual(2);
});

test("EMB-UX-1: a focused field never lands under the header", async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) >= 768, "the phone layout");
  await seedInbox(page, 2);
  const scrollPadding = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop));
  expect(scrollPadding).toBeGreaterThanOrEqual(60);
});

test.describe("from 1180 px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.skip(({ browserName }) => browserName !== "chromium", "a desktop layout; the WebKit project is an iPhone");

  test("EMB-UX-2: Today, Inbox and Settings are tabs with no menu, and Wrap up the day is beside them", async ({ page }) => {
    await seedInbox(page, 3);
    const left = page.locator("[data-pane=left]");
    await expect(page.getByRole("button", { name: "Open menu" })).toHaveCount(0);
    const tabs = left.getByRole("navigation", { name: "Screens" });
    await expect(tabs.getByRole("button")).toHaveText(["Today", "Inbox", "Settings"]);
    await expect(tabs.getByRole("button", { name: "Today" })).toHaveAttribute("aria-current", "page");
    await tabs.getByRole("button", { name: "Inbox" }).click();
    await expect(tabs.getByRole("button", { name: "Inbox" })).toHaveAttribute("aria-current", "page");
    await expect(left.getByRole("region", { name: "Needs sorting" })).toBeVisible();
    await expect(left.getByRole("button", { name: "Wrap up the day" })).toBeVisible();
  });

  test("EMB-UX-2: beside Settings the right pane does not show the frog", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const day = (back: number) => new Date(Date.now() - back * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
      const t = { id: "t1", title: "Cover letter", state: "active", size: "S", quick: false, holding_up: false, deadline: day(0), runway_start: day(5), pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1 };
      const c = { id: "c1", task_id: "t1", parent_id: null, title: "Open the draft", position: 1, state: "todo", deleted: false, updated_at: 1 };
      localStorage.setItem("ember", JSON.stringify({ tasks: [t], chunks: [c], days: [], draft: "", onboarded: true, nudge_offered: true }));
    });
    await page.reload();
    const right = page.locator("[data-pane=right]");
    await expect(right.getByRole("heading", { level: 1, name: "Cover letter" })).toBeVisible(); // Today: the frog's task, as before
    await page.locator("[data-pane=left]").getByRole("button", { name: "Settings", exact: true }).click();
    await expect(right.getByText("Pick a task to see it here.")).toBeVisible();
    await expect(right.getByRole("heading", { level: 1, name: "Cover letter" })).toHaveCount(0);
  });

  test("EMB-UX-13: the offline line sits inside the left column, aligned with the content under it", async ({ page }) => {
    await seedInbox(page, 2); // the API is unreachable in these specs, so the line shows
    const line = page.getByText(/^Offline\./);
    await expect(line).toBeVisible();
    const pane = (await page.locator("[data-pane=left]").boundingBox())!;
    const lineBox = (await line.boundingBox())!;
    expect(lineBox.x).toBeGreaterThanOrEqual(pane.x);
    expect(lineBox.x + lineBox.width).toBeLessThanOrEqual(pane.x + pane.width);
    const field = (await page.getByRole("textbox", { name: "Capture a thought" }).boundingBox())!;
    expect(Math.abs(lineBox.x - field.x)).toBeLessThanOrEqual(16); // the field's own padding is inside its box
  });
});

test("EMB-UX-13: on a phone the offline line is under the header, not above it", async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) >= 768, "the phone layout");
  await seedInbox(page, 2);
  const [h, l] = await Promise.all([page.locator(".header").boundingBox(), page.getByText(/^Offline\./).boundingBox()]);
  expect(l!.y).toBeGreaterThanOrEqual(h!.y + h!.height - 1);
});

test("EMB-UX-10: Settings folds the set-once groups into rows with a summary; a row opens its controls", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const heads = ["Quiet hours", "Time zone", "Hard blocks", "Rewards", "Data"];
  for (const h of heads) await expect(page.getByRole("button", { name: new RegExp(`^${h}`) })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: /^Quiet hours/ })).toContainText(/22:00|10:00\sPM/);
  await expect(page.getByRole("button", { name: /^Hard blocks/ })).toContainText("None");
  await expect(page.getByRole("button", { name: /^Rewards/ })).toContainText("Surprise me");
  // Nudges and the focus timer stay open: they are the ones used.
  await expect(page.getByRole("radio", { name: /25 \/ 5/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Link Telegram" })).toBeVisible();
  await expect(page.getByLabel("From")).toBeHidden();
  // The page is shorter than it was with everything open: under 1.3 screens of the phone's 812 px.
  expect(await page.evaluate(() => document.documentElement.scrollHeight / innerHeight)).toBeLessThan(1.3);
  await openFold(page, "Quiet hours");
  await expect(page.getByLabel("From")).toBeVisible();
});
