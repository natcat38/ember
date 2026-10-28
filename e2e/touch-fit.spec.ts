import { expect, test } from "./fixtures";

// The phone baseline and fit from the 2026-10-23 UX pass (EMB-UX-9, 11, 12, 14). Each test is named for its finding.
test.use({ timezoneId: "Asia/Singapore" });

test("EMB-UX-9: taps do not double-tap zoom, the page does not bounce, and controls are not selectable", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const t = { id: "t1", title: "Revise DSA basics", state: "inbox", size: null, quick: false, holding_up: false, deadline: null, runway_start: null, pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1 };
    localStorage.setItem("ember", JSON.stringify({ tasks: [t], chunks: [], days: [], draft: "", onboarded: true, nudge_offered: true }));
  });
  await page.reload();
  const style = (sel: string, prop: string) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
  // Playwright's WebKit build on Windows does not support overscroll-behavior; the CSS is still shipped for iOS Safari.
  if (await page.evaluate(() => CSS.supports("overscroll-behavior-y", "none"))) expect(await style("html", "overscroll-behavior-y")).toBe("none");
  expect(await style(".capture-bar > button", "touch-action")).toBe("manipulation");
  expect(await style("button.icon-button", "user-select")).toBe("none");
});

test("EMB-UX-14: the capture bar is under 80 px, 10% of a 812 px screen", async ({ page }) => {
  await page.goto("/");
  const bar = (await page.locator(".capture-bar").boundingBox())!;
  expect(bar.height).toBeLessThanOrEqual(80);
});

test("EMB-UX-11: an empty Today with an empty Inbox has no Inbox button; with a task in Inbox it has one", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Nothing's lined up for today yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sort a few from Inbox" })).toHaveCount(0);
  await expect(page.locator(".nook .cat")).toBeVisible(); // the resting cat, as on a full day
  await page.evaluate(() => {
    const t = { id: "t1", title: "Revise DSA basics", state: "inbox", size: null, quick: false, holding_up: false, deadline: null, runway_start: null, pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1 };
    localStorage.setItem("ember", JSON.stringify({ tasks: [t], chunks: [], days: [], draft: "", onboarded: true, nudge_offered: true }));
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Sort a few from Inbox" })).toBeVisible();
});

test("EMB-UX-12: in triage, Not yet and Pick a date are the same width", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const t = { id: "t1", title: "Revise DSA basics", state: "inbox", size: null, quick: false, holding_up: false, deadline: null, runway_start: null, pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1 };
    localStorage.setItem("ember", JSON.stringify({ tasks: [t], chunks: [], days: [], draft: "", onboarded: true, nudge_offered: true }));
  });
  await page.reload();
  await page.getByRole("button", { name: "Sort a few from Inbox" }).click();
  await page.getByRole("button", { name: /Revise DSA basics/ }).click();
  const deadline = page.getByRole("group", { name: "Has a deadline?" });
  const [a, b] = await Promise.all([deadline.getByRole("button", { name: "Not yet" }).boundingBox(), deadline.getByRole("button", { name: "Pick a date" }).boundingBox()]);
  expect(Math.abs(a!.width - b!.width)).toBeLessThanOrEqual(1);
});
