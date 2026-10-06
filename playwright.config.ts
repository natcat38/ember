import { defineConfig, devices } from "@playwright/test";

// Tech_Scope.md §9: UI tests run at 375 × 812 against the production build, in Chromium and in WebKit as an iPhone
// (touch, mobile user agent). WebKit is Safari's engine on desktop, not iOS itself: it catches Safari-engine bugs, while
// iOS-only behaviour (native pickers, the keyboard) stays on the iPhone checklist in docs/Verify_List.md.
// E2E_PORT lets parallel worktrees each run their own server instead of reusing another's.
declare const process: { env: Record<string, string | undefined> }; // no @types/node in this repo
const port = Number(process.env.E2E_PORT ?? 4173);
export default defineConfig({
  testDir: "e2e",
  // Service workers are blocked: in WebKit, requests from a page the worker controls skip page.route, so a stubbed or
  // unreachable API would reach the real server. pwa.spec.ts turns them back on to test the worker itself.
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 375, height: 812 }, serviceWorkers: "block" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { ...devices["iPhone 13"], viewport: { width: 375, height: 812 } } },
  ],
  webServer: { command: `npm run build && npm run db:migrate:local && npx vite preview --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: true },
});
