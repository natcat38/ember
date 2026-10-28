import { expect, startFrog, startRow, test, type Page } from "./fixtures";

// A quieter Today and plainer words, from the 2026-10-23 UX pass (EMB-UX-4, 5, 6, 7, 8, 12). Each test is named for its finding.
test.use({ timezoneId: "Asia/Singapore" });

async function seedMei(page: Page) {
  await page.clock.install({ time: new Date("2026-10-05T09:00:00+08:00") });
  await page.goto("/");
  await page.evaluate(() => {
    const task = (id: string, title: string, o: object) => ({ id, title, state: "active", size: "M", quick: false, holding_up: false, deadline: null, runway_start: null, pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1, ...o });
    const steps = (t: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${t}${i + 1}`, task_id: t, parent_id: null, title: `${t}${i + 1}`, position: i + 1, state: "todo", deleted: false, updated_at: 1 }));
    const tasks = [
      task("A", "DSA assignment", { deadline: "2026-10-08", runway_start: "2026-09-28" }),
      task("B", "Cover letter", { size: "S", deadline: "2026-10-05", runway_start: "2026-10-01" }),
      task("C", "Lab report", { size: "L", deadline: "2026-10-04", runway_start: "2026-09-20" }),
    ];
    localStorage.setItem("ember", JSON.stringify({ tasks, chunks: [...steps("A", 3), ...steps("B", 1), ...steps("C", 3)], days: [], draft: "" }));
  });
  await page.reload();
}

test("EMB-UX-4: the frog's button says Start, and no button repeats the region's name", async ({ page }) => {
  await seedMei(page);
  const frog = page.getByRole("region", { name: "Do this first" });
  await expect(frog.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Do this first" })).toHaveCount(0);
});

test("EMB-UX-5: the morning confirm is a strip of 64 px or less with the frog's Start above the fold, and Let's go dismisses it", async ({ page }) => {
  await seedMei(page);
  const strip = page.getByRole("region", { name: "Morning confirm" });
  await expect(strip).toBeVisible();
  expect((await strip.boundingBox())!.height).toBeLessThanOrEqual(64); // 125 px as a card
  expect((await startFrog(page).boundingBox())!.y).toBeLessThan(500); // y 519 of 844 before
  await strip.getByRole("button", { name: "Let's go" }).click();
  await expect(strip).toHaveCount(0);
  await startFrog(page).click();
  await expect(page.getByRole("timer")).toBeVisible();
});

test("EMB-UX-5: Adjust still shows Not today on every row", async ({ page }) => {
  await seedMei(page);
  await page.getByRole("region", { name: "Morning confirm" }).getByRole("button", { name: "Adjust" }).click();
  const rows = await page.getByRole("list", { name: "Today" }).getByRole("listitem").count();
  expect(rows).toBeGreaterThan(1);
  await expect(page.getByRole("button", { name: /^Not today: / })).toHaveCount(rows); // one per row
});

test("EMB-UX-6: a Today row is a checkbox, a title and one menu; Start and Not today are in the menu", async ({ page }) => {
  await seedMei(page);
  await page.getByRole("button", { name: "Let's go" }).click();
  const row = page.getByRole("list", { name: "Today" }).getByRole("listitem").first();
  await expect(row.getByRole("button")).toHaveCount(2); // the title, then "..."
  await expect(row.getByRole("checkbox")).toBeVisible();
  const title = await row.locator(".row-link > span:first-child").innerText();
  await expect(page.getByRole("button", { name: `Start ${title}` })).toHaveCount(0); // no play icon
  await page.getByRole("button", { name: `More actions for ${title}`, exact: true }).click();
  await expect(page.locator(".row-menu").getByRole("button")).toHaveText(["Start", "Not today", "Open task"]);
  await page.locator(".row-menu").getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible(); // Focus on that step
  await expect(page.getByRole("timer")).toBeVisible();
});

test("EMB-UX-6: a row's Start works through the helper on a second row too", async ({ page }) => {
  await seedMei(page);
  await page.getByRole("button", { name: "Let's go" }).click();
  await startRow(page, "C2");
  await expect(page.getByRole("heading", { level: 1, name: "C2" })).toBeVisible();
});

test("EMB-UX-12: the step prompt asks for the first small thing", async ({ page }) => {
  await seedMei(page);
  await page.getByRole("button", { name: "Let's go" }).click();
  await page.getByRole("button", { name: "C1" }).first().click();
  await expect(page.getByRole("textbox", { name: "What's the first small thing to do?" })).toBeVisible();
  await expect(page.getByText("very next physical action")).toHaveCount(0);
});

test.describe("first run", () => {
  test.use({ firstRun: true });

  test("EMB-UX-7: the way out says Skip for now", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
  });

  test("EMB-UX-7: on a wide screen the foot buttons sit under the field, not at the bottom of the window", async ({ page }) => {
    test.skip(test.info().project.name !== "chromium", "a desktop layout");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const [field, foot] = await Promise.all([page.getByRole("textbox", { name: "Capture a thought" }).boundingBox(), page.getByRole("button", { name: "Skip for now" }).boundingBox()]);
    expect(foot!.y - (field!.y + field!.height)).toBeLessThan(250); // was about 700 px
  });

  test("EMB-UX-8: the Today step has one way on, Break this down", async ({ page }) => {
    await page.goto("/");
    const field = page.getByRole("textbox", { name: "Capture a thought" });
    for (const t of ["Cover letter", "Lab report"]) {
      await field.fill(t);
      await field.press("Enter");
    }
    await page.getByRole("button", { name: "That's it for now" }).click();
    await page.getByRole("list", { name: "Which one's weighing on you most?" }).getByRole("button", { name: "Lab report" }).click();
    await expect(page.getByRole("button", { name: "Break this down" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);
  });
});
