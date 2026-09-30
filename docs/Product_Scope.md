# Ember — Product Scope

Status: **signed off 2026-09-30** (Define closed). Research and the option analysis are in `PROPOSAL.md` and `research/`. Screen-by-screen behaviour, flows, and copy are in `UX_Flows.md`.

## 1. Background and problem

Ember is for one person with too many deadline tasks whose size and priority are unknown: a final-year student or a working engineer juggling job applications, coursework, and side projects. Their tasks live in Notion or a text file with no reminders, so nothing pulls them back. Every productivity app they have tried died the same four ways: the reminders felt like guilt, the setup became a chore, one missed day turned into never reopening it, and the list grew until opening it was the stressful part.

The problem is not motivation. It is executive load: not knowing where to start, and holding the whole plan in their head.

**Who it is for:** Natalie first. Persona for every later decision: "Mei, 24, final semester, four assignments and two interviews in the next three weeks, opens her todo list, feels sick, closes it."

**What this repo proves to a recruiter:** a full-stack TypeScript PWA with cross-device sync, a server-driven reminder engine (deadline back-planning, escalation by specificity, adaptive timing), free-tier infrastructure with documented failure modes, and design craft. Differentiator: reminders that persist like Due but sound like Finch.

## 2. Proposed solution (behaviour, not tech)

### The loop
1. **Capture.** One text field, one tap from anywhere. Nothing else is required. Optional: deadline, "quick" flag (pre-sets size XS, so triage skips the size question).
2. **Triage.** At most two yes/no questions ("Has a deadline?", "Is this holding up anything else?") and a one-tap size XS–XL. Priority is computed and never shown as a formula.
3. **Chunk.** The app asks: "What's the very next physical action?" An optional "Break this down for me" button returns 3–6 editable steps from a free-tier LLM.
4. **Pick.** Each morning the app builds Today: at most 5 chunks, ranked, and no more than fit the day's free time (see Day shape). One is flagged as the frog with "Do this first" / "Not today" toggles. Far-future tasks appear here only when the day is light ("Light day. Want to get ahead on X?").
5. **Focus.** 25/5 timer by default, Flowtime mode as alternative. The current chunk fills the screen; the rest dims.
6. **Reward.** Chunk done: progress ring fills, the cat reacts. An optional unlock of up to 90 seconds: a trivia question, a Lichess daily puzzle, or a Wikipedia "on this day" fact. The timer's real break is restful: a breathing guide or a calm screen.
7. **Review.** Evening shutdown in three steps: "Anything urgent still open?" → "Tomorrow's list is ready: N things." → "That's it for today. You're done." One optional journal line and a 5-point mood tap.

### Day shape
The user sets recurring **hard blocks** once: fixed, unavailable hours, like lectures. Ember sizes Today from the **free-floating** time left over. Hard blocks are scheduled; chunks never are. Today is a ranked list to work through in the free time, with no clock sequence, so starting late breaks nothing. Phase placement is decided in Plan; it is not in the phase-1 cut line.

### The companion
An orange tabby cat. States: asleep (no activity yet today), watching (Today list open), stretching (focus session running), curled up purring (chunk finished), sitting by the door (lapse return, glad to see you). The cat is never sad, worried, or disappointed. It has no needs of its own; the user never feeds or maintains it.

### The reminder engine
- Back-plan sessions from the deadline: estimate in 25-minute sessions from size, pad 20%, keep one buffer day, spread evenly.
- **Far out** (more than 50% of runway left, or no deadline): at most one gentle morning offer; no midday nudges.
- **Getting close** (last 30% of runway or last 3 days): up to two nudges a day, each more specific ("2 sessions left, 3 days to go").
- **Deadline day:** one factual morning message.
- **Overdue:** one message, once, with three buttons. Then silence for that task.
- **Hard cap:** 3 notifications per day across all tasks. Competing tasks batch into one message. Over the cap, deadlines win: overdue, then deadline day, then getting close, then the morning message, then the evening wrap-up invite.
- **Quiet hours:** 22:00–08:00 default, editable. Never re-nudge within 30 minutes of a dismiss or snooze.
- **Day boundary:** a day starts when quiet hours end (08:00 default), not at midnight. Today rebuilds and the daily cap resets then; a 1am session counts toward the day before.
- **Snooze:** 1 hour / this evening / tomorrow. Snoozing never moves the deadline.
- **Adaptive timing (phase 4):** nudge times drift toward hours the user acts on and away from hours they dismiss. Heuristic, not a model.
- **Channels:** Telegram bot first (phase 2). Web push added in phase 3 from the same scheduler.

### The lapse return
After any absence, the home screen looks like a normal day: no red, no count of missed days, no broken streak. Overdue tasks stay in Today with their date shown until the user resets them. After **3 or more days away**, Ember opens with "Welcome back. Here's what's on today." and offers the reset once; a one- or two-day absence opens as an ordinary day.

## 3. Hard rules and exact UI copy

| Rule | Copy |
|---|---|
| Capture requires only text | Placeholder: "What's on your mind?" |
| Today never shows more than 5 chunks | Overflow line: "4 more waiting. They'll come up when there's room." |
| Every task can be let go without deleting | Button: "Let it go" · Confirmation: "Moved out of the way. It's still here if you want it back." |
| Overdue message sends once only | "X was due today and isn't marked done. Still relevant?" [Reschedule] [Done] [Let it go] |
| No guilt language in any notification | Forbidden patterns: quantifying absence, sad mascot, rhetorical "everything okay?", manufactured loss, social comparison. Rule set in `research/competitors-and-design.md` Part D. |
| Deadline nudges always pair fact with help | "This deadline's getting close. Want help breaking it down?" |
| Shutdown ends with an explicit stop | "That's it for today. You're done." |
| Journal is optional, one line | Placeholder: "One line about today, whatever comes to mind." |
| Mood scale | Rough · Meh · Okay · Good · Great |
| Estimate honesty (phase 4) | "Similar tasks took you about N sessions." shown beside the size picker |
| AI breakdown is capped and optional | Button: "Break this down for me" · Cap reached: "Out of breakdowns for today. Try: what's the very next physical action?" |

## 4. State machines

### Task
| State | Enters from | Leaves to |
|---|---|---|
| Inbox | Capture | Active (triaged), Let go |
| Active | Inbox | Done, Let go, Overdue (deadline passed) |
| Overdue | Active | Active (rescheduled), Done, Let go |
| Done | Active, Overdue | — |
| Let go | any | Active (restored) |

### Chunk
Todo → In focus → Done. A chunk in focus that is abandoned returns to Todo with sessions logged.

### Reminder for a task
| State | Meaning |
|---|---|
| Scheduled | Computed send time exists |
| Sent | Delivered via a channel |
| Acted | User opened the task or logged a session within 5 hours |
| Dismissed | Sent, no action within 5 hours (feeds taper and adaptive timing) |
| Snoozed | User chose 1h / evening / tomorrow; recomputed against the same deadline |
| Silenced | Overdue message already sent; no further sends unless rescheduled |

## 5. Out of scope

- Teams, sharing, collaboration, comments.
- Calendar integration, email or Slack task import.
- Clock-pinned scheduling of chunks or a full day timeline (Structured / Sunsama style). Only hard blocks are scheduled.
- Body doubling / Focusmate-style pairing.
- Full GTD projects, contexts, tags; Eisenhower grids; MoSCoW labels.
- A cat with needs (feeding, shop, currency, cosmetics).
- Streak counters of any kind.
- Native app store builds (Apple Developer costs $99/year; not free).
- Long-form journaling, therapy-style prompts.
- Web push in the EU (Apple removed PWA push there).

## 6. Phases and cut line

| Phase | Delivers | Proves |
|---|---|---|
| 0 Define + Plan | This scope, tech scope, design direction with Claude Design mockups of all three visual directions, feasibility spike | Decisions are written down |
| 1 The loop, one device | Capture, triage, chunk, Today (cap 5), timer, done ring, shutdown. Local storage, plus a one-time iPhone Add-to-Home-Screen nudge so Safari's storage wipe can't empty the list. Deployed as a PWA. | You open it tomorrow |
| **2 Reminders + sync (cut line)** | Backend, anonymous backup from the first capture (account needed only for a second device), auth, cross-device sync, scheduler, Telegram sends, quiet hours, snooze, overdue flow, lapse return | It nags you kindly while closed |
| 3 Engagement | Cat with 5 states, unlocks (trivia, Lichess, Wikipedia), restful breaks, journal + mood, web push, client-side journal encryption | You keep opening it |
| 4 Adaptive + honest | Timing drift, estimate-vs-actual, weekly stale nudge, AI breakdown | It gets smarter without getting louder |
| 5 Ship | README, scheduler diagram, ADRs, repo review | Recruiter-ready |

**Kill criterion:** two weeks into phase 2, if Natalie has not opened it three days running, stop and write down why before phase 3.

## 7. Decisions taken (2026-09-09)

| # | Decision | Chosen | Note |
|---|---|---|---|
| 1 | Concept | A "Kind Due" first; companion in phase 3 | Far-future tasks get the morning-offer treatment |
| 2 | Channel | Telegram first, web push phase 3 | Same Cloudflare cron fires both |
| 3 | Companion | Orange tabby cat, 5 states, never sad | Illustration approach decided at design stage |
| 4 | Stack | Provisional: Cloudflare Pages + Workers + D1 + cron | Feasibility spike in Plan stage before commitment |
| 5 | AI breakdown | Free-tier LLM behind the API, daily cap | Provider chosen in tech scope |
| 6 | Visual direction | Undecided; mock all three | Warm Paper, Focus Beam, Small Companion |
| 7 | Name | Ember | Collides with Ember.js; publish as `ember-tasks` or similar |
| 8 | Day structure (2026-09-30) | Day-shape template: hard blocks scheduled, chunks never clock-pinned | Full timeline rejected as brittle. Phase decided in Plan |
| 9 | Data safety (2026-09-30) | iPhone install nudge in phase 1; anonymous server backup from phase 2 | Needs a retention rule for anonymous users who never return (Tech_Scope). Safari's 7-day wipe to be confirmed in the feasibility spike |
