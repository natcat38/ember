# ADR-0008: The scheduler plans the whole day's messages at day start

**Status:** Accepted
**Date:** 2026-10-02
**Deciders:** Natalie

## Context

At most 3 messages a day, and over the cap deadlines win (Product_Scope §2). A scheduler that sends whatever is due each minute would spend the morning slots on conveniences and have no room left for a deadline message in the afternoon. `UX_Flows.md` §5 requires slots to be held for higher-priority messages later in the day.

## Decision

At each user's day start, compute every candidate message for the day, keep the 3 highest-priority, and place them in four fixed slots across the waking day, moving any slot out of a hard block. Store them as `sends` rows. Each minute, the cron claims due rows and sends them. Any change to a task with a planned row (a sync, a Telegram button, a snooze) replans the unsent rest of the day. Details and a worked example: `Tech_Scope.md` §4.5–4.6.

## Options considered

| Option | Why it lost |
|---|---|
| **Plan at day start, replan on change (chosen)** | — |
| Greedy: send whatever is due each tick | Spends the cap on early, low-priority messages. Violates "deadlines win". |
| One external delayed message per reminder (Upstash QStash) | Second vendor with about 500 free messages a day, and replanning means cancelling queued messages one by one. |

## Consequences

- The cap and the priority order live in one pure function in `core/`, covered by the golden test.
- Fixed slots make send times predictable; phase 4's adaptive timing only has to move the slots.
- A message's time can shift by hours after a replan. Acceptable: the UX never promises an exact minute.
