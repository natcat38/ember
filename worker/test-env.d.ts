// Test-only binding, injected by vitest.config.ts and consumed by test-setup.ts.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("@cloudflare/vitest-pool-workers").D1Migration[];
  }
}
