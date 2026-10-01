import { expect, test, type Page } from "./fixtures";

async function captureOne(page: Page, title: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "What's on your mind?" }).click();
  await page.getByRole("textbox", { name: "Capture a thought" }).fill(title);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
}

const section = (page: Page, name: string) => page.getByRole("region", { name });

test("a triaged task shows as Active: out of Needs sorting, and ranked into Today", async ({ page }) => {
  await captureOne(page, "Ethics essay");
  await section(page, "Needs sorting").getByRole("button", { name: "Ethics essay" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Ethics essay" })).toBeFocused();
  await page.getByRole("group", { name: "Is this holding up anything else?" }).getByRole("button", { name: "Yes" }).click();
  await page.getByRole("main").locator("input[type=date]").fill("2099-10-14");
  await page.getByRole("group", { name: "Size" }).getByRole("button", { name: "M", exact: true }).click();
  await expect(page.getByRole("group", { name: "Size" }).getByRole("button", { name: "M", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Back" }).click();
  await expect(section(page, "Needs sorting")).toHaveCount(0);
  // Far deadline, but holding things up lifts it to on track, so it ranks into Today rather than Waiting.
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByRole("region", { name: "Do this first" })).toContainText("Ethics essay");

  // Survives a reload, and reopens on the one-line summary.
  await page.reload();
  await page.getByRole("region", { name: "Do this first" }).getByRole("button", { name: "Ethics essay" }).click();
  await expect(page.getByRole("region", { name: "Triage" })).toContainText("Due 14 Oct · Holding things up · M");
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("group", { name: "Size" })).toBeVisible();
});

test("Remove from list asks first, then Restore brings it back", async ({ page }) => {
  await captureOne(page, "Fix bike light");
  await page.getByRole("button", { name: "Fix bike light" }).click();

  await page.getByRole("button", { name: "More actions for Fix bike light" }).click();
  await page.getByRole("button", { name: "Remove from list" }).click();
  const prompt = page.getByRole("alertdialog", { name: 'Remove "Fix bike light" from your list?' });
  await expect(prompt.getByRole("button", { name: "Keep it" })).toBeFocused();

  await prompt.getByRole("button", { name: "Keep it" }).click();
  await expect(prompt).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Fix bike light" })).toBeVisible();

  await page.getByRole("button", { name: "More actions for Fix bike light" }).click();
  await page.getByRole("button", { name: "Remove from list" }).click();
  await prompt.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  await expect(page.getByText("Moved out of the way. It's still here if you want it back.")).toBeVisible();
  await expect(page.getByText("Nothing waiting here.")).toBeVisible();

  await page.getByRole("button", { name: "Removed" }).click();
  await page.getByRole("button", { name: "Restore Fix bike light" }).click();
  await expect(page.getByText("Back on your list.")).toBeVisible();
  await expect(section(page, "Needs sorting").getByRole("button", { name: "Fix bike light" })).toBeVisible();
});

test("Rename task", async ({ page }) => {
  await captureOne(page, "Spring tutorial");
  await page.getByRole("button", { name: "Spring tutorial" }).click();
  await page.getByRole("button", { name: "More actions for Spring tutorial" }).click();
  await page.getByRole("button", { name: "Rename task" }).click();
  const field = page.getByRole("dialog", { name: "Rename task" }).getByRole("textbox");
  await field.fill("Spring tutorial, ch. 4");
  await field.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Spring tutorial, ch. 4" })).toBeVisible();
});

test("a Telegram 'Pick a date' link opens the task with the deadline question ready", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const t = { id: "t-pick", title: "Lab report", state: "active", size: "L", quick: false, holding_up: false, deadline: "2026-10-04", runway_start: "2026-09-20", pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1 };
    localStorage.setItem("ember", JSON.stringify({ tasks: [t], chunks: [], draft: "" }));
  });
  await page.goto("/?t=t-pick&pick=1");
  await expect(page.getByRole("heading", { level: 1, name: "Lab report" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Has a deadline?" }).getByRole("button", { name: /Due 4 Oct|Pick a date/ })).toBeFocused();
  await expect(page).toHaveURL(/\/$/); // the link's parameters are cleared
});
