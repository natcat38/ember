import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { Op } from "./protocol";
import { MAX_SUBSCRIPTIONS, type PushSub } from "./push";
import { browserSubscription, decryptPayload, vapidKeys } from "./push-testing";
import { MAX_PLANNED, MAX_SENDS, runTick, type SchedulerEnv } from "./scheduler";
import { sync } from "./sync";

// Worker + D1 tests for slice 12 (Tech_Scope.md §4.5, §6, §9, §11): real local D1, outbound Telegram fetch mocked with
// vi.spyOn as in telegram.test.ts. The scheduler is driven with explicit instants (runTick takes `now`), so a whole
// day runs in a few calls. The secret is not bound in vitest.config.ts, so it is added to the env here.

const TOKEN = "123456:TEST-TOKEN";
const vapid = await vapidKeys();
const testEnv: SchedulerEnv = { ...env, TG_BOT_TOKEN: TOKEN, VAPID_PUBLIC_KEY: vapid.publicB64, VAPID_PRIVATE_KEY: vapid.d, VAPID_SUBJECT: "mailto:ember@example.com" };
const ORIGIN = env.APP_ORIGIN;

// Local Singapore time (UTC+8, no DST) as unix ms. The golden day is Monday 2026-10-05 (§4.6).
const sg = (day: string, time: string) => Date.parse(`${day}T${time}+08:00`);
const DAY = "2026-10-05";

// The simulated D1 takes roughly 50-100 ms a statement, so the tests that run a few days of ticks need more than 5 s.
vi.setConfig({ testTimeout: 60_000 });

interface Sent {
  chat_id: string;
  text: string;
  reply_markup?: { inline_keyboard: { text: string; url: string; callback_data?: string }[][] };
}
let calls: Sent[] = [];
let nextMessageId = 100;
// Status Telegram answers with, per chat id; anything not listed gets 200.
let statusFor: Record<string, number> = {};
// Lets a test hold every send for a macrotask, so two ticks really interleave.
let sendDelayMs = 0;

// Web push (slice 18): the push service is any https://push.example.net/<name>. What it was sent, and the status it answers
// with per endpoint (anything not listed gets 201). `browsers` holds each subscribed browser's private key, to read the payload.
const PUSH_HOST = "https://push.example.net/";
interface PushCall {
  endpoint: string;
  body: Uint8Array;
  headers: Record<string, string>;
}
let pushCalls: PushCall[] = [];
let pushStatusFor: Record<string, number> = {};
const browsers = new Map<string, { sub: PushSub; privateKey: CryptoKey }>();

beforeEach(async () => {
  calls = [];
  nextMessageId = 100;
  statusFor = {};
  sendDelayMs = 0;
  pushCalls = [];
  pushStatusFor = {};
  // The scheduler scans every user, so tests start from an empty database.
  for (const t of ["sends", "handoffs", "sessions", "chunks", "tasks", "hard_blocks", "days", "settings", "ops", "push_subscriptions", "users"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(PUSH_HOST)) {
      pushCalls.push({ endpoint: url, body: new Uint8Array(init?.body as ArrayBuffer), headers: init?.headers as Record<string, string> });
      return new Response(null, { status: pushStatusFor[url] ?? 201 });
    }
    if (url !== `https://api.telegram.org/bot${TOKEN}/sendMessage`) throw new Error(`unexpected outbound fetch: ${url}`);
    const body = JSON.parse(String(init?.body)) as Sent;
    body.chat_id = String(body.chat_id);
    if (sendDelayMs) await new Promise((r) => setTimeout(r, sendDelayMs));
    calls.push(body);
    const status = statusFor[body.chat_id] ?? 200;
    return status === 200 ? Response.json({ ok: true, result: { message_id: nextMessageId++ } }) : Response.json({ ok: false, description: "nope" }, { status });
  });
});
afterEach(() => vi.restoreAllMocks());

// --- Seeding -----------------------------------------------------------------------------------------------------

let nextChat = 7_000_000;

/** A user linked to a fresh Telegram chat. `planned: true` marks the day planned far ahead, for tests that seed their own `sends` rows. */
async function linkedUser(opts: { planned?: boolean; channel?: string | null; chat?: string | null } = {}) {
  const uid = `user-${crypto.randomUUID().slice(0, 18)}`;
  const chat = opts.chat === undefined ? String(nextChat++) : opts.chat;
  const channel = opts.channel === undefined ? "telegram" : opts.channel;
  await env.DB
    .prepare("INSERT INTO users (id, created_at, last_seen_at, channel, telegram_chat_id, planned_until, planned_rev) VALUES (?1, 0, 0, ?2, ?3, ?4, ?5)")
    .bind(uid, channel, chat, opts.planned ? 9e15 : null, opts.planned ? 0 : null)
    .run();
  return { uid, chat: chat! };
}

/** Writes through the real sync path, so every change bumps `users.rev` as a client's would. */
async function put(uid: string, ops: Op[], now = Date.now()) {
  const { rejected } = await sync(env.DB, uid, 0, ops, now);
  expect(rejected).toEqual([]);
}
const op = (entity: Op["entity"], id: string, fields: Record<string, unknown>): Op => ({ op_id: crypto.randomUUID(), entity, id, fields });
const taskOp = (id: string, title: string, fields: Record<string, unknown>) => op("tasks", id, { title, state: "active", created_at: 1, updated_at: 1, ...fields });
const chunkOp = (id: string, task_id: string, position: number, state = "todo") => op("chunks", id, { task_id, title: `${id} step`, position, state, updated_at: 1 });

/** Mei, Monday 2026-10-05 (Tech_Scope.md §4.6): quiet hours 22:00-08:00, Asia/Singapore, Monday blocks 09:00-12:00 and 14:00-16:00. */
async function seedMei(uid: string) {
  await put(uid, [
    op("settings", "me", { tz: "Asia/Singapore", quiet_start: 1320, quiet_end: 480 }),
    op("hard_blocks", "hb-am", { weekdays: [0], start_min: 540, end_min: 720 }),
    op("hard_blocks", "hb-pm", { weekdays: [0], start_min: 840, end_min: 960 }),
    taskOp("task-b", "Cover letter", { size: "S", deadline: "2026-10-05", runway_start: "2026-10-01" }),
    taskOp("task-c", "Lab report", { size: "L", deadline: "2026-10-04", runway_start: "2026-09-20" }),
    chunkOp("c1", "task-c", 1),
    chunkOp("c2", "task-c", 2),
    chunkOp("c3", "task-c", 3),
    taskOp("task-a", "DSA assignment", { size: "M", deadline: "2026-10-08", runway_start: "2026-09-28" }),
    chunkOp("a1", "task-a", 1),
    chunkOp("a2", "task-a", 2),
    op("sessions", "sess-a", { chunk_id: "a1", started_at: 1, ended_at: 2, completed: true }),
    taskOp("task-e", "Reply to recruiter", { size: "XS", deadline: "2026-10-20", runway_start: "2026-10-01", holding_up: true }),
    taskOp("task-d", "System design ch. 3", { size: "M" }),
  ]);
}

interface SendSeed {
  uid: string;
  id?: string;
  kind?: string;
  day?: string;
  due_at: number;
  text?: string;
  task_ids?: string[];
  claimed_at?: number | null;
  sent_at?: number | null;
  attempts?: number;
}
/** `sends` rows planted directly, for the tests of the send step on its own. One batch, because the simulated D1 is slow per statement. */
async function seedSends(rows: SendSeed[]) {
  const ids = rows.map((s) => s.id ?? crypto.randomUUID());
  await env.DB.batch(
    rows.map((s, i) =>
      env.DB
        .prepare("INSERT INTO sends (id, user_id, day, kind, task_ids, due_at, text, claimed_at, sent_at, attempts) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)")
        .bind(ids[i], s.uid, s.day ?? DAY, s.kind ?? "morning", JSON.stringify(s.task_ids ?? []), s.due_at, s.text ?? `text ${ids[i]}`, s.claimed_at ?? null, s.sent_at ?? null, s.attempts ?? 0),
    ),
  );
  return ids;
}
const seedSend = async (s: SendSeed) => (await seedSends([s]))[0];

const tick = (now: number) => runTick(testEnv, now);

// A tick sends before it plans (audit #31), so a message planned this minute goes out on the next tick. Tests about what
// the plan sends run both at one instant; the report is the second tick's, with the first tick's `planned`.
async function planAndSend(now: number) {
  const first = await tick(now);
  return { ...(await tick(now)), planned: first.planned };
}
const sendRow = (id: string) =>
  env.DB.prepare("SELECT sent_at, claimed_at, attempts, cancelled, tg_message_id FROM sends WHERE id = ?").bind(id).first<{ sent_at: number | null; claimed_at: number | null; attempts: number; cancelled: number; tg_message_id: number | null }>();
const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())!.n;
const textsTo = (chat: string) => calls.filter((c) => c.chat_id === chat).map((c) => c.text);

// --- The golden day ----------------------------------------------------------------------------------------------

describe("the golden day (Tech_Scope.md §4.6)", () => {
  it("sends exactly three messages, at 08:00, 16:00 and 19:00 Singapore time, with the right text and buttons", async () => {
    const { uid, chat } = await linkedUser();
    await seedMei(uid);

    // Ticks fire about 31 s past the minute (§11). Before the day starts nothing is due.
    await tick(sg(DAY, "07:59:31"));
    expect(calls).toEqual([]);

    await planAndSend(sg(DAY, "08:00:31"));
    expect(textsTo(chat)).toEqual(["Cover letter is due today."]);

    for (const t of ["08:01:31", "08:30:31", "12:00:31", "15:59:31"]) await tick(sg(DAY, t));
    expect(calls).toHaveLength(1);

    await tick(sg(DAY, "16:00:31"));
    expect(textsTo(chat)).toHaveLength(2);
    for (const t of ["16:01:31", "18:59:31"]) await tick(sg(DAY, t));
    expect(calls).toHaveLength(2);

    await tick(sg(DAY, "19:00:31"));
    for (const t of ["19:01:31", "21:00:31", "21:59:31", "23:00:31"]) await tick(sg(DAY, t));

    expect(textsTo(chat)).toEqual([
      "Cover letter is due today.",
      "Lab report was due yesterday and isn't marked done. Still relevant?",
      "4 sessions left on DSA assignment, 3 days to go. Want to start one now?",
    ]);

    const rows = (await env.DB.prepare("SELECT kind, task_ids, due_at, sent_at, attempts, tg_message_id, deadline FROM sends WHERE user_id = ? ORDER BY due_at").bind(uid).all()).results;
    expect(rows).toEqual([
      { kind: "deadline_day", task_ids: '["task-b"]', due_at: sg(DAY, "08:00:00"), sent_at: sg(DAY, "08:00:31"), attempts: 1, tg_message_id: 100, deadline: null },
      { kind: "overdue", task_ids: '["task-c"]', due_at: sg(DAY, "16:00:00"), sent_at: sg(DAY, "16:00:31"), attempts: 1, tg_message_id: 101, deadline: "2026-10-04" },
      { kind: "close", task_ids: '["task-a"]', due_at: sg(DAY, "19:00:00"), sent_at: sg(DAY, "19:00:31"), attempts: 1, tg_message_id: 102, deadline: null },
    ]);

    // §6: "Open today" on every message; "Start a session" on deadline_day, overdue and close, naming the task. Every
    // URL carries the send id and a sign-in code, and one message has one code.
    const ids = (await env.DB.prepare("SELECT id FROM sends WHERE user_id = ? ORDER BY due_at").bind(uid).all<{ id: string }>()).results.map((r) => r.id);
    const tasks = ["task-b", "task-c", "task-a"];
    calls.forEach((call, i) => {
      const [open, start] = call.reply_markup!.inline_keyboard[0];
      // Slice 13: the state buttons sit beside the links (Snooze on close) or under them (Overdue's three).
      const rows = [
        [["Open today", "Start a session"]], // deadline_day
        [["Open today", "Start a session"], ["Reschedule", "Done", "Remove from list"]], // overdue
        [["Open today", "Start a session", "Snooze"]], // close
      ];
      expect(call.reply_markup!.inline_keyboard.map((row) => row.map((b) => b.text))).toEqual(rows[i]);
      expect(open.text).toBe("Open today");
      expect(start.text).toBe("Start a session");
      const code = new URL(open.url).searchParams.get("h")!;
      expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(open.url).toBe(`${ORIGIN}/?h=${code}&s=${ids[i]}`);
      expect(start.url).toBe(`${ORIGIN}/?h=${code}&s=${ids[i]}&t=${tasks[i]}`);
    });
    const codes = calls.map((c) => new URL(c.reply_markup!.inline_keyboard[0][0].url).searchParams.get("h"));
    expect(new Set(codes).size).toBe(3);
    const handoff = await env.DB.prepare("SELECT user_id, purpose, expires_at, used_at FROM handoffs WHERE code = ?").bind(codes[0]).first();
    expect(handoff).toEqual({ user_id: uid, purpose: "login_link", expires_at: sg(DAY, "08:00:31") + 24 * 3_600_000, used_at: null });
  });

  it("plans a user once: a later tick with nothing changed plans nobody", async () => {
    const { uid } = await linkedUser();
    await seedMei(uid);
    expect((await tick(sg(DAY, "08:00:31"))).planned).toBe(1);
    expect((await tick(sg(DAY, "08:01:31"))).planned).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM sends WHERE user_id = ?", uid)).toBe(3);
  });
});

// --- Planning ----------------------------------------------------------------------------------------------------

describe("planning", () => {
  it("never plans an unlinked user, or one whose channel was cleared", async () => {
    const noChat = await linkedUser({ chat: null, channel: null });
    const blocked = await linkedUser({ channel: null }); // chat id kept, channel cleared: what a 403 leaves behind
    const push = await linkedUser({ channel: "push" });
    for (const { uid } of [noChat, blocked, push]) await put(uid, [taskOp("t-" + uid, "Overdue thing", { size: "S", deadline: "2026-10-01" })]);

    const report = await tick(sg(DAY, "08:00:31"));
    expect(report).toEqual({ planned: 0, claimed: 0, sent: 0, blocked: 0 });
    expect(calls).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM sends")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE planned_until IS NOT NULL")).toBe(0);
  });

  it("planned after a slot has passed, moves its message to the next free slot instead of dropping it", async () => {
    // Linked at 10:00: the 08:00 slot is gone, so the day's three move on to 16:00, 19:00 and 21:00 (§4.5).
    const { uid, chat } = await linkedUser();
    await seedMei(uid);
    await tick(sg(DAY, "10:00:31"));
    expect(calls).toEqual([]);
    const rows = (await env.DB.prepare("SELECT kind, due_at FROM sends WHERE user_id = ? ORDER BY due_at").bind(uid).all()).results;
    expect(rows).toEqual([
      { kind: "deadline_day", due_at: sg(DAY, "16:00:00") },
      { kind: "overdue", due_at: sg(DAY, "19:00:00") },
      { kind: "close", due_at: sg(DAY, "21:00:00") },
    ]);
    for (const t of ["16:00:31", "19:00:31", "21:00:31"]) await tick(sg(DAY, t));
    expect(textsTo(chat)).toHaveLength(3);
  });

  it("sends what is due before it plans, so a message planned this minute goes out on the next tick (audit #31)", async () => {
    const { uid, chat } = await linkedUser();
    await seedMei(uid);

    expect(await tick(sg(DAY, "08:00:31"))).toMatchObject({ planned: 1, claimed: 0, sent: 0 });
    expect(calls).toEqual([]);
    expect(await tick(sg(DAY, "08:01:31"))).toMatchObject({ planned: 0, claimed: 1, sent: 1 });
    expect(textsTo(chat)).toEqual(["Cover letter is due today."]);
  });

  it("logs a short hash of the user's id when a plan fails, never the id, which is a session cookie (audit #35)", async () => {
    const { uid } = await linkedUser();
    await seedMei(uid);
    await env.DB.prepare("INSERT INTO days (user_id, day, deferred, rev) VALUES (?1, ?2, 'not json', 1)").bind(uid, DAY).run(); // the plan cannot read this row
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await tick(sg(DAY, "08:00:31"));

    const logged = log.mock.calls.find((args) => args[0] === "plan failed");
    expect(logged?.[1]).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(log.mock.calls)).not.toContain(uid);
    expect((await env.DB.prepare("SELECT planned_until FROM users WHERE id = ?").bind(uid).first<{ planned_until: number }>())!.planned_until).toBe(sg(DAY, "08:00:31") + 5 * 60_000);
  });

  it("composes a close message about a task with no steps with the task name first, and batches several", async () => {
    const { uid, chat } = await linkedUser();
    await put(uid, [
      op("settings", "me", { tz: "Asia/Singapore", quiet_start: 1320, quiet_end: 480 }),
      taskOp("t-one", "Tax form", { size: "S", deadline: "2026-10-07", runway_start: "2026-10-01" }),
    ]);
    await tick(sg("2026-10-06", "08:00:31")); // 2026-10-06 is a Tuesday: no blocks, S2 is 15:00
    await tick(sg("2026-10-06", "15:00:31"));
    expect(textsTo(chat)).toContain("Tax form\nThis deadline's getting close. Want help breaking it down?");

    await put(uid, [taskOp("t-two", "Visa renewal", { size: "S", deadline: "2026-10-08", runway_start: "2026-10-01" })]);
    await tick(sg("2026-10-06", "15:01:31"));
    await tick(sg("2026-10-06", "18:00:31")); // S3 = 19:00; not yet
    await tick(sg("2026-10-06", "19:00:31"));
    expect(textsTo(chat).at(-1)).toBe("A few deadlines are getting close: Tax form and Visa renewal. Want to start with Tax form?");
  });

  it("sends the morning message with only an Open today button", async () => {
    const { uid, chat } = await linkedUser();
    await put(uid, [op("settings", "me", { tz: "Asia/Singapore", quiet_start: 1320, quiet_end: 480 }), taskOp("t-x", "Read paper", { size: "S", deadline: "2026-10-10", runway_start: "2026-10-01" })]);
    await planAndSend(sg("2026-10-06", "08:00:31"));
    expect(textsTo(chat)).toEqual(["Today's ready: 1 thing. First up: Read paper."]);
    expect(calls[0].reply_markup!.inline_keyboard[0].map((b) => b.text)).toEqual(["Open today"]);
  });
});

describe("replanning", () => {
  it("after a sync changes a task, keeps the three of the day and does not send the sent message again", async () => {
    const { uid, chat } = await linkedUser();
    await seedMei(uid);
    await planAndSend(sg(DAY, "08:00:31")); // Cover letter goes out

    await put(uid, [op("tasks", "task-e", { title: "Reply to the recruiter" })], sg(DAY, "10:00:00"));
    const replan = await tick(sg(DAY, "10:00:31"));
    expect(replan.planned).toBe(1);
    // The sent row stays; the two unsent ones are rebuilt in their old places.
    expect((await env.DB.prepare("SELECT kind, due_at FROM sends WHERE user_id = ? ORDER BY due_at").bind(uid).all()).results).toEqual([
      { kind: "deadline_day", due_at: sg(DAY, "08:00:00") },
      { kind: "overdue", due_at: sg(DAY, "16:00:00") },
      { kind: "close", due_at: sg(DAY, "19:00:00") },
    ]);

    for (const t of ["16:00:31", "19:00:31", "21:00:31"]) await tick(sg(DAY, t));
    expect(textsTo(chat)).toHaveLength(3);
    expect(new Set(textsTo(chat)).size).toBe(3);
  });

  it("never exceeds 3 messages for the day when a sync adds more deadlines than there is room for", async () => {
    const { uid, chat } = await linkedUser();
    await seedMei(uid);
    await tick(sg(DAY, "08:00:31"));

    // Two minutes later two more tasks turn out to be due today. The cap leaves room for two more messages, not three.
    await put(uid, [taskOp("task-f", "Pay rent", { size: "XS", deadline: DAY, runway_start: DAY }), taskOp("task-g", "Book flights", { size: "XS", deadline: DAY, runway_start: DAY })], sg(DAY, "08:02:00"));
    await tick(sg(DAY, "08:02:31"));
    for (const t of ["09:30:31", "12:00:31", "16:00:31", "17:00:31", "19:00:31", "21:00:31", "23:00:31"]) await tick(sg(DAY, t));

    expect(await count("SELECT COUNT(*) AS n FROM sends WHERE user_id = ? AND cancelled = 0", uid)).toBeLessThanOrEqual(3);
    expect(textsTo(chat)).toHaveLength(3);
    expect(textsTo(chat)[0]).toBe("Cover letter is due today.");
    // Deadlines outrank the close nudge for DSA assignment, which is the one that dropped.
    expect(textsTo(chat).join("\n")).not.toContain("DSA assignment");
  });

  it("silences an overdue task after one message, until its deadline changes", async () => {
    const { uid, chat } = await linkedUser();
    await put(uid, [op("settings", "me", { tz: "Asia/Singapore", quiet_start: 1320, quiet_end: 480 }), taskOp("task-o", "Oz report", { size: "S", deadline: "2026-10-04", runway_start: "2026-10-01" })]);
    const overdueTexts = () => textsTo(chat).filter((t) => t.includes("was due "));

    await planAndSend(sg(DAY, "08:00:31"));
    expect(overdueTexts()).toEqual(["Oz report was due yesterday and isn't marked done. Still relevant?"]);

    // The next two days: the task is still overdue, and nothing more is said about it.
    for (const day of ["2026-10-06", "2026-10-07"]) for (const t of ["08:00:31", "12:00:31", "16:00:31", "19:00:31", "21:00:31"]) await tick(sg(day, t));
    expect(overdueTexts()).toHaveLength(1);

    // Rescheduled to a date that has also passed: a new deadline, so one new overdue message.
    await put(uid, [op("tasks", "task-o", { deadline: "2026-10-06" })], sg("2026-10-08", "08:00:10"));
    await planAndSend(sg("2026-10-08", "08:00:31"));
    expect(overdueTexts()).toHaveLength(2);
    expect((await env.DB.prepare("SELECT deadline FROM sends WHERE user_id = ? AND kind = 'overdue' ORDER BY due_at").bind(uid).all()).results).toEqual([{ deadline: "2026-10-04" }, { deadline: "2026-10-06" }]);

    for (const t of ["12:00:31", "16:00:31", "21:00:31"]) await tick(sg("2026-10-08", t));
    for (const t of ["08:00:31", "12:00:31", "19:00:31"]) await tick(sg("2026-10-09", t));
    expect(overdueTexts()).toHaveLength(2);
  });

  it("counts a snooze or an untouched message's 5 hours of silence when it places the rest of the day", async () => {
    // Close nudges for DSA assignment are due at 19:00. A snooze at 18:50 keeps anything out of [18:50, 19:20).
    const { uid, chat } = await linkedUser();
    await seedMei(uid);
    await planAndSend(sg(DAY, "08:00:31"));
    await env.DB.prepare("UPDATE sends SET snoozed_at = ?1 WHERE user_id = ?2 AND kind = 'deadline_day'").bind(sg(DAY, "18:50:00"), uid).run();
    await put(uid, [op("tasks", "task-e", { title: "Reply to a recruiter" })], sg(DAY, "18:51:00"));
    await tick(sg(DAY, "18:51:31"));
    const close = await env.DB.prepare("SELECT due_at FROM sends WHERE user_id = ? AND kind = 'close'").bind(uid).first<{ due_at: number }>();
    expect(close!.due_at).toBeGreaterThanOrEqual(sg(DAY, "19:20:00"));
    expect(textsTo(chat)).toHaveLength(1);
  });
});

// --- Sending -----------------------------------------------------------------------------------------------------

describe("claiming and sending", () => {
  it("sends each row once when two ticks overlap", async () => {
    const { uid, chat } = await linkedUser({ planned: true });
    const NOW = sg(DAY, "08:00:31");
    await seedSends(Array.from({ length: 12 }, (_, i) => ({ uid, id: `row-${i}`, due_at: NOW - 1000 - i, text: `message ${i}` })));
    sendDelayMs = 5;

    const [a, b] = await Promise.all([tick(NOW), tick(NOW)]);

    expect(a.claimed + b.claimed).toBe(12);
    expect(a.sent + b.sent).toBe(12);
    expect(textsTo(chat).sort()).toEqual(Array.from({ length: 12 }, (_, i) => `message ${i}`).sort());
    expect(await count("SELECT COUNT(*) AS n FROM sends WHERE sent_at IS NOT NULL AND attempts = 1")).toBe(12);
  });

  it("claims at most 20 rows a tick, oldest first, and leaves the rest for the next", async () => {
    const { uid, chat } = await linkedUser({ planned: true });
    const NOW = sg(DAY, "08:00:31");
    await seedSends(Array.from({ length: 25 }, (_, i) => ({ uid, id: `row-${String(i).padStart(2, "0")}`, due_at: NOW - 60_000 + i, text: `m${i}` })));
    const first = await tick(NOW);
    expect(first).toMatchObject({ claimed: MAX_SENDS, sent: MAX_SENDS });
    expect(textsTo(chat)).toEqual(Array.from({ length: 20 }, (_, i) => `m${i}`));
    const second = await tick(NOW + 60_000);
    expect(second).toMatchObject({ claimed: 5, sent: 5 });
  });

  it("drops a row more than 30 minutes past due instead of sending it late, and sends the one that is only a little late (audit #15)", async () => {
    const { uid, chat } = await linkedUser({ planned: true });
    const NOW = sg(DAY, "18:00:31");
    const old = await seedSend({ uid, due_at: sg(DAY, "12:00:00"), text: "the twelve o'clock one" });
    const late = await seedSend({ uid, due_at: NOW - 20 * 60_000, text: "a tick or two late" });

    const report = await tick(NOW);

    expect(report).toMatchObject({ claimed: 1, sent: 1 });
    expect(textsTo(chat)).toEqual(["a tick or two late"]);
    expect(await sendRow(old)).toMatchObject({ sent_at: null, claimed_at: null, attempts: 0 });
    expect(await sendRow(late)).toMatchObject({ sent_at: NOW });
  });

  it("does not send a row before it is due", async () => {
    const { uid } = await linkedUser({ planned: true });
    await seedSend({ uid, due_at: sg(DAY, "08:00:00") });
    await tick(sg(DAY, "07:59:59"));
    expect(calls).toEqual([]);
  });

  it("retries a crashed claim, but not one that is still fresh", async () => {
    const { uid, chat } = await linkedUser({ planned: true });
    const NOW = sg(DAY, "09:00:31");
    const stale = await seedSend({ uid, due_at: NOW - 600_000, claimed_at: NOW - 6 * 60_000, attempts: 1, text: "crashed" });
    const fresh = await seedSend({ uid, due_at: NOW - 600_000, claimed_at: NOW - 4 * 60_000, attempts: 1, text: "in flight" });

    await tick(NOW);

    expect(textsTo(chat)).toEqual(["crashed"]);
    expect(await sendRow(stale)).toMatchObject({ sent_at: NOW, attempts: 2 });
    expect(await sendRow(fresh)).toMatchObject({ sent_at: null, attempts: 1 });
  });

  it("gives up after five failed attempts, one every five minutes", async () => {
    const { uid, chat } = await linkedUser({ planned: true });
    statusFor[chat] = 500;
    const NOW = sg(DAY, "09:00:31");
    const id = await seedSend({ uid, due_at: NOW - 1000 });

    await tick(NOW);
    await tick(NOW + 60_000); // a minute later: still waiting out its claim
    expect(calls).toHaveLength(1);

    for (let i = 1; i <= 8; i++) await tick(NOW + i * 6 * 60_000);
    expect(calls).toHaveLength(5);
    expect(await sendRow(id)).toMatchObject({ sent_at: null, attempts: 5, cancelled: 0 });
    // A 5xx is not "blocked": the user stays linked.
    expect((await env.DB.prepare("SELECT channel FROM users WHERE id = ?").bind(uid).first<{ channel: string }>())!.channel).toBe("telegram");
  });

  it("treats a send that never got an answer as a failed attempt too", async () => {
    const { uid } = await linkedUser({ planned: true });
    vi.mocked(fetch).mockImplementation(async () => {
      throw new Error("connection reset by https://api.telegram.org/bot" + TOKEN);
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await seedSend({ uid, due_at: sg(DAY, "09:00:00") });
    await tick(sg(DAY, "09:00:31"));
    expect(await sendRow(id)).toMatchObject({ sent_at: null, attempts: 1 });
    expect(spy.mock.calls.flat().join(" ")).not.toContain(TOKEN);
  });

  it("cancels a blocked user's unsent rows and clears the channel on a 403, leaving other users alone", async () => {
    const blocked = await linkedUser({ planned: true });
    const fine = await linkedUser({ planned: true });
    statusFor[blocked.chat] = 403;
    const NOW = sg(DAY, "09:00:31");
    const due1 = await seedSend({ uid: blocked.uid, due_at: NOW - 2000 });
    const due2 = await seedSend({ uid: blocked.uid, due_at: NOW - 1000 });
    const later = await seedSend({ uid: blocked.uid, kind: "wrap_up", due_at: sg(DAY, "21:00:00") });
    const other = await seedSend({ uid: fine.uid, due_at: NOW - 1000, text: "for the other user" });

    const report = await tick(NOW);

    expect(report).toMatchObject({ claimed: 3, sent: 1, blocked: 1 });
    expect(calls.filter((c) => c.chat_id === blocked.chat)).toHaveLength(1); // the second due row was not even tried
    for (const id of [due1, due2, later]) expect(await sendRow(id)).toMatchObject({ sent_at: null, cancelled: 1 });
    expect(await sendRow(other)).toMatchObject({ cancelled: 0 });
    expect(textsTo(fine.chat)).toEqual(["for the other user"]);
    const user = await env.DB.prepare("SELECT channel, telegram_chat_id FROM users WHERE id = ?").bind(blocked.uid).first();
    expect(user).toEqual({ channel: null, telegram_chat_id: blocked.chat });

    // Nothing more goes to the blocked chat, even when the later row falls due.
    await tick(sg(DAY, "21:00:31"));
    expect(calls.filter((c) => c.chat_id === blocked.chat)).toHaveLength(1);
  });

  it("does nothing, and burns no attempt, when the bot token is not set", async () => {
    const { uid } = await linkedUser({ planned: true });
    const id = await seedSend({ uid, due_at: sg(DAY, "09:00:00") });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await runTick({ ...env }, sg(DAY, "09:00:31"));
    expect(calls).toEqual([]);
    expect(await sendRow(id)).toMatchObject({ claimed_at: null, attempts: 0 });
    expect(spy).toHaveBeenCalled();
  });
});

describe("the cron entry point", () => {
  const controller = (cron: string, scheduledTime: number) => ({ cron, scheduledTime, type: "scheduled", noRetry() {} }) as unknown as ScheduledController;

  it("runs a tick for the every-minute schedule, using the instant it was scheduled for", async () => {
    const { uid, chat } = await linkedUser({ planned: true });
    await seedSend({ uid, due_at: sg(DAY, "09:00:00"), text: "via cron" });
    await worker.scheduled!(controller("* * * * *", sg(DAY, "09:00:31")), testEnv as unknown as typeof env);
    expect(textsTo(chat)).toEqual(["via cron"]);
  });

  it("runs retention on the daily schedule, and sends nothing", async () => {
    const { uid } = await linkedUser({ planned: true });
    await seedSend({ uid, due_at: sg(DAY, "09:00:00") });
    const now = sg(DAY, "03:00:00");
    await env.DB.prepare("INSERT INTO users (id, created_at, last_seen_at) VALUES ('idle-user', 0, ?1)").bind(now - 366 * 86_400_000).run();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await worker.scheduled!(controller("0 19 * * *", now), testEnv as unknown as typeof env);
    expect(calls).toEqual([]);
    expect(await env.DB.prepare("SELECT id FROM users WHERE id = 'idle-user'").first()).toBeNull();
    expect(log).toHaveBeenCalledWith("retention", expect.stringMatching(/"users":[1-9]/)); // the fixture user may be old too
  });

  it("ignores a schedule it has no handler for", async () => {
    const { uid } = await linkedUser({ planned: true });
    await seedSend({ uid, due_at: sg(DAY, "09:00:00") });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await worker.scheduled!(controller("30 4 * * *", sg(DAY, "09:00:31")), testEnv as unknown as typeof env);
    expect(calls).toEqual([]);
    expect(spy).toHaveBeenCalled();
  });
});

// --- Web push (slice 18) -----------------------------------------------------------------------------------------

/** A user whose channel is web push, with `subs` browsers subscribed (the oldest first). `chat` links a Telegram chat as well. */
async function pushUser(opts: { subs?: number; planned?: boolean; chat?: string | null } = {}) {
  const { uid, chat } = await linkedUser({ planned: opts.planned, channel: "push", chat: opts.chat ?? null });
  const endpoints: string[] = [];
  for (let i = 0; i < (opts.subs ?? 1); i++) {
    const endpoint = `${PUSH_HOST}${crypto.randomUUID()}`;
    browsers.set(endpoint, await browserSubscription(endpoint));
    endpoints.push(endpoint);
  }
  await env.DB.batch(
    endpoints.map((e, i) => {
      const { sub } = browsers.get(e)!;
      return env.DB.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(uid, e, sub.p256dh, sub.auth, i + 1);
    }),
  );
  return { uid, endpoints, chat };
}

/** What each push to this endpoint carried, decrypted the way its browser would. */
async function payloadsTo(endpoint: string): Promise<{ text: string; url: string }[]> {
  const { sub, privateKey } = browsers.get(endpoint)!;
  return Promise.all(pushCalls.filter((c) => c.endpoint === endpoint).map(async (c) => JSON.parse(new TextDecoder().decode(await decryptPayload(c.body, privateKey, sub)))));
}
const subsOf = async (uid: string) => (await env.DB.prepare("SELECT endpoint FROM push_subscriptions WHERE user_id = ? ORDER BY created_at").bind(uid).all<{ endpoint: string }>()).results.map((r) => r.endpoint);
const channelOf = async (uid: string) => (await env.DB.prepare("SELECT channel FROM users WHERE id = ?").bind(uid).first<{ channel: string | null }>())!.channel;

describe("web push", () => {
  it("sends a due message to each of the user's browsers, and to nobody on Telegram: one channel per message", async () => {
    const pushy = await pushUser({ subs: 2, planned: true });
    const telegram = await linkedUser({ planned: true });
    const NOW = sg(DAY, "09:00:31");
    const pushId = await seedSend({ uid: pushy.uid, due_at: NOW - 1000, text: "Today's ready: 3 things." });
    await seedSend({ uid: telegram.uid, due_at: NOW - 1000, text: "for telegram" });

    const report = await tick(NOW);

    expect(report).toMatchObject({ claimed: 2, sent: 2, blocked: 0 });
    expect(pushCalls.map((c) => c.endpoint).sort()).toEqual([...pushy.endpoints].sort());
    for (const e of pushy.endpoints) expect(await payloadsTo(e)).toEqual([{ text: "Today's ready: 3 things.", url: expect.stringContaining(`${ORIGIN}/?h=`) }]);
    expect(textsTo(telegram.chat)).toEqual(["for telegram"]);
    expect(calls).toHaveLength(1); // nothing went to Telegram for the push user
    expect(await sendRow(pushId)).toMatchObject({ sent_at: NOW, attempts: 1, cancelled: 0, tg_message_id: null });
    for (const c of pushCalls) {
      expect(c.headers["Content-Encoding"]).toBe("aes128gcm");
      expect(c.headers.Authorization).toMatch(/^vapid t=/);
    }
  });

  it("opens the app where Telegram's link does: the send, its sign-in code, and the task for a message about one task", async () => {
    const { uid, endpoints } = await pushUser({ planned: true });
    const NOW = sg(DAY, "09:00:31");
    const [overdue, morning] = await seedSends([
      { uid, kind: "overdue", task_ids: ["task-x"], due_at: NOW - 3000, text: "overdue text" },
      { uid, kind: "morning", due_at: NOW - 2000, text: "morning text" },
      { uid, kind: "close", task_ids: ["t1", "t2"], due_at: NOW - 1000, text: "batch text" },
    ]);

    await tick(NOW);

    const urls = new Map((await payloadsTo(endpoints[0])).map((p) => [p.text, new URL(p.url)]));
    const handoff = (text: string) => env.DB.prepare("SELECT user_id, purpose, expires_at FROM handoffs WHERE code = ?").bind(urls.get(text)!.searchParams.get("h")).first();
    expect(urls.get("overdue text")!.origin).toBe(ORIGIN);
    expect(urls.get("overdue text")!.searchParams.get("s")).toBe(overdue);
    expect(urls.get("overdue text")!.searchParams.get("t")).toBe("task-x");
    expect(urls.get("morning text")!.searchParams.get("s")).toBe(morning);
    expect(urls.get("morning text")!.searchParams.has("t")).toBe(false); // Today's morning confirm
    expect(urls.get("batch text")!.searchParams.has("t")).toBe(false); // several tasks: Today
    for (const text of ["overdue text", "morning text", "batch text"]) expect(await handoff(text)).toEqual({ user_id: uid, purpose: "login_link", expires_at: NOW + 24 * 3_600_000 });  });

  it("plans a push user's day like a Telegram user's and sends the planned message", async () => {
    const { uid, endpoints } = await pushUser({ planned: false });
    await seedMei(uid);

    const report = await planAndSend(sg(DAY, "08:00:31"));

    expect(report.planned).toBe(1);
    expect(report.sent).toBeGreaterThanOrEqual(1);
    const row = (await env.DB.prepare("SELECT id, text FROM sends WHERE user_id = ? AND sent_at IS NOT NULL").bind(uid).first<{ id: string; text: string }>())!;
    expect((await payloadsTo(endpoints[0])).map((p) => p.text)).toContain(row.text);
  });

  it("neither plans nor sends for a user on the push channel with no subscription left", async () => {
    const orphan = await linkedUser({ channel: "push", chat: null });
    await put(orphan.uid, [op("settings", "me", { tz: "Asia/Singapore", quiet_start: 1320, quiet_end: 480 }), taskOp("orphan-task", "Orphan", { size: "S", deadline: DAY, runway_start: DAY })]);
    const planned = await linkedUser({ channel: "push", chat: null, planned: true });
    const id = await seedSend({ uid: planned.uid, due_at: sg(DAY, "08:00:00") });

    const report = await tick(sg(DAY, "08:00:31"));

    expect(report).toMatchObject({ planned: 0, claimed: 0, sent: 0 });
    expect(pushCalls).toEqual([]);
    expect(await sendRow(id)).toMatchObject({ claimed_at: null, attempts: 0 });
  });

  describe("a subscription the push service has dropped (404 or 410)", () => {
    for (const status of [404, 410]) {
      it(`${status}: deletes it; with none left and no Telegram, cancels the unsent messages and clears the channel`, async () => {
        const { uid, endpoints } = await pushUser({ planned: true });
        pushStatusFor[endpoints[0]] = status;
        const NOW = sg(DAY, "09:00:31");
        const due = await seedSend({ uid, due_at: NOW - 1000 });
        const later = await seedSend({ uid, kind: "wrap_up", due_at: sg(DAY, "21:00:00") });

        const report = await tick(NOW);

        expect(report).toMatchObject({ claimed: 1, sent: 0 });
        expect(await subsOf(uid)).toEqual([]);
        expect(await channelOf(uid)).toBeNull();
        expect(await sendRow(due)).toMatchObject({ sent_at: null, attempts: 1, cancelled: 1 });
        expect(await sendRow(later)).toMatchObject({ sent_at: null, cancelled: 1 });
        await tick(sg(DAY, "21:00:31"));
        expect(pushCalls).toHaveLength(1); // nothing more is attempted
      });
    }

    it("with a Telegram chat linked, hands the channel to Telegram, which then delivers the waiting message", async () => {
      const { uid, endpoints, chat } = await pushUser({ planned: true, chat: "5550001" });
      pushStatusFor[endpoints[0]] = 410;
      const NOW = sg(DAY, "09:00:31");
      const id = await seedSend({ uid, due_at: NOW - 1000, text: "waiting" });

      await tick(NOW);
      expect(await channelOf(uid)).toBe("telegram");
      expect(await sendRow(id)).toMatchObject({ sent_at: null, cancelled: 0, attempts: 1 });

      await tick(NOW + 6 * 60_000); // the claim is 5 minutes old now
      expect(textsTo(chat)).toEqual(["waiting"]);
      expect(await sendRow(id)).toMatchObject({ sent_at: NOW + 6 * 60_000, attempts: 2 });
    });

    it("drops only the dead browser: the message still counts as sent and the channel stays push", async () => {
      const { uid, endpoints } = await pushUser({ subs: 2, planned: true });
      pushStatusFor[endpoints[0]] = 410;
      const NOW = sg(DAY, "09:00:31");
      const id = await seedSend({ uid, due_at: NOW - 1000 });

      const report = await tick(NOW);

      expect(report).toMatchObject({ claimed: 1, sent: 1 });
      expect(await subsOf(uid)).toEqual([endpoints[1]]);
      expect(await channelOf(uid)).toBe("push");
      expect(await sendRow(id)).toMatchObject({ sent_at: NOW, cancelled: 0 });
    });

    it("does not ask a dead endpoint twice in one tick", async () => {
      const { uid, endpoints } = await pushUser({ planned: true });
      pushStatusFor[endpoints[0]] = 410;
      const NOW = sg(DAY, "09:00:31");
      await seedSends([1, 2, 3].map((i) => ({ uid, due_at: NOW - 1000 * i })));
      await tick(NOW);
      expect(pushCalls).toHaveLength(1);
    });
  });

  describe("other failures", () => {
    it("count an attempt like Telegram's, keep the subscription, and are retried after the claim is 5 minutes old", async () => {
      const { uid, endpoints } = await pushUser({ planned: true });
      pushStatusFor[endpoints[0]] = 503;
      const NOW = sg(DAY, "09:00:31");
      const id = await seedSend({ uid, due_at: NOW - 1000 });
      vi.spyOn(console, "error").mockImplementation(() => {});

      expect(await tick(NOW)).toMatchObject({ claimed: 1, sent: 0 });
      expect(await sendRow(id)).toMatchObject({ sent_at: null, attempts: 1 });
      expect(await subsOf(uid)).toEqual(endpoints);
      expect(await channelOf(uid)).toBe("push");

      await tick(NOW + 60_000); // still inside the 5 minutes: not claimed
      expect(pushCalls).toHaveLength(1);

      pushStatusFor = {};
      expect(await tick(NOW + 6 * 60_000)).toMatchObject({ claimed: 1, sent: 1 });
      expect(await sendRow(id)).toMatchObject({ sent_at: NOW + 6 * 60_000, attempts: 2 });
    });

    it("count as sent when one browser took the message and another failed, so the message is not sent twice", async () => {
      const { uid, endpoints } = await pushUser({ subs: 2, planned: true });
      pushStatusFor[endpoints[1]] = 500;
      vi.spyOn(console, "error").mockImplementation(() => {});
      const NOW = sg(DAY, "09:00:31");
      const id = await seedSend({ uid, due_at: NOW - 1000 });
      expect(await tick(NOW)).toMatchObject({ sent: 1 });
      expect(await sendRow(id)).toMatchObject({ sent_at: NOW });
    });
  });

  it("claims only the channels that are set up: without VAPID, push rows wait and burn no attempt, and Telegram goes on", async () => {
    const pushy = await pushUser({ planned: true });
    const telegram = await linkedUser({ planned: true });
    const NOW = sg(DAY, "09:00:31");
    const pushId = await seedSend({ uid: pushy.uid, due_at: NOW - 1000 });
    await seedSend({ uid: telegram.uid, due_at: NOW - 1000, text: "for telegram" });

    const report = await runTick({ ...testEnv, VAPID_PRIVATE_KEY: undefined }, NOW);

    expect(report).toMatchObject({ claimed: 1, sent: 1 });
    expect(pushCalls).toEqual([]);
    expect(await sendRow(pushId)).toMatchObject({ claimed_at: null, attempts: 0 });
    // And the other way round: without the bot token the push user is still served.
    expect(await runTick({ ...testEnv, TG_BOT_TOKEN: undefined }, NOW + 60_000)).toMatchObject({ claimed: 1, sent: 1 });
    expect(pushCalls).toHaveLength(1);
  });

  it("sends each row once when two ticks overlap", async () => {
    const { uid } = await pushUser({ planned: true });
    const NOW = sg(DAY, "09:00:31");
    await seedSends(Array.from({ length: 6 }, (_, i) => ({ uid, due_at: NOW - 1000 - i })));
    const [a, b] = await Promise.all([tick(NOW), tick(NOW)]);
    expect(a.claimed + b.claimed).toBe(6);
    expect(pushCalls).toHaveLength(6);
  });
});

// --- Budget ------------------------------------------------------------------------------------------------------

// Counts D1 statements the way the platform does: each query is one, and each statement of a batch is one.
function countingDb(db: D1Database) {
  let n = 0;
  const targets = new WeakMap<object, D1PreparedStatement>();
  const wrap = (st: D1PreparedStatement): D1PreparedStatement => {
    const proxy: D1PreparedStatement = new Proxy(st, {
      get(target, prop) {
        if (prop === "bind") return (...args: unknown[]) => wrap(target.bind(...args));
        if (prop === "run" || prop === "all" || prop === "first" || prop === "raw") {
          return (...args: unknown[]) => {
            n++;
            return (target[prop] as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(target, prop);
      },
    });
    targets.set(proxy, st);
    return proxy;
  };
  const counted = new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") return (sql: string) => wrap(target.prepare(sql));
      if (prop === "batch") {
        return (stmts: D1PreparedStatement[]) => {
          n += stmts.length;
          return target.batch(stmts.map((s) => targets.get(s) ?? s));
        };
      }
      return Reflect.get(target, prop);
    },
  });
  return { db: counted as D1Database, statements: () => n };
}

describe("budget", () => {
  it("keeps a full tick (20 sends and a planning backlog) under 50 D1 statements and 50 subrequests", async () => {
    const NOW = sg(DAY, "08:00:31");
    // Eight users waiting to be planned, each with a deadline task, so each plan writes rows.
    for (let i = 0; i < 8; i++) {
      const { uid } = await linkedUser();
      await put(uid, [op("settings", "me", { tz: "Asia/Singapore", quiet_start: 1320, quiet_end: 480 }), taskOp(`bt-${i}`, `Task ${i}`, { size: "S", deadline: DAY, runway_start: DAY })]);
    }
    // A user with 30 messages due: more than a tick may send.
    const busy = await linkedUser({ planned: true });
    await seedSends(Array.from({ length: 30 }, (_, i) => ({ uid: busy.uid, due_at: NOW - 60_000 + i })));

    const counter = countingDb(env.DB);
    const report = await runTick({ ...testEnv, DB: counter.db }, NOW);

    expect(report.planned).toBe(MAX_PLANNED);
    expect(report.claimed).toBe(MAX_SENDS);
    expect(calls).toHaveLength(MAX_SENDS);
    expect(counter.statements()).toBeLessThan(50);
  });

  it("stays under the limit when the sends are 403s, which clean up after themselves", async () => {
    const NOW = sg(DAY, "08:00:31");
    for (let i = 0; i < 8; i++) {
      const { uid } = await linkedUser();
      await put(uid, [op("settings", "me", { tz: "Asia/Singapore", quiet_start: 1320, quiet_end: 480 }), taskOp(`bt-${i}`, `Task ${i}`, { size: "S", deadline: DAY, runway_start: DAY })]);
    }
    for (let i = 0; i < 20; i++) {
      const u = await linkedUser({ planned: true });
      statusFor[u.chat] = 403;
      await seedSend({ uid: u.uid, due_at: NOW - 60_000 });
    }
    const counter = countingDb(env.DB);
    const report = await runTick({ ...testEnv, DB: counter.db }, NOW);
    expect(report.blocked).toBeGreaterThan(0);
    expect(counter.statements()).toBeLessThan(50);
  });

  // 20 users at the most browsers a user may keep: the worst case for subrequests.
  it("keeps a full tick of web push (20 users, every browser they keep, and a planning backlog) under 50 subrequests and 50 statements", async () => {
    const NOW = sg(DAY, "08:00:31");
    for (let i = 0; i < 8; i++) {
      const { uid } = await linkedUser();
      await put(uid, [op("settings", "me", { tz: "Asia/Singapore", quiet_start: 1320, quiet_end: 480 }), taskOp(`bt-${i}`, `Task ${i}`, { size: "S", deadline: DAY, runway_start: DAY })]);
    }
    for (let i = 0; i < MAX_SENDS + 5; i++) {
      const u = await pushUser({ subs: MAX_SUBSCRIPTIONS, planned: true });
      await seedSend({ uid: u.uid, due_at: NOW - 60_000 + i });
      if (i === 0) pushStatusFor[u.endpoints[0]] = 410; // every message is still sent, and the clean-up statements are spent too
    }

    const counter = countingDb(env.DB);
    const report = await runTick({ ...testEnv, DB: counter.db }, NOW);

    expect(report.planned).toBe(MAX_PLANNED);
    expect(report.claimed).toBe(MAX_SENDS);
    expect(report.sent).toBe(MAX_SENDS);
    expect(pushCalls).toHaveLength(MAX_SENDS * MAX_SUBSCRIPTIONS);
    expect(pushCalls.length + calls.length).toBeLessThan(50);
    expect(counter.statements()).toBeLessThan(50);
  });

  it("stays under the limits when every push is a 410 and every Telegram send a 403, which clean up after themselves", async () => {
    const NOW = sg(DAY, "08:00:31");
    for (let i = 0; i < 8; i++) {
      const { uid } = await linkedUser();
      await put(uid, [op("settings", "me", { tz: "Asia/Singapore", quiet_start: 1320, quiet_end: 480 }), taskOp(`bt-${i}`, `Task ${i}`, { size: "S", deadline: DAY, runway_start: DAY })]);
    }
    for (let i = 0; i < MAX_SENDS; i++) {
      if (i % 2) {
        const u = await linkedUser({ planned: true });
        statusFor[u.chat] = 403;
        await seedSend({ uid: u.uid, due_at: NOW - 60_000 });
      } else {
        const u = await pushUser({ subs: MAX_SUBSCRIPTIONS, planned: true });
        for (const e of u.endpoints) pushStatusFor[e] = 410;
        await seedSend({ uid: u.uid, due_at: NOW - 60_000 });
      }
    }
    const counter = countingDb(env.DB);
    const report = await runTick({ ...testEnv, DB: counter.db }, NOW);
    expect(report.blocked).toBeGreaterThan(0);
    expect(await count("SELECT COUNT(*) AS n FROM push_subscriptions")).toBe(0);
    expect(pushCalls.length + calls.length).toBeLessThan(50);
    expect(counter.statements()).toBeLessThan(50);
  });
});
