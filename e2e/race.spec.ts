import { expect, test, type Page } from "./fixtures";

// Slice 9 done-when: two devices editing offline converge as Tech_Scope.md §5 says. The server refuses an illegal
// change (nothing leaves Done), and the device that made it shows the server's version and says why.
test.describe("two devices", () => {
  test.use({ online: true, timezoneId: "Asia/Singapore" });

  const NOW = new Date("2026-10-05T20:00:00+08:00");
  const settled = (page: Page) =>
    page.waitForFunction(() => {
      const m = JSON.parse(localStorage.getItem("ember.sync") ?? "{}");
      return m.uploaded && m.outbox?.length === 0;
    });

  test("A finishes a task; B's stale edit is refused and B shows Done", async ({ page: a, browser }) => {
    await a.clock.install({ time: NOW });
    await a.goto("/");
    await a.getByRole("button", { name: "What's on your mind?" }).click();
    await a.getByRole("button", { name: "Deadline" }).waitFor();
    await a.locator("input[type=date]").first().fill("2026-10-05"); // due today
    await a.getByRole("textbox", { name: "Capture a thought" }).fill("Race");
    await a.keyboard.press("Enter");
    await a.getByRole("button", { name: "Close" }).click();
    await a.clock.runFor(3000);
    await settled(a);

    // Device B: the same identity (as a passkey or Telegram link would give it), with its own storage.
    const ctxB = await browser.newContext({ timezoneId: "Asia/Singapore" });
    await ctxB.addCookies((await a.context().cookies()).filter((c) => c.name === "ember_uid"));
    const b = await ctxB.newPage();
    await b.clock.install({ time: NOW });
    await b.goto("/");
    await b.getByRole("button", { name: "Sort a few from Inbox" }).click();
    await expect(b.getByRole("region", { name: "Needs sorting" })).toContainText("Race");

    // A sorts it (Inbox → Active) and marks it done in the evening wrap-up; B still holds the Inbox copy.
    await a.getByRole("button", { name: "Sort a few from Inbox" }).click();
    await a.getByRole("button", { name: /Race/ }).click();
    await a.getByRole("group", { name: "Size" }).getByRole("button", { name: "S", exact: true }).click();
    await a.getByRole("button", { name: "Back" }).click();
    await a.getByRole("button", { name: "Open menu" }).click();
    await a.getByRole("button", { name: "Wrap up the day" }).click();
    await a.getByRole("list", { name: "Still open" }).getByRole("button", { name: "Done" }).click();
    await a.clock.runFor(3000);
    await settled(a);

    // B, still showing the old Inbox, triages it, which would move Done back to Active.
    await b.getByRole("region", { name: "Needs sorting" }).getByRole("button", { name: /Race/ }).click();
    await b.getByRole("group", { name: "Size" }).getByRole("button", { name: "S", exact: true }).click();
    await b.clock.runFor(3000);
    await expect(b.getByText("This changed on another device, so you're seeing the latest version.")).toBeVisible();
    await b.getByRole("button", { name: "Back" }).click();
    await expect(b.getByText("Race")).toHaveCount(0); // Done: off Inbox, as on device A
    const stateOnB = () => b.evaluate(() => JSON.parse(localStorage.getItem("ember")!).tasks.find((t: { title: string }) => t.title === "Race").state);
    expect(await stateOnB()).toBe("done"); // B's stored copy is the server's Done, not its own Active
    await ctxB.close();
  });
});

test("with no connection the app says so quietly and keeps working", async ({ page }) => {
  await page.goto("/"); // the fixture makes the API unreachable
  await expect(page.getByText("Offline. Your changes will sync when you reconnect.")).toBeVisible();
  await page.getByRole("button", { name: "What's on your mind?" }).click();
  await page.getByRole("textbox", { name: "Capture a thought" }).fill("Still works");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "Added just now" })).toContainText("Still works");
});

test("Settings offers Telegram, and says plainly when it can't link", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("Ember can nudge you while the app is closed: on Telegram, or on this device.")).toBeVisible();
  await page.getByRole("button", { name: "Link Telegram" }).click();
  await expect(page.getByRole("main").getByText("Linking Telegram needs a connection.")).toBeVisible(); // API unreachable here
});

test.describe("Settings with the server reachable", () => {
  test.use({ online: true });
  test("offers to link Telegram while it isn't linked", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("button", { name: "Link Telegram" })).toBeVisible();
    await expect(page.getByText("Linked · nudges go here")).toHaveCount(0);
  });
});
