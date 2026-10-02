import { expect, test } from "./fixtures";

// Slice 6 done-when: the phase-1 loop runs end to end at 375 px (Tech_Scope.md §9):
// capture → triage → step → Today → focus → reward → shutdown.
test.use({ timezoneId: "Asia/Singapore" });

test("the whole loop, from an empty device to a closed day", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-05T09:00:00+08:00") });
  await page.goto("/");

  // Capture
  await expect(page.getByText("Nothing's lined up for today yet.")).toBeVisible();
  await page.getByRole("button", { name: "Capture something" }).click();
  await page.getByRole("textbox", { name: "Capture a thought" }).fill("Cover letter");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Close" }).click();

  // Triage: due tomorrow, size S
  await page.getByRole("button", { name: "Sort a few from Inbox" }).click();
  await page.getByRole("button", { name: "Cover letter" }).click();
  await page.getByRole("main").locator("input[type=date]").fill("2026-10-06");
  await page.getByRole("group", { name: "Size" }).getByRole("button", { name: "S", exact: true }).click();

  // Step
  const next = page.getByRole("textbox", { name: "What's the very next physical action?" });
  await next.fill("Tailor the opening");
  await next.press("Enter");
  await next.fill("Proofread");
  await next.press("Enter");

  // Today: two steps, the first is the frog
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByText("Here's today: 2 things. Good to go?")).toBeVisible();
  await page.getByRole("button", { name: "Let's go" }).click();
  await expect(page.getByRole("img", { name: "0 of 2 done today" })).toBeVisible();

  // Focus → Reward
  await page.getByRole("button", { name: "Do this first" }).click();
  await page.clock.runFor(12 * 60_000);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Step done." })).toBeVisible();
  await expect(page.getByRole("img", { name: "1 of 2 done today" })).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click(); // the unlock (slice 20) comes before the way on

  // Next step straight from Reward; the last one of the day
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Proofread" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "That's everything for today." })).toBeVisible();
  await expect(page.getByRole("img", { name: "2 of 2 done today" })).toBeVisible();
  await page.getByRole("button", { name: "Back to Today" }).click();
  await expect(page.getByText("That's everything for today.")).toBeVisible();

  // Shutdown: nothing urgent (the task is due tomorrow), tomorrow's list, the explicit stop
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Wrap up the day" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nothing urgent." })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Tomorrow's list is ready: \d+ things?\.$/ })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "That's it for today. You're done." })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();

  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("ember")!));
  expect(s.days.find((d: { day: string }) => d.day === "2026-10-05").shutdown_at).toBeTruthy();
  expect(s.sessions).toHaveLength(2);
});

test("marking an urgent task done in the shutdown counts as a done day", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-05T20:00:00+08:00") });
  await page.goto("/");
  await page.evaluate(() => {
    const t = { id: "B", title: "Cover letter", state: "active", size: "S", quick: false, holding_up: false, deadline: "2026-10-05", runway_start: "2026-10-01", pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1 };
    localStorage.setItem("ember", JSON.stringify({ tasks: [t], chunks: [], days: [{ day: "2026-10-05", confirmed_at: 1, deferred: [] }], draft: "" }));
  });
  await page.reload();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Wrap up the day" }).click();
  await page.getByRole("list", { name: "Still open" }).getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nothing urgent." })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "That's it for today. You're done." })).toBeVisible();
});

test("zero-done day: urgent items are offered, and the close rests instead of tallying", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-05T20:00:00+08:00") });
  await page.goto("/");
  await page.evaluate(() => {
    const t = { id: "B", title: "Cover letter", state: "active", size: "S", quick: false, holding_up: false, deadline: "2026-10-05", runway_start: "2026-10-01", pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1 };
    localStorage.setItem("ember", JSON.stringify({ tasks: [t], chunks: [], days: [{ day: "2026-10-05", confirmed_at: 1, deferred: [] }], draft: "" }));
  });
  await page.reload();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Wrap up the day" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Anything urgent still open?" })).toBeVisible();
  const open = page.getByRole("list", { name: "Still open" });
  await expect(open).toContainText("Due today");
  await expect(open.getByRole("button", { name: "Reschedule" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Some days are for resting. Tomorrow's list is ready when you are." })).toBeVisible();
});
