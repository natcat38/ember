import { expect, test, type Page } from "./fixtures";

// Slice 17 (Tech_Scope.md §10): the cat's poses by trigger (UX_Flows.md §6) and where it appears (Design_Direction.md §4).
test.use({ timezoneId: "Asia/Singapore" });

const cat = (page: Page) => page.locator("svg.cat");
const animations = (page: Page) => page.evaluate(() => document.getAnimations().length);

// Two steps on one task due today, so Today has a frog. `lastSeen` is the visit before this open; `shutdown` marks today's wrap-up.
async function seed(page: Page, { lastSeen = "2026-10-05T08:30:00+08:00", shutdown = false } = {}) {
  await page.clock.install({ time: new Date("2026-10-05T09:00:00+08:00") });
  await page.goto("/");
  await page.evaluate(
    ([lastSeen, shutdown]) => {
      const task = { id: "B", title: "Cover letter", state: "active", size: "S", quick: false, holding_up: false, deadline: "2026-10-05", runway_start: "2026-10-01", pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1 };
      const step = (id: string, title: string, position: number) => ({ id, task_id: "B", parent_id: null, title, position, state: "todo", deleted: false, updated_at: 1 });
      const days = [{ day: "2026-10-05", confirmed_at: 1, deferred: [], ...(shutdown ? { shutdown_at: 2 } : {}) }];
      localStorage.setItem("ember", JSON.stringify({ tasks: [task], chunks: [step("B1", "Tailor the opening", 1), step("B2", "Proofread", 2)], days, last_seen_at: Date.parse(lastSeen as string), draft: "" }));
    },
    [lastSeen, shutdown] as const,
  );
  await page.reload();
}

test("Today: the cat watches from the nook, decorative, beside the ring", async ({ page }) => {
  await seed(page);
  await expect(cat(page)).toHaveCount(1);
  await expect(cat(page)).toHaveAttribute("data-pose", "watching");
  await expect(cat(page)).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByRole("region", { name: "Progress" }).locator("svg.cat")).toBeVisible();
  expect((await cat(page).boundingBox())?.width).toBe(72);
});

test("first open of the day: asleep, then it wakes and watches", async ({ page }) => {
  await seed(page, { lastSeen: "2026-10-04T20:00:00+08:00" });
  await expect(cat(page)).toHaveAttribute("data-pose", "asleep");
  await page.clock.runFor(2000);
  await expect(cat(page)).toHaveAttribute("data-pose", "watching");
  // Going to Inbox and back does not put it back to sleep.
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Inbox" }).click();
  await expect(cat(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(cat(page)).toHaveAttribute("data-pose", "watching");
});

test("lapse return: by the door until the first tap after the welcome back", async ({ page }) => {
  await seed(page, { lastSeen: "2026-09-28T20:00:00+08:00" });
  await expect(page.getByRole("region", { name: "Welcome back" })).toBeVisible();
  await expect(cat(page)).toHaveAttribute("data-pose", "door");
  await page.clock.runFor(2000); // the wake-up timer does not move it
  await expect(cat(page)).toHaveAttribute("data-pose", "door");
  await page.getByRole("heading", { level: 1, name: "Today" }).click();
  await expect(cat(page)).toHaveAttribute("data-pose", "watching");
});

test("after shutdown the cat stays asleep, even on a reopen", async ({ page }) => {
  await seed(page, { shutdown: true });
  await expect(cat(page)).toHaveAttribute("data-pose", "asleep");
  await page.clock.runFor(2000);
  await expect(cat(page)).toHaveAttribute("data-pose", "asleep");
});

test("Focus: the cat stretches once in the corner, then holds still", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Do this first" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tailor the opening" })).toBeVisible();
  await expect(cat(page)).toHaveCount(1);
  await expect(cat(page)).toHaveAttribute("data-pose", "stretching");
  await expect(page.locator(".cat-corner")).toHaveAttribute("aria-hidden", "true");
  await expect(cat(page)).not.toHaveCSS("animation-name", "none");
  // Under 5 s (Design_Direction.md §11, A1), and not a loop: the animation ends and nothing replaces it.
  await expect.poll(() => animations(page), { timeout: 5000 }).toBe(0);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(cat(page)).toHaveAttribute("data-pose", "watching");
});

test("Reward: the cat purrs in the 200 px circle", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Do this first" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Step done." })).toBeVisible();
  await expect(cat(page)).toHaveCount(1);
  await expect(cat(page)).toHaveAttribute("data-pose", "purring");
  await expect(page.locator(".cat-circle")).toHaveAttribute("aria-hidden", "true");
  expect((await page.locator(".cat-circle").boundingBox())?.width).toBe(200);
});

test("Shutdown: the cat falls asleep at You're done, and only there", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Wrap up the day" }).click();
  await expect(cat(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /You.re done|resting/ })).toBeVisible();
  await expect(cat(page)).toHaveAttribute("data-pose", "asleep");
  await expect(cat(page)).toHaveAttribute("aria-hidden", "true");
});

test("the cat is nowhere else: not the Task view, Inbox or Settings", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Tailor the opening" }).first().click();
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await expect(cat(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  await expect(cat(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(cat(page)).toHaveCount(0);
});

test.describe("reduced motion", () => {
  test("no element is animating: the poses are still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed(page);
    await expect(cat(page)).toHaveAttribute("data-pose", "watching");
    expect(await animations(page)).toBe(0);

    await page.getByRole("button", { name: "Do this first" }).click();
    await expect(cat(page)).toHaveAttribute("data-pose", "stretching");
    await expect(cat(page)).toHaveCSS("animation-name", "none");
    expect(await animations(page)).toBe(0);

    await page.getByRole("button", { name: "Done" }).click();
    await expect(cat(page)).toHaveAttribute("data-pose", "purring");
    expect(await animations(page)).toBe(0);
  });
});
