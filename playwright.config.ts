import { defineConfig } from "@playwright/test";

// Tech_Scope.md §9: UI tests run at 375 × 812 against the production build.
// E2E_PORT lets parallel worktrees each run their own server instead of reusing another's.
declare const process: { env: Record<string, string | undefined> }; // no @types/node in this repo
const port = Number(process.env.E2E_PORT ?? 4173);
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 375, height: 812 } },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: { command: `npm run build && npm run db:migrate:local && npx vite preview --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: true },
});
