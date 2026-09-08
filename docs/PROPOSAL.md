# Proposal — a task app that encourages you to finish

Date: 2026-09-09. Status: **awaiting your decisions** (section 5). Nothing is built.

Research behind this lives in `research/` (five files, ~1,300 lines, ~150 sources). This document is the short version. Every claim below points at the file that backs it.

Priority note: this is secondary to the job search. It earns its place only as a portfolio piece that reads well to a Singapore recruiter and as a tool that actually helps you ship the job-search work itself.

---

## 1. What it is, in one paragraph

A free web app on desktop and phone for one overwhelmed person with too many deadline tasks of unknown size and priority. You dump a task in one line. The app turns it into a first small step, decides how urgent it is, and shows you a short list for today, never the whole backlog. It reminds you through the day at times it learns from when you respond, and the reminders get more specific as a deadline nears, but never guilt-trip. A focus timer runs each chunk. Finishing a chunk earns a small reward: a companion reacts, a progress ring fills, a short teaser or fact unlocks. One line at the end of the day closes the loop. If you vanish for a week, it welcomes you back like nothing happened.

**What it proves to a recruiter:** a full-stack TypeScript PWA with real cross-device sync, server-driven web push plus a fallback channel, a scheduling engine with a documented algorithm, and design craft. The differentiator is the reminder engine: back-planning from deadlines, escalation by specificity not volume, and adaptive timing.

---

## 2. What the research says (the parts that change the design)

### The user problem is executive load, not laziness
- Task initiation under stress is an executive-function bottleneck. The fix is externalising the plan and shrinking the task to a first physical action, not more motivation. (`psychology.md` §5)
- Making small visible progress is the single strongest driver of daily motivation in Amabile and Kramer's 12,000-diary study. Progress you can see beats badges. (`psychology.md` §5)
- People systematically underestimate their own tasks. Showing their own past estimate-vs-actual ratio is the evidence-backed fix. (`psychology.md` §5)

### Why apps get abandoned, and you confirmed all four
Your interview (`user-interview.md`) matches the literature exactly:

| You said | Research says | Design rule |
|---|---|---|
| Reminders felt like guilt | Reactance: once reminders get dismissed without action, the channel is dead. ~38% of quitters cite notification fatigue. | Notifications are a trust budget. Default low, taper on dismiss-without-action, hard cap 3/day total. |
| Too much setup / upkeep | Self-tracking burden is itself an abandonment cause. | One text field to capture, zero required fields. The app classifies; you never do. |
| Missed once, then gave up | Abstinence-violation effect. Missing one day does not hurt habit formation; feeling it does causes the quit. | No streaks that break. No red states. A lapse return looks like a normal day. |
| The list got too long | Zeigarnik open loops; the workable visible set is 4–5 items. | Today shows at most 5 chunks. The backlog exists but is never the home screen. |

### Reminder science is humbler than the marketing
- Adaptive ML timing did not reliably beat simple fixed windows in a controlled trial. Frequency within reasonable bounds matters more than cleverness. (`psychology.md` §3)
- So "learns from when I respond" should be a cheap heuristic (shift toward hours you actually act, away from hours you dismiss), not a model. It is still worth building because you asked for it and it is a good portfolio story, but it is v2, after fixed windows work.
- If-then plans ("when and where will you do this?") have one of the largest replicated effects in this whole literature (d≈0.65). One optional question at capture. (`psychology.md` §2)

### Breaks: teasers are a reward, not a rest
- Attention Restoration Theory: a demanding puzzle taxes the same directed attention you need for the next chunk. Restorative breaks are low-effort (breathing, a window, a calm visual). (`psychology.md` §7)
- So the teaser/fact you asked for is framed as an **earned unlock after a chunk**, bounded to a minute or two, and the timer's actual break defaults to something restful. Both exist; they are different buttons.

### Nobody owns the gap
From the 21-app teardown (`competitors-and-design.md` Part A):
- Due nags relentlessly but has zero warmth. Finch is warm but never pushes. Nobody combines persistence with kindness.
- Goblin.tools breaks tasks down beautifully and then forgets everything. No reminders, no memory.
- The calm, well-designed apps are $20/month or Apple-only. The free cross-platform ones look like enterprise tools.
- Companion apps that add real task management either stay shallow (Focus Friend) or drown in RPG admin (Habitica). Keep gamification light.
- Focus Friend hit #1 in Productivity on both stores in 2026 with only a companion and a timer, no task list. The loop is proven; the deadline-task layer is the missing piece.

### Free and on your phone is possible, with one hard constraint
(`tech-feasibility.md`)
- **No browser ships client-side scheduled notifications.** The Notification Triggers API never left origin trial. A server must send every reminder.
- iPhone receives web push only from a home-screen-installed PWA, permission granted from inside it, no silent push. Android is lenient.
- Web push itself is free (VAPID). The free cron that fires it: Cloudflare Workers at 1-minute granularity, no inactivity pause. GitHub Actions cron drifts 5–30 minutes. Vercel Hobby allows one run per day.
- Supabase pauses after 7 idle days. Cloudflare D1/KV do not pause.
- A free Telegram bot delivers a real native notification on any phone with no install funnel. The report's recommendation is to send both: web push for the portfolio story, Telegram for reliability.
- Journal text can be encrypted client-side with WebCrypto so the server only ever holds ciphertext.

---

## 3. The core loop (common to every concept below)

Capture → Triage → Chunk → Pick → Focus → Reward → Review. (`methods-and-content.md` Part A)

1. **Capture.** One text field, one tap away, no required fields. Optional deadline. If you mark it "quick", a 2-minute countdown offers to just do it now.
2. **Triage.** Two yes/no questions at most ("has a deadline?", "does something depend on it?") plus a one-tap size (XS–XL). Priority is computed silently: days-to-deadline × how-much-you-care ÷ size. You never see a formula or a quadrant.
3. **Chunk.** The app asks one thing: "what is the very next physical action?" An optional "break this down for me" button produces 3–6 editable steps.
4. **Pick.** Today's list is generated each morning, capped at 5 chunks, ranked. One is flagged as the frog with a "do this first" or "not today" toggle. You keep agency.
5. **Focus.** 25/5 timer by default, Flowtime as the alternative mode. The current chunk fills the screen; everything else dims.
6. **Reward.** Chunk done: ring fills, companion reacts, an optional 60-second unlock (trivia, a Lichess puzzle, a Wikipedia "on this day" fact). Timer break: breathing or a calm screen.
7. **Review.** Evening shutdown, three taps: anything urgent still open → tomorrow's list is ready → "That's it for today. You're done." One optional line of journal. Weekly, one passive nudge: "3 tasks have had no activity in 10 days. Still doing these?" with a first-class "let it go" option.

**Reminder engine** (`methods-and-content.md` Part B): back-plan sessions from the deadline with 20% padding and one buffer day. Far out: at most one gentle nudge a day. Last 30% of runway: up to two, more specific. Deadline day: one factual morning message. Overdue: one message, three buttons (reschedule, done, let it go), then silence. Quiet hours default 22:00–08:00. Snooze options are 1 hour, this evening, tomorrow. Snoozing never moves the deadline, so avoidance shows up naturally as "this now needs 6 sessions a day" instead of a shame counter.

---

## 4. Three concepts

Same loop, different centre of gravity. You pick one.

### Concept A — "Kind Due": the reminder engine is the product
The deadline back-planner and escalating-but-kind nudges are the hero. Companion is a small progress ring with reactions. Teasers are a later phase.
- **For:** smallest scope, strongest backend story for a Senior/Backend application, directly attacks the gap nobody owns.
- **Against:** least "engaging" visually at launch; the risk you named (you stop responding) is mitigated only by tone and timing, not by a character.
- **Cut line:** capture, chunk, today list, timer, push+Telegram reminders, shutdown ritual.

### Concept B — "Small Companion": a character that cares about real work
A companion (abstract shape or creature) whose state reflects your real deadline chunks, not self-care check-ins. Focus timer and earned unlocks are core. Reminders come from the companion's voice.
- **For:** matches all three things you said work on you (visible progress, a character, small unlocks). Focus Friend proved the loop sells in 2026. Best showcase for the design-heavy goal.
- **Against:** biggest scope and the most design assets. Adult reviewers call Finch childish; the character needs restraint (see decision 5.3). A companion that is sad when you lapse is a dark pattern, so it can only ever be neutral or glad.
- **Cut line:** everything in A plus the companion with 4–5 states and the reward unlock.

### Concept C — "Daily Ritual": one morning pick, one evening close
Wordle-shaped. Two touchpoints a day: a morning screen that hands you today's five chunks, and an evening shutdown with a one-line journal. Between them, only deadline-driven nudges. Journal is first-class from day one.
- **For:** calmest, least nag risk, cheapest to build, strongest journaling story.
- **Against:** weakest on "nag me through the day", which was your opening sentence. Least portfolio differentiation (looks like a nice Microsoft To Do).
- **Cut line:** capture, chunk, morning pick, shutdown, journal, deadline nudges only.

If you cannot choose: A first, B's companion as phase 2. The reminder engine is the hard part and the recruiter story; the companion is skin on top of the same events.

---

## 5. Decisions that are yours

Each has three options. Where an option is wrong on a fact, it says so.

### 5.1 Concept
A, B, or C above.

### 5.2 Notification channel
1. **Web push + Telegram bot, both fired by one Cloudflare cron.** Free. Reliable on iPhone via Telegram, real PWA push for the portfolio. Two channels to maintain.
2. **Web push only.** Free, pure PWA story. Fact: on iPhone it only works after home-screen install, and the report rates it flaky. You will miss reminders.
3. **Telegram (or email) only, no PWA push.** Free and most reliable. Loses the "I shipped web push" line on the résumé.

### 5.3 Companion form
1. **Abstract shape** that changes posture and glow with your day (research recommendation; avoids the "childish" complaint).
2. **Literal creature** (Finch/Focus Friend style). Highest warmth, highest asset cost, highest childish risk for an adult job-seeker persona.
3. **Progress ring only, no character.** Fact: you said a character works on you; this drops it.

### 5.4 Stack
From `tech-feasibility.md` §6:
1. **Cloudflare Pages + Workers + D1, cron, VAPID push, Telegram; passkey or shared-secret auth.** Zero cost, no pause risk, one vendor, 1-minute cron. Server is source of truth; basic sync. Report's pick.
2. **Local-first CRDT (Yjs) over a free relay, plus the same Cloudflare cron.** Best offline sync, strongest senior-engineer signal. Fact: highest complexity; the report says it is overkill for a to-do app unless CRDTs are the story you want to tell. Fits as a phase-2 upgrade to option 1.
3. **Supabase Postgres + Edge Functions + Cloudflare cron for sends.** Most recognisable stack to a recruiter. Fact: free project pauses after 7 idle days; needs a keep-alive ping.

### 5.5 AI task breakdown ("break this down for me")
Fact: this needs an LLM API call. Claude Max does not include API credits; the Claude API is pay-as-you-go. Three options:
1. **Manual chunking only for v1** ("what's the next physical action?"), AI button in phase 2. Zero cost.
2. **A free-tier LLM** (e.g. Gemini or Groq free tiers) behind a Worker with a daily cap. Zero cost, adds a vendor whose free tier can change.
3. **Claude API, pay-as-you-go**, cached one call per task. Small but non-zero cost, breaks "free forever".

### 5.6 Visual direction
From `competitors-and-design.md` Part C. The Claude Design canvas skill renders these as mockups at the Design Direction stage, once you pick.
1. **Warm Paper.** Cream, ink, terracotta accent. Fraunces + Inter. Tasks are index cards that tear off when done. Closest to Things 3 and Craft.
2. **Focus Beam.** Light for planning, dark for focus; amber accent as a spotlight. Sora + IBM Plex Sans. Starting a timer dims everything but the current chunk. Mode switch is visible without copy.
3. **Small Companion.** Dusty lavender and peach, Nunito + Karla, an abstract shape in the corner. Fact: the report warns this is the direction most likely to read childish; pairs naturally with Concept B if the shape stays restrained.

### 5.7 Name
1. **Kindling** — small pieces that get a fire going. Chunking is the metaphor; the tone is warm.
2. **Pebble** — one small step at a time; also the shape the companion could be.
3. **Ember** — a small glow that keeps going; the "come back after a lapse" idea.
Check GitHub and npm for collisions before locking one in.

---

## 6. Draft product roadmap (edit freely)

Phases, each ending runnable and committed. The cut line is the end of Phase 2.

**Phase 0 — Define and Plan** (this proposal → your decisions → `docs/Product_Scope.md`, `docs/Tech_Scope.md`, `docs/Design_Direction.md` with Claude Design mockups).

**Phase 1 — The loop, one device.** Capture, triage, chunk, today list (cap 5), timer, done state with progress ring, shutdown ritual. Local storage only. Deployed to Cloudflare Pages as a PWA. *Proves: the loop feels good enough that you open it tomorrow.*

**Phase 2 — Reminders and sync (cut line).** D1 backend, auth, sync across desktop and phone, the back-planning scheduler, Cloudflare cron sending web push and Telegram, quiet hours, snooze, overdue flow, lapse-return flow. *Proves: it nags you kindly on your phone while the app is closed.*

**Phase 3 — Engagement.** Companion states and reactions, earned unlocks (Open Trivia DB, Lichess daily puzzle, Wikipedia "on this day"), restful timer breaks (breathing script), one-line journal with mood scale, client-side encryption for journal text.

**Phase 4 — Adaptive and honest.** Reminder timing shifts toward hours you act on, away from hours you dismiss. Estimate-vs-actual shown at capture. Weekly stale-task nudge. Optional AI breakdown.

**Phase 5 — Ship.** README with screenshots and the scheduler algorithm diagram, ADRs for push+Telegram and sync choice, `/repo-review`.

**Kill criteria** (say these now so the sunk-cost trap does not get you): if after two weeks of Phase 2 you have not opened it on three consecutive days, stop and write down why before building Phase 3.

---

## 7. What happens next

1. You answer 5.1–5.7 (a line each is enough).
2. I create the repo folder under `Documents\Coding\<name>` with the `new-repo` skill, move `research/` and this file into `docs/`, and write `Product_Scope.md` from your answers.
3. Grill session on the scope, then `Tech_Scope.md`, then Design Direction with Claude Design mockups.
4. Build happens in a separate session from a written plan, as you asked.
