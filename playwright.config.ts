import { defineConfig } from "@playwright/test";

// Tech_Scope.md §9: UI tests run at 375 × 812 against the production build.
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:4173", viewport: { width: 375, height: 812 } },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: { command: "npm run build && npm run db:migrate:local && npx vite preview --port 4173 --strictPort", url: "http://localhost:4173", reuseExistingServer: true },
});
