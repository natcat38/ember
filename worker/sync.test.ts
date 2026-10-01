import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "./index";
import { MAX_OPS, type Op, type SyncResponse } from "./protocol";

const URL_SYNC = "https://ember.test/api/sync";
const uuid = () => crypto.randomUUID();

const task = (id: string, fields: Record<string, unknown> = {}): Op => ({
  op_id: uuid(),
  entity: "tasks",
  id,
  fields: { title: "Write cover letter", state: "inbox", ...fields },
});
const patch = (id: string, fields: Record<string, unknown>): Op => ({ op_id: uuid(), entity: "tasks", id, fields });

function request(body: unknown, cookie?: string): Request {
  return new Request(URL_SYNC, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

interface Reply {
  res: Response;
  body: SyncResponse;
  /** `ember_uid=<id>` as the browser would send it back, or undefined when no cookie was set. */
  cookie?: string;
}

async function read(res: Response): Promise<Reply> {
  const setCookie = res.headers.get("Set-Cookie");
  return { res, body: (await res.json()) as SyncResponse, cookie: setCookie?.split(";")[0] };
}

async function sync(body: unknown, cookie?: string): Promise<Reply> {
  return read(await exports.default.fetch(request(body, cookie)));
}

// A fresh anonymous user, so each test owns its data.
async function newUser(): Promise<string> {
  const { cookie } = await sync({ cursor: 0, ops: [] });
  return cookie!;
}

const uidOf = (cookie: string) => cookie.split("=")[1];
const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())!.n;
const userRev = async (cookie: string) => (await env.DB.prepare("SELECT rev FROM users WHERE id = ?").bind(uidOf(cookie)).first<{ rev: number }>())!.rev;
const taskRow = (id: string) => env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<Record<string, unknown>>();

describe("idempotency", () => {
  it("applies the same op sent twice once", async () => {
    const cookie = await newUser();
    const id = uuid();
    const op = task(id);

    const first = await sync({ cursor: 0, ops: [op] }, cookie);
    expect(first.res.status).toBe(200);
    expect(await userRev(cookie)).toBe(1);

    // A retry after a lost response carries the same op_id, and even different fields: the ledger wins.
    const second = await sync({ cursor: 0, ops: [{ ...op, fields: { ...op.fields, title: "Changed by a replay" } }] }, cookie);
    expect(second.res.status).toBe(200);
    expect(second.body.rejected).toEqual([]);
    expect(await userRev(cookie)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM ops WHERE user_id = ?", uidOf(cookie))).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM tasks WHERE id = ?", id)).toBe(1);
    expect((await taskRow(id))!.title).toBe("Write cover letter");
    // The replay still gets the current rows back, so the client can finish the sync it thinks it lost.
    expect(second.body.changes.map((c) => c.row.id)).toEqual([id]);
  });

  it("counts an op_id repeated inside one body once", async () => {
    const cookie = await newUser();
    const op = task(uuid());
    await sync({ cursor: 0, ops: [op, op] }, cookie);
    expect(await userRev(cookie)).toBe(1);
  });

  it("leaves exactly one effect when two requests carry the same op at once", async () => {
    const cookie = await newUser();
    const id = uuid();
    const op = task(id);
    const body = { cursor: 0, ops: [op] };

    const [a, b] = await Promise.all([sync(body, cookie), sync(body, cookie)]);
    expect([a.res.status, b.res.status]).toEqual([200, 200]);
    expect(await userRev(cookie)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM ops WHERE user_id = ?", uidOf(cookie))).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM tasks WHERE id = ?", id)).toBe(1);
  });

  it("recovers when a rival request records the op between our check and our batch", async () => {
    // Promise.all above may or may not interleave. This forces it: just before our first batch, a full rival request
    // carrying the same op runs to completion, so our batch hits the ledger's primary key and rolls back whole.
    const cookie = await newUser();
    const id = uuid();
    const op = task(id);
    const body = { cursor: 0, ops: [op] };

    const sqlOf = new Map<D1PreparedStatement, string>();
    let rivalRan = false;
    let collisions = 0;
    const db = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare") {
          return (q: string) => {
            // sync.ts always binds straight after preparing, and db.batch() receives the bound statements.
            return {
              bind: (...args: unknown[]) => {
                const bound = target.prepare(q).bind(...args);
                sqlOf.set(bound, q);
                return bound;
              },
            };
          };
        }
        if (prop === "batch") {
          return async (stmts: D1PreparedStatement[]) => {
            const writesLedger = stmts.some((s) => sqlOf.get(s)?.startsWith("INSERT INTO ops"));
            if (writesLedger && !rivalRan) {
              rivalRan = true;
              await exports.default.fetch(request(body, cookie));
            }
            try {
              return await target.batch(stmts);
            } catch (e) {
              if (writesLedger) collisions++;
              throw e;
            }
          };
        }
        return Reflect.get(target, prop);
      },
    });

    const res = await worker.fetch(request(body, cookie) as Parameters<typeof worker.fetch>[0], { ...env, DB: db });
    expect(res.status).toBe(200);
    expect(rivalRan).toBe(true);
    expect(collisions).toBe(1); // our first commit collided and rolled back; the retry filtered the op out
    expect(await userRev(cookie)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM tasks WHERE id = ?", id)).toBe(1);
    expect((await read(res)).body.changes).toHaveLength(1);
  });

  it("keeps op ids separate per user", async () => {
    const [a, b] = [await newUser(), await newUser()];
    const opId = uuid();
    const mk = (title: string): Op => ({ op_id: opId, entity: "tasks", id: uuid(), fields: { title, state: "inbox" } });
    await sync({ cursor: 0, ops: [mk("A")] }, a);
    await sync({ cursor: 0, ops: [mk("B")] }, b);
    expect(await userRev(a)).toBe(1);
    expect(await userRev(b)).toBe(1);
  });
});

describe("pull and cursor", () => {
  it("returns only rows newer than the cursor, and the cursor advances", async () => {
    const cookie = await newUser();
    const [t1, t2] = [uuid(), uuid()];

    const first = await sync({ cursor: 0, ops: [task(t1)] }, cookie);
    expect(first.body.cursor).toBe(1);

    const second = await sync({ cursor: first.body.cursor, ops: [task(t2, { title: "Second" })] }, cookie);
    expect(second.body.cursor).toBe(2);
    expect(second.body.changes.map((c) => c.row.id)).toEqual([t2]);

    const idle = await sync({ cursor: second.body.cursor, ops: [] }, cookie);
    expect(idle.body.cursor).toBe(2);
    expect(idle.body.changes).toEqual([]);

    const restore = await sync({ cursor: 0, ops: [] }, cookie);
    expect(restore.body.changes.map((c) => c.row.id)).toEqual([t1, t2]);
  });

  it("covers every synced entity, in the client's shape, oldest change first", async () => {
    const cookie = await newUser();
    const [t, c, s, h] = [uuid(), uuid(), uuid(), uuid()];
    const ops: Op[] = [
      task(t, { quick: true, size: "XS", deadline: "2026-10-09" }),
      { op_id: uuid(), entity: "chunks", id: c, fields: { task_id: t, parent_id: null, title: "Draft", position: 1.5, state: "todo", deleted: false } },
      { op_id: uuid(), entity: "sessions", id: s, fields: { chunk_id: c, started_at: 1000, ended_at: 2000, completed: true } },
      { op_id: uuid(), entity: "days", id: "2026-10-05", fields: { confirmed_at: 5, deferred: [c] } },
      { op_id: uuid(), entity: "hard_blocks", id: h, fields: { weekdays: [0, 2], start_min: 540, end_min: 720, label: "Classes" } },
    ];
    const { body } = await sync({ cursor: 0, ops }, cookie);

    expect(body.changes.map((x) => x.entity)).toEqual(["tasks", "chunks", "sessions", "days", "hard_blocks"]);
    expect(body.changes.map((x) => x.row.rev)).toEqual([1, 2, 3, 4, 5]);
    expect(body.cursor).toBe(5);
    const [tr, cr, sr, dr, hr] = body.changes.map((x) => x.row);
    expect(tr).toMatchObject({ id: t, title: "Write cover letter", quick: true, holding_up: false, size: "XS", deadline: "2026-10-09", pinned_on: null });
    expect(tr).not.toHaveProperty("user_id");
    expect(cr).toMatchObject({ id: c, task_id: t, parent_id: null, position: 1.5, deleted: false });
    expect(sr).toMatchObject({ id: s, chunk_id: c, completed: true });
    expect(dr).toMatchObject({ day: "2026-10-05", confirmed_at: 5, shutdown_at: null, deferred: [c] });
    expect(hr).toMatchObject({ id: h, weekdays: [0, 2], start_min: 540, end_min: 720, label: "Classes", deleted: false });
  });

  it("never returns another user's rows", async () => {
    const [a, b] = [await newUser(), await newUser()];
    await sync({ cursor: 0, ops: [task(uuid())] }, a);
    expect((await sync({ cursor: 0, ops: [] }, b)).body.changes).toEqual([]);
  });
});

describe("per-field last write wins", () => {
  it("lands two different fields patched by two ops", async () => {
    const cookie = await newUser();
    const id = uuid();
    await sync({ cursor: 0, ops: [task(id, { size: "M" })] }, cookie);

    // Two devices, both offline: one renames, one marks active. Both fields survive, and untouched fields stay.
    await sync({ cursor: 0, ops: [patch(id, { title: "Renamed" })] }, cookie);
    await sync({ cursor: 0, ops: [patch(id, { state: "active" })] }, cookie);

    expect(await taskRow(id)).toMatchObject({ title: "Renamed", state: "active", size: "M" });
  });

  it("ends with the later value when the same field is patched twice", async () => {
    const cookie = await newUser();
    const id = uuid();
    await sync({ cursor: 0, ops: [task(id)] }, cookie);

    await sync({ cursor: 0, ops: [patch(id, { title: "first" })] }, cookie);
    await sync({ cursor: 0, ops: [patch(id, { title: "second" })] }, cookie);
    expect((await taskRow(id))!.title).toBe("second");

    // Within one request, arrival order is array order.
    await sync({ cursor: 0, ops: [patch(id, { title: "third" }), patch(id, { title: "fourth" })] }, cookie);
    expect((await taskRow(id))!.title).toBe("fourth");
  });

  it("creates then patches in one request, and each write takes its own rev", async () => {
    const cookie = await newUser();
    const id = uuid();
    const { body } = await sync({ cursor: 0, ops: [task(id), patch(id, { state: "active" })] }, cookie);
    expect(await userRev(cookie)).toBe(2);
    expect(body.changes).toHaveLength(1); // one row, at its latest rev
    expect(body.changes[0].row).toMatchObject({ id, state: "active", rev: 2 });
  });

  it("refuses to create a row from a patch that lacks required fields, and does not record the op", async () => {
    const cookie = await newUser();
    const op = patch(uuid(), { state: "active" });
    const { body } = await sync({ cursor: 0, ops: [op] }, cookie);
    expect(body.rejected).toEqual([{ op_id: op.op_id, reason: "incomplete_create" }]);
    expect(body.changes).toEqual([]);
    expect(await userRev(cookie)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM ops WHERE user_id = ?", uidOf(cookie))).toBe(0);
  });

  it("cannot overwrite another user's row by reusing its id", async () => {
    const [a, b] = [await newUser(), await newUser()];
    const id = uuid();
    await sync({ cursor: 0, ops: [task(id, { title: "Mine" })] }, a);
    await sync({ cursor: 0, ops: [task(id, { title: "Hijacked" }), patch(id, { state: "done" })] }, b);
    expect(await taskRow(id)).toMatchObject({ title: "Mine", state: "inbox" });
  });
});

describe("identity", () => {
  it("creates a user and sets the cookie when none is presented", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM users");
    const res = await exports.default.fetch(request({ cursor: 0, ops: [] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toMatch(/^ember_uid=[A-Za-z0-9_-]{22}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=34560000$/);
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(before + 1);
    const uid = uidOf(res.headers.get("Set-Cookie")!.split(";")[0]);
    const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(uid).first<Record<string, number | string>>();
    expect(user).toMatchObject({ rev: 0, tz: "Asia/Singapore", quiet_start: 1320, quiet_end: 480 });
    expect(user!.created_at).toBe(user!.last_seen_at);
  });

  it("reuses the user and refreshes the cookie and last_seen_at on a second call", async () => {
    const cookie = await newUser();
    await env.DB.prepare("UPDATE users SET last_seen_at = 0 WHERE id = ?").bind(uidOf(cookie)).run();
    const before = await count("SELECT COUNT(*) AS n FROM users");

    const again = await sync({ cursor: 0, ops: [] }, cookie);
    expect(again.cookie).toBe(cookie);
    expect(again.res.headers.get("Set-Cookie")).toContain("Max-Age=34560000");
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(before);
    const row = await env.DB.prepare("SELECT last_seen_at FROM users WHERE id = ?").bind(uidOf(cookie)).first<{ last_seen_at: number }>();
    expect(row!.last_seen_at).toBeGreaterThan(0);
  });

  it("issues a new user for a malformed or unknown cookie instead of trusting it", async () => {
    for (const cookie of ["ember_uid=nope", "ember_uid=AAAAAAAAAAAAAAAAAAAAAA", "other=1"]) {
      const { cookie: issued } = await sync({ cursor: 0, ops: [] }, cookie);
      expect(issued).toMatch(/^ember_uid=[A-Za-z0-9_-]{22}$/);
      expect(issued).not.toBe(cookie);
    }
  });
});

describe("validation", () => {
  const good = (): Op => task(uuid());
  const bad: [string, unknown][] = [
    ["not JSON", "{nope"],
    ["a JSON array", []],
    ["a missing cursor", { ops: [] }],
    ["a negative cursor", { cursor: -1, ops: [] }],
    ["a fractional cursor", { cursor: 1.5, ops: [] }],
    ["ops that are not an array", { cursor: 0, ops: {} }],
    ["an op that is not an object", { cursor: 0, ops: ["x"] }],
    ["an unknown entity", { cursor: 0, ops: [{ ...good(), entity: "users" }] }],
    ["a prototype-chain entity", { cursor: 0, ops: [{ ...good(), entity: "constructor" }] }],
    ["an unknown field", { cursor: 0, ops: [{ ...good(), fields: { title: "x", state: "inbox", user_id: "evil" } }] }],
    ["a field that is not whitelisted (rev)", { cursor: 0, ops: [{ ...good(), fields: { title: "x", rev: 99 } }] }],
    ["a wrong type", { cursor: 0, ops: [{ ...good(), fields: { title: "x", state: "inbox", quick: 1 } }] }],
    ["an enum value that does not exist", { cursor: 0, ops: [{ ...good(), fields: { title: "x", state: "finished" } }] }],
    ["an empty title", { cursor: 0, ops: [{ ...good(), fields: { title: "   ", state: "inbox" } }] }],
    ["an oversized title", { cursor: 0, ops: [{ ...good(), fields: { title: "x".repeat(501), state: "inbox" } }] }],
    ["an impossible date", { cursor: 0, ops: [{ ...good(), fields: { title: "x", state: "inbox", deadline: "2026-02-31" } }] }],
    ["empty fields", { cursor: 0, ops: [{ ...good(), fields: {} }] }],
    ["a malformed op_id", { cursor: 0, ops: [{ ...good(), op_id: "has space" }] }],
    ["a malformed row id", { cursor: 0, ops: [{ ...good(), id: "../x" }] }],
    ["a day id that is not a date", { cursor: 0, ops: [{ op_id: uuid(), entity: "days", id: "monday", fields: { deferred: [] } }] }],
    ["a deferred list with a non-id", { cursor: 0, ops: [{ op_id: uuid(), entity: "days", id: "2026-10-05", fields: { deferred: ["ok", 5] } }] }],
  ];

  it.each(bad)("returns 400 for %s, and creates no user", async (_name, body) => {
    const before = await count("SELECT COUNT(*) AS n FROM users");
    const res = await exports.default.fetch(request(body));
    expect(res.status).toBe(400);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(await res.json()).toMatchObject({ error: "invalid_body" });
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(before);
  });

  it("applies nothing when one op in the body is bad", async () => {
    const cookie = await newUser();
    const id = uuid();
    const res = await exports.default.fetch(request({ cursor: 0, ops: [task(id), { ...good(), fields: { title: 5 } }] }, cookie));
    expect(res.status).toBe(400);
    expect(await taskRow(id)).toBeNull();
    expect(await userRev(cookie)).toBe(0);
  });

  it(`accepts ${MAX_OPS} ops and refuses ${MAX_OPS + 1} with 413`, async () => {
    const cookie = await newUser();
    const ok = await sync({ cursor: 0, ops: Array.from({ length: MAX_OPS }, () => task(uuid())) }, cookie);
    expect(ok.res.status).toBe(200);
    expect(ok.body.changes).toHaveLength(MAX_OPS);
    expect(ok.body.cursor).toBe(MAX_OPS);

    const res = await exports.default.fetch(request({ cursor: 0, ops: Array.from({ length: MAX_OPS + 1 }, () => task(uuid())) }, cookie));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "too_many_ops" });
    expect(await userRev(cookie)).toBe(MAX_OPS);
  });

  it("answers 405 to GET and 404 to an unknown API path", async () => {
    expect((await exports.default.fetch(new Request(URL_SYNC))).status).toBe(405);
    expect((await exports.default.fetch(new Request("https://ember.test/api/nope", { method: "POST" }))).status).toBe(404);
  });
});
