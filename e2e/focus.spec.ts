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
  await page.clock.runFor(10 * MIN);
  await page.reload(); // stands in for the phone locking and the page being discarded
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

test("a task with no steps asks for the next action, then starts", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Start Book dentist" }).click();
  const ask = page.getByRole("dialog", { name: "What's the very next physical action?" });
  await ask.getByRole("textbox").fill("Find the clinic's number");
  await ask.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Find the clinic's number" })).toBeVisible();
  await expect(timer(page)).toHaveText("25:00");
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
  const ask = page.getByRole("dialog", { name: "What's the very next physical action?" });
  await ask.getByRole("textbox").fill("Find the book");
  await ask.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Find the book" })).toBeVisible();
  const s = await stored(page);
  expect(s.tasks.find((t: { title: string }) => t.title === "Return the library book").state).toBe("inbox"); // focusing doesn't triage it
});

test("the next-action dialog starts empty each time and will not submit blank", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Start Book dentist" }).click();
  const ask = page.getByRole("dialog", { name: "What's the very next physical action?" });
  await ask.getByRole("button", { name: "Start" }).click(); // blank: the dialog stays open, nothing starts
  await expect(ask).toBeVisible();
  await ask.getByRole("textbox").fill("Find the clinic's number");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toBeHidden();
  await page.getByRole("button", { name: "Start Book dentist" }).click();
  await expect(ask.getByRole("textbox")).toHaveValue(""); // typed text did not carry over
  expect((await stored(page)).focus ?? null).toBeNull();
});
