import { expect, test, type Page } from "./fixtures";

// Slice 8 done-when: clearing the device's storage and returning restores the list (Tech_Scope.md §10).
// The identity lives in the server's HttpOnly cookie, which Safari's 7-day wipe of script storage doesn't touch.
test.use({ online: true });

// Wait until the outbox is empty and the last response has been fully handled, then wipe and reload in one step,
// so no in-flight sync can write its cursor back after the wipe (a real wipe never lands mid-request).
async function wipeAndReturn(page: Page) {
  await page.waitForFunction(() => {
    const m = JSON.parse(localStorage.getItem("ember.sync") ?? "{}");
    return m.uploaded && m.outbox?.length === 0;
  });
  await page.waitForTimeout(300);
  await Promise.all([page.waitForEvent("load"), page.evaluate(() => (localStorage.clear(), location.reload()))]);
}

const synced = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith("/api/sync") && r.ok() && (r.request().postDataJSON()?.ops?.length ?? 0) > 0);

async function capture(page: Page, ...titles: string[]) {
  await page.getByRole("button", { name: "What's on your mind?" }).click();
  for (const t of titles) {
    await page.getByRole("textbox", { name: "Capture a thought" }).fill(t);
    await page.keyboard.press("Enter");
  }
  await page.getByRole("button", { name: "Close" }).click();
}

test("the list comes back after the device's storage is wiped", async ({ page }) => {
  await page.goto("/");
  const upload = synced(page);
  await capture(page, "Cover letter", "Book dentist");
  await upload;

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("Your list is backed up, so it won't get lost.")).toBeVisible();

  await wipeAndReturn(page); // what Safari's wipe does; the cookie survives
  await page.getByRole("button", { name: "Sort a few from Inbox" }).click();
  await expect(page.getByRole("region", { name: "Needs sorting" }).getByRole("listitem")).toHaveText(["Book dentist", "Cover letter"]);
});

test("phase-1 data on the device is uploaded on the first sync", async ({ page, context }) => {
  // Seed before the app's first script runs (once; sessionStorage survives the reloads below), so this device has
  // phase-1 data and has never synced.
  // Fresh ids each run: the local D1 outlives test runs, and the server never lets one user's write touch a row id
  // another user already owns.
  const [tid, cid] = [crypto.randomUUID(), crypto.randomUUID()];
  await page.addInitScript(([tid, cid]) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    const t = { id: tid, title: "From phase one", state: "active", size: "M", quick: false, holding_up: false, deadline: null, runway_start: null, pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1 };
    const c = { id: cid, task_id: tid, parent_id: null, title: "A first step", position: 1, state: "todo", deleted: false, updated_at: 1 };
    localStorage.setItem("ember", JSON.stringify({ tasks: [t], chunks: [c], draft: "" }));
  }, [tid, cid]);
  const upload = synced(page);
  await page.goto("/");
  const req = (await upload).request().postDataJSON();
  expect(req.ops.map((o: { entity: string; id: string }) => `${o.entity}:${o.id}`)).toEqual([`tasks:${tid}`, `chunks:${cid}`, "settings:me"]);

  // A fresh device with the same cookie pulls it down.
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "ember_uid")).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  await wipeAndReturn(page);
  await page.getByRole("button", { name: "Sort a few from Inbox" }).click();
  await expect(page.getByRole("region", { name: "Waiting" })).toContainText("From phase one");
});
