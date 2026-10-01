import { expect, test, type Page } from "./fixtures";

// Tech_Scope.md §4.6: Mei, Monday 2026-10-05, Asia/Singapore. Hard blocks arrive in slice 10.
test.use({ timezoneId: "Asia/Singapore" });

async function seedMei(page: Page, at = "2026-10-05T09:00:00+08:00") {
  await page.clock.install({ time: new Date(at) });
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
    localStorage.setItem("ember", JSON.stringify({ tasks, chunks, days: [], draft: "" }));
  });
  await page.reload();
}

const frog = (page: Page) => page.getByRole("region", { name: "Do this first" });
const rowTitles = (page: Page) => page.getByRole("list", { name: "Today" }).locator(".row-link > span:first-child");

test("golden: the §4.6 example renders as specified", async ({ page }) => {
  await seedMei(page);
  await expect(page.getByText("Here's today: 5 things. Good to go?")).toBeVisible();
  await expect(frog(page)).toContainText("B1");
  await expect(frog(page)).toContainText("from: Cover letter");
  await expect(rowTitles(page)).toHaveText(["C1", "C2", "A1", "A2"]);
  await expect(page.getByRole("list", { name: "Today" })).toContainText("Was due Sun");
  await expect(page.getByRole("button", { name: "1 more waiting. They'll come up when there's room." })).toBeVisible();
  await expect(page.getByText(/Light day/)).toHaveCount(0);
});

test("the morning confirm shows once a day", async ({ page }) => {
  await seedMei(page);
  await page.getByRole("button", { name: "Let's go" }).click();
  await expect(page.getByText("Here's today: 5 things. Good to go?")).toBeHidden();
  await page.reload();
  await expect(frog(page)).toBeVisible();
  await expect(page.getByText("Here's today: 5 things. Good to go?")).toHaveCount(0);
});

test("Not today: the next-ranked step fills the slot; Adjust shows it on every row", async ({ page }) => {
  await seedMei(page);
  await page.getByRole("button", { name: "More actions for C2" }).click();
  await page.locator("#row-C2").getByRole("button", { name: "Not today" }).click();
  await expect(rowTitles(page)).toHaveText(["C1", "C3", "A1", "A2"]);

  await page.reload();
  await expect(rowTitles(page)).toHaveText(["C1", "C3", "A1", "A2"]); // survives a reload
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("ember")!);
    s.days = s.days.map((d: { confirmed_at: number | null }) => ({ ...d, confirmed_at: null }));
    localStorage.setItem("ember", JSON.stringify(s));
  });
  await page.reload();
  await page.getByRole("button", { name: "Adjust" }).click();
  await page.getByRole("button", { name: "Not today: A2" }).click();
  await expect(rowTitles(page)).toHaveText(["C1", "C3", "A1", "A3"]); // A's next step takes its second slot
  await expect(page.getByRole("button", { name: "Pin a task" })).toBeVisible();
});

test("done means done: a ticked step stays, dimmed, and nothing refills", async ({ page }) => {
  await seedMei(page);
  await page.getByRole("checkbox", { name: "C1" }).check();
  await expect(rowTitles(page)).toHaveText(["C2", "A1", "A2", "C1"]); // done rows sit below open ones
  await expect(page.getByRole("checkbox", { name: "C1" })).toBeChecked();
  await expect(page.getByRole("button", { name: "1 more waiting. They'll come up when there's room." })).toBeVisible();
});

test("Pin to today takes a slot and becomes the frog", async ({ page }) => {
  await seedMei(page);
  await page.getByRole("button", { name: "Let's go" }).click();
  await page.getByRole("button", { name: "1 more waiting. They'll come up when there's room." }).click();
  await page.getByRole("region", { name: "Waiting" }).getByRole("button", { name: /System design ch\. 3/ }).click();
  await page.getByRole("button", { name: "Pin to today" }).click();
  await expect(page.getByRole("button", { name: "Pin to today" })).toHaveCount(0);
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(frog(page)).toContainText("D1");
  await expect(rowTitles(page)).toHaveText(["B1", "C1", "C2", "A1"]);
});

test("an app left open rolls over at 08:00: the new day gets its own morning confirm", async ({ page }) => {
  await seedMei(page, "2026-10-05T07:58:00+08:00"); // still Sunday's day
  await page.getByRole("button", { name: "Let's go" }).click();
  await expect(page.getByRole("button", { name: "Let's go" })).toHaveCount(0);
  await page.clock.runFor(3 * 60_000); // past 08:00; the minute re-render picks up the new day
  await expect(page.getByText("Here's today: 5 things. Good to go?")).toBeVisible();
});
