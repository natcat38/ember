import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { MAX_STATEMENTS, runRetention } from "./retention";

// Worker + D1 tests for slice 15 (Tech_Scope.md §8, §10): real local D1, rows seeded directly so "idle for 366
// days" needs no clock tricks. Every test owns its users (random ids) and asserts only on them, because the D1
// file is shared by the tests in this file.

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 2, 19, 0, 0); // the cron's own time, 2026-10-02 19:00 UTC
const uuid = () => crypto.randomUUID();

const OWNED_TABLES = ["tasks", "chunks", "sessions", "days", "hard_blocks", "settings", "journal", "ops", "sends", "handoffs"] as const;

// A user last seen `idleDays` ago, with one row in every table that carries user_id.
async function seedUser(idleDays: number, opts: { passkey?: boolean } = {}): Promise<string> {
  const uid = uuid();
  const seen = NOW - idleDays * DAY;
  const stmts = [
    env.DB.prepare("INSERT INTO users (id, created_at, last_seen_at) VALUES (?1, ?2, ?3)").bind(uid, seen - DAY, seen),
    env.DB.prepare("INSERT INTO tasks (id, user_id, title, state, rev) VALUES (?1, ?2, 'Task', 'inbox', 1)").bind(uuid(), uid),
    env.DB.prepare("INSERT INTO chunks (id, user_id, task_id, title, position, state, rev) VALUES (?1, ?2, ?3, 'Chunk', 1, 'todo', 1)").bind(uuid(), uid, uuid()),
    env.DB.prepare("INSERT INTO sessions (id, user_id, chunk_id, started_at, ended_at, rev) VALUES (?1, ?2, ?3, ?4, ?4, 1)").bind(uuid(), uid, uuid(), seen),
    env.DB.prepare("INSERT INTO days (user_id, day, rev) VALUES (?1, '2025-01-01', 1)").bind(uid),
    env.DB.prepare("INSERT INTO hard_blocks (id, user_id, weekdays, start_min, end_min, rev) VALUES (?1, ?2, '[0]', 540, 600, 1)").bind(uuid(), uid),
    env.DB.prepare("INSERT INTO settings (user_id, id, rev) VALUES (?1, 'me', 1)").bind(uid),
    env.DB.prepare("INSERT INTO journal (user_id, day, iv, text, mood, rev) VALUES (?1, '2025-01-01', 'AAAAAAAAAAAAAAAA', 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', 3, 1)").bind(uid),
    // Fresh enough to survive the 30-day ops prune, so a surviving row proves the user delete, not the prune, took it.
    env.DB.prepare("INSERT INTO ops (user_id, op_id, applied_at) VALUES (?1, ?2, ?3)").bind(uid, uuid(), NOW - DAY),
    env.DB.prepare("INSERT INTO sends (id, user_id, day, kind, due_at) VALUES (?1, ?2, '2025-01-01', 'morning', ?3)").bind(uuid(), uid, seen),
    env.DB.prepare("INSERT INTO handoffs (code, user_id, purpose, expires_at) VALUES (?1, ?2, 'install', ?3)").bind(uuid(), uid, NOW + DAY),
  ];
  if (opts.passkey) {
    stmts.push(env.DB.prepare("INSERT INTO credentials (id, user_id, public_key, created_at) VALUES (?1, ?2, x'00', ?3)").bind(uuid(), uid, seen));
  }
  await env.DB.batch(stmts);
  return uid;
}

const rowsOf = async (table: string, uid: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(uid).first<{ n: number }>())!.n;

// `users` has the id in `id`, not `user_id`.
async function userCount(uid: string): Promise<number> {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").bind(uid).first<{ n: number }>())!.n;
}
async function allRows(uid: string): Promise<Record<string, number>> {
  const out: Record<string, number> = { users: await userCount(uid) };
  for (const t of OWNED_TABLES) out[t] = await rowsOf(t, uid);
  return out;
}
const FULL = Object.fromEntries([["users", 1], ...OWNED_TABLES.map((t) => [t, 1])]);
const EMPTY = Object.fromEntries([["users", 0], ...OWNED_TABLES.map((t) => [t, 0])]);

describe("idle anonymous users", () => {
  it("deletes a user idle 366 days with every row they own, and leaves a neighbour alone", async () => {
    const gone = await seedUser(366);
    const neighbour = await seedUser(1);
    expect(await allRows(gone)).toEqual(FULL);

    const result = await runRetention(env.DB, NOW);

    expect(await allRows(gone)).toEqual(EMPTY);
    expect(await allRows(neighbour)).toEqual(FULL);
    expect(result.users).toBeGreaterThanOrEqual(1);
    expect(result.userRows).toBeGreaterThanOrEqual(OWNED_TABLES.length);
  });

  it("keeps a user idle 366 days who has a passkey", async () => {
    const uid = await seedUser(366, { passkey: true });
    await runRetention(env.DB, NOW);
    expect(await allRows(uid)).toEqual(FULL);
    expect(await rowsOf("credentials", uid)).toBe(1);
  });

  it("keeps a user idle 364 days, and one idle exactly 365", async () => {
    const recent = await seedUser(364);
    const edge = await seedUser(365);
    await runRetention(env.DB, NOW);
    expect(await allRows(recent)).toEqual(FULL);
    expect(await allRows(edge)).toEqual(FULL);
  });

  it("is a no-op the second time", async () => {
    await seedUser(400);
    await runRetention(env.DB, NOW);
    const again = await runRetention(env.DB, NOW);
    expect(again.users).toBe(0);
    expect(again.more).toBe(false);
  });
});

describe("housekeeping", () => {
  it("prunes ops older than 30 days and keeps newer ones", async () => {
    const uid = await seedUser(1); // its own seeded op is 1 day old
    await env.DB.batch([
      env.DB.prepare("INSERT INTO ops (user_id, op_id, applied_at) VALUES (?1, 'old', ?2)").bind(uid, NOW - 31 * DAY),
      env.DB.prepare("INSERT INTO ops (user_id, op_id, applied_at) VALUES (?1, 'recent', ?2)").bind(uid, NOW - 29 * DAY),
    ]);

    const result = await runRetention(env.DB, NOW);

    const left = (await env.DB.prepare("SELECT op_id FROM ops WHERE user_id = ?").bind(uid).all<{ op_id: string }>()).results.map((r) => r.op_id);
    expect(left).toContain("recent");
    expect(left).not.toContain("old");
    expect(left).toHaveLength(2); // 'recent' plus the seeded one
    expect(result.opsPruned).toBeGreaterThanOrEqual(1);
  });

  it("prunes handoffs that expired more than a day ago, and keeps the rest", async () => {
    const uid = await seedUser(1);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO handoffs (code, user_id, purpose, expires_at) VALUES ('long-expired', ?1, 'tg_link', ?2)").bind(uid, NOW - 2 * DAY),
      env.DB.prepare("INSERT INTO handoffs (code, user_id, purpose, expires_at) VALUES ('just-expired', ?1, 'tg_link', ?2)").bind(uid, NOW - DAY / 2),
      env.DB.prepare("INSERT INTO handoffs (code, user_id, purpose, expires_at) VALUES ('live', ?1, 'tg_link', ?2)").bind(uid, NOW + 1000),
    ]);

    const result = await runRetention(env.DB, NOW);

    const left = (await env.DB.prepare("SELECT code FROM handoffs WHERE user_id = ?").bind(uid).all<{ code: string }>()).results.map((r) => r.code);
    expect(left).toContain("just-expired");
    expect(left).toContain("live");
    expect(left).not.toContain("long-expired");
    expect(result.handoffsPruned).toBeGreaterThanOrEqual(1);
  });
});

describe("bounded work", () => {
  it("deletes at most one batch per pass, reports more, and a later run finishes the job", async () => {
    // Clear leftovers from the earlier tests so the counts below are exact.
    await runRetention(env.DB, NOW);
    const idle = await Promise.all(Array.from({ length: 7 }, () => seedUser(500)));
    const keeper = await seedUser(10);

    // batchSize 2 and a 40-statement cap allow 3 batches of 2 = 6 users per call.
    const first = await runRetention(env.DB, NOW, { batchSize: 2 });
    expect(first.users).toBe(6);
    expect(first.more).toBe(true);
    let remaining = 0;
    for (const uid of idle) remaining += await userCount(uid);
    expect(remaining).toBe(1);

    const second = await runRetention(env.DB, NOW, { batchSize: 2 });
    expect(second.users).toBe(1);
    expect(second.more).toBe(false);
    for (const uid of idle) expect(await allRows(uid)).toEqual(EMPTY);
    expect(await allRows(keeper)).toEqual(FULL);
  }, 30_000); // seeding and checking dozens of rows one query at a time is slow when the whole suite runs at once

  it("issues at most 40 D1 statements per call, however many users are idle", async () => {
    await runRetention(env.DB, NOW);
    await Promise.all(Array.from({ length: 12 }, () => seedUser(500)));

    // Every statement the job runs starts with db.prepare, so counting prepares counts statements.
    let prepared = 0;
    const counting = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare") {
          return (sql: string) => {
            prepared++;
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const result = await runRetention(counting, NOW, { batchSize: 1 });
    expect(result.more).toBe(true);
    expect(prepared).toBeLessThanOrEqual(MAX_STATEMENTS);
    expect(prepared).toBeLessThanOrEqual(40);
  });
});
