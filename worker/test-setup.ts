import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Runs before each test file. Migrations are idempotent, so a second file reuses the schema.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
