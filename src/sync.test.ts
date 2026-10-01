import { expect, test } from "vitest";
import { allOps, applyChanges, diff } from "./sync";
import { capture, emptyState, triage, type State } from "../core/task";
import { addChunk } from "../core/chunk";

let n = 0;
const id = () => `id-${++n}`;
const today = "2026-10-05";

function sample(): State {
  n = 0;
  let s = capture(emptyState(), { title: "Cover letter" }, 1, today, id);
  s = addChunk(s, "id-1", "Tailor the opening", null, 2, id);
  s = addChunk(s, "id-1", "Proofread", null, 3, id);
  s = addChunk(s, "id-1", "Read the ad again", "id-2", 4, id); // smaller step under the first
  return { ...s, days: [{ day: today, confirmed_at: 5, deferred: ["id-3"] }] };
}

test("a new row becomes one complete op with every synced field", () => {
  const before = emptyState();
  const after = capture(before, { title: "Cover letter", quick: true }, 1, today, () => "t1");
  const ops = diff(before, after, () => "op1");
  expect(ops).toEqual([
    {
      op_id: "op1",
      entity: "tasks",
      id: "t1",
      fields: { title: "Cover letter", state: "inbox", size: "XS", quick: true, holding_up: false, deadline: null, runway_start: null, pinned_on: null, snoozed_until: null, created_at: 1, updated_at: 1 },
    },
  ]);
});

test("a change sends only the fields that changed", () => {
  const s = sample();
  const t = triage(s, "id-1", { size: "M" }, 9, today);
  expect(diff(s, t, () => "op")).toEqual([{ op_id: "op", entity: "tasks", id: "id-1", fields: { size: "M", state: "active", updated_at: 9 } }]);
  expect(diff(t, t, () => "op")).toEqual([]);
});

test("days are keyed by the date; arrays compare by value", () => {
  const s = sample();
  const same = { ...s, days: [{ day: today, confirmed_at: 5, deferred: ["id-3"] }] };
  expect(diff(s, same, () => "op")).toEqual([]);
  const more = { ...s, days: [{ day: today, confirmed_at: 5, deferred: ["id-3", "id-4"] }] };
  expect(diff(s, more, () => "op")).toEqual([{ op_id: "op", entity: "days", id: today, fields: { deferred: ["id-3", "id-4"] } }]);
});

test("device-only state never syncs: draft, focus, settings, last seen", () => {
  const s = sample();
  const t = { ...s, draft: "half a tho", last_seen_at: 99, settings: { ...s.settings, quiet_end: 420 } };
  expect(diff(s, t, () => "op")).toEqual([]);
});

test("first upload: every row, parents before children, tasks before steps", () => {
  const ops = allOps(sample(), id);
  expect(ops.map((o) => `${o.entity}:${o.id}`)).toEqual(["tasks:id-1", "chunks:id-2", "chunks:id-3", "chunks:id-4", "days:2026-10-05"]);
  expect(ops[3].fields.parent_id).toBe("id-2");
});

test("server changes merge in, except fields with a local edit still waiting to send", () => {
  const s = sample();
  const local = { ...s, tasks: s.tasks.map((t) => ({ ...t, title: "Cover letter v2" })) };
  const pending = diff(s, local, () => "p1"); // title is waiting to go
  const merged = applyChanges(
    local,
    [
      { entity: "tasks", row: { ...s.tasks[0], title: "Renamed elsewhere", holding_up: true, rev: 7 } },
      { entity: "chunks", row: { id: "c9", task_id: "id-1", parent_id: null, title: "From the phone", position: 9, state: "todo", deleted: false, updated_at: 1, rev: 8 } },
      { entity: "days", row: { day: "2026-10-06", confirmed_at: null, shutdown_at: null, deferred: [], rev: 9 } },
    ],
    pending,
  );
  expect(merged.tasks[0]).toMatchObject({ title: "Cover letter v2", holding_up: true });
  expect(merged.tasks[0]).not.toHaveProperty("rev");
  expect(merged.chunks.at(-1)).toMatchObject({ id: "c9", title: "From the phone" });
  expect(merged.days.map((d) => d.day)).toEqual([today, "2026-10-06"]);
});

test("applying an echo of what this device already has changes nothing", () => {
  const s = sample();
  const echo = allOps(s, id).map((o) => ({ entity: o.entity, row: o.entity === "days" ? { day: o.id, ...o.fields, rev: 1 } : { id: o.id, ...o.fields, rev: 1 } }));
  const merged = applyChanges(s, echo, []);
  expect(diff(s, merged, () => "op")).toEqual([]);
});
