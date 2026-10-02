import { expect, test, type Page } from "./fixtures";

// Slice 10 done-when: the §4.6 example renders in full, hard blocks included.
test.use({ timezoneId: "Asia/Singapore", locale: "en-US" }); // the locale decides how the time inputs and the sentences beside them show a time

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
      task("D", "System design ch. 3", {}),
      task("E", "Reply to recruiter", { size: "XS", deadline: "2026-10-20", runway_start: "2026-10-01", holding_up: true }),
    ];
    const chunks = [...steps("A", 3), ...steps("B", 1), ...steps("C", 3), ...steps("D", 2), ...steps("E", 1)];
    localStorage.setItem("ember", JSON.stringify({ tasks, chunks, days: [{ day: "2026-10-05", confirmed_at: 1, deferred: [] }], draft: "" }));
  });
  await page.reload();
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
}

async function addBlock(page: Page, days: string[], from: string, to: string, name: string) {
  await page.getByRole("button", { name: "+ Add a block" }).click();
  const form = page.getByRole("form", { name: "Add a block" });
  for (const d of days) await form.getByRole("button", { name: d }).click();
  await form.getByLabel("From").fill(from);
  await form.getByLabel("To").fill(to);
  await form.getByLabel("Name (optional)").fill(name);
  await form.getByRole("button", { name: "Save" }).click();
}

const rows = (page: Page) => page.getByRole("list", { name: "Today" }).locator(".row-link > span:first-child");

test("§4.6 in full: Mei's Monday lectures leave 540 minutes, so Today is still B1, C1, C2, A1, A2", async ({ page }) => {
  await seedMei(page);
  await openSettings(page);
  await addBlock(page, ["Monday"], "09:00", "12:00", "Lecture");
  await addBlock(page, ["Monday"], "14:00", "16:00", "Lab");
  await expect(page.getByRole("list", { name: "Hard blocks" })).toContainText(/Mon 09:00\sAM–12:00\sPM Lecture/); // times show the way the time inputs do (en-US here)
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByRole("region", { name: "Do this first" })).toContainText("B1");
  await expect(rows(page)).toHaveText(["C1", "C2", "A1", "A2"]);
  await expect(page.getByRole("button", { name: "1 more waiting. They'll come up when there's room." })).toBeVisible();
});

test("a packed day gets fewer slots, and the rest wait", async ({ page }) => {
  await seedMei(page);
  await openSettings(page);
  await addBlock(page, ["Monday", "Tuesday"], "08:00", "21:00", "Shift");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByRole("region", { name: "Do this first" })).toContainText("B1");
  await expect(rows(page)).toHaveText(["C1"]); // 60 free minutes → 2 slots
  await expect(page.getByRole("button", { name: "4 more waiting. They'll come up when there's room." })).toBeVisible();
});

test("Add a block moves focus into the form, and Cancel moves it back", async ({ page }) => {
  await seedMei(page);
  await openSettings(page);
  await page.getByRole("button", { name: "+ Add a block" }).click();
  const form = page.getByRole("form", { name: "Add a block" });
  await expect(form.getByRole("button").first()).toBeFocused();
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "+ Add a block" })).toBeFocused();
});

test("a block needs a day; quiet hours move the day's start", async ({ page }) => {
  await seedMei(page);
  await openSettings(page);
  await page.getByRole("button", { name: "+ Add a block" }).click();
  await page.getByRole("form", { name: "Add a block" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("main").getByText("Pick at least one day.")).toBeVisible();

  const quiet = page.getByRole("region", { name: "Quiet hours" });
  await quiet.getByLabel("To").fill("07:00");
  await expect(quiet).toContainText(/No nudges between 10:00\sPM and 07:00\sAM\./); // the same format as the inputs (en-US here), not 22:00
  await expect(quiet).toContainText(/Today is rebuilt at 07:00\sAM\./);
  await page.reload();
  await openSettings(page);
  await expect(page.getByRole("region", { name: "Quiet hours" }).getByLabel("To")).toHaveValue("07:00"); // saved
});
