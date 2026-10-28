# Ember — UX Flows

Status: **signed off 2026-09-30**, together with `Product_Scope.md` (Define closed). Builds on `Product_Scope.md` and the five reports in `research/`. Describes the *finished* product's behaviour; the phase table in `Product_Scope.md` §6 stays the authority on what ships when. Phase seams are marked inline.

Contents:
1. Persona paths ✅ signed off 2026-09-15
2. Screen inventory and navigation ✅ signed off 2026-09-16
3. The seven flows in detail ✅ signed off 2026-09-30
4. Edge and state screens ✅ signed off 2026-09-30
5. Notification interaction design ✅ signed off 2026-09-30
6. The cat ✅ signed off 2026-09-30
7. Onboarding ✅ signed off 2026-09-30
8. Design process plan ✅ signed off 2026-09-30

## Scope changes from this session

All applied to `Product_Scope.md` on 2026-09-30: day shape (§2 + decision 8), Quick flag meaning, reworded triage question, lapse-return wording, the 3-day gap, the day boundary at the end of quiet hours, cap priority, anonymous backup from phase 2 + phase-1 iPhone nudge (decision 9), and the out-of-scope line for clock-pinned scheduling.

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
   - **Dumped several** → *"Got it, six things. Let's make today small."* then *"Which one's weighing on you most?"* with the items listed. One tap picks it; the rest clear off-screen. Cat: sitting up, watching.
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
Gone seven days. Home screen looks like a normal day: no red, no count of missed days, no broken streak (there are no streaks). Overdue tasks show their date until she resets them. Greeting: *"Welcome back. Here's what's on today."* Cat: sitting by the door, glad to see her. Anything now overdue is offered for one-time re-chunking: *"A couple of these slipped past their date. Want to reset them?"* Not forced; she can ignore it and start.

### Natalie

The builder, and Ember's first daily user. NeetCode and system-design practice daily; learning Spring. Uses Ember every day for months, so her paths test durability and the no-guilt design under real emotional load. **Her frog: learning DSA / hard concepts** — the deep-learning task she avoids. **Her day: currently formless; she wants a university shape** — hard blocks (fixed) and free-floating time (see Day shape in `Product_Scope.md` §2).

**First run**
She built it, so first run is the first day she uses it for real. Dumps: three applications to send, a NeetCode set, a Spring tutorial, résumé tweaks, Ember work. Hybrid branch fires on the dump path → *"Let's make today small."* → surfaces one. Cat: waking → watching. Same seven-step shape as Mei's first run.

**Normal day**
Today: 5 chunks sized to her free-floating time (hard blocks excluded). The frog — a DSA / hard-concepts chunk — is auto-flagged first. Deep-work chunks (the DSA block, a coding block) under the 25/5 timer; applications as their own chunks. Three of five done, shutdown, done.

**Deadline day (interview tomorrow)**
An interview is tomorrow 10am. Morning: one factual line. In Today, interview prep is pulled top and auto-flagged frog. System-design review and mock questions are the chunks. No extra nagging beyond the cap.

**Bad day (a rejection lands)**
A rejection email hits at 2pm. She doesn't open Ember, or opens it and can't start. The design's job here is to do nothing clever — no "everything okay?", no pep talk, no mascot concern. Evening: if she opens, shutdown fires reframed to rest — *"Some days are for resting. Tomorrow's list is ready when you are."* Cat: watching, unchanged. It cannot see the rejection and does not pretend to.

**Return after a week (went dark prepping / slump)**
Vanished a week, deep in interview loops or a slump. Home looks like a normal day; overdue applications show their date until she resets them. *"Welcome back. Here's what's on today."* Cat: by the door. Overdue applications offered for one-time re-chunk; she can ignore and just start.

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
| **Capture** | One text field. The "get it out of your head" moment. A bottom sheet over whatever you're on, so you never lose your place. | The capture bar on Today, Inbox, and Focus (not Settings). | Task saved → sheet drops, back where you were. |
| **Focus** | Current chunk fills the screen, timer running, everything else dimmed. A full-screen mode on phone, not a place. | *Start* on a chunk. | Chunk done → Reward. Bail → back to Today, sessions logged. |

### Drill-in

| Screen | What it's for | Reach it | Leave it |
|---|---|---|---|
| **Task view** | One task: light triage (deadline? depends on anything? size XS–XL), its chunks, *Break this down*, *Remove from list*. Triage happens here, inline, when the task is about to enter Today — not as a step after capture. | Tap any task in Today or Inbox. | Back to where you came from. |

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
- Reachable from Today, Inbox, and mid-Focus (dump a stray thought without leaving the session). Not shown in Settings, where there is nothing to capture into (wireframe review, 2026-09-30).
- *Phase-2 seam:* send any message to the Telegram bot → it becomes a captured task in Inbox.
- *Optional, later:* register Ember as a PWA share target so text shared from another app lands in capture. Not core.

**Every tap (phone)**
1. Tap capture button → bottom sheet slides up, field already focused, keyboard up. Placeholder: *"What's on your mind?"* When Inbox is empty or it's first run, the sub-line shows: *"One thing or ten. Just get it out of your head."*
2. Type text → **Send** (or the keyboard's enter). The item flashes a quiet *Added* and the field **clears but stays open** — dump five things in a row without reopening anything.
3. Optional, revealed not forced: two chips under the field — **Deadline** (opens the native date picker) and **Quick**. Both collapsed by default; nothing required.
4. Close with **Done** (top-left of the sheet, away from *Send*), a tap on the dimmed background, or a swipe-down. *Send* is the only action by the field. (Done moved during wireframe review, 2026-09-30.)

**Decisions the app makes silently**
- A new capture enters **Inbox** state — not Today, not triaged. Triage is deferred to the Task view when the task is about to enter Today.
- **Quick** pre-sets **size = XS**, so triage can skip the size question later. It changes nothing about scheduling or priority.
- **No deduplication.** Two similar captures are two tasks; silently merging could hide a real second thing. *(ponytail: no dedup in v1.)*
- Empty or whitespace-only send is ignored, no error.
- Inbox orders newest first.

**Bail-outs**
- Dismiss the sheet with **unsent** text → the text is **kept as a draft in the sheet** (reopening shows it), not committed to Inbox. No half-typed thought lost; no Inbox clutter. Sending is the only thing that commits.
- Mid-Focus capture: sending returns you straight to the running session; the timer never paused.

**Copy:** placeholder *"What's on your mind?"*; empty-state sub-line *"One thing or ten. Just get it out of your head."*; confirmation *Added*; chips *Deadline* / *Quick*; close *Close* (design step 2, 2026-10-01); was *Done*, which clashed with Focus's *Done*.

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

**Word on screen: *step*.** *Chunk* is the internal term in these docs and in code; the user never sees it (wireframe review, 2026-09-30).

**Purpose:** get to the very next physical action, so starting is never "where do I even begin."

**Entry points**
- Task view, below triage: a prompt and the breakdown button.
- Tapping **Start** on a task with no chunks yet → the task's own title becomes its first step and Focus starts on it, no question asked (Natalie, 2026-10-06; it used to ask for the next action first).

**Every tap**
1. Task view shows *"What's the very next physical action?"* with a text field, and a **Break this down for me** button beside it.
2. **Manual:** type one next action and press enter or the **+** button → it's added to the bottom of the list, and the field clears and stays ready for another. Add more if you want, but you never have to — one next thing is enough to start. The question *"What's the very next physical action?"* is the field's label; its placeholder is *"Type one step"* (wireframe review, 2026-09-30).
3. **AI** (*phase-4 seam; before that, manual only*): tap *Break this down for me* → 3–6 editable steps come back. Edit, delete, reorder, then **accept** → added as the task's chunks. Nothing commits until you accept.
4. Chunks show as a checklist under the task. Each chunk runs Todo → In focus → Done.

**Decisions the app makes silently**
- A task needs **≥1 chunk to enter Focus.** No chunk = the Start tap makes the task's title its first step rather than blocking you.
- **Chunks belong to the task; Today still surfaces only ≤5 across everything.** A 6-step breakdown doesn't blow the day — the rest wait behind the *"N more waiting"* line and surface as room opens.
- **Two levels at most: a step can be split once into smaller steps** (wireframe review, 2026-09-30; replaces "chunks are flat"). The smaller steps stay under their parent, because the parent's name is how the user recognises the work. The cap of two levels keeps out recursive breakdown, the Goblin trap. The rules:
  1. **Splitting:** a step's `...` menu has *Break this step down*. Before phase 4 it's manual: the step becomes a heading and an indented field opens under it, labelled *Add a smaller step*. That field shows only right after a split or after the parent's *Add a smaller step* menu item, and closes when it loses focus while empty (design step 2, 2026-10-01). From phase 4 the AI returns 3–6 smaller steps with the same edit-then-accept flow, and each press counts against the daily cap like *Break this down for me*.
  2. **Parent checkbox:** ticks itself when its last smaller step is done. Ticking it by hand marks all its remaining smaller steps done and plays one Reward, not one per step. Unticking it straight away puts its smaller steps back as they were (design step 2, 2026-10-01).
  3. **No start button on a parent.** Focus always runs on one smaller step. The Task view's *Start* begins the first unfinished smaller step in list order.
  4. **Today surfaces smaller steps, never the parent**, so the cap of 5 still counts real actions. Each row names its parent as context.
  5. **Reordering:** smaller steps move only within their own parent. Moving a parent moves its whole group. Nothing is dragged between levels.
  6. **No third level:** a smaller step's menu has no *Break this step down*.
  7. **Deleting a parent** asks first: *"Delete this step and its N smaller steps?"* Deleting the last smaller step turns the parent back into a plain step.
  8. **States:** Todo → In focus → Done applies only to steps with no smaller steps. A parent's state is derived: Done when all its smaller steps are Done, otherwise Todo.
- **Editing a step:** each step's `...` opens a menu with *Start this step*, *Move up*, *Move down*, *Rename*, and *Delete step* (wireframe review, 2026-09-30).
- **Reordering steps:** hold a step (touch) or click it (mouse) and drag; *Move up* / *Move down* cover keyboard and screen-reader users. The Task view's *Start* begins the first unfinished step in list order; any step's own start button begins that step (wireframe review, 2026-09-30).
- A chunk can take one or more focus sessions; sessions log against it. Chunk ≠ session.
- AI cap reached → falls back to manual with the fixed line: *"Out of breakdowns for today. Try: what's the very next physical action?"* The daily cap **number** depends on the chosen free-tier LLM → deferred to `Tech_Scope.md`.
- **Each press of *Break this down for me* counts against the daily cap, whether or not the result is accepted** — the press is what calls the paid LLM. Cost-driven, not a preference.
- **Manual gives one next action; AI gives the full 3–6.** Deliberate asymmetry: manual keeps you on just the next thing, AI does the whole breakdown on request.

**Bail-outs**
- Don't chunk: the task ranks and sits; Start prompts the one-line next action whenever you're ready. Chunking is never a separate chore.
- Bad AI breakdown: edit it down or discard and type your own.

**Copy:** *"What's the very next physical action?"*; button *Break this down for me*, with a line under it naming the task, *Splits "Revise DSA basics" into 3 to 6 steps you can edit.* (added in wireframe review, 2026-09-30); cap reached *"Out of breakdowns for today. Try: what's the very next physical action?"*

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
2. Minimal controls only: **Pause** (large, centred), **Done**, **Stop for now**. Capture stays reachable without pausing. (*Stop for now* was *Exit* until wireframe review, 2026-09-30; renamed so it can't be mistaken for Done.)
3. Timer ends or **Done**:
   - **Chunk done** → Reward (§3.6).
   - **Timer done** → the app can't know whether the chunk is finished, so the prompt asks *"Take 5?"* with *[Take 5] [Skip break]*, plus *[I finished it]*, which goes to Reward (design step 2, 2026-10-01). Not finished → restful break, then a gentle *"Back to it?"* to resume the same chunk.

**Two different rest moments — do not conflate:**
- **Pomodoro break** (after a 25, chunk unfinished) = the **restful** one: a calm screen or breathing guide. No games here.
- **Chunk completion** = the **reward** (§3.6): ring fills, cat reacts, optional ≤90s unlock. Games live here, not in the pomodoro break.

**Decisions the app makes silently**
- Default **25/5**. **Flowtime** (count-up, stop when you stop) is the alternative, set in Settings with a per-session switch at start. *(Flowtime's phase placement is a Plan call; the 25/5 timer is the phase-1 loop.)*
- The timer runs on **wall-clock**. Backgrounding or locking the phone fails nothing — no tree-death punishment (Forest's punitive model, off-thesis). Return shows elapsed time.
- Sessions log against the chunk, including a partial session if you bail — feeds phase-4 estimate-vs-actual.
- The 5-min break is **offered, not auto-forced** (*"Take 5?"* → *"Back to it?"*); no strict auto-flow.

**Bail-outs**
- **Pause** stops the timer, stays in focus. **Stop for now** returns the chunk to Todo with sessions logged — no penalty, no guilt.
- **Done early** completes the chunk before the timer elapses → straight to Reward.

**Copy:** break prompt *"Take 5?"* with *[Take 5] [Skip break] [I finished it]*; resume *"Back to it?"*; controls *Pause / Done / Stop for now*. Break screen: a calm visual + optional breathing guide, copy kept minimal.

### 3.6 Reward

**Purpose:** make finishing a chunk feel good, without the reward becoming a time-sink or a second job.

**Entry points**
- A chunk marked **Done** — from Focus, or checked off in Today / a Task view. A check-off outside Focus plays layer 1 only (ring and cat); the unlock card follows chunks finished in Focus, so ticking several done in a row never stacks overlays (design step 2, 2026-10-01).

**Two layers**
1. **Always-on, instant:** progress ring fills (Apple-rings style — *"3 of 5"*), cat curls up purring. Short animation (~300–400ms); a slightly bigger moment only on the **last chunk of the day**, never on every check (confetti fatigue is real). Free and guaranteed.
2. **Optional ≤90s unlock:** a trivia question, the Lichess daily puzzle, or a Wikipedia "on this day" fact. Always skippable.

**User control: auto-served, skippable, every chunk**
- After every chunk finished in Focus, the app **serves one unlock** (rotating through trivia / puzzle / fact, or a default set once in Settings, with a *surprise me* option). No in-moment "which treat" decision.
- Offered after every Focus completion, always one tap to skip. The 90-second bar is a hint, not a limit: when it runs out the next-step offer appears under the unlock, and nothing closes mid-puzzle (design step 2, 2026-10-01). Thin content self-caps the time cost; trivia is one quick question per completion, so it can't be chained.

**Decisions the app makes silently**
- The unlock content is **naturally thin by design** — the Lichess daily puzzle is once a day, "on this day" is one static fact — so it's hard to binge. Trivia is served one question per completion.
- Skipping is one tap and costs nothing; the ring + cat already happened.
- *This is not the pomodoro break.* The restful break (breathing/calm) lives in Focus; the game unlock lives here, at completion.

**Bail-outs**
- Skip the unlock → straight to the next chunk or back to Today.
- The ring and cat are non-interactive — they react and get out of the way; nothing to dismiss.

**Copy:** unlock offer *"Step done. Ninety seconds, if you want it."* → a button naming the unlock being served, *[Try today's chess puzzle]*, *[Answer a trivia question]*, or *[See what happened on this day]*, plus *[Skip]*. (Changed from a generic *[Play]* during wireframe review, 2026-09-30.)

### 3.7 Review (evening shutdown)

**Purpose:** end the day with an explicit, guilt-free stop — the opposite of an open-ended list that never lets you clock off.

**Entry points**
- Evening: **one gentle invite** — a single soft nudge *"Ready to wrap up?"*, counted within the 3/day cap and silenced during quiet hours.
- A manual **wrap up** action, available any time of day.

**Every tap — three steps** (scope §2.7, fixed)
1. *"Anything urgent still open?"* → shows any due-today/overdue not done, with quick reschedule / remove / mark-done. Or *"Nothing urgent."* → next.
2. *"Tomorrow's list is ready: N things."* → a peek at tomorrow's pre-built Today. Reassurance, not a planning task.
3. *"That's it for today. You're done."* → the explicit stop.

Then optional, never required: one-line journal (*"One line about today, whatever comes to mind."*) + a mood tap (*Rough · Meh · Okay · Good · Great*).

**Zero-done variant** (from §1): step 3 becomes *"Some days are for resting. Tomorrow's list is ready when you are."* No tally of what wasn't done.

**Decisions the app makes silently**
- Tomorrow's Today is built at shutdown (or overnight in phase 2); *"N things"* is that count.
- Journal + mood are logged, non-punitive (*phase-3 seam: client-side encrypted per scope; phase-4 seam: mood may feed adaptive timing*). They change nothing tonight.
- Shutdown runs **once a day**; reopening afterward doesn't re-run it.

**Bail-outs**
- Skip journal and mood — *"You're done"* is the real end; the rest comes after it.
- Exit any time. Shutdown is a ritual on offer, never mandatory.

**Copy:** invite *"Ready to wrap up?"*; the three fixed step lines; journal placeholder *"One line about today, whatever comes to mind."*; mood *Rough · Meh · Okay · Good · Great*; zero-done close *"Some days are for resting. Tomorrow's list is ready when you are."*

---

## 4. Edge and state screens

Every state follows the same rules: no red, no counts of what was missed, and each one tells the user what they can do next. Copy marked *fixed* comes verbatim from `Product_Scope.md` §3.

| State | When | What the screen does | Copy |
|---|---|---|---|
| **Empty Inbox** | Nothing captured, or everything triaged | Plain line + capture button | *"Nothing waiting here."* |
| **Empty Today: nothing lined up** | Nothing triaged and ranked yet | Two ways forward, no blank grid | *"Nothing's lined up for today yet."* → *[Sort a few from Inbox]* only when Inbox holds something; the capture bar is the way to add (UX pass, EMB-UX-11) |
| **Empty Today: all done** | Today cleared | Done means done: ring full, cat purring, optional get-ahead offer | *"That's everything for today."* |
| **Overflow** | More than 5 chunks qualify | One line under Today, links to Inbox | *fixed:* *"4 more waiting. They'll come up when there's room."* |
| **Offline** | No connection | Small quiet indicator, not a banner. Capture, complete, focus, and shutdown keep working and queue. Only AI breakdown and Telegram linking need a connection | *"Offline. Your changes will sync when you reconnect."* · breakdown offline: *"Breakdowns need a connection. Try: what's the very next physical action?"* |
| **Telegram not linked** | User skipped it | Nothing on Today. One row in Settings. Reminders stay in-app | *"Ember can nudge you on Telegram while the app is closed."* → *[Link Telegram]* |
| **Web push not granted** | Browser permission denied | Settings only. Never re-asked (browsers block re-prompting after a denial). Offers Telegram instead | *"Notifications are off for this browser. You can turn them on in your browser settings, or use Telegram instead."* |
| **iPhone, not on Home Screen** | iOS Safari, user said yes to nudges | iOS only allows web push for installed apps. One-time dismissible hint, findable again in Settings | *"To get nudges on iPhone, add Ember to your Home Screen. Tap Share, then Add to Home Screen."* |
| **AI cap reached** | Daily breakdowns used up | Falls back to manual | *fixed:* *"Out of breakdowns for today. Try: what's the very next physical action?"* |
| **Overdue** | Deadline passed, not done | One message, once, then silence for that task. The task **stays in Today**, ranked at the top and sharing the 5-cap, with a plain date label until the user reschedules, finishes, or removes it from the list | *fixed:* *"X was due today and isn't marked done. Still relevant?"* *[Reschedule] [Done] [Remove from list]* · in-app label *"Was due Tue"* (plain text, no red) |
| **Removed** | User removes a task from the list | Moves to a collapsed **Removed** section at the bottom of Inbox. No new screen | *fixed:* *[Remove from list]* (wireframe review, 2026-09-30; was *Let it go*) → prompt *"Remove "<task>" from your list?"* *[Keep it] [Remove]* (wireframe review, 2026-09-30) → on *Remove*: *"Moved out of the way. It's still here if you want it back."* |
| **Restore** | Tap a removed task → *Restore* | Back to Active, re-enters ranking | *"Back on your list."* |
| **Lapse return** | First open after 3+ days away | No red, no count of missed days. Overdue tasks show their date label; the reset offer runs once and clears the labels in one tap | *fixed:* *"Welcome back. Here's what's on today."* + *"A couple of these slipped past their date. Want to reset them?"* |
| **Quiet hours active** | Inside the quiet window | App works normally when opened. Nudges scheduled inside the window move to its end and still count toward the daily cap. Nothing shows on Today | Settings: *"No nudges between 22:00 and 08:00."* |

**Resolved 2026-09-30:** overdue-stays-in-Today means the lapse-return home screen can open with dated overdue tasks at the top. The lapse-return promise is reworded to match, in §1 and `Product_Scope.md` §2: *"looks like a normal day: no red, no count of missed days. Overdue tasks show their date until you reset them."*

**Deferred to `Tech_Scope.md`:** conflict resolution when the same task is edited on two devices while offline, and the guarantee that a queued action retried after reconnecting never runs twice. The UX promises both; how they work is a tech decision.

---

## 5. Notification interaction design

Every message follows `Product_Scope.md` §2's engine: hard cap of 3 per day, quiet hours (22:00–08:00 default), no re-nudge within 30 minutes of a dismiss or snooze, and every urgent fact paired with help.

### The messages

| Message | When | Copy | Telegram buttons | Web push tap opens |
|---|---|---|---|---|
| **Morning** | Start of day, after quiet hours | *"Today's ready: 5 things. First up: [frog]."* | *[Open today]* | Today's morning confirm |
| **Light-day offer** | Only far-out tasks, day is light | *fixed:* *"Light day. Want to get ahead on X?"* | *[Start a session] [Not today]* | That task |
| **Getting close, has chunks** | Last 30% of runway or last 3 days | *"2 sessions left on X, 3 days to go. Want to start one now?"* | *[Start a session] [Snooze]* | Focus on the next chunk |
| **Getting close, no chunks** | Same, task never chunked | Title: task name. Body *fixed:* *"This deadline's getting close. Want help breaking it down?"* | *[Break it down] [Snooze]* | That task's Chunk area |
| **Batched** | Two or more tasks competing for one slot | *"A few deadlines are getting close: X, Y, and Z. Want to start with X?"* | *[Start X] [Snooze]* | Today |
| **Deadline day** | Morning of the due date | *"X is due today."* | *[Start a session]* | Focus on its next chunk |
| **Overdue** | Once, after the deadline passes | *fixed:* *"X was due today and isn't marked done. Still relevant?"* | *[Reschedule] [Done] [Remove from list]* | That task |
| **Wrap-up invite** | Evening, before quiet hours | *"Ready to wrap up?"* | *[Wrap up]* | Shutdown |

### Cap priority: deadlines win

When more messages want to send than the cap allows, they claim slots in this order:

1. Overdue
2. Deadline day
3. Getting close (competing tasks batched into one message)
4. Morning
5. Wrap-up invite

Morning and wrap-up are conveniences and drop first on busy days. Nothing is lost when they do: Today is there on open, and shutdown is one *wrap up* tap away. The scheduler holds slots for higher-priority messages due later that day. How it does that belongs in `Tech_Scope.md`.

### How buttons behave

- **Telegram buttons split by purpose.** Anything that needs a screen (*Start a session*, *Break it down*, *Open today*, *Wrap up*) is a link that opens Ember at that place. Anything that only changes state (*Done*, *Remove from list*, *Snooze*, *Reschedule*) is handled by the bot without opening the app. *Remove from list* asks first in the chat, with the same prompt and *[Keep it] [Remove]* buttons, like the app (wireframe review, 2026-09-30).
- **After a state button, the bot edits the message** to confirm (*"Marked done."*, *"Moved out of the way. It's still here if you want it back."*, *"Snoozed until 18:00."*) and removes the buttons, so a double tap can't count twice.
- **Stale buttons are safe.** Tapping *Done* on an old message for a task already finished in the app edits it to *"Already done."* and changes nothing.
- **Snooze** (Telegram): *Snooze* swaps the buttons for *[1 hour] [This evening] [Tomorrow]*. The deadline never moves.
- **Reschedule** (Telegram): *[Tomorrow] [In 3 days] [Pick a date]*. *Pick a date* opens Ember's date picker.
- **Web push is tap-to-open only, no action buttons.** iOS web push does not support notification buttons *(confirmed 2026-10-02, `docs/adr/0002-web-push-tap-to-open.md`)*. Rather than build two behaviours, every web push opens the right screen. When the user arrives from a notification, that screen shows one extra line, *"Not now? [Snooze]"*, so snooze still exists on web push.

### How each response is recorded

States are from `Product_Scope.md` §4.

- Tap the message or a link button → **Acted** (opening the task counts).
- *Done / Remove from list / Reschedule* → the task changes state; the reminder is **Acted**.
- *Snooze* → **Snoozed**: recomputed against the same deadline, no new nudge for at least 30 minutes.
- No interaction within 5 hours → **Dismissed**. Ember never reads swipe-aways: Telegram doesn't report them and web push reports them unreliably, so dismissal is always inferred from silence.
- Overdue sent → **Silenced** for that task unless rescheduled.

### Channels

One channel per message, never both. The user picks Telegram or web push in Settings; the default is Telegram if linked. With neither linked, reminders exist only in-app.

---

## 6. The cat

**The rule under everything:** the cat reflects what the user is doing *right now*, not how the day is going. It has no memory of what was missed and no opinion about it, so there is nothing for it to be sad about.

### States and triggers

| State | Triggered by | Leaves when |
|---|---|---|
| **Asleep** | Start of a new day, before any activity. Also after shutdown's *"You're done"* | First open of the day (brief wake-up stretch) → watching |
| **Watching** | Today on screen, nothing else happening | Focus starts, a chunk finishes, or shutdown completes |
| **Stretching** | A focus session is running | Pause or exit → watching; chunk done → purring |
| **Curled up, purring** | A chunk is done (slightly bigger moment on the last chunk of the day) | Reward moment ends (unlock played or skipped) → watching |
| **By the window** (was "by the door") | First open after **3+ days** away (the lapse return) | First tap after the welcome-back greeting → watching |

### Transitions worth spelling out

- **After shutdown the cat stays asleep**, even if the user reopens Ember to capture something at 11pm. Capture works; the cat just signals the day is over and nothing more is expected.
- **The day rolls over when quiet hours end** (08:00 by default), not at midnight. A 1am session counts toward the day before. This is app-wide: it is also when Today rebuilds and the daily notification cap resets.
- A 1–2 day absence is not a lapse: the app opens as a normal day, cat asleep → watching as usual.

### Where it appears

- **Today:** small, beside the progress ring. Never covers the list. On the lapse return the window scene fills the nook's left side instead.
- **Focus:** small in a corner; the stretch plays once as the session starts, then holds its last frame. Dims with everything else. Company while you work.
- **Reward and shutdown moments:** briefly the centre of attention (purring; falling asleep).
- **Nowhere else:** not in Capture, Task view, Inbox, Settings, or notifications. This is what keeps it from becoming a second job.

### What it never does

- Look sad, worried, disappointed, sick, hungry, or lonely.
- React to absence, missed or overdue tasks, or logged mood.
- Have needs: no feeding, shop, currency, or cosmetics (`Product_Scope.md` §5).
- **Speak.** It has no voice; all copy is Ember's plain voice. A cat that never talks cannot guilt-trip.
- Block the list, need dismissing, or gate anything.
- Count anything: no hearts, levels, or XP.

### Accessibility

Every pose has a gentle idle motion (breathing, a slow loop of a few seconds) baked into its animated file. With reduced motion on, still poses replace animations; that is the off switch WCAG 2.2.2 asks for (ADR 0009, reversing the stricter reading in `Design_Direction.md` §11 A1). The cat is decorative and hidden from screen readers (`aria-hidden`): the ring and timer carry everything it shows, so screen-reader users lose nothing.

**Illustration:** Natalie's AI-generated five-pose pack (2026-10-03), see `Design_Direction.md` §4 and ADR 0009.

---

## 7. Onboarding

**Target:** a real chunk ready to start within 60 seconds of required input. No tour, no signup, no account screen.

### The sequence

Times are required input only.

| Step | What happens | Time |
|---|---|---|
| 1. Land | Capture field already focused. *"What's on your mind?"* + *"One thing or ten. Just get it out of your head."* Cat asleep | 0s |
| 2. Dump | Type one or more things; each stacks above the field. After the first, the Close control relabels to *"That's it for now"* | 10–40s |
| 3. Branch | Decided on the *That's it for now* tap. **One item** → *"Want me to break that one down?"* · **Two or more** → *"Got it, six things. Let's make today small."* then *"Which one's weighing on you most?"*, one tap to pick | 1–2 taps |
| 4. First Today | The picked task, big and alone. *Break this down* / *Start*. Cat watching | ~2s |
| 5. First chunk | Type one next action (phase 1) or accept an AI breakdown (phase 4) | ~10s |
| — | **Under-60s target met.** Everything below is optional | |
| 6. Starter focus | *"Start with two minutes?"* Cat stretching | 2 min |
| 7. Reward + reminder offer | Ring ticks, cat purrs. *"That's a start. Want Ember to nudge you gently while it's closed?"* | — |

### Decisions the app makes silently

- **The branch is decided by a tap, not an idle timer.** An idle timer guesses wrong and is fiddly to build; the relabelled *"That's it for now"* makes the tap obvious.
- **Nothing is triaged during onboarding.** The other items wait untriaged in Inbox; the next morning's Pick offers to sort a few.
- **The picked task needs no triage** to be the first Today. It is placed directly, not ranked.
- **No account screen.** An identity is created the first time the user asks for something that needs one (reminders, or a second device). The sign-in method is a `Tech_Scope.md` decision.

### The reminder offer (step 7, phase 2+)

- Yes → *"Where should nudges go?"* *[Telegram] [This device]*
  - **Telegram:** opens the bot through a one-time link; the user taps Start in Telegram; the bot replies *"Linked. Ember will nudge you here."*
  - **This device:** the browser permission prompt, shown only after the user's tap (browsers penalise sites that ask on page load). **iPhone without Ember on the Home Screen:** push cannot work there, so the Add to Home Screen hint (§4) comes first.
  - **Desktop:** no install ask; desktop browsers send push without it.
- *Not now* → *"You can turn this on in Settings any time."* Not offered again automatically.
- **No to both:** the app works fully; reminders exist in-app only.

### Keeping iPhone data safe

Safari on iPhone deletes a site's stored data after about 7 days of browser use without a visit, unless the site is on the Home Screen *(confirmed 2026-10-02, `docs/adr/0003-iphone-storage-durability.md`)*. An iPhone user with no account who declines everything could come back to an empty app, which is exactly the user the lapse return exists for.

- **Phase 1 (no server): honest install nudge.** On iPhone Safari, not installed, after the first reward: *"Safari can clear your list if you don't open Ember for about a week. Adding Ember to your Home Screen keeps it safe."* *[Add to Home Screen] [Not now]*. Shown once; the hint stays findable in Settings. The installed app has its own storage, separate from Safari, so the nudge carries the list across (`Tech_Scope.md` §7; added 2026-10-02).
- **Phase 2 onward: quiet backup.** Tasks back up to the server under an anonymous identity from the first capture, so declining everything never risks data. Disclosed on the landing screen: *"Your list is backed up, so it won't get lost."* The phase-1 nudge is dropped. A real account is needed only to open Ember on a second device.

### Desktop

Same sequence. The capture bar is always visible, so step 1 is the bar with the cursor in it. No install ask.

---

## 8. Design process plan

From these flows to visuals. Each step produces a file; no UI code is written before `Design_Direction.md` exists.

| # | Step | Output | Skill | When |
|---|---|---|---|---|
| 1 | **Wireframes**: every screen in §2 as a plain-text layout (boxes and labels, no colour or style). Fixes content and placement before looks | `docs/Wireframes.md` | None; written directly | Start of Plan |
| 2 | **Check flows and wireframes**: usability critique, then accessibility (touch targets, focus order, screen-reader announcements). Contrast is a target to meet (WCAG AA, 4.5:1 for text), not a value picked here | Findings appended to `Wireframes.md` | `design:design-critique`, then `design:accessibility-review` | After 1 |
| 3 | **Mockups**: Warm Paper, Focus Beam, and Small Companion on **all seven screens** (the six §2 views plus Reward), 21 artboards on one canvas | A Claude Design canvas | `design` | **Only when Natalie asks for the mockups by name** (the one exception to the no-Artifacts rule) |
| 4 | **Natalie picks** a direction or a blend | `Product_Scope.md` §7, decision 6 | None | After 3 |
| 5 | **Design spec**: 4–6 named colours, 2–3 typefaces with roles, layout concept, one signature element, loading/empty/error states (copy in §4), quality floor (visible focus, AA contrast, reduced motion, 375px), self-check against the generic default | `docs/Design_Direction.md` | `hallmark` + `frontend-design`; shadcn/ui components checked for patterns first | After 4 |
| 6 | **Accessibility pass on the chosen direction** | Findings in `Design_Direction.md` | `design:accessibility-review` | Before Build |

**Which screens:** Today, Capture, Focus, Task view, Inbox, Settings, and Reward. Reward is a transient moment rather than a §2 view, but it is included because two of the three signatures show there (Warm Paper's card tear, the purring cat); Focus Beam's spotlight shows on Focus. Expect Capture, Inbox, and Settings to differ least across directions, since they are mostly text and lists. Shutdown and onboarding are not mocked; their look follows from the chosen direction in step 5. Artboards are grouped by screen, so the three directions for each screen sit side by side.

**Mockup constraints (from decisions already made):**
- **All three directions show the tabby** in its §6 placements. The research described Warm Paper and Focus Beam without a companion; the cat is locked in `Product_Scope.md` §7.
- **Small Companion is adapted.** As researched it is an abstract shape whose posture and glow track "how the day is going". That breaks two decisions (the companion is a cat; §6 says it reflects current activity only), so it is mocked as its palette and type with the cat, without the day-mood glow.

**Scheduling:** steps 1–6 are Plan's design track. The feasibility spike and `Tech_Scope.md` are the tech track. The tracks are independent; either can go first.
