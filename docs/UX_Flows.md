# Ember — UX Flows

Status: **draft, signed off section by section** (Define stage). Builds on `Product_Scope.md` and the five reports in `research/`. Describes the *finished* product's behaviour; the phase table in `Product_Scope.md` §6 stays the authority on what ships when. Phase seams are marked inline.

Contents:
1. Persona paths ✅ signed off 2026-09-15
2. Screen inventory and navigation ✅ signed off 2026-09-16
3. The seven flows in detail — *in progress (3.1–3.5 done)*
4. Edge and state screens — *to draft*
5. Notification interaction design — *to draft*
6. The cat — *to draft*
7. Onboarding — *to draft*
8. Design process plan — *to draft*

## Open scope changes (fold into Product_Scope at the scope pass)

- **Day shape.** New concept, not in `Product_Scope.md` yet. The user sets recurring **hard blocks** (fixed, unavailable hours — the "lecture" model). Ember sizes Today from the **free-floating** time left over and slots the ranked chunks into it. Guard against brittleness: **hard blocks are scheduled; chunks are never clock-pinned** — there is no clock sequence to wreck when the user starts late, only fixed blocks and a ranked list to fill the gaps. Phase placement is a Plan-stage call; not in the phase-1 cut line. Adds a §7 decision and a screen (§2).

---

## 1. Persona paths

Two people: **Mei** (the persona in `Product_Scope.md` §1) and **Natalie** (the builder, who dogfoods it daily). Each gets five days. The cat's state is noted at each step; the cat is never sad, worried, or disappointed, and it cannot see the user's mood.

**First-run hook: hybrid.** Capture-first by default. If the user dumps several things, the app calms the pile and surfaces one. If the user types one thing and stalls, the app offers to break that one down on the spot.

### Mei

Persona: 24, final semester, four assignments and two interviews in three weeks. Opens her todo list, feels sick, closes it.

**First run**
1. Lands on a near-empty screen, one capture field already focused. No tour, no signup, no account. Placeholder: *"What's on your mind?"* Sub-line: *"One thing or ten. Just get it out of your head."* Cat: asleep, curled in a corner.
2. Types "finish data structures assignment", hits enter; it drops into a short stack above the field, which stays ready. She keeps going — interview prep, ethics essay, fix résumé — six things in about 40 seconds. Cat: one eye open, waking. No deadlines, sizes, or triage asked for.
3. The turn (hybrid branch):
   - **Dumped several** → *"Got it, six things. Let's make today small."* The pile clears off-screen. Cat: sitting up, watching.
   - **Typed one and stalled** → *"Want me to break that one down?"* → straight into chunking that task.
4. First value, one thing not five: a single task surfaces, big and alone, with two buttons — **Break this down** and **Start**. Everything else is out of sight. First-run Today is deliberately one item; the five-cap is for a normal day, not a cold start.
5. First chunk: taps *Break this down* → 3–6 editable steps. *(Phase-1 seam: no AI yet; instead it asks "What's the very next physical action?" and she types one line.)* Picks step one.
6. First focus: *"Start with two minutes?"* — a short starter, not a full 25. The chunk fills the screen; the rest dims. Cat: stretching.
7. First reward: two minutes end, progress ring ticks up one, cat curls up purring. Then the offer, after the payoff, never before: *"That's a start. Want Ember to nudge you gently while it's closed?"* This is where Telegram-linking and add-to-home-screen are asked. **If she says no to both:** the app works fully; reminders live in-app, when she opens it. No nagging to turn nagging on.

Time to first finished chunk: under a minute of required input.

**Normal day**
Mid-morning, opens Ember. Today is already built: 5 chunks, ranked, one flagged as the frog with *Do this first / Not today*. Cat: watching. Taps the frog, hits *Start*, 25/5 timer, chunk fills screen, rest dims (cat: stretching). Chunk done → ring fills, cat curls purring, optional ≤90s unlock (trivia / Lichess / Wikipedia) or a restful breather. Three of five done. Evening shutdown in three taps: *"Anything urgent still open?"* → *"Tomorrow's list is ready: 4 things."* → *"That's it for today. You're done."* Optional one-line journal + mood tap.

**Deadline day**
The ethics essay is due today. Morning: one factual line — *"The ethics essay is due today."* In Today it is pulled to the top and **auto-flagged as the frog** (a due-today task is always first, bypassing the ranking). No extra nagging beyond the day's cap. Cat: normal states; never signals alarm. Finished → ring + purr. Unfinished at day's end → rolls into the overdue flow (one message, once, three buttons).

**Bad day (nothing done)**
Opens at 9pm having done nothing, or never opens.
- **Never opened:** at most the day's kind nudges fired (capped at 3, quiet hours respected). No "you did nothing" message exists.
- **Opens late:** Today looks normal — no red, no "0/5", nothing broken. Cat: watching, glad she's here.
- **Evening shutdown fires either way, reframed to rest:** *"Some days are for resting. Tomorrow's list is ready when you are."* No tally of what wasn't done.

**Return after a week away**
Gone seven days. Home screen looks exactly like a normal day — no red, no "7 days missed", no broken streak (there are no streaks). Greeting: *"Welcome back. Here's what's on today."* Cat: sitting by the door, glad to see her. Anything now overdue is offered for one-time re-chunking: *"A couple of these slipped past their date. Want to reset them?"* Not forced; she can ignore it and start.

### Natalie

The builder. Unemployed, job hunting for a Senior/Full Stack/Backend/Product role in Singapore; NeetCode and system-design practice daily; learning Spring. Uses Ember every day for months, so her paths test durability and the no-guilt design under real emotional load. **Her frog: learning DSA / hard concepts** — the deep-learning task she avoids. **Her day: currently formless; she wants a university shape** — hard blocks (fixed) and free-floating time (see the day-shape scope change above).

**First run**
She built it, so first run is the first day she uses it for real. Dumps: three applications to send, a NeetCode set, a Spring tutorial, résumé tweaks, Ember work. Hybrid branch fires on the dump path → *"Let's make today small."* → surfaces one. Cat: waking → watching. Same seven-step shape as Mei's first run.

**Normal day**
Today: 5 chunks sized to her free-floating time (hard blocks excluded). The frog — a DSA / hard-concepts chunk — is auto-flagged first. Deep-work chunks (the DSA block, a coding block) under the 25/5 timer; applications as their own chunks. Three of five done, shutdown, done.

**Deadline day (interview tomorrow)**
An interview is tomorrow 10am. Morning: one factual line. In Today, interview prep is pulled top and auto-flagged frog. System-design review and mock questions are the chunks. No extra nagging beyond the cap.

**Bad day (a rejection lands)**
A rejection email hits at 2pm. She doesn't open Ember, or opens it and can't start. The design's job here is to do nothing clever — no "everything okay?", no pep talk, no mascot concern. Evening: if she opens, shutdown fires reframed to rest — *"Some days are for resting. Tomorrow's list is ready when you are."* Cat: watching, unchanged. It cannot see the rejection and does not pretend to.

**Return after a week (went dark prepping / slump)**
Vanished a week, deep in interview loops or a slump. Home = normal day. *"Welcome back. Here's what's on today."* Cat: by the door. Overdue applications offered for one-time re-chunk; she can ignore and just start.

---

## 2. Screen inventory and navigation

The research is blunt: the visible surface must stay tiny. The whole app hangs off **one home screen (Today)**; everything else is an overlay, a mode, a drill-in, or tucked into a drawer. Six views plus three transient flows. Nothing shows the full backlog by default.

**Navigation: Today + slide-over drawer.** Today is home. A swipe or menu icon opens a drawer holding **Inbox** and **Settings** together, off the main view, one gesture away. The *"N more waiting"* line on Today is also a direct shortcut into Inbox — the drawer is the general nav, that line is the contextual peek. No persistent tab bar; the backlog is never a permanent visible tab.

### The anchor

| Screen | What it's for | Reach it | Leave it |
|---|---|---|---|
| **Today** (home) | The ≤5 ranked chunks, the frog, progress ring, the cat. The default view every open. | App open. Everything returns here. | Into Focus, a task, Capture, or Shutdown. |

### Overlay and mode

| Screen | What it's for | Reach it | Leave it |
|---|---|---|---|
| **Capture** | One text field. The "get it out of your head" moment. A bottom sheet over whatever you're on, so you never lose your place. | Persistent capture button, from anywhere. | Task saved → sheet drops, back where you were. |
| **Focus** | Current chunk fills the screen, timer running, everything else dimmed. A full-screen mode on phone, not a place. | *Start* on a chunk. | Chunk done → Reward. Bail → back to Today, sessions logged. |

### Drill-in

| Screen | What it's for | Reach it | Leave it |
|---|---|---|---|
| **Task view** | One task: light triage (deadline? depends on anything? size XS–XL), its chunks, *Break this down*, *Let it go*. Triage happens here, inline, when the task is about to enter Today — not as a step after capture. | Tap any task in Today or Inbox. | Back to where you came from. |

### Tucked away (in the drawer, off the home screen)

| Screen | What it's for | Reach it | Leave it |
|---|---|---|---|
| **Inbox** | The captured-but-not-scheduled backlog. Kept off the home screen on purpose; the research warns this is the screen that becomes stressful. | Drawer, or the *"N more waiting"* shortcut on Today. | Back to Today. |
| **Settings** | Quiet hours, reminder channels (Telegram / web push), **day-shape / hard blocks**, account & sync. | Drawer. | Back to Today. |

### Transient flows (appear, do their job, leave)

- **Onboarding** — first run only (detailed in §7).
- **Reward / break** — progress ring + cat reaction + optional ≤90s unlock or a breather. Rides on top of Focus, not a destination.
- **Shutdown** — the three-step evening close. Fires in the evening or on a *wrap up* action.

### Desktop delta

Same screens, no new ones. The wider canvas shows **Today and the active Focus side by side**, with a persistent capture bar along the top instead of a summoned sheet. Inbox and Settings stay behind the same drawer. Desktop shows more at once; it does not add surface.

---

## 3. The seven flows in detail

Capture, triage, chunk, pick, focus, reward, review. Each flow lists its entry points, every tap, the decisions the app makes silently, every bail-out, and exact copy. `Product_Scope.md` §3 copy is fixed; this section extends it, never changes it.

### 3.1 Capture

**Purpose:** get a thought out of your head with zero friction. One field. Nothing required but text.

**Entry points**
- Persistent capture button on Today (desktop: the always-there top capture bar).
- Global — reachable from any screen, including mid-Focus (dump a stray thought without leaving the session).
- *Phase-2 seam:* send any message to the Telegram bot → it becomes a captured task in Inbox.
- *Optional, later:* register Ember as a PWA share target so text shared from another app lands in capture. Not core.

**Every tap (phone)**
1. Tap capture button → bottom sheet slides up, field already focused, keyboard up. Placeholder: *"What's on your mind?"* When Inbox is empty or it's first run, the sub-line shows: *"One thing or ten. Just get it out of your head."*
2. Type text → **Send** (or the keyboard's enter). The item flashes a quiet *Added* and the field **clears but stays open** — dump five things in a row without reopening anything.
3. Optional, revealed not forced: two chips under the field — **Deadline** (opens the native date picker) and **Quick**. Both collapsed by default; nothing required.
4. Close with **Done** or a swipe-down.

**Decisions the app makes silently**
- A new capture enters **Inbox** state — not Today, not triaged. Triage is deferred to the Task view when the task is about to enter Today.
- **Quick** pre-sets **size = XS**, so triage can skip the size question later. It changes nothing about scheduling or priority.
- **No deduplication.** Two similar captures are two tasks; silently merging could hide a real second thing. *(ponytail: no dedup in v1.)*
- Empty or whitespace-only send is ignored, no error.
- Inbox orders newest first.

**Bail-outs**
- Dismiss the sheet with **unsent** text → the text is **kept as a draft in the sheet** (reopening shows it), not committed to Inbox. No half-typed thought lost; no Inbox clutter. Sending is the only thing that commits.
- Mid-Focus capture: sending returns you straight to the running session; the timer never paused.

**Copy:** placeholder *"What's on your mind?"*; empty-state sub-line *"One thing or ten. Just get it out of your head."*; confirmation *Added*; chips *Deadline* / *Quick*; close *Done*.

### 3.2 Triage

**Purpose:** turn a raw captured thought into a rankable task with the least possible input — deadline? depends? size. Priority is computed from these and never shown as a formula.

**Entry points**
- Tap an untriaged task in Inbox → the Task view shows the triage questions inline, above its chunk area.
- As part of the morning **Pick**, when Inbox has untriaged items and Today has room, the app offers to sort a few (detailed in §3.4 — the app adds the structure).

**Every tap** (≤3, in any order)
1. **Deadline?** *[Not yet]* / *[Pick a date]* → native date picker. Default: none.
2. **Is this holding up anything else?** *[No]* / *[Yes]* → a bottleneck bump.
3. **Size:** XS · S · M · L · XL, one tap. Skipped automatically if **Quick** pre-set XS at capture.

**Decisions the app makes silently**
- **Size alone makes a task rankable.** Deadline and "holding up" are optional refinements. A Quick-flagged task (XS) is already rankable with zero further taps.
- Priority is computed from deadline proximity (back-planned into 25-min sessions), the "holding up" flag, and size. The user sees only *where it lands in Today* and the frog flag — never a number or formula.
- A task with no deadline and no dependency is "far out" — it won't push into Today except on a light day (*"Light day. Want to get ahead on X?"*).
- The "holding up" flag is a **single boolean nudge, not a dependency graph.** Ember does not model task-to-task links (out of scope: no GTD projects/contexts). It only bumps priority.
- The size→sessions numbers (XS = 1 session, etc., padded 20%) are a formula → they belong in `Tech_Scope.md`, not here. Flagged, deferred.
- Completing triage moves the task **Inbox → Active**.

**Bail-outs**
- Skip triage entirely: an untriaged task just sits in Inbox. It never nags and never ranks. A valid resting place, not a failure.
- Partial triage is fine — answer in any order, leave whenever. As long as it has a size, it can rank.

**Copy:** *"Has a deadline?"* → *[Not yet] [Pick a date]*; *"Is this holding up anything else?"* → *[No] [Yes]*; size *XS · S · M · L · XL*. *Phase-4 seam:* beside size, *"Similar tasks took you about N sessions."*

### 3.3 Chunk

**Purpose:** get to the very next physical action, so starting is never "where do I even begin."

**Entry points**
- Task view, below triage: a prompt and the breakdown button.
- Tapping **Start** on a task with no chunks yet → it asks for the next action first, inline, then starts.

**Every tap**
1. Task view shows *"What's the very next physical action?"* with a text field, and a **Break this down for me** button beside it.
2. **Manual:** type one next action → it becomes chunk 1. Add more if you want, but you never have to — one next thing is enough to start.
3. **AI** (*phase-4 seam; before that, manual only*): tap *Break this down for me* → 3–6 editable steps come back. Edit, delete, reorder, then **accept** → added as the task's chunks. Nothing commits until you accept.
4. Chunks show as a checklist under the task. Each chunk runs Todo → In focus → Done.

**Decisions the app makes silently**
- A task needs **≥1 chunk to enter Focus.** No chunk = the Start tap asks for the next action rather than blocking you.
- **Chunks belong to the task; Today still surfaces only ≤5 across everything.** A 6-step breakdown doesn't blow the day — the rest wait behind the *"N more waiting"* line and surface as room opens.
- **Chunks are flat — no sub-chunks.** One level only; recursive breakdown is the Goblin trap. *(ponytail: flat.)*
- A chunk can take one or more focus sessions; sessions log against it. Chunk ≠ session.
- AI cap reached → falls back to manual with the fixed line: *"Out of breakdowns for today. Try: what's the very next physical action?"* The daily cap **number** depends on the chosen free-tier LLM → deferred to `Tech_Scope.md`.
- **Each press of *Break this down for me* counts against the daily cap, whether or not the result is accepted** — the press is what calls the paid LLM. Cost-driven, not a preference.
- **Manual gives one next action; AI gives the full 3–6.** Deliberate asymmetry: manual keeps you on just the next thing, AI does the whole breakdown on request.

**Bail-outs**
- Don't chunk: the task ranks and sits; Start prompts the one-line next action whenever you're ready. Chunking is never a separate chore.
- Bad AI breakdown: edit it down or discard and type your own.

**Copy:** *"What's the very next physical action?"*; button *Break this down for me*; cap reached *"Out of breakdowns for today. Try: what's the very next physical action?"*

### 3.4 Pick

**Purpose:** each morning, hand the user a short, ranked, *doable* Today — never the backlog. At most 5 chunks, sized to the free time the day actually has.

**Entry points**
- First open of the day → Today is built and shown as a light morning confirm (below).
- *Phase-2 seam:* the scheduler builds Today overnight so a morning nudge can say it's ready. *(Phase 1: built on first open; no server.)*

**The morning moment: light confirm**
Once a day, Today opens with a brief confirm: *"Here's today: N things. Good to go?"* Accept in one tap, or tweak first (pin / defer, below). A small intention-setting beat, not a plan-the-day ritual.

**How Today is built (silent decisions)**
- Ranked chunks from Active tasks, top-down, until the smaller of **5 chunks** or **the free-floating time available today** is filled. Hard blocks are excluded from capacity; chunks are never pinned to clock times.
- **The frog:** the single top-ranked chunk, flagged *Do this first / Not today*. On a deadline day, the due-today task's chunk is auto-frog. *(Phase-4 seam: bias the frog toward tasks the user tends to avoid, once there's history.)*
- **Overflow:** anything past the cap sits behind *"N more waiting. They'll come up when there's room."*
- **Light day:** if free time exceeds what's due soon, one far-future task is offered — *"Light day. Want to get ahead on X?"* — never forced.
- **Empty:** nothing to rank, or all done → the empty-Today state (§4), not a blank cap-5 grid.
- **Finish behaviour: done means done.** Clearing all of Today does **not** auto-refill five more — you get the completion and an optional *get-ahead* offer you can decline. Auto-refill would rebuild the endless-list overwhelm the whole app exists to prevent.

**User control: swap, defer, and pin**
- *Not today* defers any chunk; the next-ranked chunk fills the slot.
- **Pin** a specific task into Today: it takes a slot and bumps the lowest-ranked chunk out. Full agency within the 5-cap, for the days you know "I must do X today."

**Bail-outs**
- Ignore Today entirely and just open Capture or a specific task. Today is an offer, not a gate.
- Dismiss the morning confirm without accepting → Today still exists as built; the confirm just doesn't nag again that day.

**Copy:** morning confirm *"Here's today: N things. Good to go?"*; controls *Do this first* / *Not today* / *Pin to today*; overflow *"N more waiting. They'll come up when there's room."*; light day *"Light day. Want to get ahead on X?"*

### 3.5 Focus

**Purpose:** one chunk, full screen, timer running, everything else out of the way. "One thing at a time" made literal.

**Entry points**
- **Start** on a chunk — from Today, the frog, or a Task view.

**Every tap**
1. Start → Focus mode: the chunk text fills the screen, timer begins, the rest of the UI **dims (not blocked — you can still peek).** Cat: stretching.
2. Minimal controls only: **Pause**, **Done**, **Exit**. Capture stays reachable without pausing.
3. Timer ends or **Done**:
   - **Chunk done** → Reward (§3.6).
   - **Timer done, chunk not done** → restful break, then a gentle *"Back to it?"* to resume the same chunk.

**Two different rest moments — do not conflate:**
- **Pomodoro break** (after a 25, chunk unfinished) = the **restful** one: a calm screen or breathing guide. No games here.
- **Chunk completion** = the **reward** (§3.6): ring fills, cat reacts, optional ≤90s unlock. Games live here, not in the pomodoro break.

**Decisions the app makes silently**
- Default **25/5**. **Flowtime** (count-up, stop when you stop) is the alternative, set in Settings with a per-session switch at start. *(Flowtime's phase placement is a Plan call; the 25/5 timer is the phase-1 loop.)*
- The timer runs on **wall-clock**. Backgrounding or locking the phone fails nothing — no tree-death punishment (Forest's punitive model, off-thesis). Return shows elapsed time.
- Sessions log against the chunk, including a partial session if you bail — feeds phase-4 estimate-vs-actual.
- The 5-min break is **offered, not auto-forced** (*"Take 5?"* → *"Back to it?"*); no strict auto-flow.

**Bail-outs**
- **Pause** stops the timer, stays in focus. **Exit** returns the chunk to Todo with sessions logged — no penalty, no guilt.
- **Done early** completes the chunk before the timer elapses → straight to Reward.

**Copy:** break prompt *"Take 5?"*; resume *"Back to it?"*; controls *Pause / Done / Exit*. Break screen: a calm visual + optional breathing guide, copy kept minimal.
