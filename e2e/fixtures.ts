import { test as base, expect, type Locator, type Page } from "@playwright/test";

// Most specs exercise the device on its own and seed localStorage directly; with the server reachable, sync would
// (correctly) overwrite those hand edits with the server's rows. So the API is unreachable unless a spec opts in with
// test.use({ online: true }). Offline is a real mode anyway: the app must work fully without the server.
//
// Specs also start past the first-run sequence (an empty device is otherwise onboarding, UX_Flows.md §7) and past the
// one-time reminder offer, unless a spec opts in with test.use({ firstRun: true }).
export const test = base.extend<{ online: boolean; firstRun: boolean }>({
  online: [false, { option: true }],
  firstRun: [false, { option: true }],
  page: async ({ page, online, firstRun }, use, testInfo) => {
    // The identity cookie is Secure, and WebKit never sends a Secure cookie to http://localhost, so every request would be
    // a new user. Server-backed specs run in Chromium; the deployed site is HTTPS, where Safari sends it.
    testInfo.skip(online && testInfo.project.name === "webkit", "WebKit drops the Secure identity cookie on http://localhost");
    // The app saves its state in an effect after the first render, and WebKit can run that effect after goto returns, so a
    // spec's goto → seed localStorage → reload would lose its seed to the app's first save. goto waits for that render.
    const goto = page.goto.bind(page);
    page.goto = async (url, options) => {
      const res = await goto(url, options);
      await page.waitForFunction(() => document.getElementById("root")?.childElementCount);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => setTimeout(done))));
      return res;
    };
    if (!online) await page.route("**/api/**", (route) => route.abort());
    if (!firstRun) {
      await page.addInitScript(() => {
        if (!localStorage.getItem("ember")) localStorage.setItem("ember", JSON.stringify({ onboarded: true, nudge_offered: true }));
      });
    }
    await use(page);
  },
});

// Settings keeps the set-once groups (Quiet hours, Time zone, Hard blocks, Rewards, Data) behind a row with a one-line
// summary (EMB-UX-10). Open one by its title before touching what is inside.
export async function openFold(page: Page, title: string) {
  const head = page.getByRole("button", { name: new RegExp(`^${title}`) });
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
}

// The frog's Start button. The region is labelled "Do this first"; the button inside it says what it does (EMB-UX-4).
export const startFrog = (page: Page) => page.getByRole("region", { name: "Do this first" }).getByRole("button", { name: "Start", exact: true });

// A Today row is a checkbox and a title: Start lives in its "..." menu (EMB-UX-6). `scope` is the page or a pane.
export async function startRow(scope: Page | Locator, title: string) {
  await scope.getByRole("button", { name: `More actions for ${title}`, exact: true }).click();
  await scope.locator(".row-menu").getByRole("button", { name: "Start", exact: true }).click();
}

export { expect, type Page };
