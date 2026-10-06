import { expect, test, type Page } from "./fixtures";

test.use({ timezoneId: "Asia/Singapore" });

const MIN = 60_000;

// The same day as focus.spec.ts: one task due today with two steps, so "Do this first" starts the frog.
async function seed(page: Page, settings: object = {}) {
  await page.clock.install({ time: new Date("2026-10-05T09:00:00+08:00") });
  await page.goto("/");
  await page.evaluate((settings) => {
    const task = (id: string, title: string, o: object) => ({ id, title, state: "active", size: "S", quick: false, holding_up: false, deadline: "2026-10-05", runway_start: "2026-10-01", pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1, ...o });
    const step = (id: string, title: string, position: number) => ({ id, task_id: "B", parent_id: null, title, position, state: "todo", deleted: false, updated_at: 1 });
    const days = [{ day: "2026-10-05", confirmed_at: 1, deferred: [] }];
    localStorage.setItem("ember", JSON.stringify({ tasks: [task("B", "Cover letter", {})], chunks: [step("B1", "Tailor the opening", 1), step("B2", "Proofread", 2)], days, draft: "", settings }));
  }, settings);
  await page.reload();
}

const timer = (page: Page) => page.getByRole("timer");
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("ember")!));
const mode = (page: Page, name: "25/5" | "Flowtime") => page.getByRole("group", { name: "Timer for this session" }).getByRole("button", { name });

test("switching to Flowtime counts up; stopping at 50 minutes offers a 10-minute break", async ({ page }) => {
  test.slow(); // replays an hour of one-second ticks, each a render: more than WebKit manages in the default 30 s
  await seed(page);
  await page.getByRole("button", { name: "Do this first" }).click();
  await expect(timer(page)).toHaveText("25:00");
  await expect(mode(page, "25/5")).toHaveAttribute("aria-pressed", "true");

  await mode(page, "Flowtime").click();
  await expect(mode(page, "Flowtime")).toHaveAttribute("aria-pressed", "true");
  await expect(timer(page)).toHaveText("0:00");
  await expect(timer(page)).toHaveAccessibleName(/worked$/);
  await page.clock.runFor(2 * MIN);
  await expect(timer(page)).toHaveText("2:00");
  await page.getByRole("button", { name: "Pause" }).click();
  await page.clock.runFor(5 * MIN);
  await expect(timer(page)).toHaveText("2:00"); // pauses are not worked time
  await page.getByRole("button", { name: "Resume" }).click();
  await page.clock.runFor(48 * MIN);
  await expect(timer(page)).toHaveText("50:00"); // past 25 minutes and still counting: there is no end

  await page.getByRole("button", { name: "Take a break" }).click();
  await expect(page.getByRole("region", { name: "Take 10 min?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "I finished it" })).toBeVisible();
  await page.getByRole("button", { name: "Take 10 min", exact: true }).click();
  await expect(timer(page)).toHaveText("10:00");
  await expect(timer(page)).toHaveAccessibleName(/of break left$/);
  await page.clock.runFor(10 * MIN + 2000);
  await expect(page.getByRole("region", { name: "Back to it?" })).toBeVisible();
  await page.getByRole("button", { name: "Stop here" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  const s = await stored(page);
  expect(s.focus).toBeNull();
  expect(s.sessions).toHaveLength(1);
  expect(s.sessions[0]).toMatchObject({ chunk_id: "B1", completed: true });
  expect((s.sessions[0].ended_at - s.sessions[0].started_at) / MIN).toBeGreaterThan(54); // 50 worked plus the 5 paused, wall clock
});

test("with timer_mode set to flowtime, Focus starts in Flowtime and Back to it stays in it", async ({ page }) => {
  await seed(page, { timer_mode: "flowtime" });
  await page.getByRole("button", { name: "Do this first" }).click();
  await expect(mode(page, "Flowtime")).toHaveAttribute("aria-pressed", "true");
  await expect(timer(page)).toHaveText("0:00");
  await page.clock.runFor(30 * MIN);
  await page.getByRole("button", { name: "Take a break" }).click();
  await expect(page.getByRole("region", { name: "Take 6 min?" })).toBeVisible();
  await page.getByRole("button", { name: "Skip break" }).click();
  await expect(timer(page)).toHaveText("0:00"); // another Flowtime session, not a 25
});

test("the switch can go back to 25/5, and is gone once the session is a minute old", async ({ page }) => {
  await seed(page, { timer_mode: "flowtime" });
  await page.getByRole("button", { name: "Do this first" }).click();
  await mode(page, "25/5").click();
  await expect(timer(page)).toHaveText("25:00");
  await expect(timer(page)).toHaveAccessibleName(/left$/);
  await expect(page.getByRole("button", { name: "Take a break" })).toHaveCount(0); // that button is Flowtime's
  await page.clock.runFor(2 * MIN);
  await expect(timer(page)).toHaveText("23:00");
  await expect(page.getByRole("group", { name: "Timer for this session" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pause" })).toBeFocused(); // the chip it stood on is gone, so focus lands here
});

test("Flowtime: Done goes to Reward and Stop for now returns to Today, with the time logged", async ({ page }) => {
  await seed(page, { timer_mode: "flowtime" });
  await page.getByRole("button", { name: "Do this first" }).click();
  await page.clock.runFor(3 * MIN);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Step done." })).toBeVisible();
  await page.getByRole("button", { name: "Back to Today" }).click();

  await page.getByRole("button", { name: "Start Proofread" }).click();
  await page.clock.runFor(4 * MIN);
  await page.getByRole("button", { name: "Stop for now" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  const s = await stored(page);
  expect(s.sessions.map((x: { chunk_id: string; completed: boolean; ended_at: number; started_at: number }) => [x.chunk_id, x.completed, Math.round((x.ended_at - x.started_at) / MIN)])).toEqual([
    ["B1", false, 3],
    ["B2", false, 4],
  ]);
});
