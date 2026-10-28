import { expect, test, type Page } from "./fixtures";

// Seed one task straight into storage and open its Task view.
async function openTask(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    const t = { id: "t1", title: "Revise DSA basics", state: "active", size: "M", quick: false, holding_up: false, deadline: null, runway_start: null, pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1 };
    localStorage.setItem("ember", JSON.stringify({ tasks: [t], chunks: [], draft: "" }));
  });
  await page.reload();
  await page.getByRole("button", { name: "Sort a few from Inbox" }).click();
  await page.getByRole("button", { name: /Revise DSA basics/ }).click();
}

const nextAction = (page: Page) => page.getByRole("textbox", { name: "What's the very next physical action?" });
const stepTitles = (page: Page) => page.locator(".step-title");

async function addSteps(page: Page, ...titles: string[]) {
  for (const t of titles) {
    await nextAction(page).fill(t);
    await nextAction(page).press("Enter");
  }
}

async function stepMenu(page: Page, title: string, item: string) {
  await page.getByRole("button", { name: `More actions for ${title}`, exact: true }).click();
  await page.getByRole("dialog", { name: `Actions for ${title}` }).getByRole("button", { name: item, exact: true }).click();
}

test("manual steps: Enter adds to the bottom, clears, stays ready; empty is ignored", async ({ page }) => {
  await openTask(page);
  await addSteps(page, "Read heaps intro", "Outline heaps chapter");
  await expect(nextAction(page)).toHaveValue("");
  await expect(nextAction(page)).toBeFocused();
  await nextAction(page).press("Enter");
  await page.getByRole("button", { name: "Add step" }).click();
  await expect(stepTitles(page)).toHaveText(["Read heaps intro", "Outline heaps chapter"]);
  await page.reload();
  await page.getByRole("button", { name: "Sort a few from Inbox" }).click();
  await page.getByRole("button", { name: /Revise DSA basics/ }).click();
  await expect(stepTitles(page)).toHaveText(["Read heaps intro", "Outline heaps chapter"]);
});

test("split once; the parent ticks itself; ticking the parent finishes the rest and unticking restores them", async ({ page }) => {
  await openTask(page);
  await addSteps(page, "Outline heaps chapter");
  await stepMenu(page, "Outline heaps chapter", "Break this step down");

  const smaller = page.getByRole("textbox", { name: "Add a smaller step to Outline heaps chapter" });
  await expect(smaller).toBeFocused();
  for (const t of ["Open notes doc", "List 5 heap ops"]) {
    await smaller.fill(t);
    await smaller.press("Enter");
  }
  const group = page.getByRole("group", { name: "Smaller steps of Outline heaps chapter" });
  await expect(group.locator(".step-title")).toHaveText(["Open notes doc", "List 5 heap ops"]);

  // Rule 6: no third level.
  await page.getByRole("button", { name: "More actions for Open notes doc" }).click();
  await expect(page.getByRole("dialog", { name: "Actions for Open notes doc" }).getByRole("button", { name: "Break this step down" })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel" }).click();

  const parent = page.getByRole("checkbox", { name: "Outline heaps chapter" });
  await page.getByRole("checkbox", { name: "Open notes doc" }).check();
  await expect(parent).not.toBeChecked();
  await page.getByRole("checkbox", { name: "List 5 heap ops" }).check();
  await expect(parent).toBeChecked(); // rule 2: ticks itself

  await page.getByRole("checkbox", { name: "List 5 heap ops" }).uncheck();
  await parent.check(); // by hand: finishes the remaining one
  await expect(page.getByRole("checkbox", { name: "List 5 heap ops" })).toBeChecked();
  await parent.uncheck(); // straight away: only what the parent finished comes back
  await expect(page.getByRole("checkbox", { name: "List 5 heap ops" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Open notes doc" })).toBeChecked();
});

test("below 480 px the step's play button gives way to the title; Start this step in the menu still runs it", async ({ page }) => {
  await openTask(page);
  await addSteps(page, "Paste the job description next to the draft");
  await expect(page.getByRole("button", { name: "Start Paste the job description next to the draft" })).toBeHidden();
  expect((await stepTitles(page).boundingBox())!.width).toBeGreaterThan(190); // 178 px at 390 with the play button, 207 at 375 without
  await page.setViewportSize({ width: 600, height: 812 });
  await expect(page.getByRole("button", { name: "Start Paste the job description next to the draft" })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await stepMenu(page, "Paste the job description next to the draft", "Start this step");
  await expect(page.getByRole("heading", { level: 1, name: "Paste the job description next to the draft" })).toBeVisible();
});

test("Move up / Move down, and a parent moves with its group", async ({ page }) => {
  await openTask(page);
  await addSteps(page, "A", "B", "C");
  await stepMenu(page, "B", "Break this step down");
  await page.getByRole("textbox", { name: "Add a smaller step to B" }).fill("B1");
  await page.getByRole("textbox", { name: "Add a smaller step to B" }).press("Enter");
  await stepMenu(page, "B", "Move up");
  await expect(stepTitles(page)).toHaveText(["B", "B1", "A", "C"]);
  await stepMenu(page, "A", "Move down");
  await expect(stepTitles(page)).toHaveText(["B", "B1", "C", "A"]);
});

// The grip handle (Natalie, 2026-10-07, after the shadcn/dnd-kit sortable list): it drags at once, no hold; the rows it
// passes slide aside while the finger is still down; the rest of the row is left to scroll and tap.
// A row that has slid up to make room for the one being dragged past it.
const slidUp = (page: Page, title: string) => expect(page.locator("li", { has: page.locator(".step-title", { hasText: title }) })).toHaveAttribute("style", /translate3d\(0px?, -/);
const centre = async (page: Page, title: string, what: "grip" | "title") => {
  const b = (await (what === "grip" ? page.getByRole("button", { name: `Reorder ${title}` }) : page.locator(".step-title", { hasText: title })).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test("touch: the grip drags at once and the others make room; a swipe on the row does nothing", async ({ page, context }) => {
  test.skip(test.info().project.name !== "chromium", "touch is driven through the Chromium DevTools protocol");
  await openTask(page);
  await addSteps(page, "A", "B", "C");
  const cdp = await context.newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", p = { x: 0, y: 0 }) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [p] });

  const title = await centre(page, "A", "title"); // the row body is not a handle
  await touch("touchStart", title);
  await touch("touchMove", { ...title, y: title.y + 60 });
  await touch("touchEnd");
  await expect(stepTitles(page)).toHaveText(["A", "B", "C"]);

  const from = await centre(page, "A", "grip");
  const to = await centre(page, "C", "grip");
  await touch("touchStart", from);
  for (let i = 1; i <= 8; i++) await touch("touchMove", { x: from.x, y: from.y + ((to.y + 10 - from.y) * i) / 8 }); // no hold first
  await expect(page.locator("li.dragging")).toHaveCSS("opacity", "0.5");
  await slidUp(page, "B"); // before the drop
  await slidUp(page, "C");
  await touch("touchEnd");
  await expect(stepTitles(page)).toHaveText(["B", "C", "A"]);
});

test("every grip is the same 44 px target in the same place, so the rows line up", async ({ page }) => {
  await openTask(page);
  await addSteps(page, "A short one", "A much longer step title that wraps", "Mid");
  const boxes = await page.locator(".grip").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.x, r.width]));
  expect(boxes).toEqual([boxes[0], boxes[0], boxes[0]]);
  expect(boxes[0][1]).toBe(44);
});

test("drag with a mouse on the grip reorders", async ({ page }) => {
  await openTask(page);
  await addSteps(page, "A", "B", "C");
  const from = await centre(page, "A", "grip");
  const to = await centre(page, "C", "grip");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, to.y + 10, { steps: 8 });
  await slidUp(page, "C"); // a hand pauses over the spot before letting go
  await page.mouse.up();
  await expect(stepTitles(page)).toHaveText(["B", "C", "A"]);
});

test("the keyboard reorders from the grip: Space lifts, arrows move, Space drops", async ({ page }) => {
  await openTask(page);
  await addSteps(page, "A", "B", "C");
  await page.getByRole("button", { name: "Reorder A" }).focus();
  await page.keyboard.press("Space");
  await expect(page.locator("li.dragging")).toHaveCount(1); // lifted
  await page.waitForTimeout(100); // dnd-kit listens for arrows a tick after the lift; no person presses sooner
  await page.keyboard.press("ArrowDown");
  await slidUp(page, "B");
  await page.keyboard.press("ArrowDown");
  await slidUp(page, "C");
  await page.keyboard.press("Space");
  await expect(stepTitles(page)).toHaveText(["B", "C", "A"]);
});

test("deleting a parent asks first; deleting the last smaller step makes it plain again", async ({ page }) => {
  await openTask(page);
  await addSteps(page, "Outline");
  await stepMenu(page, "Outline", "Break this step down");
  const smaller = page.getByRole("textbox", { name: "Add a smaller step to Outline" });
  for (const t of ["O1", "O2"]) {
    await smaller.fill(t);
    await smaller.press("Enter");
  }

  await stepMenu(page, "Outline", "Delete step");
  const prompt = page.getByRole("alertdialog", { name: "Delete this step and its 2 smaller steps?" });
  await expect(prompt.getByRole("button", { name: "Keep it" })).toBeFocused();
  await prompt.getByRole("button", { name: "Keep it" }).click();
  await expect(stepTitles(page)).toHaveText(["Outline", "O1", "O2"]);

  await stepMenu(page, "O1", "Delete step");
  await expect(page.getByRole("checkbox", { name: "O2" })).toBeFocused(); // focus moves to the next step, not the page body
  await stepMenu(page, "O2", "Delete step");
  await expect(stepTitles(page)).toHaveText(["Outline"]);
  await expect(page.getByRole("checkbox", { name: "Outline" })).toBeFocused(); // the last smaller step: its parent
  await page.getByRole("button", { name: "More actions for Outline" }).click();
  await expect(page.getByRole("dialog", { name: "Actions for Outline" }).getByRole("button", { name: "Break this step down" })).toBeVisible();
  await page.getByRole("button", { name: "Delete step" }).click();
  await expect(stepTitles(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Steps" })).toBeFocused(); // nothing left to land on: the section heading
});

test("opening a task never steals focus from a field the user already moved to", async ({ page }) => {
  await openTask(page);
  await page.getByRole("button", { name: "Back" }).click();
  // Open the task and focus the step field before the navigation's focus frame comes round
  // (React renders in a microtask after the click; the frame comes later).
  const stolen = await page.evaluate(async () => {
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Revise DSA basics"))!.click();
    for (let i = 0; i < 20 && !document.querySelector(".step-field"); i++) await Promise.resolve();
    const field = document.querySelector<HTMLInputElement>(".step-field")!;
    field.focus();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // let the navigation's frame run
    return document.activeElement !== field;
  });
  expect(stolen).toBe(false);
  await page.waitForTimeout(100);
  await expect(nextAction(page)).toBeFocused();
});

// Verify finding 1: the empty "Add a smaller step" field used to unmount the moment it lost focus, so the rows below it
// jumped up and the tap that caused the blur landed on nothing. It now goes only once that tap has been delivered.
test("tapping a row below the empty smaller-step field opens that row's menu on the first tap", async ({ page }) => {
  await openTask(page);
  await addSteps(page, "A", "B", "C");
  await stepMenu(page, "A", "Break this step down");
  const smaller = page.getByRole("textbox", { name: "Add a smaller step to A" });
  await expect(smaller).toBeFocused();
  await expect(smaller).toHaveValue("");

  await page.getByRole("button", { name: "More actions for C", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Actions for C" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(smaller).toHaveCount(0); // the empty field still goes, just after the tap
});

test("an empty smaller-step field with text typed in it stays, and a keyboard exit collapses it on the next key", async ({ page }) => {
  await openTask(page);
  await addSteps(page, "A", "B");
  await stepMenu(page, "A", "Break this step down");
  const smaller = page.getByRole("textbox", { name: "Add a smaller step to A" });
  await smaller.fill("half typed");
  await page.getByRole("heading", { name: "Steps" }).click();
  await expect(smaller).toHaveValue("half typed"); // never lose typed text

  await smaller.fill("");
  await smaller.press("Tab"); // leaves it empty by keyboard: nothing has been pressed since
  await expect(smaller).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(smaller).toHaveCount(0);
});
