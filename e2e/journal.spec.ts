import { expect, test, type Page } from "./fixtures";

// Slice 22: the optional journal line and mood after "You're done" (UX_Flows.md §3.7). The line is sealed on the device
// (src/journal.ts); the server only ever holds ciphertext.
test.use({ timezoneId: "Asia/Singapore" });

const LINE = "Finished the cover letter, tired but glad.";

async function toYoureDone(page: Page) {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Wrap up the day" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
}

const synced = (page: Page) =>
  page.waitForFunction(() => {
    const m = JSON.parse(localStorage.getItem("ember.sync") ?? "{}");
    return m.uploaded && m.outbox?.length === 0;
  });

const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("ember")!));

test.describe("online", () => {
  test.use({ online: true });

  test("a line and a mood save sealed, reach the server as ciphertext, and reopen decrypted", async ({ page }) => {
    await page.goto("/");
    await synced(page); // this device has synced and has nothing waiting, so it may make the journal key
    await toYoureDone(page);

    await page.getByRole("textbox", { name: "One line about today" }).fill(LINE);
    await page.getByRole("radio", { name: "Good" }).check();
    await page.getByRole("button", { name: "Close" }).last().click();
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

    await expect.poll(async () => (await stored(page)).journal.length).toBe(1);
    const s = await stored(page);
    expect(s.journal[0]).toMatchObject({ mood: 4 });
    expect(JSON.stringify(s.journal)).not.toContain("cover letter"); // ciphertext only
    expect(s.settings.journal_key).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The server's copy: the row came up as ciphertext, and the line is nowhere in what it holds.
    await synced(page);
    const pulled = await page.evaluate(async () => {
      const res = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ cursor: 0, ops: [] }) });
      return res.text();
    });
    expect(pulled).toContain('"journal"');
    expect(pulled).not.toContain("cover letter");

    await page.reload();
    await synced(page);
    await toYoureDone(page);
    await expect(page.getByRole("textbox", { name: "One line about today" })).toHaveValue(LINE);
    await expect(page.getByRole("radio", { name: "Good" })).toBeChecked();
  });

  test("a mood alone is enough, and skipping both leaves nothing behind", async ({ page }) => {
    await page.goto("/");
    await synced(page);
    await toYoureDone(page);
    await page.getByRole("button", { name: "Close" }).last().click(); // both empty: Close just works
    expect((await stored(page)).journal).toEqual([]);

    await toYoureDone(page);
    await page.getByRole("radio", { name: "Rough" }).check();
    await expect.poll(async () => (await stored(page)).journal.map((j: { mood: number }) => j.mood)).toEqual([1]);
  });
});

test("before the first sync the key isn't made: the line is held, and the screen says why", async ({ page }) => {
  await page.goto("/"); // the default fixture leaves the server unreachable
  await toYoureDone(page);
  await page.getByRole("textbox", { name: "One line about today" }).fill(LINE);
  await page.getByRole("radio", { name: "Okay" }).check();
  await expect(page.getByRole("main").getByText("Your journal needs a connection the first time.")).toBeVisible();
  const s = await stored(page);
  expect(s.settings.journal_key).toBeNull(); // two devices must not each make a key
  expect(s.journal).toEqual([]);
  await page.getByRole("button", { name: "Close" }).last().click(); // never blocks
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
});

test("an entry that won't decrypt shows as nothing, never an error", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-05T20:00:00+08:00") });
  await page.goto("/");
  await page.evaluate(() => {
    const key = "A".repeat(43);
    localStorage.setItem("ember", JSON.stringify({ onboarded: true, nudge_offered: true, settings: { journal_key: key }, journal: [{ day: "2026-10-05", iv: "A".repeat(16), text: "A".repeat(22), mood: 3, updated_at: 1 }] }));
  });
  await page.reload();
  await toYoureDone(page);
  await expect(page.getByRole("textbox", { name: "One line about today" })).toHaveValue("");
  await expect(page.getByRole("radio", { name: "Okay" })).toBeChecked(); // the mood is plain, so it still shows
  await expect(page.getByText(/error|couldn't|can't/i)).toHaveCount(0);
});
