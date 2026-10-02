import { test as base, expect, type Page } from "@playwright/test";

// Most specs exercise the device on its own and seed localStorage directly; with the server reachable, sync would
// (correctly) overwrite those hand edits with the server's rows. So the API is unreachable unless a spec opts in with
// test.use({ online: true }). Offline is a real mode anyway: the app must work fully without the server.
//
// Specs also start past the first-run sequence (an empty device is otherwise onboarding, UX_Flows.md §7) and past the
// one-time reminder offer, unless a spec opts in with test.use({ firstRun: true }).
export const test = base.extend<{ online: boolean; firstRun: boolean }>({
  online: [false, { option: true }],
  firstRun: [false, { option: true }],
  page: async ({ page, online, firstRun }, use) => {
    if (!online) await page.route("**/api/**", (route) => route.abort());
    if (!firstRun) {
      await page.addInitScript(() => {
        if (!localStorage.getItem("ember")) localStorage.setItem("ember", JSON.stringify({ onboarded: true, nudge_offered: true }));
      });
    }
    await use(page);
  },
});

export { expect, type Page };
