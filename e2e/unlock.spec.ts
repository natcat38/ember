import { expect, test, type Page } from "./fixtures";

// Slice 20: the 90-second unlock on Reward, with the three feeds stubbed (Tech_Scope.md §10, UX_Flows.md §3.6).
test.use({ timezoneId: "Asia/Singapore" });

const SEC = 1000;
const FRAME = "**/lichess.org/training/frame*";
const TRIVIA = "**/opentdb.com/api.php*";
const FACT = "**/api.wikimedia.org/feed/v1/wikipedia/en/onthisday/selected/**";

// One task due today with two steps, so Focus → Done gives a Reward with a next step. `unlock` is the Settings choice.
async function seed(page: Page, unlock: string) {
  await page.clock.install({ time: new Date("2026-10-05T09:00:00+08:00") });
  await page.goto("/");
  await page.evaluate((unlock) => {
    const task = (id: string, title: string, o: object) => ({ id, title, state: "active", size: "S", quick: false, holding_up: false, deadline: "2026-10-05", runway_start: "2026-10-01", pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1, ...o });
    const step = (id: string, title: string, position: number) => ({ id, task_id: "B", parent_id: null, title, position, state: "todo", deleted: false, updated_at: 1 });
    const days = [{ day: "2026-10-05", confirmed_at: 1, deferred: [] }];
    const settings = { tz: null, quiet_start: 1320, quiet_end: 480, timer_mode: "pomodoro", unlock, journal_key: null };
    localStorage.setItem("ember", JSON.stringify({ tasks: [task("B", "Cover letter", {})], chunks: [step("B1", "Tailor the opening", 1), step("B2", "Proofread", 2)], days, draft: "", settings }));
  }, unlock);
  await page.reload();
}

async function stubFeeds(page: Page) {
  await page.route(TRIVIA, (route) =>
    route.fulfill({
      json: { response_code: 0, results: [{ question: "Which%20planet%20is%20known%20as%20the%20Red%20Planet%3F", correct_answer: "Mars", incorrect_answers: ["Venus", "Jupiter", "Saturn"] }] },
    }),
  );
  await page.route(FACT, (route) =>
    route.fulfill({ json: { selected: [{ text: "Apollo 11 lands on the Moon.", year: 1969, pages: [{ content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Apollo_11" } } }] }] } }),
  );
  await page.route(FRAME, (route) => route.fulfill({ contentType: "text/html", body: "<p>A puzzle</p>" }));
}

// Focus on the first step, then Done: the Reward, with the unlock offered.
async function finishInFocus(page: Page) {
  await page.getByRole("button", { name: "Do this first" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Step done. Ninety seconds, if you want it." })).toBeVisible();
}

const nextStep = (page: Page) => page.getByRole("button", { name: "Next step" });

test("a step finished in Focus offers the unlock named for the kind, and Skip goes to the next step", async ({ page }) => {
  await stubFeeds(page);
  await seed(page, "trivia");
  await finishInFocus(page);
  await expect(page.getByRole("button", { name: "Answer a trivia question" })).toBeVisible();
  await expect(nextStep(page)).toHaveCount(0); // the unlock comes first
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Step done." })).toBeFocused();
  await expect(nextStep(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Today" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Answer a trivia question" })).toHaveCount(0);
});

test("trivia: one question, four answers, right or wrong is shown, and the next step waits for the 90 seconds", async ({ page }) => {
  let asked = 0;
  await stubFeeds(page);
  await page.route(TRIVIA, (route) => {
    asked++;
    return route.fallback();
  });
  await seed(page, "trivia");
  await finishInFocus(page);
  expect(asked).toBe(0); // fetched when the button is tapped, not before
  await page.getByRole("button", { name: "Answer a trivia question" }).click();
  await expect(page.getByText("Which planet is known as the Red Planet?")).toBeVisible();
  const answers = page.getByRole("group", { name: "Answers" }).getByRole("button");
  await expect(answers).toHaveCount(4);
  await answers.filter({ hasText: "Venus" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Not quite. It was Mars." })).toBeVisible();
  await expect(answers.first()).toBeDisabled(); // one answer, done
  expect(asked).toBe(1);

  await page.clock.runFor(85 * SEC);
  await expect(nextStep(page)).toHaveCount(0);
  await page.clock.runFor(10 * SEC);
  await expect(nextStep(page)).toBeVisible(); // under the unlock, which has not closed
  await expect(page.getByText("Which planet is known as the Red Planet?")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Which planet is known as the Red Planet?")).toHaveCount(0);
  await expect(nextStep(page)).toBeVisible();
});

test("trivia: the right answer says so, and the text goes in as text", async ({ page }) => {
  await stubFeeds(page);
  await page.route(TRIVIA, (route) =>
    route.fulfill({ json: { response_code: 0, results: [{ question: "Which%20tag%20is%20%3Cb%3Ebold%3C%2Fb%3E%3F", correct_answer: "%3Cb%3E", incorrect_answers: ["%3Ci%3E", "%3Cu%3E", "%3Cp%3E"] }] } }),
  );
  await seed(page, "trivia");
  await finishInFocus(page);
  await page.getByRole("button", { name: "Answer a trivia question" }).click();
  await expect(page.getByText("Which tag is <b>bold</b>?")).toBeVisible();
  await page.getByRole("group", { name: "Answers" }).getByRole("button", { name: "<b>" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Right." })).toBeVisible();
  await expect(page.locator(".unlock b")).toHaveCount(0);
});

test("puzzle: the Lichess frame, titled, fits 375 px, and Done goes to the next step", async ({ page }) => {
  await stubFeeds(page);
  await seed(page, "puzzle");
  await finishInFocus(page);
  await expect(page.getByRole("button", { name: "Try today's chess puzzle" })).toBeVisible();
  await page.getByRole("button", { name: "Try today's chess puzzle" }).click();
  const frame = page.locator("iframe");
  await expect(frame).toHaveAttribute("title", "Lichess daily puzzle");
  await expect(frame).toHaveAttribute("src", "https://lichess.org/training/frame?theme=brown&bg=light");
  const box = (await frame.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  await expect(nextStep(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(nextStep(page)).toBeVisible();
});

test("fact: one event with its year, and a Wikipedia link that opens in a new tab", async ({ page }) => {
  const asked: string[] = [];
  await stubFeeds(page);
  await page.route(FACT, (route) => {
    asked.push(new URL(route.request().url()).pathname);
    return route.fallback();
  });
  await seed(page, "fact");
  await finishInFocus(page);
  await page.getByRole("button", { name: "See what happened on this day" }).click();
  await expect(page.getByText("Apollo 11 lands on the Moon.")).toBeVisible();
  await expect(page.getByText("1969")).toBeVisible();
  const link = page.getByRole("link", { name: "Read more on Wikipedia" });
  await expect(link).toHaveAttribute("href", "https://en.wikipedia.org/wiki/Apollo_11");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener");
  expect(asked).toEqual(["/feed/v1/wikipedia/en/onthisday/selected/10/05"]); // today's local date
  await page.getByRole("button", { name: "Done" }).click();
  await expect(nextStep(page)).toBeVisible();
});

test("the bar fills by transform only; under reduced motion it is hidden and the label stays", async ({ page }) => {
  await stubFeeds(page);
  await seed(page, "fact");
  await finishInFocus(page);
  await page.getByRole("button", { name: "See what happened on this day" }).click();
  await expect(page.locator(".unlock-bar-fill")).toHaveCSS("animation-name", "unlock-fill");
  await expect(page.locator(".unlock-bar-fill")).toHaveCSS("animation-duration", "90s");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".unlock-bar")).toBeHidden();
  await expect(page.locator(".unlock-bar-fill")).toHaveCSS("animation-name", "none");
  await expect(page.getByText("Take about ninety seconds.")).toBeVisible();
});

test("rotate: trivia first, then the puzzle on the next step, and the position stays on this device", async ({ page }) => {
  await stubFeeds(page);
  await seed(page, "rotate");
  await finishInFocus(page);
  await expect(page.getByRole("button", { name: "Answer a trivia question" })).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();
  await nextStep(page).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Try today's chess puzzle" })).toBeVisible();
  const mem = await page.evaluate(() => JSON.parse(localStorage.getItem("ember.unlock")!));
  expect(mem).toEqual({ last: "puzzle", puzzleDay: "2026-10-05" });
  expect(await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("ember")!).settings))).not.toContain("puzzleDay");
});

test("a check-off in Today or the Task view shows no unlock card", async ({ page }) => {
  await stubFeeds(page);
  await seed(page, "trivia");
  const noCard = async () => {
    await expect(page.getByText("Ninety seconds, if you want it.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Answer a trivia question" })).toHaveCount(0);
  };
  await page.getByRole("checkbox", { name: "Proofread" }).check(); // a row in Today
  await expect(page.getByRole("checkbox", { name: "Proofread" })).toBeChecked();
  await noCard();
  await page.getByRole("region", { name: "Do this first" }).getByRole("button", { name: "Tailor the opening" }).click();
  await page.getByRole("checkbox", { name: "Tailor the opening" }).check(); // in the Task view's steps
  await expect(page.getByRole("checkbox", { name: "Tailor the opening" })).toBeChecked();
  await noCard();
});

test("a failed fetch says so once, with Skip, and does not retry", async ({ page }) => {
  let asked = 0;
  await stubFeeds(page);
  await page.route(TRIVIA, (route) => {
    asked++;
    return route.abort();
  });
  await seed(page, "trivia");
  await finishInFocus(page);
  await page.getByRole("button", { name: "Answer a trivia question" }).click();
  await expect(page.getByText("That didn't load. Skip it this time.")).toBeVisible();
  await expect(nextStep(page)).toHaveCount(0);
  await page.clock.runFor(100 * SEC);
  expect(asked).toBe(1);
  await expect(nextStep(page)).toHaveCount(0); // no 90 seconds for something that never showed
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(nextStep(page)).toBeVisible();
});

test("an error from the feed counts as a failure too", async ({ page }) => {
  await stubFeeds(page);
  await page.route(FACT, (route) => route.fulfill({ status: 503, body: "down" }));
  await seed(page, "fact");
  await finishInFocus(page);
  await page.getByRole("button", { name: "See what happened on this day" }).click();
  await expect(page.getByText("That didn't load. Skip it this time.")).toBeVisible();
});
