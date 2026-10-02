import { dayOf } from "../core/day";
import { blockSpans, clearOfBlocks, localToMs, slotOffsets, type MessageKind } from "../core/messages";
import { addDays } from "../core/today";
import { newUserId } from "./identity";
import type { Op } from "./protocol";
import { sync } from "./sync";
import type { BotResult } from "./telegram";

// The Telegram state buttons (Tech_Scope.md §4.5, §6; UX_Flows.md §5; slice 13): the keyboard each message carries, and
// what a tap on it does. Link buttons open the app; state buttons are handled here without opening it.
//
// callback_data is a short action code and nothing else (at most 2 bytes; Telegram allows 64, and a UUID is 36, so a
// task id plus a send id would not fit). The tap names its message (chat id + message id, which the update already
// carries), and `sends.tg_message_id` (stamped by the scheduler) leads from there to the send, its task ids, and its
// user. So a tap can only ever act on the tasks of a send that was delivered to the tapper's own chat.
//
// Budget: one webhook call is one invocation, 50 D1 statements and 50 subrequests (§11). Worst case is Snooze on a batch
// of MAX_SNOOZE_TASKS = 30 tasks:
//   send + user + settings (one JOIN) 1, the tasks 1, hard blocks 1,
//   sync: ledger and row lookup 2, then one batch of rev guard 1 + rev bump 1 + ledger 1 + 30 writes + pull 2 +
//   cursor 1 = 36, mark the send 1                                                          = 42, under 50.
// A tap that loses the sync race (SyncConflict) fails the webhook with 500, and Telegram redelivers it.
// Subrequests: answerCallbackQuery and one edit, 2. (Reschedule's menu adds one INSERT for its sign-in code.)

export interface ButtonsEnv {
  DB: D1Database;
  /** Var: the app's origin, for the link buttons and *Pick a date*. */
  APP_ORIGIN?: string;
}

/** A button tap as the webhook parses it. `chatId` and `messageId` are null when Telegram did not say (inline-mode taps). */
export interface ButtonTap {
  id: string; // callback_query.id: the deterministic part of the op id
  data: string;
  chatId: number | null;
  messageId: number | null;
}

/** Calls one Bot API method. Never throws. */
export type BotCall = (method: string, payload: Record<string, unknown>) => Promise<BotResult>;

export type Button = { text: string; url: string } | { text: string; callback_data: string };
export interface Keyboard {
  inline_keyboard: Button[][];
}

export const LOGIN_LINK_TTL_MS = 24 * 3_600_000; // §6
export const MAX_SNOOZE_TASKS = 30; // a batched message snoozes at most this many tasks; see the budget above
const DEFAULT_TZ = "Asia/Singapore"; // a null tz means "the browser's"; core falls back to the same zone

// Confirmation copy. UX_Flows §5 gives the first three; the rest is proposed and not yet seen by Natalie.
const COPY = {
  done: "Marked done.",
  removed: "Moved out of the way. It's still here if you want it back.",
  notToday: "Okay, not today.", // proposed
  alreadyDone: "Already done.",
  alreadyRemoved: "Already removed.", // proposed
  changed: "That's changed since. Open Ember to see where it stands.", // proposed: the task is gone or in a state no button fits
};

// --- The keyboards -----------------------------------------------------------------------------------------------

// Action codes. Every code is used by exactly one button.
const CODE = {
  done: "d",
  ask: "x", // Remove from list: asks first
  keep: "xk",
  remove: "xr",
  snoozeMenu: "s",
  snooze1h: "s1",
  snoozeEvening: "se",
  snoozeTomorrow: "st",
  rescheduleMenu: "r",
  reschedule1: "r1",
  reschedule3: "r3",
  notToday: "n",
} as const;

const cb = (text: string, callback_data: string): Button => ({ text, callback_data });

/** What a message needs to know about its send to build its buttons. */
export interface KeyboardSend {
  id: string;
  kind: MessageKind;
  task_ids: string[];
}

const START_KINDS = new Set<MessageKind>(["deadline_day", "overdue", "close"]);

// The link buttons (slice 12) carry the send id and the message's sign-in code; "Start a session" also names the task.
// The state buttons (UX_Flows §5) sit beside them, except Overdue's three, which go on a row of their own.
export function messageKeyboard(origin: string | undefined, send: KeyboardSend, code: string | undefined): Keyboard | undefined {
  const row: Button[] = [];
  if (origin && code) {
    const link = (task?: string) => `${origin}/?h=${code}&s=${send.id}${task ? `&t=${task}` : ""}`;
    row.push({ text: "Open today", url: link() });
    if (START_KINDS.has(send.kind) && send.task_ids[0]) row.push({ text: "Start a session", url: link(send.task_ids[0]) });
  }
  if (send.kind === "close") row.push(cb("Snooze", CODE.snoozeMenu));
  if (send.kind === "light_day") row.push(cb("Not today", CODE.notToday));

  const rows = row.length ? [row] : [];
  if (send.kind === "overdue") rows.push([cb("Reschedule", CODE.rescheduleMenu), cb("Done", CODE.done), cb("Remove from list", CODE.ask)]);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

export const snoozeMenu = (): Keyboard => ({ inline_keyboard: [[cb("1 hour", CODE.snooze1h), cb("This evening", CODE.snoozeEvening), cb("Tomorrow", CODE.snoozeTomorrow)]] });

/** *Pick a date* is a link into the app; without an origin to link to it is left out. */
export const rescheduleMenu = (pickUrl?: string): Keyboard => ({
  inline_keyboard: [[cb("Tomorrow", CODE.reschedule1), cb("In 3 days", CODE.reschedule3), ...(pickUrl ? [{ text: "Pick a date", url: pickUrl }] : [])]],
});

export const removePrompt = (): Keyboard => ({ inline_keyboard: [[cb("Keep it", CODE.keep), cb("Remove", CODE.remove)]] });

// --- Snooze times (§4.5) -----------------------------------------------------------------------------------------

export interface DayShape {
  tz: string;
  quietStart: number; // minutes after local midnight
  quietEnd: number;
  blocks: { weekdays: number[]; start_min: number; end_min: number }[];
}

// Slots use the planner's own rules (core/messages.ts), so a snooze lands where the planner would put a message.

export type SnoozeChoice = "1h" | "evening" | "tomorrow";

/**
 * When a snoozed message comes back. 1 hour = now + 60 minutes; This evening = S3; Tomorrow = the next day's S1. Two
 * cases the docs do not spell out, both settled so the confirmation never promises a time the planner would not honour:
 *   - S3 has already passed: the next free slot after it (S4), then tomorrow's S1, as the planner places a message.
 *   - 1 hour would land in quiet hours (the planner drops a snooze there): tomorrow's S1.
 */
export function snoozeTime(choice: SnoozeChoice, now: number, shape: DayShape): number {
  const { tz, quietStart, quietEnd } = shape;
  const len = (quietStart - quietEnd + 1440) % 1440 || 1440;
  const slot = (day: string, index: 0 | 2 | 3) => {
    const raw = slotOffsets(len)[index];
    const cleared = clearOfBlocks(raw, blockSpans(shape.blocks, day, quietEnd));
    return localToMs(day, quietEnd + (cleared < len ? cleared : raw), tz);
  };
  const today = dayOf(now, tz, quietEnd);
  const tomorrow = () => slot(addDays(today, 1), 0);

  switch (choice) {
    case "1h": {
      const t = now + 3_600_000;
      const day = dayOf(t, tz, quietEnd);
      return t >= localToMs(day, quietEnd + len, tz) ? slot(addDays(day, 1), 0) : t;
    }
    case "evening":
      return [slot(today, 2), slot(today, 3)].find((t) => t > now) ?? tomorrow();
    case "tomorrow":
      return tomorrow();
  }
}

// --- Copy helpers ------------------------------------------------------------------------------------------------

const calendarDate = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
const clockTime = (tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const weekdayShort = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "Snoozed until 18:00." in the user's local time; a time on another calendar day says "tomorrow". */
function snoozedText(until: number, now: number, tz: string): string {
  const time = clockTime(tz).format(until);
  return calendarDate(tz).format(until) === calendarDate(tz).format(now) ? `Snoozed until ${time}.` : `Snoozed until tomorrow, ${time}.`;
}

/** "Moved to Fri 10 Oct." (proposed copy). */
const movedText = (day: string) => `Moved to ${weekdayShort.format(Date.parse(day))} ${dayMonth.format(Date.parse(day))}.`;

// --- Handling a tap ----------------------------------------------------------------------------------------------

type Action = { menu: "snooze" | "reschedule" | "ask" | "keep" } | { change: "done" | "remove" | "notToday" | `snooze:${SnoozeChoice}` | "reschedule:1" | "reschedule:3" };

const ACTIONS: Record<string, Action> = {
  [CODE.snoozeMenu]: { menu: "snooze" },
  [CODE.rescheduleMenu]: { menu: "reschedule" },
  [CODE.ask]: { menu: "ask" },
  [CODE.keep]: { menu: "keep" },
  [CODE.done]: { change: "done" },
  [CODE.remove]: { change: "remove" },
  [CODE.notToday]: { change: "notToday" },
  [CODE.snooze1h]: { change: "snooze:1h" },
  [CODE.snoozeEvening]: { change: "snooze:evening" },
  [CODE.snoozeTomorrow]: { change: "snooze:tomorrow" },
  [CODE.reschedule1]: { change: "reschedule:1" },
  [CODE.reschedule3]: { change: "reschedule:3" },
};

// The send a tap belongs to, found through the chat and the message id, with the user's day shape, and whether this very
// callback was already applied (its op is in the ledger).
interface Context {
  send_id: string;
  kind: MessageKind;
  task_ids: string[];
  text: string;
  user_id: string;
  tz: string;
  quiet_start: number;
  quiet_end: number;
  replay: boolean;
}

async function loadContext(db: D1Database, chatId: number, messageId: number, opId: string): Promise<Context | null> {
  const row = await db
    .prepare(
      `SELECT s.id AS send_id, s.kind, s.task_ids, s.text, u.id AS user_id, st.tz AS tz,
              COALESCE(st.quiet_start, 1320) AS quiet_start, COALESCE(st.quiet_end, 480) AS quiet_end,
              EXISTS (SELECT 1 FROM ops o WHERE o.user_id = u.id AND o.op_id = ?3) AS replay
       FROM users u JOIN sends s ON s.user_id = u.id LEFT JOIN settings st ON st.user_id = u.id AND st.id = 'me'
       WHERE u.telegram_chat_id = ?1 AND s.tg_message_id = ?2 LIMIT 1`,
    )
    .bind(String(chatId), messageId, opId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    send_id: row.send_id as string,
    kind: row.kind as MessageKind,
    task_ids: JSON.parse(String(row.task_ids)) as string[],
    text: row.text as string,
    user_id: row.user_id as string,
    tz: (row.tz as string | null) ?? DEFAULT_TZ,
    quiet_start: row.quiet_start as number,
    quiet_end: row.quiet_end as number,
    replay: row.replay === 1,
  };
}

interface TaskRow {
  id: string;
  title: string;
  state: string;
  deadline: string | null;
  snoozed_until: number | null;
}

// The send's tasks, in the send's order. A task id that is not this user's simply comes back missing.
async function loadTasks(db: D1Database, ctx: Context): Promise<TaskRow[]> {
  const { results } = await db
    .prepare("SELECT id, title, state, deadline, snoozed_until FROM tasks WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))")
    .bind(ctx.user_id, JSON.stringify(ctx.task_ids))
    .all<TaskRow>();
  return ctx.task_ids.flatMap((id) => results.filter((t) => t.id === id));
}

const isLive = (t: TaskRow) => t.state === "active" || t.state === "overdue";

// What to tell the user when the task is not in a state the button fits.
const staleText = (t: TaskRow | undefined) => (t?.state === "done" ? COPY.alreadyDone : t?.state === "removed" ? COPY.alreadyRemoved : COPY.changed);

// A sign-in code for a link button on a restored or swapped keyboard, minted the way the scheduler mints one (§6).
async function mintLoginCode(db: D1Database, uid: string, now: number): Promise<string> {
  const code = newUserId();
  await db.prepare("INSERT INTO handoffs (code, user_id, purpose, expires_at) VALUES (?1, ?2, 'login_link', ?3)").bind(code, uid, now + LOGIN_LINK_TTL_MS).run();
  return code;
}

/**
 * One tap on a state button. Always answers the callback, so the spinner stops. Changes go through the exported `sync`
 * with op id `tg:<callback id>`: a repeated delivery finds its op in the ledger and applies nothing, and the slice 9 rules
 * judge it like any client's change. A D1 failure is let through (the webhook answers 500 and Telegram redelivers, which
 * is safe for the same reason); a failed answer or edit is only logged, because the change is already saved.
 */
export async function handleCallback(env: ButtonsEnv, tap: ButtonTap, bot: BotCall, now: number): Promise<void> {
  const answered = await bot("answerCallbackQuery", { callback_query_id: tap.id });
  if (!answered.ok) console.error("telegram answerCallbackQuery failed", answered.status, answered.description);

  const action = ACTIONS[tap.data];
  if (!action || tap.chatId === null || tap.messageId === null) return;
  const ctx = await loadContext(env.DB, tap.chatId, tap.messageId, opId(tap, 0));
  if (!ctx) return; // not a linked chat, or not a message of ours

  const where = { chat_id: tap.chatId, message_id: tap.messageId };
  const edit = async (text: string | null, markup: Keyboard) => {
    const r = text === null ? await bot("editMessageReplyMarkup", { ...where, reply_markup: markup }) : await bot("editMessageText", { ...where, text, reply_markup: markup });
    if (!r.ok) console.error("telegram edit failed", r.status, r.description);
  };
  const done = (text: string) => edit(text, { inline_keyboard: [] });

  if ("menu" in action) return showMenu(env, ctx, action.menu, now, edit);

  const [state, choice] = action.change.split(":");
  const tasks = await loadTasks(env.DB, ctx);
  const first = tasks[0];
  const shape = await dayShape(env.DB, ctx, state === "snooze" && choice !== "1h");
  const today = dayOf(now, shape.tz, shape.quietEnd);

  // A callback already applied (a redelivery): confirm again from what is stored and change nothing.
  if (ctx.replay) {
    const stored = storedConfirmation(state, choice, tasks, shape, now);
    await mark(env.DB, ctx, state === "snooze" ? "snoozed" : "acted", now);
    return done(stored);
  }

  // Everything but Snooze acts on the message's one task; Snooze on every live task of a batch.
  const targets = state === "snooze" ? tasks.filter(isLive).slice(0, MAX_SNOOZE_TASKS) : first && isLive(first) ? [first] : [];
  if (!targets.length) return done(staleText(first));

  let ops: Op[];
  let confirmation: string;
  switch (state) {
    case "done":
      ops = [taskOp(first, { state: "done", done_at: now }, now)];
      confirmation = COPY.done;
      break;
    case "remove":
      ops = [taskOp(first, { state: "removed" }, now)];
      confirmation = COPY.removed;
      break;
    case "snooze": {
      const until = snoozeTime(choice as SnoozeChoice, now, shape);
      ops = targets.map((t) => taskOp(t, { snoozed_until: until }, now));
      confirmation = snoozedText(until, now, shape.tz);
      break;
    }
    case "reschedule": {
      const deadline = addDays(today, choice === "1" ? 1 : 3);
      // A new deadline restarts the runway (as the client's triage does), and an overdue task is active again.
      ops = [taskOp(first, { deadline, runway_start: today, ...(first.state === "overdue" ? { state: "active" } : {}) }, now)];
      confirmation = movedText(deadline);
      break;
    }
    default: {
      // notToday: the day's deferred list, as the app's own button writes it. Already on it: nothing to write.
      const deferred = await deferredToday(env.DB, ctx.user_id, today);
      ops = deferred.includes(first.id) ? [] : [{ op_id: "", entity: "days", id: today, fields: { deferred: [...deferred, first.id] } }];
      confirmation = COPY.notToday;
    }
  }
  ops.forEach((o, i) => (o.op_id = opId(tap, i)));

  if (ops.length) {
    const { rejected } = await sync(env.DB, ctx.user_id, Number.MAX_SAFE_INTEGER, ops, now);
    if (rejected.length) return done(COPY.changed); // the rules refused it after all (a race with another device)
  }
  await mark(env.DB, ctx, state === "snooze" ? "snoozed" : "acted", now);
  await done(confirmation);
}

const opId = (tap: ButtonTap, i: number) => `tg:${tap.id}${i ? `:${i}` : ""}`;

// A partial patch of a task that exists. `updated_at` is set as the client does.
const taskOp = (t: TaskRow, fields: Record<string, unknown>, now: number): Op => ({ op_id: "", entity: "tasks", id: t.id, fields: { ...fields, updated_at: now } });

// Buttons that only swap the keyboard, or restore the message. Nothing here changes a task.
async function showMenu(env: ButtonsEnv, ctx: Context, menu: "snooze" | "reschedule" | "ask" | "keep", now: number, edit: (text: string | null, markup: Keyboard) => Promise<void>) {
  switch (menu) {
    case "snooze":
      return edit(null, snoozeMenu());
    case "reschedule": {
      const code = env.APP_ORIGIN ? await mintLoginCode(env.DB, ctx.user_id, now) : undefined;
      const pick = code && env.APP_ORIGIN ? `${env.APP_ORIGIN}/?h=${code}&s=${ctx.send_id}&t=${ctx.task_ids[0]}&pick=1` : undefined;
      return edit(null, rescheduleMenu(pick));
    }
    case "ask": {
      const task = (await loadTasks(env.DB, ctx))[0];
      return task ? edit(`Remove "${task.title}" from your list?`, removePrompt()) : edit(COPY.changed, { inline_keyboard: [] });
    }
    case "keep": {
      const code = env.APP_ORIGIN ? await mintLoginCode(env.DB, ctx.user_id, now) : undefined;
      return edit(ctx.text, messageKeyboard(env.APP_ORIGIN, { id: ctx.send_id, kind: ctx.kind, task_ids: ctx.task_ids }, code) ?? { inline_keyboard: [] });
    }
  }
}

// The user's day shape for snooze times. Hard blocks are read only when a slot (not "1 hour") is being picked.
async function dayShape(db: D1Database, ctx: Context, withBlocks: boolean): Promise<DayShape> {
  const base = { tz: ctx.tz, quietStart: ctx.quiet_start, quietEnd: ctx.quiet_end };
  if (!withBlocks) return { ...base, blocks: [] };
  const { results } = await db.prepare("SELECT weekdays, start_min, end_min FROM hard_blocks WHERE user_id = ?1 AND deleted = 0").bind(ctx.user_id).all<{ weekdays: string; start_min: number; end_min: number }>();
  return { ...base, blocks: results.map((b) => ({ ...b, weekdays: JSON.parse(b.weekdays) as number[] })) };
}

async function deferredToday(db: D1Database, uid: string, today: string): Promise<string[]> {
  const row = await db.prepare("SELECT deferred FROM days WHERE user_id = ?1 AND day = ?2").bind(uid, today).first<{ deferred: string }>();
  return row ? (JSON.parse(row.deferred) as string[]) : [];
}

// The confirmation for a callback whose change is already stored: the same words, from the stored values.
function storedConfirmation(state: string, choice: string | undefined, tasks: TaskRow[], shape: DayShape, now: number): string {
  const first = tasks[0];
  switch (state) {
    case "done":
      return COPY.done;
    case "remove":
      return COPY.removed;
    case "notToday":
      return COPY.notToday;
    case "snooze": {
      const until = first?.snoozed_until ?? snoozeTime(choice as SnoozeChoice, now, shape);
      return snoozedText(until, now, shape.tz);
    }
    default:
      return first?.deadline ? movedText(first.deadline) : COPY.changed;
  }
}

// §5 "How each response is recorded": Done, Remove, Reschedule and Not today are Acted; Snooze is Snoozed. COALESCE keeps
// the first tap's time if a redelivery marks again.
async function mark(db: D1Database, ctx: Context, as: "acted" | "snoozed", now: number): Promise<void> {
  const column = as === "acted" ? "acted_at" : "snoozed_at";
  await db.prepare(`UPDATE sends SET ${column} = COALESCE(${column}, ?1) WHERE id = ?2 AND user_id = ?3`).bind(now, ctx.send_id, ctx.user_id).run();
}
