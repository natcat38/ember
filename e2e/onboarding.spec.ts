import { expect, test } from "./fixtures";

// Slice 16 done-when: from an empty device to a real step ready to start in under a minute of input (UX_Flows.md §7).
test.use({ firstRun: true, timezoneId: "Asia/Singapore" });

const field = (page: import("@playwright/test").Page) => page.getByRole("textbox", { name: "Capture a thought" });

test("several things: pick the heavy one, give it a first step, start two minutes, get the reminder offer", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-05T10:00:00+08:00") });
  await page.goto("/");

  // 1. Land: the field is ready, with its sub-line. No tour, no account screen.
  await expect(field(page)).toBeFocused();
  await expect(page.getByRole("main").getByText("One thing or ten. Just get it out of your head.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible();

  // 2. Dump: each item stacks; after the first, Skip for now becomes "That's it for now".
  for (const t of ["Cover letter", "Lab report", "Book dentist"]) {
    await field(page).fill(t);
    await field(page).press("Enter");
  }
  await expect(page.getByRole("list", { name: "Added just now" }).getByRole("listitem")).toHaveCount(3);
  await page.getByRole("button", { name: "That's it for now" }).click();

  // 3. Branch: several things.
  await expect(page.getByRole("heading", { level: 1, name: "Got it, three things. Let's make today small." })).toBeFocused();
  await page.getByRole("list", { name: "Which one's weighing on you most?" }).getByRole("button", { name: "Lab report" }).click();

  // 4. First Today: the picked task, alone.
  await expect(page.getByRole("region", { name: "Do this first" })).toContainText("Lab report");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toHaveCount(0); // one way on, not two that run the same line
  await page.getByRole("button", { name: "Break this down" }).click();

  // 5. First step.
  await page.getByRole("textbox", { name: "What's the first small thing to do?" }).fill("Open the data sheet");
  await page.getByRole("button", { name: "Next" }).click();

  // 6. Starter focus: two minutes.
  await expect(page.getByRole("heading", { level: 1, name: "Start with two minutes?" })).toBeVisible();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("timer")).toHaveText("2:00");
  await page.getByRole("button", { name: "Done" }).click();

  // 7. Reward + reminder offer, once. No unlock card in front of it on this first Reward.
  await expect(page.getByRole("button", { name: "Skip" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "That's everything for today." })).toBeVisible();
  const offer = page.getByRole("region", { name: "Reminders" });
  await expect(offer).toContainText("That's a start. Want Ember to nudge you gently while it's closed?");
  await offer.getByRole("button", { name: "Not now" }).click();
  await expect(offer).toContainText("You can turn this on in Settings any time.");

  // Afterwards: nothing was triaged, so all three wait in Inbox (the picked one was also Today's); no second run.
  await page.getByRole("button", { name: "Back to Today" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("region", { name: "Needs sorting" }).getByRole("listitem")).toHaveText(["Book dentist", "Lab report", "Cover letter"]);
});

test("one thing: 'Not now' puts it alone in Today, untriaged", async ({ page }) => {
  await page.goto("/");
  await field(page).fill("Reply to recruiter");
  await field(page).press("Enter");
  await page.getByRole("button", { name: "That's it for now" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Want me to break that one down?" })).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("region", { name: "Do this first" })).toContainText("Reply to recruiter");
});

test("Skip for now with nothing captured skips the first run for good", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(page.getByText("Nothing's lined up for today yet.")).toBeVisible();
});

test("'Already use Ember? Sign in' skips the first run for good and opens Settings, where sign-in is", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Already use Ember? Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Data" })).toHaveAttribute("aria-expanded", "true"); // the way in is not behind a fold
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(page.getByText("Nothing's lined up for today yet.")).toBeVisible();
});
