import { dayOf } from "../core/day";
import { sessionsDone } from "../core/focus";
import { localToMs, messageText, planDay, type MessageKind, type PlannedMessage, type TextContext } from "../core/messages";
import type { Chunk } from "../core/chunk";
import type { Day, HardBlock, State, Task } from "../core/task";
import { addDays, buildToday, daysBetween, remaining, slotsFor } from "../core/today";
import type { Session } from "../core/focus";
import { LOGIN_LINK_TTL_MS, messageKeyboard } from "./buttons";
import { newUserId } from "./identity";
import { runRetention } from "./retention";
import type { Entity } from "./protocol";
import { ENTITIES } from "./schema";
import { botCall, type TelegramEnv } from "./telegram";

// The scheduler (Tech_Scope.md §4.5, §6, §11, slice 12): one cron tick plans the stale users' days, then sends what is due.

export interface SchedulerEnv extends TelegramEnv {
  /** Var: the app's origin, for the link buttons (`https://ember-tasks.<subdomain>.workers.dev`). */
  APP_ORIGIN?: string;
}

/** The schedules in wrangler.jsonc `triggers.crons`; `scheduled()` dispatches on which one fired. */
export const EVERY_MINUTE = "* * * * *";
export const DAILY_RETENTION = "0 19 * * *"; // 03:00 Singapore (Tech_Scope.md §8)

// --- Budget ------------------------------------------------------------------------------------------------------
//
// A free-plan invocation may run 50 D1 statements (each statement of a db.batch() counts) and 50 subrequests (§11); the
// two are separate limits. One tick, worst case, with MAX_SENDS = 20:
//
//   stale-user scan ............................................... 1
//   send phase:  claim (UPDATE ... RETURNING, chat id included) ... 1
//                handoff codes for the claimed rows (one INSERT) .. 1
//                stamp sent_at after each Telegram send ........... 20
//                403 clean-up: cancel rows, clear channel ......... 2   (only if a send was a 403; a 403 is not stamped)
//                                                                  = 24 (SEND_COST)
//   plan phase:  per user: state load (one statement) ............. 1
//                           plan write (one batch of 3) ........... 3
//                                                                  = 4 each (PLAN_COST); a failed plan costs 1 + 1, still under
//   5 users planned (MAX_PLANNED) ................................. 20
//                                                                  total 45, under the 48 of STATEMENT_BUDGET
//
// Subrequests: one Telegram call per send, at most 20. The plan phase spends the statements the send phase does not
// reserve, so a backlog of stale users (a whole city waking at 08:00) drains MAX_PLANNED per minute, never more.
export const MAX_SENDS = 20;
const STATEMENT_BUDGET = 48; // 50 less two spare
const STALE_SCAN_COST = 1;
const SEND_COST = 2 + MAX_SENDS + 2;
const PLAN_COST = 4;
export const MAX_PLANNED = Math.floor((STATEMENT_BUDGET - STALE_SCAN_COST - SEND_COST) / PLAN_COST);

const DAILY_CAP = 3; // Product_Scope.md §2 (planDay's own constant is not exported)
const DEFAULT_TZ = "Asia/Singapore"; // a null tz means "the browser's"; core falls back to the same zone
const CLAIM_TTL_MS = 5 * 60_000; // §11: a claim this old with no sent_at is a crashed tick, and the row is retried
const MAX_ATTEMPTS = 5; // counted at claim time, so a tick that dies mid-send still uses one
const DISMISS_AFTER_MS = 5 * 3_600_000; // UX_Flows §5: no interaction within 5 hours = dismissed
const LATE_GRACE_MS = 5 * 60_000; // a planned message this far past due (or more) is dropped; less is just a late tick
const PLAN_RETRY_MS = 5 * 60_000; // a user whose plan threw is tried again after this

type Db = D1Database;

// --- The tick ----------------------------------------------------------------------------------------------------

export interface TickReport {
  planned: number; // users whose day was (re)planned
  claimed: number; // rows claimed for sending
  sent: number;
  blocked: number; // users whose Telegram answered 403
}

export async function handleScheduled(controller: { cron: string; scheduledTime: number }, env: SchedulerEnv): Promise<void> {
  switch (controller.cron) {
    case EVERY_MINUTE: {
      const report = await runTick(env, controller.scheduledTime);
      if (report.planned || report.claimed) console.log("tick", JSON.stringify(report));
      return;
    }
    case DAILY_RETENTION: {
      console.log("retention", JSON.stringify(await runRetention(env.DB, controller.scheduledTime)));
      return;
    }
    default:
      console.error("scheduled: no handler for cron", controller.cron);
  }
}

/** Plans the stale users, then sends what is due. Plans first, so a message planned for this minute goes out this minute. */
export async function runTick(env: SchedulerEnv, now: number): Promise<TickReport> {
  const planned = await planStaleUsers(env.DB, now);
  return { planned, ...(await sendDue(env, now)) };
}

// --- Plan phase --------------------------------------------------------------------------------------------------

interface StaleUser {
  id: string;
  rev: number;
  planned_rev: number | null;
  planned_until: number | null;
  tz: string | null;
  quiet_start: number;
  quiet_end: number;
}

// §4.5: stale = not planned for the current local day (`planned_until` has passed), or `users.rev` has moved on since
// the plan. Only linked Telegram users are ever planned. Settings default as the table does when the row is missing.
async function staleUsers(db: Db, now: number, limit: number): Promise<StaleUser[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.rev, u.planned_rev, u.planned_until, s.tz AS tz, COALESCE(s.quiet_start, 1320) AS quiet_start, COALESCE(s.quiet_end, 480) AS quiet_end
       FROM users u LEFT JOIN settings s ON s.user_id = u.id AND s.id = 'me'
       WHERE u.channel = 'telegram' AND u.telegram_chat_id IS NOT NULL AND (u.planned_until IS NULL OR u.planned_until <= ?1 OR u.planned_rev < u.rev)
       ORDER BY u.id LIMIT ?2`,
    )
    .bind(now, limit)
    .all<StaleUser>();
  return results;
}

async function planStaleUsers(db: Db, now: number): Promise<number> {
  let planned = 0;
  for (const user of await staleUsers(db, now, MAX_PLANNED)) {
    try {
      if (await planUser(db, user, now)) planned++;
    } catch (e) {
      // One user's bad data must not stall the queue (the scan is ordered by id): push this user's retry back.
      console.error("plan failed", user.id, e instanceof Error ? e.message : "unknown error");
      await db.prepare("UPDATE users SET planned_until = ?1, planned_rev = rev WHERE id = ?2").bind(now + PLAN_RETRY_MS, user.id).run();
    }
  }
  return planned;
}

/** One `sends` row as the planner reads it back. */
interface SendRow {
  id: string;
  day: string;
  kind: MessageKind;
  task_ids: string[];
  due_at: number;
  claimed_at: number | null;
  sent_at: number | null;
  acted_at: number | null;
  snoozed_at: number | null;
  cancelled: boolean;
  deadline: string | null;
}

interface Loaded {
  tasks: Task[];
  chunks: Chunk[];
  sessions: Session[];
  hard_blocks: HardBlock[];
  days: Day[];
  sends: SendRow[];
}

// json_object(...) of an entity's columns, from schema.ts (the names come from that file, never from a request).
function columns(entity: Entity): string {
  const { key, fields } = ENTITIES[entity];
  return [`'${key}', ${key}`, ...Object.keys(fields).map((f) => `'${f}', ${f}`)].join(", ");
}

const SEND_COLUMNS = ["id", "day", "kind", "task_ids", "due_at", "claimed_at", "sent_at", "acted_at", "snoozed_at", "cancelled", "deadline"];

// Everything the planner reads, in one statement: only the live tasks (active or overdue) and what hangs off them, the
// day's row, and the sends that matter (today's, plus every overdue send that went out, whatever its day). D1 refuses a
// flat compound SELECT of more than 5 terms (§11), and this has 6, so it is two groups of three.
const LIVE_TASKS = "SELECT id FROM tasks WHERE user_id = ?1 AND state IN ('active', 'overdue')";
const LIVE_CHUNKS = `SELECT id FROM chunks WHERE user_id = ?1 AND task_id IN (${LIVE_TASKS})`;
const term = (name: string, table: string, cols: string, where: string) => `SELECT '${name}' AS entity, json_object(${cols}) AS row FROM ${table} WHERE user_id = ?1 AND ${where}`;
const LOAD_SQL = `SELECT * FROM (
  ${term("tasks", "tasks", columns("tasks"), "state IN ('active', 'overdue')")}
  UNION ALL ${term("chunks", "chunks", columns("chunks"), `task_id IN (${LIVE_TASKS})`)}
  UNION ALL ${term("sessions", "sessions", columns("sessions"), `completed = 1 AND chunk_id IN (${LIVE_CHUNKS})`)}
) UNION ALL SELECT * FROM (
  ${term("hard_blocks", "hard_blocks", columns("hard_blocks"), "deleted = 0")}
  UNION ALL ${term("days", "days", columns("days"), "day = ?2")}
  UNION ALL ${term("sends", "sends", SEND_COLUMNS.map((c) => `'${c}', ${c}`).join(", "), "(day = ?2 OR (kind = 'overdue' AND claimed_at IS NOT NULL))")}
)`;

// D1 stores booleans as 0/1 and lists as JSON text; this turns a row back into the shape core/ expects, as sync's pull does.
function entityRow<T>(entity: Entity, raw: Record<string, unknown>): T {
  const fields = ENTITIES[entity].fields;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Object.hasOwn(fields, k) && v !== null ? fields[k].read(v) : v])) as T;
}

async function load(db: Db, uid: string, today: string): Promise<Loaded> {
  const { results } = await db.prepare(LOAD_SQL).bind(uid, today).all<{ entity: string; row: string }>();
  const out: Loaded = { tasks: [], chunks: [], sessions: [], hard_blocks: [], days: [], sends: [] };
  for (const { entity, row } of results) {
    const raw = JSON.parse(row) as Record<string, unknown>;
    if (entity === "sends") {
      out.sends.push({ ...raw, task_ids: JSON.parse(String(raw.task_ids)) as string[], cancelled: raw.cancelled === 1 } as SendRow);
    } else {
      (out[entity as Exclude<keyof Loaded, "sends">] as unknown[]).push(entityRow(entity as Entity, raw));
    }
  }
  return out;
}

// Which messages count as already used today: sent, or claimed (in flight, waiting out a failed attempt, or given up).
const isUsed = (r: SendRow) => !r.cancelled && (r.sent_at !== null || r.claimed_at !== null);

// The planner is blind to which messages already went out (core/messages' report, gap 1), so an already-sent message
// is matched to the planned message that stands for it and removed. Deadline messages match per task; the morning and
// light-day offers stand in for one another; close nudges (first and second) match by count, because the batch changes.
const sameMessage = (kind: MessageKind, ids: string[]) =>
  kind === "deadline_day" || kind === "overdue" ? `${kind}:${ids[0]}` : kind === "morning" || kind === "light_day" ? "start" : kind;

// §4.5 step 1 order, for trimming to the cap after the sent messages are taken off.
const PRIORITY: Record<MessageKind, number> = { overdue: 1, deadline_day: 2, close: 3, morning: 4, light_day: 4, wrap_up: 5 };

/** One row to insert into `sends`. */
interface NewSend {
  id: string;
  kind: MessageKind;
  task_ids: string[];
  due_at: number;
  text: string;
  deadline: string | null;
}

export interface Plan {
  today: string;
  until: number; // the instant this local day ends
  rows: NewSend[];
}

export function buildPlan(loaded: Loaded, settings: State["settings"], now: number): Plan {
  const tz = settings.tz ?? DEFAULT_TZ;
  const today = dayOf(now, tz, settings.quiet_end);
  const until = localToMs(addDays(today, 1), settings.quiet_end, tz);
  const state: State = {
    tasks: loaded.tasks,
    chunks: loaded.chunks,
    days: loaded.days,
    sessions: loaded.sessions,
    focus: null,
    last_seen_at: null,
    settings,
    hard_blocks: loaded.hard_blocks,
    draft: "",
  };

  const todays = loaded.sends.filter((r) => r.day === today);
  const used = todays.filter(isUsed);

  // The last snooze, or the last dismissal (5 hours of silence after a send nobody touched).
  const quietTimes = todays.flatMap((r) => [
    r.snoozed_at,
    r.sent_at !== null && r.acted_at === null && r.snoozed_at === null && r.sent_at + DISMISS_AFTER_MS <= now ? r.sent_at + DISMISS_AFTER_MS : null,
  ]);
  const lastQuietAt = quietTimes.reduce<number | null>((a, t) => (t === null ? a : a === null ? t : Math.max(a, t)), null);

  // An overdue send is silenced until the task's deadline changes: the row remembers the deadline it was planned for.
  const deadlineOf = new Map(loaded.tasks.map((t) => [t.id, t.deadline]));
  const overdueSentFor = loaded.sends
    .filter((r) => r.kind === "overdue" && isUsed(r))
    .flatMap((r) => r.task_ids.filter((id) => deadlineOf.get(id) === r.deadline));

  // sentToday is 0 on purpose: with the real count the planner would spend its cap on messages that already went out.
  // Planned with the sent ones still in the pool, they hold their slots, and they are taken off afterwards.
  // First plan of a day that has already begun (say, Telegram linked at 10:00): with `now`, a message whose slot has
  // passed moves to the next free slot instead of being lost (§4.5). Only while nothing has gone out today: a replan
  // relies on the sent messages holding their past slots, so the rest of the day stays where it was. The 5 minutes of
  // slack match the drop below: the tick fires about 31 s past the minute, so a slot due this minute is still free.
  const raw = planDay({ state, today, sentToday: 0, lastQuietAt, overdueSentFor, now: used.length ? undefined : now - 5 * 60_000 });
  const taken = new Map<string, number>();
  // A snoozed close nudge (slice 13's Snooze button, which only close messages carry) still counts against the cap, but
  // it no longer stands for a planned message: the snooze pinned its tasks' message to their own time, and that planned
  // message is the one that must go out.
  for (const r of used.filter((u) => !(u.kind === "close" && u.snoozed_at !== null))) taken.set(sameMessage(r.kind, r.task_ids), (taken.get(sameMessage(r.kind, r.task_ids)) ?? 0) + 1);
  const unsent = raw.filter((m) => {
    const key = sameMessage(m.kind, m.task_ids);
    const n = taken.get(key) ?? 0;
    if (n) taken.set(key, n - 1);
    return !n;
  });

  const kept = unsent
    .map((m, i) => ({ m, i }))
    .sort((a, b) => PRIORITY[a.m.kind] - PRIORITY[b.m.kind] || a.i - b.i)
    .slice(0, Math.max(DAILY_CAP - used.length, 0))
    .map(({ m }) => m)
    .sort((a, b) => a.due_at - b.due_at)
    .filter((m) => m.due_at >= now - LATE_GRACE_MS); // planDay has no clock: its past slots are dropped here

  const things = buildToday(state, today, { sessionsDone: sessionsDone(state), tz, quietEndMin: settings.quiet_end, slots: slotsFor(state, today) }).rows.length;
  const rows = kept.map((m): NewSend => ({
    id: crypto.randomUUID(),
    kind: m.kind,
    task_ids: m.task_ids,
    due_at: m.due_at,
    text: textFor(m, state, today, things),
    deadline: m.kind === "overdue" ? (deadlineOf.get(m.task_ids[0]) ?? null) : null,
  }));
  return { today, until, rows };
}

// The message body, from the state the plan was made from. The plan is redone when that state changes, so it stays true.
function textFor(m: PlannedMessage, s: State, today: string, things: number): string {
  const tasks = m.task_ids.map((id) => s.tasks.find((t) => t.id === id)).filter((t): t is Task => !!t);
  const ctx: TextContext = {};
  if (m.kind === "morning") ctx.things = things;
  if (m.kind === "close" && tasks.length === 1) {
    const t = tasks[0];
    if (t.deadline && s.chunks.some((c) => c.task_id === t.id && !c.deleted)) {
      ctx.sessionsLeft = remaining(t, sessionsDone(s)(t.id));
      ctx.daysLeft = daysBetween(today, t.deadline);
    } else {
      // Never chunked: UX_Flows §5 gives the task name as the title. Telegram text has no title line, so it leads the body.
      return `${t.title}\n${messageText(m.kind, tasks)}`;
    }
  }
  return messageText(m.kind, tasks, ctx);
}

// Replaces the day's unsent, unclaimed rows with the new plan, as one batch (one transaction, 3 statements). The first
// statement is a compare-and-set on the plan the user was found on; if another tick planned them first it changes no
// row, and the token check makes the delete and the insert do nothing too. Returns whether this tick's plan won.
async function writePlan(db: Db, user: StaleUser, plan: Plan): Promise<boolean> {
  const token = crypto.randomUUID();
  const mine = "(SELECT plan_token FROM users WHERE id = ?1) = ?3";
  const [claim] = await db.batch([
    db
      .prepare("UPDATE users SET planned_until = ?1, planned_rev = ?2, plan_token = ?3 WHERE id = ?4 AND planned_rev IS ?5 AND planned_until IS ?6")
      .bind(plan.until, user.rev, token, user.id, user.planned_rev, user.planned_until),
    // `day <= today` also sweeps a previous day's rows that never went out.
    db.prepare(`DELETE FROM sends WHERE user_id = ?1 AND day <= ?2 AND sent_at IS NULL AND claimed_at IS NULL AND ${mine}`).bind(user.id, plan.today, token),
    db
      .prepare(
        `INSERT INTO sends (id, user_id, day, kind, task_ids, due_at, text, deadline)
         SELECT json_extract(value, '$.id'), ?1, ?2, json_extract(value, '$.kind'), json_extract(value, '$.task_ids'), json_extract(value, '$.due_at'),
                json_extract(value, '$.text'), json_extract(value, '$.deadline')
         FROM json_each(?4) WHERE ${mine}`,
      )
      .bind(user.id, plan.today, token, JSON.stringify(plan.rows)),
  ]);
  return claim.meta.changes === 1;
}

async function planUser(db: Db, user: StaleUser, now: number): Promise<boolean> {
  const settings = { tz: user.tz, quiet_start: user.quiet_start, quiet_end: user.quiet_end };
  const today = dayOf(now, settings.tz ?? DEFAULT_TZ, settings.quiet_end);
  return writePlan(db, user, buildPlan(await load(db, user.id, today), settings, now));
}

// --- Send phase --------------------------------------------------------------------------------------------------

interface Claimed {
  id: string;
  user_id: string;
  kind: MessageKind;
  task_ids: string;
  text: string;
  attempts: number;
  chat_id: string;
}

// §11, claim first. One statement takes up to MAX_SENDS due rows that nobody holds (never claimed, or claimed more than
// 5 minutes ago with no sent_at: a crashed tick or a failed send waiting its turn), so two overlapping ticks cannot
// both get a row. `attempts` goes up here, not on failure: a tick that dies mid-send also uses an attempt, and a failed
// send needs no write at all, because the claim already makes the next try wait 5 minutes. After MAX_ATTEMPTS the row
// is never claimed again. Rows of users who are no longer linked are left alone.
const CLAIM_SQL = `UPDATE sends SET claimed_at = ?1, attempts = attempts + 1
  WHERE id IN (
    SELECT id FROM sends
    WHERE due_at <= ?1 AND sent_at IS NULL AND cancelled = 0 AND attempts < ?3 AND (claimed_at IS NULL OR claimed_at < ?2)
      AND user_id IN (SELECT id FROM users WHERE channel = 'telegram' AND telegram_chat_id IS NOT NULL)
    ORDER BY due_at LIMIT ?4)
  RETURNING id, user_id, kind, task_ids, text, attempts, (SELECT telegram_chat_id FROM users WHERE users.id = sends.user_id) AS chat_id`;

async function sendDue(env: SchedulerEnv, now: number): Promise<Omit<TickReport, "planned">> {
  const none = { claimed: 0, sent: 0, blocked: 0 };
  // Without the token every send would fail and burn an attempt, so nothing is claimed.
  if (!env.TG_BOT_TOKEN) {
    console.error("scheduler: TG_BOT_TOKEN is not set, nothing sent");
    return none;
  }
  const db = env.DB;
  const { results: rows } = await db.prepare(CLAIM_SQL).bind(now, now - CLAIM_TTL_MS, MAX_ATTEMPTS, MAX_SENDS).all<Claimed>();
  if (!rows.length) return none;

  // One sign-in code per message, made now so it has its full 24 hours from the send (§6). One INSERT for all of them.
  const codes = new Map<string, string>();
  if (env.APP_ORIGIN) {
    for (const r of rows) codes.set(r.id, newUserId());
    await db
      .prepare("INSERT INTO handoffs (code, user_id, purpose, expires_at) SELECT json_extract(value, '$.c'), json_extract(value, '$.u'), 'login_link', ?1 FROM json_each(?2)")
      .bind(now + LOGIN_LINK_TTL_MS, JSON.stringify(rows.map((r) => ({ c: codes.get(r.id), u: r.user_id }))))
      .run();
  }

  let sent = 0;
  const blocked = new Set<string>();
  try {
    for (const r of rows) {
      if (blocked.has(r.user_id)) continue; // this tick already learned the user blocked the bot
      const result = await deliver(env, r.chat_id, r.text, messageKeyboard(env.APP_ORIGIN, { id: r.id, kind: r.kind, task_ids: JSON.parse(r.task_ids) as string[] }, codes.get(r.id)));
      if (result.ok) {
        // A failure of this write after Telegram accepted the message would have the row sent again once its claim
        // is 5 minutes old; the error is let through so the tick stops rather than risk more of those.
        await db.prepare("UPDATE sends SET sent_at = ?1, tg_message_id = ?2 WHERE id = ?3").bind(now, result.messageId, r.id).run();
        sent++;
      } else if (result.status === 403) {
        blocked.add(r.user_id);
      } else {
        console.error(`send ${r.id} failed with ${result.status || "a network error"} (attempt ${r.attempts} of ${MAX_ATTEMPTS})`);
      }
    }
  } finally {
    // The user blocked the bot: nothing more will reach them. Their unsent rows are cancelled and the channel cleared;
    // telegram_chat_id stays, so linking again is one tap.
    if (blocked.size) {
      const ids = JSON.stringify([...blocked]);
      await db.batch([
        db.prepare("UPDATE sends SET cancelled = 1 WHERE sent_at IS NULL AND cancelled = 0 AND user_id IN (SELECT value FROM json_each(?1))").bind(ids),
        db.prepare("UPDATE users SET channel = NULL WHERE channel = 'telegram' AND id IN (SELECT value FROM json_each(?1))").bind(ids),
      ]);
    }
  }
  return { claimed: rows.length, sent, blocked: blocked.size };
}

type Delivery = { ok: true; messageId: number | null } | { ok: false; status: number };

// One Bot API sender for everything (botCall in telegram.ts); the scheduler needs the message id to stamp and the 403 that
// means "blocked". status 0 = the request never got an answer.
async function deliver(env: SchedulerEnv, chatId: string, text: string, replyMarkup?: unknown): Promise<Delivery> {
  const r = await botCall(env, "sendMessage", { chat_id: chatId, text, ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }) });
  if (!r.ok) return { ok: false, status: r.status };
  const id = (r.result as { message_id?: unknown } | null | undefined)?.message_id;
  return { ok: true, messageId: typeof id === "number" ? id : null };
}
