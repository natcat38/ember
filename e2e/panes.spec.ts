import { expect, test, type Page } from "./fixtures";

// Wireframes.md §10: on a wide screen Today and Focus (or the selected task) sit side by side, two 560 px columns.
test.use({ timezoneId: "Asia/Singapore", viewport: { width: 1440, height: 900 } });

// The Mei example of Tech_Scope.md §4.6: the frog is B1 of "Cover letter"; the rest of Today is C1, C2, A1, A2.
async function seed(page: Page) {
  await page.clock.install({ time: new Date("2026-10-05T09:00:00+08:00") });
  await page.goto("/");
  await page.evaluate(() => {
    const task = (id: string, title: string, o: object) => ({ id, title, state: "active", size: "M", quick: false, holding_up: false, deadline: null, runway_start: null, pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1, ...o });
    const steps = (t: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${t}${i + 1}`, task_id: t, parent_id: null, title: `${t}${i + 1}`, position: i + 1, state: "todo", deleted: false, updated_at: 1 }));
    const tasks = [
      task("A", "DSA assignment", { deadline: "2026-10-08", runway_start: "2026-09-28" }),
      task("B", "Cover letter", { size: "S", deadline: "2026-10-05", runway_start: "2026-10-01" }),
      task("C", "Lab report", { size: "L", deadline: "2026-10-04", runway_start: "2026-09-20" }),
      task("D", "System design ch. 3", {}),
      task("E", "Reply to recruiter", { size: "XS", deadline: "2026-10-20", runway_start: "2026-10-01", holding_up: true }),
    ];
    const chunks = [...steps("A", 3), ...steps("B", 1), ...steps("C", 3), ...steps("D", 2), ...steps("E", 1)];
    localStorage.setItem("ember", JSON.stringify({ tasks, chunks, days: [], draft: "", onboarded: true, nudge_offered: true }));
  });
  await page.reload();
}

const left = (page: Page) => page.locator('[data-pane="left"]');
const right = (page: Page) => page.locator('[data-pane="right"]');
const overflows = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test("both panes show, with the frog's task on the right", async ({ page }) => {
  await seed(page);
  await expect(left(page).getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(left(page).getByRole("list", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("main", { name: "Today" })).toBeVisible(); // each pane is a labelled landmark
  await expect(page.getByRole("region", { name: "Task" })).toBeVisible();
  await expect(right(page).getByRole("heading", { level: 1, name: "Cover letter" })).toBeVisible();
  await expect(right(page).getByRole("button", { name: "Back" })).toHaveCount(0);
  await expect(left(page).getByRole("region", { name: "Do this first" }).locator(".row-link")).toHaveAttribute("aria-current", "true");
  // The panes sit side by side, each 560 px wide.
  const a = (await left(page).boundingBox())!;
  const b = (await right(page).boundingBox())!;
  expect(a.width).toBe(560);
  expect(b.width).toBe(560);
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
  expect(Math.abs(a.y - b.y)).toBeLessThan(1);
});

test("choosing another row swaps the right pane without leaving Today or adding history", async ({ page }) => {
  await seed(page);
  const before = await page.evaluate(() => history.length);
  await left(page).getByRole("list", { name: "Today" }).getByRole("button", { name: "C1" }).first().click();
  await expect(right(page).getByRole("heading", { level: 1, name: "Lab report" })).toBeVisible();
  await expect(right(page).getByRole("heading", { level: 1, name: "Lab report" })).toBeFocused(); // focus follows the content
  await expect(left(page).getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(left(page).locator(".row-link", { hasText: "C1" })).toHaveAttribute("aria-current", "true");
  await expect(left(page).locator('.row-link[aria-current="true"]')).toHaveCount(2); // C1 and C2 are steps of the same task
  expect(await page.evaluate(() => history.length)).toBe(before); // back from a selected task needs no entry
});

test("starting Focus puts the timer on the right while Today stays", async ({ page }) => {
  await seed(page);
  await left(page).getByRole("button", { name: "Start C1" }).click();
  await expect(page.getByRole("region", { name: "Focus" })).toBeVisible();
  await expect(right(page).getByRole("timer")).toBeVisible();
  await expect(right(page).getByRole("heading", { level: 1, name: "C1" })).toBeFocused();
  await expect(left(page).getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(left(page).getByRole("list", { name: "Today" })).toBeVisible();
  // Peeking at Inbox in the left pane leaves the session where it is.
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(left(page).getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  await expect(right(page).getByRole("timer")).toBeVisible();
  // Stopping hands the right pane back to a task, and the focus goes with it.
  await right(page).getByRole("button", { name: "Stop for now" }).click();
  await expect(right(page).getByRole("timer")).toHaveCount(0);
  await expect(right(page).getByRole("heading", { level: 1 })).toBeFocused();
});

test("finishing a step shows Reward on the right", async ({ page }) => {
  await seed(page);
  await left(page).getByRole("button", { name: "Start C1" }).click();
  await right(page).getByRole("button", { name: "Done" }).click();
  await expect(right(page).getByRole("heading", { level: 1, name: "Step done." })).toBeVisible();
  await expect(left(page).getByRole("list", { name: "Today" })).toBeVisible();
  await right(page).getByRole("button", { name: "Skip" }).click(); // the unlock (slice 20) comes before the way on
  await right(page).getByRole("button", { name: "Back to Today" }).click();
  await expect(right(page).getByRole("heading", { level: 1 })).toBeFocused();
});

test("Settings replaces the left pane and leaves the right one", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(left(page).getByRole("heading", { level: 1, name: "Settings" })).toBeFocused();
  await expect(page.getByRole("main", { name: "Settings" })).toBeVisible();
  await expect(left(page).getByRole("list", { name: "Today" })).toHaveCount(0);
  await expect(right(page).getByRole("heading", { level: 1, name: "Cover letter" })).toBeVisible();
  await page.goBack(); // the phone's gesture and the browser's Back still unwind the left pane
  await expect(left(page).getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
});

test("an empty Today leaves the right pane with the existing empty-state copy", async ({ page }) => {
  await page.goto("/");
  await expect(right(page).getByText("Nothing's lined up for today yet.")).toBeVisible();
  await expect(left(page).getByText("Nothing's lined up for today yet.")).toBeVisible();
});

for (const width of [1180, 1440]) {
  test(`no horizontal scroll at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await seed(page);
    await expect(right(page)).toBeVisible();
    expect(await overflows(page)).toBe(false);
  });
}

test.describe("below the breakpoint", () => {
  test("1179 px stays one column", async ({ page }) => {
    await page.setViewportSize({ width: 1179, height: 900 });
    await seed(page);
    await expect(page.locator(".panes")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    expect(await overflows(page)).toBe(false);
  });

  test("a 375 px phone keeps its single column, Back and bottom capture bar", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await seed(page);
    await expect(page.locator(".panes")).toHaveCount(0);
    await expect(page.locator("[data-pane]")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    await expect(page.locator(".capture-bar")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Cover letter" })).toHaveCount(0); // no second pane to show it
    await page.getByRole("list", { name: "Today" }).getByRole("button", { name: "C1" }).first().click();
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Lab report" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    expect(await overflows(page)).toBe(false);
  });
});
