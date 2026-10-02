import { expect, test, type Page } from "./fixtures";

// Fixes from the Verify-stage UI walk (v1-report.md). Each test is named for the finding it keeps fixed.
test.use({ timezoneId: "Asia/Singapore", locale: "en-US" });

async function seedMei(page: Page, at = "2026-10-05T09:00:00+08:00") {
  await page.clock.install({ time: new Date(at) });
  await page.goto("/");
  await page.evaluate(() => {
    const task = (id: string, title: string, o: object) => ({ id, title, state: "active", size: "M", quick: false, holding_up: false, deadline: null, runway_start: null, pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1, ...o });
    const chunk = (t: string, n: number) => ({ id: `${t}${n}`, task_id: t, parent_id: null, title: `${t}${n}`, position: n, state: "todo", deleted: false, updated_at: 1 });
    const tasks = [task("B", "Cover letter", { size: "S", deadline: "2026-10-05", runway_start: "2026-10-01" }), task("C", "Lab report", { size: "L", deadline: "2026-10-04", runway_start: "2026-09-20" })];
    localStorage.setItem("ember", JSON.stringify({ tasks, chunks: [chunk("B", 1), chunk("C", 1), chunk("C", 2)], days: [], draft: "" }));
  });
  await page.reload();
}

test("finding 3: an announcement takes no room, so nothing under the header moves when the ring count changes", async ({ page }) => {
  await seedMei(page);
  await page.getByRole("button", { name: "Let's go" }).click();
  await expect(page.getByText(/^Offline\./)).toBeVisible(); // settle the one visible status line before measuring
  const nook = page.getByRole("region", { name: "Progress" });
  const before = (await nook.boundingBox())!.y;

  await page.getByRole("checkbox", { name: "C1" }).check();
  await page.clock.runFor(200); // the announcement is queued on a short timer
  const live = page.locator(".app > p[aria-live=polite]");
  await expect(live).toHaveText("1 of 3 done today"); // still there for screen readers
  expect((await live.boundingBox())!.height).toBeLessThanOrEqual(1);
  expect((await nook.boundingBox())!.y).toBe(before);
});

test("finding 9: the Task view of an overdue task says 'Was due', as Today does", async ({ page }) => {
  await seedMei(page);
  await expect(page.getByRole("list", { name: "Today" })).toContainText("Was due Sun");
  await page.getByRole("list", { name: "Today" }).getByRole("button", { name: /^C1/ }).click();
  await expect(page.getByRole("region", { name: "Triage" })).toContainText("Was due Sun");
  await expect(page.getByRole("region", { name: "Triage" })).not.toContainText("Due 4 Oct");
});

test("finding 4: a new task's 'Not yet' and 'No' are not drawn chosen until answered", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "What's on your mind?" }).click();
  await page.getByRole("textbox", { name: "Capture a thought" }).fill("Ethics essay");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await page.getByRole("region", { name: "Needs sorting" }).getByRole("button", { name: "Ethics essay" }).click();

  const deadline = page.getByRole("group", { name: "Has a deadline?" });
  const holding = page.getByRole("group", { name: "Is this holding up anything else?" });
  await expect(deadline.getByRole("button", { name: "Not yet" })).toHaveAttribute("aria-pressed", "false");
  await expect(holding.getByRole("button", { name: "No", exact: true })).toHaveAttribute("aria-pressed", "false");
  for (const pill of await page.getByRole("main").locator(".chip").all()) await expect(pill).toHaveAttribute("aria-pressed", "false");

  await deadline.getByRole("button", { name: "Not yet" }).click();
  await expect(deadline.getByRole("button", { name: "Not yet" })).toHaveAttribute("aria-pressed", "true");
  await expect(holding.getByRole("button", { name: "No", exact: true })).toHaveAttribute("aria-pressed", "false"); // the other question is still open
  await holding.getByRole("button", { name: "Yes" }).click();
  await expect(holding.getByRole("button", { name: "Yes" })).toHaveAttribute("aria-pressed", "true");

  // Sized, the task is Active and the untouched defaults count as answered.
  await page.getByRole("group", { name: "Size" }).getByRole("button", { name: "M", exact: true }).click();
  await expect(page.getByRole("group", { name: "Size" }).getByRole("button", { name: "M", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("finding 4: an already-triaged task opens with its stored answers drawn chosen", async ({ page }) => {
  await seedMei(page);
  await page.getByRole("list", { name: "Today" }).getByRole("button", { name: /^C1/ }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("group", { name: "Is this holding up anything else?" }).getByRole("button", { name: "No", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("finding 20: the summary's Edit button is a full-size target", async ({ page }) => {
  await seedMei(page);
  await page.getByRole("list", { name: "Today" }).getByRole("button", { name: /^C1/ }).click();
  const box = (await page.getByRole("button", { name: "Edit" }).boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});
