import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleCallback,
  MAX_SNOOZE_TASKS,
  messageKeyboard,
  rescheduleMenu,
  removePrompt,
  snoozeMenu,
  snoozeTime,
  type ButtonTap,
  type DayShape,
} from "./buttons";
import worker from "./index";
import type { Op } from "./protocol";
import { runTick } from "./scheduler";
import { sync } from "./sync";
import { botCall } from "./telegram";

// Worker + D1 tests for slice 13 (Tech_Scope.md §4.5, §6, §10; UX_Flows.md §5): the Telegram state buttons. Real local
// D1, outbound Telegram fetch mocked with vi.spyOn as in telegram.test.ts. `handleCallback` takes `now`, so the clock is
// explicit; the webhook tests go through worker.fetch to prove the callback uses the same auth as messages.

const TOKEN = "123456:TEST-TOKEN";
const WEBHOOK_PATH = "path-secret";
const WEBHOOK_SECRET = "header-secret";
const testEnv = { ...env, TG_BOT_USERNAME: "ember_test_bot", TG_BOT_TOKEN: TOKEN, TG_WEBHOOK_SECRET: WEBHOOK_SECRET, TG_WEBHOOK_PATH: WEBHOOK_PATH };
const ORIGIN = env.APP_ORIGIN;

// Local Singapore time (UTC+8, no DST) as unix ms. DAY is Monday 2026-10-05 (Tech_Scope.md §4.6).
const sg = (day: string, time: string) => Date.parse(`${day}T${time}+08:00`);
const DAY = "2026-10-05";
const NEXT = "2026-10-06"; // a Tuesday

// The simulated D1 takes 50-100 ms a statement, and these tests run ticks and several callbacks each.
vi.setConfig({ testTimeout: 60_000 });

interface BotCallRecord {
  method: string;
  body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
let calls: BotCallRecord[] = [];
let nextMessageId = 100;
beforeEach(async () => {
  calls = [];
  nextMessageId = 100;
  // The scheduler scans every user, so tests start from an empty database.
  for (const t of ["sends", "handoffs", "sessions", "chunks", "tasks", "hard_blocks", "days", "settings", "ops", "users"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const m = new RegExp(`^https://api.telegram.org/bot${TOKEN}/(\\w+)$`).exec(url);
    if (!m) throw new Error(`unexpected outbound fetch: ${url}`);
    calls.push({ method: m[1], body: JSON.parse(String(init?.body)) });
    return Response.json({ ok: true, result: m[1] === "sendMessage" ? { message_id: nextMessageId++ } : true });
  });
});
afterEach(() => vi.restoreAllMocks());

const edits = () => calls.filter((c) => c.method === "editMessageText" || c.method === "editMessageReplyMarkup");
const lastEdit = () => edits().at(-1)!;
const labels = (markup: { inline_keyboard: { text: string }[][] }) => markup.inline_keyboard.map((row) => row.map((b) => b.text));

// --- Seeding -----------------------------------------------------------------------------------------------------

let nextChat = 9_000_000;
async function linkedUser(): Promise<{ uid: string; chat: string }> {
  const uid = `user-${crypto.randomUUID().slice(0, 18)}`;
  const chat = String(nextChat++);
  await env.DB.prepare("INSERT INTO users (id, created_at, last_seen_at, channel, telegram_chat_id) VALUES (?1, 0, 0, 'telegram', ?2)").bind(uid, chat).run();
  return { uid, chat };
}

const op = (entity: Op["entity"], id: string, fields: Record<string, unknown>): Op => ({ op_id: crypto.randomUUID(), entity, id, fields });
const taskOp = (id: string, title: string, fields: Record<string, unknown>) => op("tasks", id, { title, state: "active", created_at: 1, updated_at: 1, ...fields });
const SETTINGS = op("settings", "me", { tz: "Asia/Singapore", quiet_start: 1320, quiet_end: 480 });

/** Writes through the real sync path, so every change bumps `users.rev` as a client's would. */
async function put(uid: string, ops: Op[], now = Date.now()) {
  const { rejected } = await sync(env.DB, uid, 0, ops, now);
  expect(rejected).toEqual([]);
}

interface SendSeed {
  uid: string;
  kind: string;
  task_ids: string[];
  message: number;
  text?: string;
  day?: string;
  sent_at?: number;
}
async function seedSend(s: SendSeed): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB
    .prepare("INSERT INTO sends (id, user_id, day, kind, task_ids, due_at, text, claimed_at, sent_at, attempts, tg_message_id, deadline) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?6, ?6, 1, ?8, NULL)")
    .bind(id, s.uid, s.day ?? DAY, s.kind, JSON.stringify(s.task_ids), s.sent_at ?? sg(DAY, "08:00:00"), s.text ?? `original text of ${id}`, s.message)
    .run();
  return id;
}

const taskRow = (id: string) =>
  env.DB
    .prepare("SELECT state, deadline, runway_start, snoozed_until, rev FROM tasks WHERE id = ?")
    .bind(id)
    .first<{ state: string; deadline: string | null; runway_start: string | null; snoozed_until: number | null; rev: number }>();
const sendRow = (id: string) => env.DB.prepare("SELECT acted_at, snoozed_at, sent_at FROM sends WHERE id = ?").bind(id).first<{ acted_at: number | null; snoozed_at: number | null; sent_at: number | null }>();
const userRev = async (uid: string) => (await env.DB.prepare("SELECT rev FROM users WHERE id = ?").bind(uid).first<{ rev: number }>())!.rev;
const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())!.n;

let nextCallback = 1;
/** A button tap, as the webhook would hand it over. */
function tap(data: string, o: { chat: string; message: number; now?: number; id?: string; env?: typeof testEnv }) {
  const cq: ButtonTap = { id: o.id ?? `cb-${nextCallback++}`, data, chatId: Number(o.chat), messageId: o.message };
  return handleCallback(o.env ?? testEnv, cq, (method, payload) => botCall(o.env ?? testEnv, method, payload), o.now ?? Date.now());
}

/** A user with a sent message of `kind` about the given tasks (all seeded `active` unless the fields say otherwise). */
async function userWithSend(kind: string, tasks: { id: string; title: string; fields?: Record<string, unknown> }[], extra: Partial<SendSeed> = {}) {
  const { uid, chat } = await linkedUser();
  await put(uid, [SETTINGS, ...tasks.map((t) => taskOp(t.id, t.title, { size: "S", deadline: DAY, runway_start: "2026-10-01", ...t.fields }))]);
  const send = await seedSend({ uid, kind, task_ids: tasks.map((t) => t.id), message: 500, ...extra });
  return { uid, chat, send, message: 500 };
}

const overdueSetup = () => userWithSend("overdue", [{ id: "t-over", title: "Lab report", fields: { state: "overdue", deadline: "2026-10-04" } }]);

// --- The keyboards -----------------------------------------------------------------------------------------------

describe("the keyboards", () => {
  const uuid = () => crypto.randomUUID();
  const kinds = ["morning", "light_day", "close", "deadline_day", "overdue", "wrap_up"] as const;

  it("puts the state buttons where UX_Flows §5 says, beside or under the link buttons", () => {
    const k = (kind: (typeof kinds)[number], ids: string[] = [uuid()]) => messageKeyboard(ORIGIN, { id: uuid(), kind, task_ids: ids }, "code".padEnd(22, "x"))!;
    expect(labels(k("overdue"))).toEqual([["Open today", "Start a session"], ["Reschedule", "Done", "Remove from list"]]);
    expect(labels(k("close"))).toEqual([["Open today", "Start a session", "Snooze"]]);
    expect(labels(k("close", [uuid(), uuid(), uuid()]))).toEqual([["Open today", "Start a session", "Snooze"]]); // batched
    expect(labels(k("light_day"))).toEqual([["Open today", "Not today"]]);
    expect(labels(k("morning"))).toEqual([["Open today"]]);
    expect(labels(k("deadline_day"))).toEqual([["Open today", "Start a session"]]);
    expect(labels(k("wrap_up"))).toEqual([["Open today"]]);
  });

  it("keeps the state buttons when there is no origin to link to", () => {
    expect(labels(messageKeyboard(undefined, { id: uuid(), kind: "overdue", task_ids: [uuid()] }, undefined)!)).toEqual([["Reschedule", "Done", "Remove from list"]]);
    expect(messageKeyboard(undefined, { id: uuid(), kind: "morning", task_ids: [] }, undefined)).toBeUndefined();
  });

  it("never produces a callback_data over 64 bytes, whatever the ids", () => {
    const longId = "x".repeat(64);
    const boards = [
      ...kinds.map((kind) => messageKeyboard(ORIGIN, { id: longId, kind, task_ids: [longId, longId] }, "c".repeat(22))!).filter(Boolean),
      snoozeMenu(),
      rescheduleMenu(`${ORIGIN}/?h=${"c".repeat(22)}&s=${longId}&t=${longId}&pick=1`),
      removePrompt(),
    ];
    const data = boards.flatMap((b) => b.inline_keyboard.flat()).flatMap((b) => ("callback_data" in b ? [b.callback_data as string] : []));
    expect(data.length).toBeGreaterThan(10);
    for (const d of data) expect(new TextEncoder().encode(d).length).toBeLessThanOrEqual(64);
    expect(new Set(data).size).toBe(data.length); // every action has its own code
  });
});

// --- Snooze times ------------------------------------------------------------------------------------------------

describe("snoozeTime (Tech_Scope.md §4.5)", () => {
  const shape: DayShape = { tz: "Asia/Singapore", quietStart: 1320, quietEnd: 480, blocks: [] };
  const at = (time: string, day = NEXT) => sg(day, time);

  it("1 hour is now + 60 minutes", () => {
    expect(snoozeTime("1h", at("15:00:31"), shape)).toBe(at("16:00:31"));
  });
  it("This evening is S3, the waking window's end minus 3 hours: 19:00 for 08:00-22:00", () => {
    expect(snoozeTime("evening", at("15:00:31"), shape)).toBe(at("19:00:00"));
  });
  it("Tomorrow is the next day's S1, 08:00", () => {
    expect(snoozeTime("tomorrow", at("15:00:31"), shape)).toBe(sg("2026-10-07", "08:00:00"));
  });
  it("Tomorrow after midnight still means the next day of the user's calendar of days: 02:00 belongs to the day before", () => {
    expect(snoozeTime("tomorrow", sg("2026-10-07", "02:00:00"), shape)).toBe(sg("2026-10-07", "08:00:00"));
  });
  it("This evening, once S3 has passed, takes the next free slot (S4, 21:00), then tomorrow's S1", () => {
    expect(snoozeTime("evening", at("19:30:31"), shape)).toBe(at("21:00:00"));
    expect(snoozeTime("evening", at("21:30:31"), shape)).toBe(sg("2026-10-07", "08:00:00"));
  });
  it("1 hour that would land in quiet hours moves to tomorrow's S1, because the planner drops a snooze in quiet hours", () => {
    expect(snoozeTime("1h", at("21:30:31"), shape)).toBe(sg("2026-10-07", "08:00:00"));
    expect(snoozeTime("1h", at("21:00:00"), shape)).toBe(sg("2026-10-07", "08:00:00")); // 22:00 sharp is already quiet
    expect(snoozeTime("1h", at("20:59:59"), shape)).toBe(at("21:59:59"));
  });
  it("a slot inside a hard block moves to the block's end", () => {
    const blocked: DayShape = { ...shape, blocks: [{ weekdays: [1], start_min: 1080, end_min: 1200 }] }; // Tuesdays 18:00-20:00
    expect(snoozeTime("evening", at("15:00:31"), blocked)).toBe(at("20:00:00"));
    expect(snoozeTime("evening", at("15:00:31"), { ...shape, blocks: [{ weekdays: [0], start_min: 1080, end_min: 1200 }] })).toBe(at("19:00:00")); // a Monday block does not apply
  });
  it("respects another time zone and other quiet hours", () => {
    const ny: DayShape = { tz: "America/New_York", quietStart: 1380, quietEnd: 420, blocks: [] }; // waking 07:00-23:00, S3 = 20:00 (EDT, UTC-4)
    expect(snoozeTime("evening", Date.parse("2026-10-06T14:00:00Z"), ny)).toBe(Date.parse("2026-10-07T00:00:00Z"));
    expect(snoozeTime("tomorrow", Date.parse("2026-10-06T14:00:00Z"), ny)).toBe(Date.parse("2026-10-07T11:00:00Z")); // 07:00 EDT
  });
});

// --- Done, Remove, Keep it ---------------------------------------------------------------------------------------

describe("Done", () => {
  it("marks the task done, answers the tap, edits the message and removes the buttons, and records the send as acted", async () => {
    const { uid, chat, send, message } = await overdueSetup();
    const revBefore = await userRev(uid);
    const now = sg(DAY, "10:00:00");
    await tap("d", { chat, message, now, id: "cb-done-1" });

    expect((await taskRow("t-over"))!.state).toBe("done");
    expect(await userRev(uid)).toBeGreaterThan(revBefore); // the scheduler replans on a rev bump
    expect(calls[0]).toEqual({ method: "answerCallbackQuery", body: { callback_query_id: "cb-done-1" } });
    expect(edits()).toHaveLength(1);
    expect(lastEdit()).toEqual({ method: "editMessageText", body: { chat_id: Number(chat), message_id: message, text: "Marked done.", reply_markup: { inline_keyboard: [] } } });
    expect((await sendRow(send))!.acted_at).toBe(now);
    expect(await count("SELECT COUNT(*) AS n FROM ops WHERE user_id = ? AND op_id = 'tg:cb-done-1'", uid)).toBe(1);
  });

  it("stamps done_at with the time of the tap", async () => {
    const { chat, message } = await overdueSetup();
    const now = sg(DAY, "10:00:00");
    await tap("d", { chat, message, now, id: "cb-done-at" });
    const row = await env.DB.prepare("SELECT done_at, updated_at FROM tasks WHERE id = 't-over'").first<{ done_at: number | null; updated_at: number }>();
    expect(row).toEqual({ done_at: now, updated_at: now });
  });

  it("answers the callback even when the code is not one of ours", async () => {
    const { chat, message } = await overdueSetup();
    await tap("zz", { chat, message, id: "cb-odd" });
    expect(calls).toEqual([{ method: "answerCallbackQuery", body: { callback_query_id: "cb-odd" } }]);
  });

  it("the same callback delivered twice applies once", async () => {
    const { uid, chat, message } = await overdueSetup();
    await tap("d", { chat, message, id: "cb-twice" });
    const rev = await userRev(uid);
    const taskRev = (await taskRow("t-over"))!.rev;
    await tap("d", { chat, message, id: "cb-twice" });

    expect(await userRev(uid)).toBe(rev);
    expect((await taskRow("t-over"))!.rev).toBe(taskRev);
    expect(await count("SELECT COUNT(*) AS n FROM ops WHERE user_id = ? AND op_id LIKE 'tg:cb-twice%'", uid)).toBe(1);
    expect(lastEdit().body.text).toBe("Marked done."); // the redelivery confirms again; it is not told "Already done."
  });

  it("a stale Done on a task already done in the app says so and changes nothing", async () => {
    const { uid, chat, message } = await overdueSetup();
    await put(uid, [op("tasks", "t-over", { state: "done", updated_at: 5 })]);
    const rev = await userRev(uid);
    const taskRev = (await taskRow("t-over"))!.rev;

    await tap("d", { chat, message, id: "cb-stale" });

    expect(lastEdit().body).toMatchObject({ text: "Already done.", reply_markup: { inline_keyboard: [] } });
    expect(await userRev(uid)).toBe(rev);
    expect((await taskRow("t-over"))!.rev).toBe(taskRev);
    expect(await count("SELECT COUNT(*) AS n FROM ops WHERE op_id = 'tg:cb-stale'")).toBe(0);
  });

  it("a Done on a task removed in the app is refused honestly, not marked done", async () => {
    const { uid, chat, message } = await overdueSetup();
    await put(uid, [op("tasks", "t-over", { state: "removed", updated_at: 5 })]);
    await tap("d", { chat, message });
    expect((await taskRow("t-over"))!.state).toBe("removed");
    expect(lastEdit().body.text).toBe("Already removed.");
  });
});

describe("Remove from list", () => {
  it("asks first, in the chat, with Keep it and Remove; nothing changes yet", async () => {
    const { uid, chat, message } = await overdueSetup();
    const rev = await userRev(uid);
    await tap("x", { chat, message });

    expect(lastEdit()).toEqual({
      method: "editMessageText",
      body: {
        chat_id: Number(chat),
        message_id: message,
        text: 'Remove "Lab report" from your list?',
        reply_markup: { inline_keyboard: [[{ text: "Keep it", callback_data: expect.any(String) }, { text: "Remove", callback_data: expect.any(String) }]] },
      },
    });
    expect((await taskRow("t-over"))!.state).toBe("overdue");
    expect(await userRev(uid)).toBe(rev);
  });

  it("Keep it restores the original message and buttons and changes nothing", async () => {
    const { uid, chat, message, send } = await overdueSetup();
    const original = (await env.DB.prepare("SELECT text FROM sends WHERE id = ?").bind(send).first<{ text: string }>())!.text;
    const rev = await userRev(uid);
    await tap("x", { chat, message });
    const keep = (lastEdit().body.reply_markup.inline_keyboard[0][0] as { callback_data: string }).callback_data;
    await tap(keep, { chat, message });

    expect(lastEdit().body.text).toBe(original);
    expect(labels(lastEdit().body.reply_markup)).toEqual([["Open today", "Start a session"], ["Reschedule", "Done", "Remove from list"]]);
    expect((await taskRow("t-over"))!.state).toBe("overdue");
    expect(await userRev(uid)).toBe(rev);
    expect((await sendRow(send))!.acted_at).toBeNull();
  });

  it("Remove marks the task removed and confirms", async () => {
    const { uid, chat, message, send } = await overdueSetup();
    await tap("x", { chat, message });
    const remove = (lastEdit().body.reply_markup.inline_keyboard[0][1] as { callback_data: string }).callback_data;
    const now = sg(DAY, "10:00:00");
    await tap(remove, { chat, message, now, id: "cb-remove" });

    expect((await taskRow("t-over"))!.state).toBe("removed");
    expect(lastEdit().body).toMatchObject({ text: "Moved out of the way. It's still here if you want it back.", reply_markup: { inline_keyboard: [] } });
    expect((await sendRow(send))!.acted_at).toBe(now);
    expect(await count("SELECT COUNT(*) AS n FROM ops WHERE user_id = ? AND op_id = 'tg:cb-remove'", uid)).toBe(1);
  });

  it("Remove on a task that was finished in the app says Already done and keeps it", async () => {
    const { uid, chat, message } = await overdueSetup();
    await put(uid, [op("tasks", "t-over", { state: "done", updated_at: 5 })]);
    await tap("xr", { chat, message });
    expect((await taskRow("t-over"))!.state).toBe("done");
    expect(lastEdit().body.text).toBe("Already done.");
  });
});

// --- Snooze ------------------------------------------------------------------------------------------------------

describe("Snooze", () => {
  const closeSetup = (extra: Partial<SendSeed> = {}) =>
    userWithSend("close", [{ id: "t-close", title: "Tax form", fields: { deadline: "2026-10-08" } }], { day: NEXT, ...extra });
  const NOW = sg(NEXT, "15:00:31");

  it("swaps the buttons for 1 hour, This evening and Tomorrow and keeps the text", async () => {
    const { uid, chat, message } = await closeSetup();
    const rev = await userRev(uid);
    await tap("s", { chat, message, now: NOW });
    expect(lastEdit()).toEqual({
      method: "editMessageReplyMarkup",
      body: { chat_id: Number(chat), message_id: message, reply_markup: { inline_keyboard: [[{ text: "1 hour", callback_data: expect.any(String) }, { text: "This evening", callback_data: expect.any(String) }, { text: "Tomorrow", callback_data: expect.any(String) }]] } },
    });
    expect((await taskRow("t-close"))!.snoozed_until).toBeNull();
    expect(await userRev(uid)).toBe(rev);
  });

  it.each([
    ["1 hour", sg(NEXT, "16:00:31"), "Snoozed until 16:00."],
    ["This evening", sg(NEXT, "19:00:00"), "Snoozed until 19:00."],
    ["Tomorrow", sg("2026-10-07", "08:00:00"), "Snoozed until tomorrow, 08:00."],
  ])("%s sets snoozed_until and sends.snoozed_at, never moves the deadline, and confirms in local time", async (choice, until, confirmation) => {
    const { uid, chat, message, send } = await closeSetup();
    await tap("s", { chat, message, now: NOW });
    const code = (lastEdit().body.reply_markup.inline_keyboard[0] as { text: string; callback_data: string }[]).find((b) => b.text === choice)!.callback_data;
    const rev = await userRev(uid);
    await tap(code, { chat, message, now: NOW, id: `cb-${choice}` });

    const t = (await taskRow("t-close"))!;
    expect(t.snoozed_until).toBe(until);
    expect(t.deadline).toBe("2026-10-08");
    expect(t.state).toBe("active");
    expect((await sendRow(send))!.snoozed_at).toBe(NOW);
    expect((await sendRow(send))!.acted_at).toBeNull();
    expect(await userRev(uid)).toBeGreaterThan(rev);
    expect(lastEdit().body).toMatchObject({ text: confirmation, reply_markup: { inline_keyboard: [] } });
  });

  it("a batched message snoozes every task in it that is still live, and skips one finished in the app", async () => {
    const tasks = ["a", "b", "c"].map((n) => ({ id: `t-${n}`, title: `Task ${n}`, fields: { deadline: "2026-10-08" } }));
    const { uid, chat, message } = await userWithSend("close", tasks, { day: NEXT });
    await put(uid, [op("tasks", "t-c", { state: "done", updated_at: 5 })]);
    await tap("s1", { chat, message, now: NOW });
    expect((await taskRow("t-a"))!.snoozed_until).toBe(sg(NEXT, "16:00:31"));
    expect((await taskRow("t-b"))!.snoozed_until).toBe(sg(NEXT, "16:00:31"));
    expect((await taskRow("t-c"))!.snoozed_until).toBeNull();
    expect(lastEdit().body.text).toBe("Snoozed until 16:00.");
  });

  it("a stale Snooze on a finished task says so and changes nothing", async () => {
    const { uid, chat, message, send } = await closeSetup();
    await put(uid, [op("tasks", "t-close", { state: "done", updated_at: 5 })]);
    await tap("s1", { chat, message, now: NOW });
    expect((await taskRow("t-close"))!.snoozed_until).toBeNull();
    expect((await sendRow(send))!.snoozed_at).toBeNull();
    expect(lastEdit().body.text).toBe("Already done.");
  });

  it("the next tick's replan puts the message at the snooze time and sends it then", async () => {
    // One close task, no blocks: the day plan is morning 08:00, a close nudge at 15:00 and a second at 19:00.
    const { uid, chat } = await linkedUser();
    await put(uid, [SETTINGS, taskOp("t-tax", "Tax form", { size: "M", deadline: "2026-10-08", runway_start: "2026-10-01" })]);
    await runTick(testEnv, sg(NEXT, "08:00:31"));
    await runTick(testEnv, sg(NEXT, "15:00:31"));
    const sent = calls.filter((c) => c.method === "sendMessage");
    expect(sent.map((c) => c.body.text)).toEqual(["Today's ready: 1 thing. First up: Tax form.", "Tax form\nThis deadline's getting close. Want help breaking it down?"]);
    const closeMessage = 101; // the second message sent; ids start at 100

    await tap("s1", { chat, message: closeMessage, now: sg(NEXT, "15:05:00") });
    expect((await taskRow("t-tax"))!.snoozed_until).toBe(sg(NEXT, "16:05:00"));

    await runTick(testEnv, sg(NEXT, "15:06:31")); // replans: users.rev moved
    const planned = (await env.DB.prepare("SELECT kind, due_at, sent_at FROM sends WHERE user_id = ? AND sent_at IS NULL ORDER BY due_at").bind(uid).all()).results;
    expect(planned[0]).toEqual({ kind: "close", due_at: sg(NEXT, "16:05:00"), sent_at: null });

    await runTick(testEnv, sg(NEXT, "16:04:31"));
    expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(2); // not yet
    await runTick(testEnv, sg(NEXT, "16:05:31"));
    expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(3);
  });
});

// --- Reschedule --------------------------------------------------------------------------------------------------

describe("Reschedule", () => {
  const NOW = sg(DAY, "12:00:00");

  it("swaps the buttons for Tomorrow, In 3 days and Pick a date, which links into the app with a sign-in code", async () => {
    const { uid, chat, message, send } = await overdueSetup();
    await tap("r", { chat, message, now: NOW });
    const row = lastEdit().body.reply_markup.inline_keyboard[0] as { text: string; callback_data?: string; url?: string }[];
    expect(row.map((b) => b.text)).toEqual(["Tomorrow", "In 3 days", "Pick a date"]);
    const url = new URL(row[2].url!);
    expect(url.origin).toBe(ORIGIN);
    expect(url.searchParams.get("s")).toBe(send);
    expect(url.searchParams.get("t")).toBe("t-over");
    expect(url.searchParams.get("pick")).toBe("1");
    const code = url.searchParams.get("h")!;
    expect(await env.DB.prepare("SELECT user_id, purpose, expires_at FROM handoffs WHERE code = ?").bind(code).first()).toEqual({ user_id: uid, purpose: "login_link", expires_at: NOW + 24 * 3_600_000 });
    expect((await taskRow("t-over"))!.deadline).toBe("2026-10-04");
  });

  it.each([
    ["Tomorrow", "2026-10-06", "Moved to Tue 6 Oct."],
    ["In 3 days", "2026-10-08", "Moved to Thu 8 Oct."],
  ])("%s moves the deadline and the runway start, brings the task back to active, and confirms", async (choice, deadline, confirmation) => {
    const { chat, message, send } = await overdueSetup();
    await tap("r", { chat, message, now: NOW });
    const code = (lastEdit().body.reply_markup.inline_keyboard[0] as { text: string; callback_data?: string }[]).find((b) => b.text === choice)!.callback_data!;
    await tap(code, { chat, message, now: NOW });

    expect(await taskRow("t-over")).toMatchObject({ state: "active", deadline, runway_start: DAY });
    expect(lastEdit().body).toMatchObject({ text: confirmation, reply_markup: { inline_keyboard: [] } });
    expect((await sendRow(send))!.acted_at).toBe(NOW);
  });

  it("lifts the overdue silence: once the new deadline passes, the task gets its overdue message again", async () => {
    // Sent for deadline 10-04; the row remembers that deadline, so the task is silenced until the deadline changes.
    const { uid, chat, message, send } = await overdueSetup();
    await env.DB.prepare("UPDATE sends SET deadline = '2026-10-04' WHERE id = ?").bind(send).run();
    await tap("r1", { chat, message, now: NOW });
    expect((await taskRow("t-over"))!.deadline).toBe(NEXT);

    // Wednesday 10-07: the task is overdue again (deadline 10-06).
    await runTick(testEnv, sg("2026-10-07", "08:00:31"));
    const sent = calls.filter((c) => c.method === "sendMessage");
    expect(sent.map((c) => c.body.text)).toContain("Lab report was due today and isn't marked done. Still relevant?");
    expect(await count("SELECT COUNT(*) AS n FROM sends WHERE user_id = ? AND kind = 'overdue' AND sent_at IS NOT NULL", uid)).toBe(2);
  });

  it("a stale Reschedule on a task finished in the app says so and changes nothing", async () => {
    const { uid, chat, message } = await overdueSetup();
    await put(uid, [op("tasks", "t-over", { state: "done", updated_at: 5 })]);
    await tap("r1", { chat, message, now: NOW });
    expect(await taskRow("t-over")).toMatchObject({ state: "done", deadline: "2026-10-04" });
    expect(lastEdit().body.text).toBe("Already done.");
  });
});

// --- Not today ---------------------------------------------------------------------------------------------------

describe("Not today", () => {
  const NOW = sg(DAY, "08:00:40");
  const lightSetup = () => userWithSend("light_day", [{ id: "t-far", title: "System design ch. 3", fields: { size: "M", deadline: null, runway_start: null } }]);

  it("defers the task for today, in the days row, and confirms", async () => {
    const { uid, chat, message, send } = await lightSetup();
    const rev = await userRev(uid);
    await tap("n", { chat, message, now: NOW });

    const day = await env.DB.prepare("SELECT deferred FROM days WHERE user_id = ? AND day = ?").bind(uid, DAY).first<{ deferred: string }>();
    expect(JSON.parse(day!.deferred)).toEqual(["t-far"]);
    expect(await userRev(uid)).toBeGreaterThan(rev);
    expect(lastEdit().body).toMatchObject({ text: "Okay, not today.", reply_markup: { inline_keyboard: [] } });
    expect((await sendRow(send))!.acted_at).toBe(NOW);
  });

  it("keeps what the day had already deferred, and does not add a task twice", async () => {
    const { uid, chat, message } = await lightSetup();
    await put(uid, [op("days", DAY, { deferred: ["other"] })]);
    await tap("n", { chat, message, now: NOW });
    await tap("n", { chat, message, now: NOW });
    const day = await env.DB.prepare("SELECT deferred FROM days WHERE user_id = ? AND day = ?").bind(uid, DAY).first<{ deferred: string }>();
    expect(JSON.parse(day!.deferred)).toEqual(["other", "t-far"]);
  });

  it("a stale Not today on a task finished in the app changes nothing", async () => {
    const { uid, chat, message } = await lightSetup();
    await put(uid, [op("tasks", "t-far", { state: "done", updated_at: 5 })]);
    await tap("n", { chat, message, now: NOW });
    expect(await count("SELECT COUNT(*) AS n FROM days WHERE user_id = ?", uid)).toBe(0);
    expect(lastEdit().body.text).toBe("Already done.");
  });
});

// --- Who may tap -------------------------------------------------------------------------------------------------

describe("who may tap", () => {
  it("a callback from a chat that is not linked answers the tap and changes nothing", async () => {
    const { uid, message } = await overdueSetup();
    const rev = await userRev(uid);
    await tap("d", { chat: "123", message, id: "cb-stranger" });
    expect(calls).toEqual([{ method: "answerCallbackQuery", body: { callback_query_id: "cb-stranger" } }]);
    expect((await taskRow("t-over"))!.state).toBe("overdue");
    expect(await userRev(uid)).toBe(rev);
  });

  it("a linked user tapping the message id of someone else's send changes nothing of theirs or the other's", async () => {
    const owner = await overdueSetup();
    const other = await linkedUser();
    await put(other.uid, [SETTINGS, taskOp("t-mine", "Mine", { size: "S", deadline: DAY, runway_start: DAY })]);
    await tap("d", { chat: other.chat, message: owner.message, id: "cb-wrong-chat" });
    expect((await taskRow("t-over"))!.state).toBe("overdue");
    expect((await taskRow("t-mine"))!.state).toBe("active");
    expect(edits()).toEqual([]);
  });

  it("a send that names another user's task cannot act on it", async () => {
    const victim = await linkedUser();
    await put(victim.uid, [SETTINGS, taskOp("t-victim", "Victim's task", { size: "S", deadline: DAY, runway_start: DAY })]);
    const attacker = await linkedUser();
    await put(attacker.uid, [SETTINGS]);
    await seedSend({ uid: attacker.uid, kind: "overdue", task_ids: ["t-victim"], message: 77 });
    await tap("d", { chat: attacker.chat, message: 77 });
    expect((await taskRow("t-victim"))!.state).toBe("active");
    expect(lastEdit().body.text).toBe("That's changed since. Open Ember to see where it stands.");
  });

  it("a callback with no message (an inline-mode tap) is answered and ignored", async () => {
    await overdueSetup();
    await handleCallback(testEnv, { id: "cb-nomsg", data: "d", chatId: null, messageId: null }, (m, p) => botCall(testEnv, m, p), Date.now());
    expect(calls).toEqual([{ method: "answerCallbackQuery", body: { callback_query_id: "cb-nomsg" } }]);
  });
});

// --- The webhook -------------------------------------------------------------------------------------------------

describe("the webhook", () => {
  const post = (body: unknown, header = WEBHOOK_SECRET) =>
    worker.fetch(
      new Request(`${ORIGIN}/api/tg/${WEBHOOK_PATH}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": header }, body: JSON.stringify(body) }) as Parameters<typeof worker.fetch>[0],
      testEnv,
    );
  const callback = (chat: string, message: number, data: string, id = `wh-${nextCallback++}`) => ({
    update_id: nextCallback + 100_000,
    callback_query: { id, data, from: { id: Number(chat) }, message: { message_id: message, chat: { id: Number(chat), type: "private" } } },
  });

  it("handles a Done tap with the same authentication as a message", async () => {
    const { chat, message } = await overdueSetup();
    expect((await post(callback(chat, message, "d"))).status).toBe(200);
    expect((await taskRow("t-over"))!.state).toBe("done");
    expect(calls.map((c) => c.method)).toEqual(["answerCallbackQuery", "editMessageText"]);
  });

  it("refuses a callback with the wrong secret header, and does nothing", async () => {
    const { chat, message } = await overdueSetup();
    expect((await post(callback(chat, message, "d"), "wrong")).status).toBe(404);
    expect((await taskRow("t-over"))!.state).toBe("overdue");
    expect(calls).toEqual([]);
  });

  it("answers 200 and still works when the Bot API refuses to edit the message (it was deleted)", async () => {
    const { chat, message } = await overdueSetup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return url.endsWith("/answerCallbackQuery") ? Response.json({ ok: true, result: true }) : Response.json({ ok: false, description: "message to edit not found" }, { status: 400 });
    });
    expect((await post(callback(chat, message, "d"))).status).toBe(200);
    expect((await taskRow("t-over"))!.state).toBe("done");
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

describe("budget (one webhook call is one invocation: 50 D1 statements, 50 subrequests)", () => {
  it("the widest callback, Snooze on a batch of MAX_SNOOZE_TASKS tasks, stays under 50 statements and 3 subrequests", async () => {
    const tasks = Array.from({ length: MAX_SNOOZE_TASKS }, (_, i) => ({ id: `t-${i}`, title: `Task ${i}`, fields: { deadline: "2026-10-08" } }));
    const { chat, message } = await userWithSend("close", tasks, { day: NEXT });
    const counter = countingDb(env.DB);
    await tap("se", { chat, message, now: sg(NEXT, "15:00:31"), env: { ...testEnv, DB: counter.db } });

    for (const i of [0, MAX_SNOOZE_TASKS - 1]) expect((await taskRow(`t-${i}`))!.snoozed_until).toBe(sg(NEXT, "19:00:00"));
    expect(counter.statements()).toBeLessThan(50);
    expect(calls.length).toBeLessThanOrEqual(3);
  });

  it("every other button costs far less", async () => {
    const { chat, message } = await overdueSetup();
    for (const [data, id] of [["x", "b1"], ["r", "b2"], ["r1", "b3"]] as const) {
      const counter = countingDb(env.DB);
      await tap(data, { chat, message, id, now: sg(DAY, "12:00:00"), env: { ...testEnv, DB: counter.db } });
      expect(counter.statements()).toBeLessThanOrEqual(14);
    }
  });
});
