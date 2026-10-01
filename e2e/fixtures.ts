import { test as base, expect, type Page } from "@playwright/test";

// Most specs exercise the device on its own and seed localStorage directly; with the server reachable, sync would
// (correctly) overwrite those hand edits with the server's rows. So the API is unreachable unless a spec opts in with
// test.use({ online: true }). Offline is a real mode anyway: the app must work fully without the server.
export const test = base.extend<{ online: boolean }>({
  online: [false, { option: true }],
  page: async ({ page, online }, use) => {
    if (!online) await page.route("**/api/**", (route) => route.abort());
    await use(page);
  },
});

export { expect, type Page };
