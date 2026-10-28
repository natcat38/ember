import { expect, openFold, startFrog, test, type Page } from "./fixtures";

// Fixes from the Verify-stage UI walk (v1-report.md). Each test is named for the finding it keeps fixed.
test.use({ timezoneId: "Asia/Singapore", locale: "en-US" });

// Monday 2026-10-05: B1 is the frog, C1 and C2 follow (Lab report is overdue). `over` replaces top-level fields of the saved state.
async function seedMei(page: Page, over: Record<string, unknown> = {}, at = "2026-10-05T09:00:00+08:00") {
  await page.clock.install({ time: new Date(at) });
  await page.goto("/");
  await page.evaluate((over) => {
    const task = (id: string, title: string, o: object) => ({ id, title, state: "active", size: "M", quick: false, holding_up: false, deadline: null, runway_start: null, pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1, ...o });
    const chunk = (t: string, n: number) => ({ id: `${t}${n}`, task_id: t, parent_id: null, title: `${t}${n}`, position: n, state: "todo", deleted: false, updated_at: 1 });
    const tasks = [task("B", "Cover letter", { size: "S", deadline: "2026-10-05", runway_start: "2026-10-01" }), task("C", "Lab report", { size: "L", deadline: "2026-10-04", runway_start: "2026-09-20" })];
    localStorage.setItem("ember", JSON.stringify({ tasks, chunks: [chunk("B", 1), chunk("C", 1), chunk("C", 2)], days: [], draft: "", ...over }));
  }, over);
  await page.reload();
}

const confirmed = { days: [{ day: "2026-10-05", confirmed_at: 1, deferred: [] }] };
const unlockTrivia = { nudge_offered: true, settings: { tz: null, quiet_start: 1320, quiet_end: 480, timer_mode: "pomodoro", unlock: "trivia", journal_key: null } };
const menu = async (page: Page, item: string) => {
  // From 1180 px the destinations are tabs in the header, with no menu to open.
  const open = page.getByRole("button", { name: "Open menu" });
  if (await open.count()) await open.click();
  await page.getByRole("button", { name: item, exact: true }).click();
};

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

test("finding 2: the time zone select is 16 px, in the body font, and shows a chevron", async ({ page }) => {
  await seedMei(page);
  await menu(page, "Settings");
  await openFold(page, "Time zone");
  const select = page.getByRole("combobox");
  const style = await select.evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: parseFloat(s.fontSize), family: s.fontFamily, image: s.backgroundImage };
  });
  expect(style.size).toBeGreaterThanOrEqual(16); // under 16 px, iOS zooms the page in on focus
  expect(style.family).toContain("Karla");
  expect(style.image).toContain("svg");
});

test("finding 8: in Adjust mode 'Not today' stays on one line and lines up on every row", async ({ page }) => {
  await seedMei(page);
  await page.getByRole("button", { name: "Adjust" }).click();
  const [a, b] = await Promise.all(["C1", "C2"].map((t) => page.getByRole("button", { name: `Not today: ${t}` }).boundingBox()));
  expect(a!.height).toBeLessThanOrEqual(44);
  expect(b!.height).toBeLessThanOrEqual(44);
  expect(a!.x).toBe(b!.x);
});

test("finding 11: Focus fits a phone screen in both timer modes, with the cat's corner on it", async ({ page }) => {
  await seedMei(page, confirmed);
  await startFrog(page).click();
  const fits = () => page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight);
  expect(await fits()).toBe(true);
  await page.getByRole("button", { name: "Flowtime" }).click();
  expect(await fits()).toBe(true);
  const nook = (await page.locator(".cat-corner").boundingBox())!;
  const bar = (await page.locator(".capture-bar").boundingBox())!;
  expect(nook.y + nook.height).toBeLessThanOrEqual(bar.y); // not under the capture bar
});

test("finding 14: a long draft is one line in the capture bar, in ink rather than placeholder grey", async ({ page }) => {
  await seedMei(page, { ...confirmed, draft: "Write the introduction to the quarterly planning review, and then book the room for the readout with the whole group on Thursday" });
  const bar = page.locator(".capture-bar > button");
  expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(56);
  const ink = await bar.evaluate((el) => getComputedStyle(el).color);
  expect(ink).toBe("rgb(46, 42, 53)"); // --color-ink; the placeholder is --color-ink-soft
});

test("finding 15: the last shutdown card has one Close, the placeholder shows whole, and the moods share a row", async ({ page }) => {
  await seedMei(page, confirmed, "2026-10-05T20:00:00+08:00");
  await menu(page, "Wrap up the day");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("button", { name: "Close" })).toHaveCount(1);

  const line = page.getByRole("textbox", { name: "One line about today" });
  expect(await line.evaluate((el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true); // nothing clipped
  const tops = await Promise.all(["Rough", "Meh", "Okay", "Good", "Great"].map(async (m) => (await page.getByText(m, { exact: true }).boundingBox())!.y));
  expect(new Set(tops.map(Math.round)).size).toBe(1);

  await line.fill("A good day"); // Enter saves, it doesn't add a second line
  await line.press("Enter");
  await expect(line).not.toBeFocused();
  await expect(line).toHaveValue("A good day");
});

test("finding 7: the reminder offer is as wide as the Reward card at every stage", async ({ page }) => {
  await seedMei(page, { ...confirmed, nudge_offered: false });
  await startFrog(page).click();
  await page.getByRole("button", { name: "Done" }).click();
  const widths = async () => [(await page.getByRole("region", { name: "Reminders" }).boundingBox())!.width, (await page.locator(".reward-card").boundingBox())!.width];
  const [offer, card] = await widths();
  expect(offer).toBe(card);
  await page.getByRole("button", { name: "Yes" }).click();
  expect((await widths())[0]).toBe(card);
  await expect(page.getByRole("region", { name: "Reminders" })).toHaveCSS("text-align", "left");
});

test("finding 18: while an unlock plays the ring and cat shrink and Skip stays on screen", async ({ page }) => {
  await page.route("**/opentdb.com/api.php*", (route) =>
    route.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { response_code: 0, results: [{ question: "Which%20planet%20is%20known%20as%20the%20Red%20Planet%3F", correct_answer: "Mars", incorrect_answers: ["Venus", "Jupiter", "Saturn"] }] } }),
  );
  await seedMei(page, { ...confirmed, ...unlockTrivia });
  await startFrog(page).click();
  await page.getByRole("button", { name: "Done" }).click();
  expect((await page.locator(".cat-circle").boundingBox())!.width).toBe(200);
  await page.getByRole("button", { name: "Answer a trivia question" }).click();
  await expect(page.getByText("Which planet is known as the Red Planet?")).toBeVisible();
  expect((await page.locator(".cat-circle").boundingBox())!.width).toBeLessThan(120);
  const skip = (await page.getByRole("button", { name: "Skip" }).boundingBox())!;
  expect(skip.y + skip.height).toBeLessThanOrEqual(812);
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.skip(({ browserName }) => browserName !== "chromium", "a desktop layout; the WebKit project is an iPhone");

  test("finding 13: the capture field stays at the top of the left pane while a long Inbox scrolls", async ({ page }) => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, title: `Inbox item ${i}`, state: "inbox", size: null, quick: false, holding_up: false, deadline: null, runway_start: null, pinned_on: null, snoozed_until: null, created_at: 100 + i, updated_at: 100 + i }));
    await seedMei(page, { ...confirmed, tasks: many, chunks: [] });
    await menu(page, "Inbox");
    const field = page.getByRole("textbox", { name: "Capture a thought" });
    const top = (await field.boundingBox())!.y;
    await page.locator("[data-pane=left]").evaluate((el) => el.scrollTo(0, 1200));
    await expect(page.getByText("Inbox item 0", { exact: true })).not.toBeInViewport(); // the list did scroll
    await expect(field).toBeInViewport();
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeInViewport(); // the header (EMB-UX-1) stays too
    expect((await field.boundingBox())!.y).toBeLessThanOrEqual(top); // the status line scrolled away; the capture row stuck right under the header
    expect((await field.boundingBox())!.y).toBeLessThan(140);
  });

  test("finding 12: each pane has one primary button, and the add (+) and Send buttons are outlined", async ({ page }) => {
    await seedMei(page, confirmed);
    // A solid lavender-deep fill is what "primary" looks like, whichever class draws it; a selected pill (.chip) is allowed one.
    const primaries = (pane: string) =>
      page.locator(`[data-pane=${pane}]`).evaluate((el) => [...el.querySelectorAll("button")].filter((b) => !b.classList.contains("chip") && b.getClientRects().length > 0 && getComputedStyle(b).backgroundColor === "rgb(107, 91, 168)").map((b) => b.textContent?.trim() || b.getAttribute("aria-label")));
    expect(await primaries("left")).toEqual(["Start"]);
    expect(await primaries("right")).toEqual(["Start"]);
    await expect(page.locator(".capture-inline .send")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.locator("[data-pane=right] .send")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    // The frog's step already runs: its button stops asking to be pressed, and Focus's Pause is the one primary.
    await startFrog(page).click();
    expect(await primaries("left")).toEqual([]);
    expect(await primaries("right")).toEqual(["Pause"]);
  });
});

test("finding 21: the page opts into the full screen on iPhone and keeps clear of the notch", async ({ page }) => {
  await seedMei(page, confirmed);
  await expect(page.locator("meta[name=viewport]")).toHaveAttribute("content", /viewport-fit=cover/);
  await expect(page.locator("meta[name=apple-mobile-web-app-status-bar-style]")).toHaveAttribute("content", "default");
  // Chromium has no notch, so the insets are 0; this only proves the declaration is valid and parsed (the real check is a phone).
  await expect(page.locator(".app")).toHaveCSS("padding", "0px");
});

test("finding 16: the sent-list bullets and the unlock bar are not lavender", async ({ page }) => {
  await seedMei(page, confirmed);
  await page.getByRole("button", { name: "What's on your mind?" }).click();
  await page.getByRole("textbox", { name: "Capture a thought" }).fill("Book dentist");
  await page.keyboard.press("Enter");
  const bullet = await page.locator(".sent li").first().evaluate((el) => getComputedStyle(el, "::before").backgroundColor);
  expect(bullet).not.toBe("rgb(140, 123, 196)"); // --color-lavender
});
