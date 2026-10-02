import { expect, test } from "./fixtures";

test("five captures in a row survive a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "What's on your mind?" }).click();
  const field = page.getByRole("textbox", { name: "Capture a thought" });
  await expect(field).toBeFocused();
  await expect(page.getByText("One thing or ten. Just get it out of your head.")).toBeVisible();

  for (let i = 1; i <= 5; i++) {
    await field.fill(`thought ${i}`);
    await field.press("Enter");
    await expect(field).toHaveValue("");
    await expect(field).toBeFocused(); // clears but stays open
  }
  await expect(page.getByRole("list", { name: "Added just now" }).getByRole("listitem")).toHaveCount(5);

  await page.reload();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  const rows = page.getByRole("main").getByRole("listitem");
  await expect(rows).toHaveText(["thought 5", "thought 4", "thought 3", "thought 2", "thought 1"]); // newest first
});

test("an empty send is ignored", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "What's on your mind?" }).click();
  await page.getByRole("textbox", { name: "Capture a thought" }).fill("   ");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("list", { name: "Added just now" })).toHaveCount(0);
});

test("unsent text is kept as a draft when the sheet closes, even across a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "What's on your mind?" }).click();
  await page.getByRole("textbox", { name: "Capture a thought" }).fill("half a thought");
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: "half a thought" }).click();
  await expect(page.getByRole("textbox", { name: "Capture a thought" })).toHaveValue("half a thought");
});

// Typing stays inside the form; the app's saved state only gets the text once typing pauses (audit #30).
test("a draft reaches saved state after typing pauses, not on every keystroke", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "What's on your mind?" }).click();
  await page.getByRole("textbox", { name: "Capture a thought" }).fill("typing away");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ember")!).draft)).toBe("");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("ember")!).draft)).toBe("typing away");
});

test("Quick tags the task XS", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "What's on your mind?" }).click();
  await page.getByRole("button", { name: "Quick" }).click();
  await expect(page.getByRole("button", { name: "Quick" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("textbox", { name: "Capture a thought" }).fill("Book dentist");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Quick" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("main").getByRole("listitem")).toHaveText("Book dentistXS");
});

test("without a date picker, Deadline shows a visible, labelled date field and focuses it", async ({ page }) => {
  await page.addInitScript(() => delete (HTMLInputElement.prototype as { showPicker?: unknown }).showPicker);
  await page.goto("/");
  await page.getByRole("button", { name: "What's on your mind?" }).click();
  await page.getByRole("button", { name: "Deadline" }).click();
  const field = page.getByLabel("Deadline", { exact: true });
  await expect(field).toBeVisible();
  await expect(field).toBeFocused();
  await field.fill("2099-12-01");
  await expect(page.getByRole("button", { name: "Due 1 Dec" })).toHaveAttribute("aria-pressed", "true");
});

test("Deadline shows the picked date and can be cleared", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "What's on your mind?" }).click();
  await page.locator("input[type=date]").fill("2099-12-01"); // the native picker is the browser's; set its input directly
  await expect(page.getByRole("button", { name: "Due 1 Dec" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Clear deadline" }).click();
  await expect(page.getByRole("button", { name: "Deadline" })).toHaveAttribute("aria-pressed", "false");
});
