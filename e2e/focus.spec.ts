import { expect, test, type Page } from "./fixtures";

test.use({ timezoneId: "Asia/Singapore" });

const MIN = 60_000;

// One task due today with two steps, so it's the frog; one task with no steps.
async function seed(page: Page) {
  await page.clock.install({ time: new Date("2026-10-05T09:00:00+08:00") });
  await page.goto("/");
  await page.evaluate(() => {
    const task = (id: string, title: string, o: object) => ({ id, title, state: "active", size: "S", quick: false, holding_up: false, deadline: "2026-10-05", runway_start: "2026-10-01", pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1, ...o });
    const step = (id: string, title: string, position: number) => ({ id, task_id: "B", parent_id: null, title, position, state: "todo", deleted: false, updated_at: 1 });
    const days = [{ day: "2026-10-05", confirmed_at: 1, deferred: [] }];
    localStorage.setItem("ember", JSON.stringify({ onboarded: true, nudge_offered: true, tasks: [task("B", "Cover letter", {}), task("N", "Book dentist", { deadline: "2026-10-06" })], chunks: [step("B1", "Tailor the opening", 1), step("B2", "Proofread", 2)], days, draft: "" }));
  });
  await page.reload();
}

const timer = (page: Page) => page.getByRole("timer");
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("ember")!));

test("Do this first starts a 25 on the frog; Pause holds the time", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Do this first" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tailor the opening" })).toBeVisible();
  await expect(timer(page)).toHaveText("25:00");
  await page.clock.runFor(2 * MIN);
  await expect(timer(page)).toHaveText("23:00");
  await page.getByRole("button", { name: "Pause" }).click();
  await page.clock.runFor(5 * MIN);
  await expect(timer(page)).toHaveText("23:00");
  await page.getByRole("button", { name: "Resume" }).click();
  await page.clock.runFor(MIN);
  await expect(timer(page)).toHaveText("22:00");
});

test("locking the phone mid-session loses nothing", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Do this first" }).click();
  await page.clock.pauseAt(new Date("2026-10-05T09:00:30+08:00")); // from here no timer fires on its own, as in a locked phone
  await expect(timer(page)).toHaveText(/^2[45]:\d\d$/);
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.clock.setSystemTime(new Date("2026-10-05T09:10:30+08:00")); // 10 minutes pass while locked
  await expect(timer(page)).toHaveText(/^2[45]:\d\d$/); // nothing ticked: the screen is as it was left
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(timer(page)).toHaveText(/^1[45]:\d\d$/); // unlocking shows the true time at once, with no tick needed
  await expect(page.getByRole("heading", { level: 1, name: "Tailor the opening" })).toBeVisible(); // and the session is still there
});

test("a reload mid-session loses nothing either", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Do this first" }).click();
  await page.clock.runFor(10 * MIN);
  await page.reload(); // the page was discarded while away
  await expect(page.getByRole("heading", { level: 1, name: "Tailor the opening" })).toBeVisible();
  await expect(timer(page)).toHaveText(/^1[45]:\d\d$/); // 10 minutes gone while away (plus the reload's own seconds)
});

test("the 25 ends: Take 5, a restful break, then Back to it? and Stop here logs the session", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Do this first" }).click();
  await page.clock.runFor(25 * MIN + 2000);
  await expect(page.getByRole("region", { name: "Take 5?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "I finished it" })).toBeVisible();
  await page.getByRole("button", { name: "Take 5", exact: true }).click();
  await expect(timer(page)).toHaveText("5:00");
  await expect(page.getByRole("heading", { level: 1, name: "Tailor the opening" })).toBeFocused(); // the button is gone; focus is not on the body
  await page.clock.runFor(5 * MIN + 2000);
  await expect(page.getByRole("region", { name: "Back to it?" })).toBeVisible();
  await page.getByRole("button", { name: "Stop here" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  const s = await stored(page);
  expect(s.focus).toBeNull();
  expect(s.sessions).toHaveLength(1);
  expect(s.sessions[0]).toMatchObject({ chunk_id: "B1", completed: true });
  expect(s.chunks.find((c: { id: string }) => c.id === "B1").state).toBe("todo");
});

test("Done early finishes the step; Stop for now puts it back", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Do this first" }).click();
  await page.clock.runFor(3 * MIN);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Step done." })).toBeVisible(); // Reward
  await page.getByRole("button", { name: "Skip" }).click(); // the unlock (slice 20) comes before the way on
  await page.getByRole("button", { name: "Back to Today" }).click();
  await expect(page.getByRole("checkbox", { name: "Tailor the opening" })).toBeChecked();

  await page.getByRole("button", { name: "Start Proofread" }).click();
  await page.getByRole("button", { name: "Stop for now" }).click();
  await expect(page.getByRole("checkbox", { name: "Proofread" })).not.toBeChecked(); // back in Today, still to do
  const s = await stored(page);
  expect(s.sessions.map((x: { completed: boolean }) => x.completed)).toEqual([false, false]);
});

test("a task with no steps starts straight away, on its own title as its first step", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Start Book dentist" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Book dentist" })).toBeVisible();
  await expect(timer(page)).toHaveText("25:00");
  const s = await stored(page);
  const steps = s.chunks.filter((c: { task_id: string }) => c.task_id === "N");
  expect(steps.map((c: { title: string }) => c.title)).toEqual(["Book dentist"]);
  expect(s.focus.chunk_id).toBe(steps[0].id);
});

test("peeking away mid-session: the return bar goes back to the running timer", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Do this first" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByText("Focusing on Tailor the opening")).toBeVisible();
  await page.clock.runFor(MIN);
  await page.getByRole("button", { name: "Back to focus" }).click();
  await expect(timer(page)).toHaveText("24:00");
});

test("Start in the Task view begins the first unfinished step", async ({ page }) => {
  await seed(page);
  await page.getByRole("region", { name: "Do this first" }).getByRole("button", { name: "Tailor the opening" }).click();
  await page.getByRole("checkbox", { name: "Tailor the opening" }).check(); // in the Task view's steps
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Proofread" })).toBeVisible();
});

test("an untriaged Inbox task can be started straight from its Task view", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "What's on your mind?" }).click();
  await page.getByRole("textbox", { name: "Capture a thought" }).fill("Return the library book");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await page.getByRole("button", { name: "Return the library book" }).click();
  await expect(page.getByRole("button", { name: "Pin to today" })).toHaveCount(0); // not rankable yet
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Return the library book" })).toBeVisible();
  const s = await stored(page);
  expect(s.tasks.find((t: { title: string }) => t.title === "Return the library book").state).toBe("inbox"); // focusing doesn't triage it
});

