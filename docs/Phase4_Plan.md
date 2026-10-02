# Phase 4 plan: adaptive and honest

**Status: draft, not approved.** Written 2026-10-02. Research and plan only; no code. Product decisions are Natalie's. The open ones are in §9.

Phase 4 (`Product_Scope.md` §6) has four features: adaptive slot times, estimate vs actual (replacing `Tech_Scope.md` §4.2), a weekly stale nudge, and AI breakdown through Workers AI (ADR-0007). This file covers what each one reads from the data Ember already stores, the simplest rule that works with a worked example, how much history it needs, how it fails, and what it costs on the free plan. Then come the slices (23–27), the parallel waves, and the decisions.

**When to build.** The roadmap holds phase 4 until Natalie's items in `docs/Verify_List.md` are done (bot created, iPhone install test, two-device passkey check). Two features learn from history, and no reminder has been sent yet. Adaptive timing needs about two weeks of sends; estimate vs actual needs finished tasks with logged sessions. Both fall back to today's fixed behaviour until they have enough, so they are safe to ship early, but nothing can test them against real use before then. The stale nudge and AI breakdown need no history.

## 1. Already decided (Natalie, 2026-10-02, in the planning session)

| Question | Answer |
|---|---|
| How a slot moves | **Snap to the best hour.** Each slot moves to the whole hour near it with the best acted-to-sent ratio over the last 14 days. An hour needs at least 5 sends to count. |
| What estimate vs actual replaces | **One ratio across all sizes.** The median of actual ÷ estimated sessions over finished tasks scales the whole §4.2 table. |
| Stale nudge | **Inbox tasks untouched for 14 days, Sunday, 19:00 slot,** inside the 3-a-day cap. |

The step count stays **3 to 6**, as in `UX_Flows.md` §3.3 (the Build session's brief said 3 to 7; the product docs win).

## 2. Free-plan limits used below

Per invocation (one cron tick or one request): **10 ms CPU, 50 D1 statements** (each statement inside a `db.batch()` counts), **50 subrequests** (`Tech_Scope.md` §11). The scheduler's budget is spelled out at the top of `worker/scheduler.ts`: a tick spends 1 + 27 + 4 per planned user, with 5 users planned per tick, for 48 of 50. **Nothing in this plan adds a statement to a tick.** Each feature's reads go into the existing state load as an extra `UNION ALL` term, and D1 allows 5 terms per compound `SELECT` (§11). Today the load is two groups of three terms, so each group has room for two more.

Workers AI (pricing page, last updated **2026-10-01**, read 2026-10-02): **10,000 neurons a day free, resetting at 00:00 UTC**; paid use costs $0.011 per 1,000 neurons. On the free plan, calls fail with an error past the allowance (ADR-0007).

## 3. Adaptive slot times

**Data it needs (all stored).** `sends`: `sent_at`, `acted_at`, `snoozed_at`, `cancelled`. Reminder states are already derived this way (`Tech_Scope.md` §3): Acted = `acted_at`; Dismissed = sent more than 5 hours ago with neither `acted_at` nor `snoozed_at`. `acted_at` is set by a Telegram state button (`worker/buttons.ts`) or by opening a link button or push notification (`worker/handoff.ts`). The user's `tz` and quiet hours come from `settings`.

**The rule.** Default slots stay as they are (`slotOffsets` in `core/messages.ts`): S1 = waking start, S2 = midpoint, S3 = end − 3 h, S4 = end − 1 h.

1. Take the user's sends from the last 14 days that are at least 5 hours old and not cancelled. Bucket each by the **local hour** of `sent_at`.
2. Per hour: `acted` = sends with `acted_at`; `dismissed` = sends with neither `acted_at` nor `snoozed_at`. A snooze counts as neither. It is a "not now", not a yes or a no.
3. An hour **qualifies** when `acted + dismissed ≥ 5`. Its score is `acted ÷ (acted + dismissed)`.
4. Each slot may sit on any whole hour within **±2 h of its default**, inside the waking window. It moves to the qualifying hour in that range with the highest score. Ties go to the hour nearest the default. With no qualifying hour, it stays at the default.
5. The four slots must stay in order, at least 60 minutes apart. If a move would break that, that slot stays at its default.
6. Hard blocks still push a slot to the block's end (`clearOfBlocks`), after the move. Quiet hours still win.

Everything that uses slot times uses the moved ones: placement in `planDay`, and *Snooze → This evening* (S3) and *Tomorrow* (next day's S1).

**Worked example.** Natalie's waking window is 08:00–22:00, so S2 defaults to 15:00. On Mondays and Wednesdays a 14:00–16:00 lecture block pushes S2 to 16:00. Over the last 14 days:

| Local hour | Sends | Acted | Dismissed | Snoozed | Qualifies? | Score |
|---|---|---|---|---|---|---|
| 15:00 | 8 | 2 | 6 | 0 | yes (8) | 0.25 |
| 16:00 | 4 | 3 | 1 | 0 | no (4 < 5) | — |

S2 stays at 15:00. One more lecture day later, 16:00 has 5 sends (4 acted, 1 dismissed, score 0.80) and qualifies. From the next plan, S2 sits at 16:00 on every day, lecture or not.

**⚠️ The flaw in this rule: it only learns about hours it has already sent at.** If nothing pushes a message off its default hour, every other hour stays at 0 sends and never qualifies. The slot then never moves, however badly the default hour performs. In the example, only the lecture block created evidence for 16:00. Without hard blocks, snoozes, or mid-day replans, nothing would. This is decision **D1** (§9).

**Minimum history.** 5 settled sends in one hour, inside 14 days. At 3 messages a day spread over 4 slots, the default hours reach 5 in about 2–4 days; other hours only through the variation D1 settles.

**Failure modes.**
- **Few messages** (an in-app-only user, or a quiet week): no hour qualifies, the defaults hold. That is the intended fallback.
- **Time zone change:** sends stay bucketed by the hour in the *current* `tz`, so evidence from the old zone lands on the wrong hours for up to 14 days. Accepted; it washes out.
- **A user who never taps anything** (reads Telegram, acts in the app instead): every send counts as dismissed, every score is 0, ties keep the defaults. No harm, just no learning. Mood (UX_Flows §6's phase-4 seam) is **not** used. Skipped until there is a reason.

**Cost.** Zero extra statements: the `sends` term in the scheduler's state load widens from `day = today` to `day ≥ today − 14` (about 42 rows more at most), and the planner splits today's rows from history in JS. CPU: about 42 local-hour conversions with one cached `Intl.DateTimeFormat`, well under 1 ms. Zero subrequests.

## 4. Estimate vs actual

**Data it needs (all stored).** `tasks` (`size`, `state = 'done'`, `done_at`), `chunks.task_id`, `sessions` (`started_at`, `ended_at`, `completed`). Partial sessions are logged too (UX_Flows §3.5: *"including a partial session if you bail"*), and Flowtime sessions have any length, so time worked, not the session count, is the honest measure.

**The rule.**

1. Take the **last 20 finished tasks** by `done_at` that have a size and at least one logged minute. A task finished from a Telegram button with no focus session has no actual, so it is skipped.
2. Per task: `actual = minutes logged on its chunks ÷ 25`; `ratio = actual ÷ base(size)`, with base from §4.2 (XS 1, S 2, M 4, L 8, XL 16).
3. `R = median(ratios)`, clamped to **0.5–3**. The clamp keeps one odd run of tasks from making the estimates absurd.
4. Once there are enough tasks (decision **D2**), `padded(size) = max(1, round(base × R))`. This **replaces** the flat 20% pad, since R already contains the user's real overrun. Before that, §4.2's table stays.
5. Beside the size picker: *"Similar tasks took you about N sessions."* with `N = padded(selected size)`. Hidden until R is active.

**Worked example.** Natalie's last five finished tasks:

| Task | Size (base) | Minutes logged | Actual | Ratio |
|---|---|---|---|---|
| Email landlord | XS (1) | 30 | 1.2 | 1.20 |
| CV tweak | S (2) | 75 | 3.0 | 1.50 |
| DSA set 4 | M (4) | 150 | 6.0 | 1.50 |
| Expense claim | S (2) | 50 | 2.0 | 1.00 |
| Portfolio README | L (8) | 325 | 13.0 | 1.63 |

Median R = **1.50**. New table: XS 2, S 3, M 6, L 12, XL 24 (was 1, 2, 5, 10, 19). Picking M shows *"Similar tasks took you about 6 sessions."* An M task with 2 sessions done now has `remaining = 4` instead of 3, so its pressure rises and it ranks higher in Today (§4.4).

**Failure modes.**
- **Sizes misjudged unevenly** (XS always right, XL always double): one ratio cannot capture that. This is the known cost of the option Natalie chose; the per-size median is the upgrade path if the line ever reads wrong.
- **Client and server see different data:** the client may hold sessions not yet synced, so for a few seconds its R can differ from the scheduler's and the two Today rankings can differ slightly. Both converge on the next sync, as everything else does.
- **Size changed after work started:** the final size is used. Accepted.

**Cost.** Server: one extra term in the state load, aggregated in SQL (`SUM(ended_at − started_at)` grouped by task, joined through `chunks`, `LIMIT 20`), so at most 20 rows. Zero extra statements, zero subrequests, trivial CPU. Client: computed from local state on render, 20 tasks.

## 5. Weekly stale nudge

**Data it needs (all stored).** `tasks` with `state = 'inbox'` and `updated_at`; the local weekday of the plan's day (from `tz`); past `sends`.

**The rule.**

1. On the user's **Sunday** (local day), the planner adds a `stale` candidate if at least one Inbox task has `updated_at` older than **14 days**, and has not already been named in a stale send since it was last touched (that last condition is decision **D3**'s default; D3 lists the others).
2. Preferred slot **S3** (19:00 with default quiet hours; it moves with adaptive timing). **Cap priority 4**, the same as *morning*, placed after it. On a busy Sunday, deadlines, overdue, and close messages still win, and a dropped stale nudge waits for next Sunday.
3. Text (draft copy): *"3 things have been sitting a while. Keep, schedule, or let go?"* With one task: *"1 thing has been sitting a while. Keep, schedule, or let go?"* One link button, *Open Inbox*, carrying the send id and a sign-in code like every link button (§6), so opening it marks the send acted. On web push, tapping the notification opens Inbox.
4. `sends.kind` gains `stale`. The column has no `CHECK` constraint, so this needs no migration, just the new kind in `MessageKind`.

**Worked example.** Sunday 2026-10-11. Inbox holds 5 tasks; 3 were last touched before 2026-09-27. No deadlines are due or close. Candidates: morning (4), stale (4), wrap-up (5). All three fit the cap of 3: morning at 08:00, stale at 19:00, wrap-up at 21:00. If a close task existed (3), wrap-up would drop instead.

**Failure modes.**
- **An Inbox that is all stale** (someone who captures and never triages): the message names a count, not a list, so it stays one short line.
- **Touching a task by mistake** (opening it and changing nothing) does not bump `updated_at`, because only real edits write a row. So "untouched" really means unedited.
- **Time zone near midnight:** "Sunday" is the local day from `core/day.ts` (the day starts at quiet end), not the UTC date.

**Cost.** One extra term in the state load (Inbox tasks past 14 days, with the D3 condition as a `NOT EXISTS` over `sends` and `json_each(task_ids)`), returning a few rows. Zero extra statements; the send itself goes through the existing claim path at the existing cost.

## 6. AI breakdown through Workers AI

### 6.1 Model comparison

Costs at ADR-0007's sizing: about 400 input tokens (instructions plus the task title) and 250 output tokens (six short numbered lines). Prices from the pricing page above.

| Model | Neurons per M in / out | Neurons per call | Free calls a day | What is known |
|---|---|---|---|---|
| `@cf/meta/llama-3.1-8b-instruct-awq` (ADR-0007's choice) | 11,161 / 24,215 | ≈ 10.5 | ≈ 950 | 8B dense model, 4-bit quantised, from 2024. **Not on the JSON-mode list** (JSON-mode page, updated 2026-09-14). |
| `@cf/google/gemma-4-26b-a4b-it` | 9,091 / 27,273 | ≈ 10.5 | ≈ 950 | Newer and larger (26B, mixture-of-experts with about 4B active per token) at the same cost. Not on the JSON-mode list. |
| `@cf/ibm-granite/granite-4.0-h-micro` | 1,542 / 10,158 | ≈ 3.2 | ≈ 3,100 | Three times the free calls. ADR-0007's worry still holds: a micro model is weaker at following a format. |

Pricing has not changed since ADR-0007 (same awq figures), so the 5-per-user and 800-global caps stand for any of these three. **Quality and latency are not measured here.** Nothing published compares these models on "split a task into physical steps", and guessing would be worse than measuring. Slice 26 starts with a bake-off: 20 real task titles from the seeded demo data through each model, scoring the share that parse into 3–6 usable steps, and timing each call. The cheapest model that parses at least 18 of 20 wins. If that is not the awq model, ADR-0007 gets a short amendment for Natalie to approve.

**No JSON mode.** None of the three supports Workers AI's JSON mode, and even where it exists, Cloudflare says it cannot guarantee the schema is met. So the model replies with a **numbered plain list**, and the Worker takes lines matching `1.` / `1)`, trims each to 120 characters, keeps at most 6, and fails the call if fewer than 3 remain. This works on every model and is easy to test.

### 6.2 Privacy

Pressing the button sends the **task title** (and, for *Break this step down*, the parent step's title) to Cloudflare Workers AI. Nothing else goes: no other tasks, no journal. Every phase-2 user's task titles already sit on Cloudflare in D1 through the anonymous backup, so the vendor is the same; what is new is the title passing through a model. Nothing is sent until the user presses the button, every time. The suggested steps are not stored on the server unless the user accepts them, and then they sync as ordinary chunks. **Cloudflare's data-use terms for Workers AI inputs were not checked for this draft.** Slice 26 cites them before anything ships, and the disclosure copy (decision **D4**) must match what they say.

### 6.3 Design within UX_Flows §3.3

- **Task view:** *Break this down for me*, with the line *Splits "<title>" into 3 to 6 steps you can edit.* The result appears as an editable draft list: rename, delete, reorder. **Accept** adds them as top-level steps at the end of the task's list, in one outbox batch. **Discard** saves nothing. Nothing commits before accept (§3.3 step 3).
- **Step menu:** *Break this step down* calls the same endpoint with the parent's title as context. Accepted steps become that step's smaller steps. It is offered only on a top-level step with no smaller steps yet, so a third level can never appear (§3.3 rule 6) and an existing group is never mixed with AI steps.
- **Every press counts** against the cap, accepted or not (§3.3). A press that fails also counts, because the call may already have used neurons.
- **States (draft copy):** loading *"Breaking it down…"*; cap reached *"Out of breakdowns for today. Try: what's the very next physical action?"* (fixed copy); failed or unparseable *"Couldn't break that down. Try: what's the very next physical action?"*; offline, button disabled with *"Breakdowns need a connection."* The manual field stays usable in every state.

### 6.4 Server

- `POST /api/breakdown { title, parent? }` → `{ steps: string[] }`, or `{ error: "cap" | "failed" }`. Both strings at most 200 characters, validated like `/api/sync`. The cookie identifies the user; no sign-in needed.
- **Cap:** a new table `ai_uses(day, user_id, n, PRIMARY KEY (day, user_id))`, with `day` as the **UTC** date because the neuron allowance resets at 00:00 UTC (08:00 Singapore, which is also Ember's default day start). One batch of two conditional upserts: the user's row (`n < 5`) and a global row with `user_id = '*'` (`n < 800`). Either returning nothing means the cap is reached. Two statements, then one AI call.
- **Abuse:** a script can mint new anonymous cookies to dodge the per-user cap, but the global 800 still holds, and the free plan errors instead of billing. The worst case is that other users lose breakdowns for the rest of that UTC day. Accepted for now; revisit if it happens.
- **Retention:** `ai_uses` rows older than 2 days are deleted by the existing daily retention cron (one statement).

## 7. Slices

Numbering continues from phase 3 (`Tech_Scope.md` §10). Format as there. On approval, this table moves into Tech_Scope §10 under *Phase 4*.

| # | Slice | Done when | Tests |
|---|---|---|---|
| 23 | **Adaptive slots.** `core/adaptive.ts`: `adaptSlots(defaults, history, tz, quiet)` per §3; the scheduler's `sends` load term widens to 14 days; `planDay` and snooze use the moved slots | The §3 example moves S2 from 15:00 to 16:00 after the fifth 16:00 send, and not before | unit: the §3 example, order and spacing guard, ties, no history; worker: plan uses moved slots, statement count unchanged |
| 24 | **Estimate vs actual.** `core/estimate.ts`: `estimateRatio(state)` and `padded(size, R)` per §4; `remaining` in `core/today.ts` uses it; scheduler load term for the last 20 finished tasks; the size-picker line in Task view | The §4 example gives R = 1.5 and M shows *"…about 6 sessions."*; below the threshold the line is hidden and §4.2 holds | unit: the §4 example, clamp, zero-minute tasks skipped, threshold; worker: server and client compute the same R from the same rows; e2e: the line appears |
| 25 | **Weekly stale nudge.** `stale` kind in `core/messages.ts` (candidate, priority 4, S3, text); scheduler load term for stale Inbox tasks with the D3 rule; *Open Inbox* link button and push tap route to Inbox | The §5 example plans morning, stale, wrap-up on Sunday 2026-10-11 and nothing stale on the Saturday | unit: Sunday only, 14-day edge, D3 repeat rule, cap interplay; worker: the message and its button |
| 26 | **AI breakdown (server).** Bake-off first (§6.1, results in an ADR-0007 note); `migrations/0007_ai.sql` (`ai_uses`); `AI` binding in `wrangler.jsonc`; `worker/breakdown.ts` (validate, cap, prompt, parse); route in `worker/index.ts`; `ai_uses` clean-up in retention; Workers AI data terms cited | A title returns 3–6 steps; the 6th press of the day returns `cap` | worker: AI binding stubbed: parse (good, too few, too long, junk), user cap, global cap, a failed call still counts, validation |
| 27 | **AI breakdown (client).** *Break this down for me* in Task view and *Break this step down* in the step menu (§6.3): draft list with edit, delete, reorder, accept, discard; every state's copy; offline disabled | Both entry points add steps only on accept, at the right level | e2e with the endpoint stubbed: accept, discard, cap, failed, offline; no third level offered |

### Waves and file ownership

As in `docs/Phase2_Parallel_Plan.md`: every unit owns its files and no two units in a wave share one. Shared files (`worker/scheduler.ts`, `core/messages.ts`, `core/today.ts`, `src/**`) have one owner, the lead.

**Wave A (parallel, each in its own worktree, Sonnet agents):**

| Unit | Owner | Owns (may edit) | Must not edit |
|---|---|---|---|
| **23c** Adaptive rule, pure | Agent | `core/adaptive.ts`, `core/adaptive.test.ts` (new) | everything else |
| **24c** Estimate ratio, pure | Agent | `core/estimate.ts`, `core/estimate.test.ts` (new) | everything else |
| **26** AI breakdown server | Agent | `worker/breakdown.ts`, `worker/breakdown.test.ts`, `migrations/0007_ai.sql` (new), `wrangler.jsonc` (the `ai` binding only), one route line in `worker/index.ts`, one clean-up line in `worker/retention.ts`, an amendment note in `docs/adr/0007-workers-ai-breakdown.md` | `worker/scheduler.ts`, `core/**`, `src/**` |

**Wave B (the lead, in order, after wave A merges):** 23 wiring (scheduler load term, `planDay` slots, snooze) → 24 wiring (`core/today.ts`, scheduler term, size-picker line) → 25 (all of it; it touches the same load query and `core/messages.ts`) → 27 (client). One PR per slice. Migration 0007 is applied to D1 before the deploy that carries slice 26.

## 8. ⚠️ Gotchas

- **Load query terms:** after slices 23–25, the scheduler's two groups hold 4 terms each. D1's cap is 5. A sixth term in either group fails with `too many terms`, so add a third group.
- **The 14-day `sends` read** must keep the overdue rule's own condition (`kind = 'overdue' AND claimed_at IS NOT NULL`), or silenced overdue tasks will be sent again.
- **Adaptive slots and the golden test:** `Tech_Scope.md` §4.6's Mei example has no history, so it must still produce 08:00, 16:00, 19:00. Keep it green unchanged; that proves the fallback.
- **Workers AI and tests:** the vitest pool has no real AI binding. Stub `env.AI.run` in tests; the bake-off is a one-off script run against the deployed binding, not part of CI.
- **UTC vs local day:** the AI cap counts UTC days on purpose (§6.4); every other day boundary in Ember is local. Name it in the code.

## 9. Decisions for Natalie

**D1. Adaptive timing: where does evidence for other hours come from?** Snap-to-best-hour cannot see an hour it never sends at (§3).

| Option | Trade-off |
|---|---|
| **Explore: every 7th message of a slot goes 1 h early or late** (alternating) | Builds evidence for neighbouring hours in about 2 weeks. Costs about one message a week at a worse time, by design. Simple to test with a fixed sequence, no randomness. |
| **Also count focus sessions:** an hour where you start a focus session counts as an acted send at that hour | Uses data already stored and costs no odd-time messages. But it learns when you work, which is not the same as when a nudge helps, and in-app users with no messages would still move slots that send nothing. |
| **No exploration:** rely on hard blocks, snoozes, and replans to scatter sends | No extra code or odd-time messages. Slots may never move for someone without hard blocks, so the feature can look dead. |

**D2. Estimate vs actual: how many finished tasks before the ratio replaces §4.2?**

| Option | Trade-off |
|---|---|
| **3 tasks** | Turns on within days. A median of 3 swings on one odd task. |
| **5 tasks** | The worked example in §4. Turns on in about one to two weeks of normal use. |
| **10 tasks** | Steadier median. Takes several weeks before the line shows at all. |

**D3. Stale nudge: how often can the same task be named?**

| Option | Trade-off |
|---|---|
| **Once until touched** (named in one stale send, then not again until it is edited) | Never nags about the same thing twice. A task ignored once stays stale silently forever, which may be fine (Inbox is where it lives). |
| **Every Sunday while stale** | Simplest rule, no `sends` lookup. The same "3 things" arrives every week, which reads as nagging over time. |
| **At most twice, 4 weeks apart** | A second chance without a weekly drip. One more rule to explain and test. |

**D4. AI breakdown: how is the user told the title leaves the device?** Copy must match Cloudflare's terms once checked (§6.2).

| Option | Trade-off |
|---|---|
| **One-time notice on the first press:** *"This sends the task's name to Cloudflare's AI to suggest steps."* [Continue] [Cancel] | Clear consent at the moment it matters. One extra tap, once. |
| **Line under the button, always visible:** add *"Sends the task name to Cloudflare's AI."* to the existing *Splits "…"* line | No extra tap, always honest. One more line of text on Task view. |
| **No in-flow notice; disclosed on the landing screen** next to *"Your list is backed up"* | Cleanest Task view. Easy to miss, and the landing screen was seen once, possibly weeks earlier. |
