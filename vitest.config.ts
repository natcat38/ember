import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

// Two projects, so `npm test` runs both (Tech_Scope.md §9):
//   unit:   core/ and src/ in plain Node.
//   worker: worker/ inside workerd, against a real local D1 with migrations/ applied (worker/test-setup.ts).
const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: { name: "unit", include: ["{core,src}/**/*.test.ts"] },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: { TEST_MIGRATIONS: migrations },
              // vitest-pool-workers 0.22.0 bundles a workerd that stops at 2026-08-22, older than wrangler.jsonc's
              // date. Tests run on the newest date it supports; nothing in worker/ depends on a newer flag.
              compatibilityDate: "2026-08-22",
            },
          }),
        ],
        test: { name: "worker", include: ["worker/**/*.test.ts"], setupFiles: ["./worker/test-setup.ts"] },
      },
    ],
  },
});
