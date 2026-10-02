import { expect, test, type Page } from "./fixtures";

// The phone's back gesture does what the visible Back does (UX_Flows.md §2). Today is the root and gets no history
// entry; screens with no way back mid-flow (Focus, Reward, Shutdown, onboarding) get none either.
test.use({ timezoneId: "Asia/Singapore" });

async function seed(page: Page) {
  await page.clock.install({ time: new Date("2026-10-05T09:00:00+08:00") });
  await page.goto("/");
  await page.evaluate(() => {
    const task = { id: "A", title: "Cover letter", state: "active", size: "S", quick: false, holding_up: false, deadline: "2026-10-08", runway_start: "2026-10-01", pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1 };
    const step = { id: "A1", task_id: "A", parent_id: null, title: "Draft the opening", position: 1, state: "todo", deleted: false, updated_at: 1 };
    const inboxTask = { ...task, id: "N", title: "Book dentist", state: "inbox", size: null, deadline: null, runway_start: null };
    localStorage.setItem("ember", JSON.stringify({ tasks: [task, inboxTask], chunks: [step], days: [], draft: "", onboarded: true, nudge_offered: true }));
  });
  await page.reload();
}

const today = (page: Page) => page.getByRole("heading", { level: 1, name: "Today" });
const openDrawer = (page: Page, item: string) => page.getByRole("button", { name: "Open menu" }).click().then(() => page.getByRole("button", { name: item, exact: true }).click());

test("back from a task returns to Today, and back from Today does nothing in the app", async ({ page }) => {
  await seed(page);
  const start = await page.evaluate(() => history.length);
  await page.locator(".row-link", { hasText: "Draft the opening" }).first().click();
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await page.goBack();
  await expect(today(page)).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(start + 1); // the entry is still there, only the position moved
  await page.goForward();
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click(); // the visible Back and the gesture agree
  await expect(today(page)).toBeVisible();
  await page.goBack(); // Today is the root: this leaves the app (about:blank), it neither throws nor loops
  await expect(page).not.toHaveURL(/localhost/);
});

test("back from Settings opened over Inbox goes to Inbox, then Today", async ({ page }) => {
  await seed(page);
  await openDrawer(page, "Inbox");
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  await openDrawer(page, "Settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  await page.goBack();
  await expect(today(page)).toBeVisible();
});

test("going to Today by the drawer clears the stack, so back doesn't revisit screens", async ({ page }) => {
  await seed(page);
  await openDrawer(page, "Inbox");
  await openDrawer(page, "Settings");
  await openDrawer(page, "Today");
  await expect(today(page)).toBeVisible();
  await page.goBack(); // nothing of ours is left to go back to
  await expect(page).not.toHaveURL(/localhost/);
});

test("back from a task opened over Inbox goes to Inbox", async ({ page }) => {
  await seed(page);
  await openDrawer(page, "Inbox");
  await page.getByRole("button", { name: /Book dentist/ }).click();
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
});

// The gesture closes the open dialog and nothing else (audit #11): the screen underneath stays, and the next back still works.
test("back with a dialog open closes the dialog and stays on the screen", async ({ page }) => {
  await seed(page);
  await page.locator(".row-link", { hasText: "Draft the opening" }).first().click();
  await page.getByRole("button", { name: "More actions for Cover letter" }).click();
  await page.getByRole("button", { name: "Remove from list" }).click();
  const prompt = page.getByRole("alertdialog", { name: 'Remove "Cover letter" from your list?' });
  await expect(prompt).toBeVisible();
  await page.goBack();
  await expect(prompt).toBeHidden();
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible(); // still on the task
  await page.goBack(); // no dialog now: this one goes back for real
  await expect(today(page)).toBeVisible();
});

test("back during a running Focus session never abandons it", async ({ page }) => {
  await seed(page);
  await page.locator(".row-link", { hasText: "Draft the opening" }).first().click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop for now" })).toBeVisible();
  await page.goBack(); // pops the task entry underneath; the session stays on screen
  await expect(page.getByRole("button", { name: "Stop for now" })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ember")!).focus)).toBeTruthy();
});

test("a task opened from a Telegram link has a Back that the gesture matches", async ({ page }) => {
  await page.route("**/api/handoff/redeem", (route) => route.abort());
  await seed(page);
  await page.goto("/?t=A");
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/); // the link params are cleaned off the address
  await page.goBack();
  await expect(today(page)).toBeVisible();
});
