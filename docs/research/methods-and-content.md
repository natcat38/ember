# Nudge App — Methods, Scheduling Logic, Content Sources, Journaling Formats

Research for: a free web app (desktop + phone) that helps one overwhelmed person chunk tasks,
pick what to do now, and finish before deadlines, with encouraging (not nagging) tone. Includes
a focus timer and optional brain-teaser/micro-learning relaxation.

---

## Part A — Time-management and prioritisation methods

For each: how it works (3 lines), what it's good at, where it fails, and the in-app mechanic.

### Eisenhower Matrix (urgent/important quadrants)
- **How**: Sort tasks into 4 boxes — urgent+important (do now), important-not-urgent (schedule),
  urgent-not-important (delegate), neither (drop). Forces a values judgement, not just a due date.
- **Good at**: Killing "urgent but pointless" busywork; separating firefighting from real progress.
- **Fails**: Needs the user to already know what's important — the exact thing an overwhelmed
  person with unknown priority can't judge. Four boxes is also a lot of manual sorting per task.
- **In-app mechanic**: Skip the 4-box grid entirely (too much upfront classification for someone
  overwhelmed). Instead ask two cheap yes/no questions at capture — "Does this have a deadline?"
  and "Does something else depend on this?" — and derive urgency/importance from the answers
  plus the deadline field, rather than making the user self-report a quadrant.

### GTD — Getting Things Done (capture / clarify / next action)
- **How**: Capture everything into one inbox immediately so it's off your mind. Clarify each item
  ("is it actionable? what's the very next physical action?"). Organize by context/project, then
  do.
- **Good at**: The core insight that matters most here — anxiety comes from un-captured,
  un-clarified stuff, not from the volume of work itself. "Next action" thinking turns a vague
  task into something startable.
- **Fails**: Full GTD (projects, contexts, tickler files, weekly review discipline) is a lot of
  system overhead for one person on a phone. Most people quit at week 3.
- **In-app mechanic**: Steal exactly two pieces — a frictionless capture box (one text field,
  no required fields, always one tap away) and a mandatory "what's the next physical action?"
  prompt the first time a task is opened, which doubles as the chunking step. Skip contexts,
  projects-as-a-formal-object, and the full weekly review ritual.

### Ivy Lee Method / 1-3-5 Rule
- **How**: Ivy Lee — each evening, write down the 6 most important things for tomorrow, ranked;
  do them in order. 1-3-5 — plan 1 big thing, 3 medium things, 5 small things per day.
- **Good at**: Radically simple daily planning; caps the list so it can't balloon; ranking forces
  a decision instead of "everything is priority 1".
- **Fails**: Doesn't handle multi-day/deadline tasks well — it's a daily lens on a system that
  needs a deadline lens too. Rigid slot counts (1/3/5) don't fit everyone's day.
- **In-app mechanic**: This is the shape of the "Today" screen: a capped list (not "all tasks"),
  ordered, generated automatically each morning from the chunk queue rather than hand-picked —
  keep the *cap* (small number of visible items) and the *ranking*, drop the rigid 1-3-5 counts.

### Timeboxing & Time-blocking
- **How**: Assign a fixed time slot on the calendar to a task ("blocking") or a fixed maximum
  duration to work on it regardless of completion ("boxing"). When the box ends, you stop or
  reassess.
- **Good at**: Makes "I'll get to it" concrete; caps perfectionism/scope creep because time is
  finite; works well combined with a timer.
- **Fails**: Requires accurate effort estimates the user usually doesn't have (this app's stated
  problem — unknown complexity); a missed/interrupted block causes guilt and calendar Tetris.
- **In-app mechanic**: Don't ask for a calendar-accurate block. Ask for a single number — "how
  many 25-minute focus sessions do you think this needs?" — and let the timer track actual
  sessions against that guess so the estimate self-corrects over time (see Part B for effort
  estimation).

### Pomodoro and variants (52/17, 90-minute, Flowtime, third-time)
- **How**: Classic Pomodoro — 25 min focus / 5 min break, long break every 4. 52/17 and 90-minute
  are longer-cycle variants matching different attention spans. Flowtime — work until natural
  fatigue, then take a break sized to how long you worked. Third-time — break length = elapsed
  focus time ÷ 3.
- **Good at**: External structure for starting (the hardest part), a built-in permission to stop
  and rest, momentum from visible completed cycles.
- **Fails**: Fixed 25-minute Pomodoro breaks flow for deep-focus tasks; forcing a stop mid-flow
  is actively counterproductive for some task types and some people.
- **In-app mechanic**: Ship Pomodoro (25/5) as the default because it's the most recognisable and
  needs no explanation, but expose Flowtime as an alternate timer mode ("stop when you want, I'll
  suggest a break length") for users who find fixed intervals annoying. Don't ship all four
  variants — that's a settings menu nobody will tune.

### Eat-the-frog
- **How**: Do the single hardest/most-dreaded task first thing, before anything else, before
  willpower depletes.
- **Good at**: Prevents the dreaded task from being silently pushed every single day (the classic
  procrastination trap); front-loads the highest-value work while energy is highest.
- **Fails**: Assumes the user can identify "the frog" and has the energy for it first thing —
  not true for everyone's chronotype or mood that day.
- **In-app mechanic**: When generating the Today list, flag one item as "your frog" (highest
  deadline pressure × highest estimated difficulty) but don't force it first — surface it as a
  suggestion with a one-tap "do this first" or "not today" so the user keeps agency.

### Two-minute rule
- **How**: If a task takes under two minutes, do it immediately instead of tracking it.
- **Good at**: Keeps the task list from clogging with trivial items that cost more to track than
  to do.
- **Fails**: Only useful at capture time; irrelevant once something's already a tracked task.
- **In-app mechanic**: At capture, if the user marks effort as "quick" (see t-shirt sizing below),
  show "Just do it now?" with a 2-minute countdown instead of filing it into the backlog.

### MoSCoW (Must / Should / Could / Won't)
- **How**: Bucket requirements/tasks into Must have, Should have, Could have, Won't have (this
  time), used heavily in project scoping.
- **Good at**: Explicit, unambiguous prioritisation language for teams; forces "Won't" as a real
  category so things can be dropped without guilt.
- **Fails**: Four labels is classification overhead again, and "Should vs Could" is a fuzzy line
  most solo users can't judge quickly — built for teams negotiating scope, not one tired person.
- **In-app mechanic**: Leave out as a labelling system. Keep only its best idea — an explicit
  "Won't do this" action on any task (distinct from delete) that removes deadline pressure/guilt
  without deleting the record, in case it matters later.

### Weighted Shortest Job First (WSJF) / Cost of Delay
- **How**: Priority score = (business value + time criticality + risk reduction) ÷ job size.
  Do the task with the highest score first — most value per unit effort, weighted by how much it
  costs to delay.
- **Good at**: Genuinely optimal sequencing when you have real value and effort numbers — this is
  how software teams sequence a backlog.
- **Fails**: Needs four estimated numbers per task from a person who, per the brief, doesn't even
  know priority or complexity. Total overkill for a personal task app.
- **In-app mechanic**: Don't expose WSJF as a form. Bake its *logic* into the auto-sort behind
  the scenes: sort the Today list by (days-until-deadline × a manual "how much do you care 1–5"
  slider) ÷ estimated-effort, so the ranking is auto-computed and the user just sees an ordered
  list, never the formula.

### "Unknown complexity" handling
- **T-shirt sizing (XS/S/M/L/XL)**: Fast, low-precision effort estimate with no false sense of
  accuracy. Good fit here — cheap, one tap, good enough to feed the sort. Use this as the default
  effort-capture control.
- **Reference-class forecasting**: Estimate a new task's effort from how long *similar past
  tasks* actually took, instead of guessing from scratch — corrects the well-documented human bias
  toward underestimating. Good in-app mechanic: once the app has history, when a task is created
  quietly show "similar tasks took you about N sessions" next to the t-shirt size picker.
- **Planning poker**: Multiple people estimate simultaneously and reveal at once, discuss
  outliers. Requires a group — not applicable to a single-user app; leave out.
- **"What's the next physical action?" (from GTD)**: The single best unknown-complexity tool
  here — you don't need to know total effort to know the next 10-minute step. Use this as the
  chunking prompt (see chunk step below): the app never asks "how big is this task", it asks
  "what's the very next thing you'd physically do."

### Goblin.tools-style AI task breakdown
- **How**: Feed a vague task ("clean my room") to an LLM and get it broken into small ordered
  sub-steps, adjustable by a "spiciness"/detail slider. Built specifically for ADHD/executive
  dysfunction.
- **Good at**: Directly solves "unknown complexity" — the exact gap this app is built around. Zero
  planning skill required from the user.
- **Fails**: Needs an LLM call (cost, latency, occasional bad breakdowns); becomes a crutch if
  it's the *only* chunking method — some users need to practise their own breakdown skill.
- **In-app mechanic**: Offer an optional "Break this down for me" button on any task that calls a
  cheap LLM once per task (cache the result) and returns 3–6 checkbox sub-steps the user can edit.
  Never make it mandatory — always let the user hand-type their own next action instead. This is
  the single highest-leverage feature for the app's stated "unknown complexity" problem, so it's
  worth the API cost.

### Body doubling / Focusmate
- **How**: Work alongside another person (in person or on a video call) who is also working,
  without necessarily interacting — their presence alone improves focus and follow-through.
- **Good at**: Strong effect for executive-function difficulties (ADHD in particular); makes
  starting easier because someone is "watching," even passively.
- **Fails**: Needs a second person/scheduling — heavy infrastructure (matching, video, no-shows)
  for a "free web app for one overwhelmed person." Out of scope for v1.
- **In-app mechanic**: Leave out of scope entirely for v1 — flag as a possible v2 feature
  ("focus room" pairing) rather than building it now.

### Temptation bundling
- **How**: Pair a task you're avoiding with something you enjoy, but only while doing the task
  (e.g., only listen to your favourite podcast while doing the dishes).
- **Good at**: Makes starting a dreaded task less aversive without willpower.
- **Fails**: Hard for an app to enforce automatically — pairing is personal and self-managed.
- **In-app mechanic**: Let the focus timer optionally launch a "reward" — the brain-teaser/
  micro-learning relaxation content this app already plans to have — automatically at the end of
  a completed session, framed as "you earned a 3-minute break game." That's temptation bundling
  applied to the break, not the work, which is the achievable version of this idea in an app.

### Cal Newport shutdown ritual
- **How**: A fixed end-of-day routine — check every list, make sure nothing urgent is
  unaddressed, verbally/mentally say "shutdown complete" — that lets you stop thinking about work
  because you've consciously verified there's nothing to catch.
- **Good at**: Solves the "task list is running in the back of my mind at 11pm" problem directly —
  very relevant for an overwhelmed user.
- **Fails**: A ritual, not a feature — hard to enforce, easy to skip, no clear UI unless
  simplified.
- **In-app mechanic**: A short end-of-day prompt (see Part D "end-of-day shutdown" — 3 questions,
  ends with an explicit "you're done for today" screen). This is one of the highest-value, lowest-
  build-cost items in the whole list.

### Weekly review
- **How**: A recurring fixed slot to look back at what got done, re-triage the backlog, and plan
  the week ahead — the GTD "keep the system trustworthy" step.
- **Good at**: Prevents the backlog from silently rotting; catches tasks that are stale, done, or
  no longer relevant.
- **Fails**: Discipline-dependent — the first thing skipped when someone's already overwhelmed,
  which defeats the purpose.
- **In-app mechanic**: Make it a single push notification once a week ("3 tasks have had no
  activity in 10+ days — still doing these?") rather than a ritual the user has to remember to
  start themselves. Passive, app-initiated, takes under a minute.

### Recommended default flow: capture → triage → chunk → pick → focus → review

1. **Capture** — one text field, always one tap away, no required fields (GTD inbox). Optional
   deadline field, optional "quick task" 2-minute-rule flag.
2. **Triage** — two yes/no questions only ("has a deadline?", "does anything depend on this?")
   plus a t-shirt-size effort tap. No manual quadrant sorting, no WSJF form — the app computes
   priority score behind the scenes.
3. **Chunk** — "what's the next physical action?" (GTD), with an optional AI breakdown button
   (Goblin.tools-style) for anything that still feels too big.
4. **Pick** — an auto-generated, capped "Today" list (Ivy-Lee-style, ranked, small number of
   items), with one item flagged as "your frog" (eat-the-frog) as a suggestion, not a mandate.
5. **Focus** — Pomodoro 25/5 as default timer, Flowtime as an alternate mode; reward micro-break
   content on completion (temptation bundling).
6. **Review** — daily: 3-question shutdown ritual (Cal Newport, simplified). Weekly: one passive
   nudge about stale tasks, not a mandatory ceremony.

**Leave out entirely**: full GTD (contexts/projects/tickler file — too much system overhead),
Eisenhower's 4-box grid as a user-facing UI (fold its logic into auto-sort instead), MoSCoW
labelling (keep only "Won't do" as an action), planning poker (needs a group), WSJF as an exposed
formula (compute it silently), body doubling/Focusmate (defer to v2), and rigid 1-3-5 slot counts
(cap the list, don't force exact counts). The common thread: anything that makes the *user*
classify or estimate with unnecessary precision is out; anything that removes a decision from the
user by computing it for them, or that turns a vague task into one concrete next step, is in.

---

## Part B — Deadline and "nag" scheduling logic

Inputs: task with deadline `D`, estimated effort `E` (in focus sessions, from t-shirt size or
reference-class forecast), and a set of chunks (next actions) with individual estimates that sum
to roughly `E`.

### Back-planning from deadline
1. Compute total sessions needed: `E` (pad by ~20% — estimates are reliably optimistic; this is
   the same correction reference-class forecasting exists for).
2. Compute available days: `D − today`.
3. If `E_padded` sessions fit comfortably before `D` at ~1 session/day, spread evenly. If they
   don't fit at 1/day, the app must say so explicitly rather than silently under-scheduling —
   surface "this needs more daily sessions than the days remaining allow" as its own nudge type
   (a warning, not a reminder), ideally at capture time, not the day before the deadline.
4. Place session reminders backward from `D`, leaving at least 1 full buffer day before the
   deadline for the last chunk to slip without becoming late.

### Escalation curve
Reminder tone/frequency should track urgency, not nag at a flat rate from day one:
- **Far out** (>50% of the runway left): one gentle nudge per day at most, framed as opt-in
  ("Want to knock out a session on X today?"), easily dismissed with zero friction.
- **Getting close** (last 3 days or last 30% of runway, whichever is sooner): up to 2 nudges/day,
  more specific ("2 sessions left, 3 days to go").
- **Final day**: at most 1 nudge in the morning, factual and calm, no guilt language ("Due today.
  You've got a session planned at 2pm.").
- **Overdue**: switch tone entirely — see "when deadline passes" below.

The curve should escalate in *specificity and clarity*, not in volume or urgency-language — more
nagging messages are not what makes people act; a clearer picture of the gap is.

### Quiet hours
- Default no notifications 22:00–08:00 local time, configurable.
- Never send a nudge less than 30 minutes after the user dismissed/snoozed one — no immediate
  re-nag.
- Deadline-day nudges still respect quiet hours unless the deadline itself falls inside quiet
  hours (e.g., "due by midnight") — in that edge case, one exception nudge is allowed at the start
  of quiet hours, clearly marked as a deadline exception.

### Max reminders per day
- Hard cap: 3 per day *total*, across all tasks combined, not 3 per task — an overwhelmed user
  with 10 deadline-driven tasks must not get 10 separate nudges. If multiple tasks compete for a
  nudge slot, batch them into one message ("3 tasks need attention today") rather than sending 3
  separate notifications.

### Snooze semantics
- Snooze options: 1 hour, this evening, tomorrow — no infinite/custom snooze by default (open-
  ended snoozing is where nagging apps go to die: infinite postponement with no consequence).
- Snoozing a task **does not** silently push its deadline or its back-planned session schedule —
  the app recomputes urgency against the *same* deadline, so repeated snoozing near a deadline
  naturally increases nudge frequency/specificity on its own, without a separate "you've snoozed
  N times" shame mechanic.
- A snooze counter is tracked internally (not shown to the user as guilt) purely to detect a task
  that's being avoided, which can inform a *supportive* nudge ("This one keeps getting pushed —
  want to break it into a smaller first step instead?") rather than a stricter one.

### What to say when the deadline passes
- No guilt language, ever. Tone stays encouraging per the brief.
- First overdue message (same day, once only): state fact + offer next step. Example: "X was due
  today and isn't marked done. Still relevant? [Reschedule] [Mark done] [Let it go]."
- "Let it go" is a first-class option, not hidden — removes the task from active nudging without
  requiring the user to delete/lose the record (mirrors MoSCoW's "Won't" bucket).
- If rescheduled, the app re-runs back-planning against the new deadline as if it were a fresh
  task — no punitive tightening of the schedule.
- After the first overdue message, stop nudging about that specific task unless the user
  reschedules it — an unaddressed overdue task should not keep generating notifications
  indefinitely (this is a major nag-fatigue failure mode in existing to-do apps).

### Worked example — task due in 5 days, 4 hours estimated effort

- `D` = day 5 (today = day 0). `E` = 4 hours ≈ 8 Pomodoro sessions (25 min work + break ≈ 30 min
  wall-clock each, but effort counted in the 25-min work portion: 4h ÷ 25min ≈ 9.6, round to 10
  sessions before padding).
- Apply 20% padding: 10 × 1.2 = 12 sessions.
- Days available for work: days 0–3 (day 4 held as buffer, per the "buffer day" rule above).
  That's 4 working days for 12 sessions → 3 sessions/day.
- Back-planned schedule:
  - Day 0 (today): capture, chunk into first next-action, 3 sessions if time allows, else fewer
    with the remainder redistributed (see below).
  - Day 1: 3 sessions.
  - Day 2: 3 sessions.
  - Day 3: 3 sessions (12 total reached).
  - Day 4: buffer — no scheduled sessions; app checks progress and only nudges if behind.
  - Day 5: deadline.
- Nudge plan:
  - Days 0–2 (>50% runway left): 1 gentle nudge/day, e.g. "3 sessions on [task] today — want to
    start with one?"
  - Day 3 (last 30%/3 days, whichever first — here they coincide): up to 2 nudges, e.g. morning
    "3 sessions left, 2 days to go" + evening check if 0 sessions logged that day.
  - Day 4 (buffer): only nudges if behind schedule — "You're at 8/12 sessions with 1 day of
    buffer left before it's due tomorrow."
  - Day 5 (deadline): 1 factual morning nudge if incomplete; if still incomplete at end of day,
    the single overdue message described above, next day.
- If the user snoozes every day-0–2 nudge, by day 3 they'll have 0/12 sessions done with 2 days
  left — the recomputed schedule (12 sessions over 2 days = 6/day) will make the escalation
  curve kick in automatically and honestly ("this now needs 6 sessions/day to finish on time"),
  without any separate shame counter.

---

## Part C — Free content sources for relaxation / micro-learning

Priority: no backend required (browser-callable / CORS), no signup friction, safe licence.

| Source | URL | Licence | Rate limit | Browser CORS (no backend) | Quality / notes |
|---|---|---|---|---|---|
| **Open Trivia DB** | https://opentdb.com/api_config.php | CC BY-SA 4.0 (attribute Open Trivia DB) | 1 request per IP per 5 seconds | Yes in practice — OpenTDB serves `Access-Control-Allow-Origin: *`; confirm with a direct fetch before shipping | Large, well-curated, category + difficulty filters, no key. Best trivia option. |
| **Riddles API (Netlify)** — `riddles-api.netlify.app` | https://riddles-api.netlify.app/ | Unclear/unstated — small community project, no explicit licence file found | Unstated, likely low/unmanaged | Likely yes (static Netlify function) but unverified — test before relying on it | Small hobby project; **licence risk: unclear provenance/ownership of riddle text, no stated terms** — flag before shipping, or self-host a small curated riddle set instead. |
| **FunGenerators Riddle API** | https://fungenerators.com/api/riddle/ | Commercial API vendor; free tier terms apply | 60 calls/day, 5/hour on free public tier | Needs checking — many FunGenerators endpoints require a key even on "free" tier despite the search summary; verify before use | Low daily cap unsuitable for many users; better as a seed dataset to self-host than a live dependency. |
| **Lichess Puzzle API** | https://lichess.org/api#tag/Puzzles | Lichess API is open (Lichess itself is free/open-source, AGPL); puzzle content reuse should still credit Lichess | Generous, documented at lichess.org/api; no key needed for public GET endpoints | Yes — Lichess API is designed for public web/app consumption with CORS | Excellent quality, real analysed puzzles, includes daily puzzle and puzzle-by-ID/theme. Best chess-puzzle option, best-documented API in this table. |
| **Wikimedia REST API** (`/api/rest_v1/page/random/summary`, `/feed/featured` "On this day") | https://api.wikimedia.org/wiki/Feed_API/Reference/On_this_day and https://en.wikipedia.org/api/rest_v1/ | CC BY-SA (Wikipedia content licence) — attribution required | ~200 req/sec shared limit; set a descriptive `User-Agent`/`Api-User-Agent` header | Yes, designed for client use; set the required User-Agent header | Best source for "did you know" facts — genuinely high-quality, sourced content, built for this exact use case ("On this day" / featured content feeds). |
| **Datamuse API** | https://www.datamuse.com/api/ | Free for non-commercial use; **a key becomes required from Jan 1, 2027** — plan for that before/at launch | 100,000 requests/day, no key today | Yes, plain GET/JSON, CORS-friendly, widely used client-side | Not a "vocab card" content source by itself, but excellent for generating word-relationship exercises (synonyms, rhymes, "which word fits") client-side with zero content licensing risk since it returns word lists, not copyrighted prose. |
| **Sugoku** (Sudoku generate/solve) | https://github.com/bertoort/sugoku | Open source, MIT-style (check repo) — self-hosted, not a maintained public API | N/A — self-host it | Yes if self-hosted alongside the app or as a serverless function | Good logic-puzzle option but requires standing up the service yourself (it's a GitHub project, not a hosted public API) — budget dev time, don't treat as a drop-in call. |
| **Zebra puzzle generators** (`tuchandra/zebra`, `zebra4j`) | https://github.com/tuchandra/zebra, https://murfffi.github.io/zebra4j/ | Open source | N/A — self-host | Depends on packaging; zebra4j ships a JS build | Same story as Sugoku — libraries/generators, not hosted APIs. Fine for a "logic puzzle of the day" feature if pre-generated and served as static JSON rather than called live. |
| **Wordle-style daily word puzzle** | — no public free API found | — | — | — | No good free hosted API exists for this (NYT's own is proprietary/closed). **Recommendation: build a tiny self-hosted daily-word feature** — pick a word from a static curated wordlist keyed by date, computed client-side (deterministic by day-of-year), zero backend, zero licence risk. |
| **Breathing exercises / guided break scripts** | — no API needed | — | — | — | These are short, original, easy to write in-house (e.g., box breathing: 4-4-4-4 count, 1 minute). **Write these yourself** rather than sourcing externally — avoids any licence question and lets you match the app's tone exactly (see Part D for voice). |

**Overall Part C recommendation**: For v1, ship Open Trivia DB (trivia), Lichess (chess puzzles),
and Wikimedia REST (facts) as the three live API integrations — all three are well-documented,
free, keyless, and CORS-friendly for direct browser calls. Self-host a small curated riddle set
and a static daily-word list rather than depending on the unverified Netlify/FunGenerators
riddle APIs. Write breathing/break scripts in-house. Revisit Datamuse's key requirement before
Jan 2027 if word-relationship exercises ship.

---

## Part D — Journaling minimal formats

Tone target: encouraging, plain, not cheesy — matches the app's stated voice. No therapy-speak,
no forced positivity, no exclamation-point inflation.

### One-line journal
Single free-text field, no character minimum, appears once per day, never mandatory.

> *"One line about today — whatever comes to mind."*
> (placeholder text, greyed out, disappears on typing: *e.g. "Got the report chunk done, tired but okay."*)

### Mood check-in (5-point scale)
Five plain labels, not emoji-only (emoji alone can misfire across cultures/readers) — pair a
short word with an optional emoji:

> *"How's today, honestly?"*
> ⬤ Rough  ⬤ Meh  ⬤ Okay  ⬤ Good  ⬤ Great

No follow-up question required after selection — a single tap should be a complete, valid entry.

### Daily review prompts (3 questions max)
> 1. *"What actually got done today?"*
> 2. *"What's one thing you're carrying into tomorrow?"*
> 3. *"Anything getting in the way you want to note?"* (optional, skippable)

Each question answerable in one line; none require the user to write more than a sentence.

### End-of-day shutdown (Cal Newport-style, simplified)
A short fixed sequence, ending in an explicit stop signal so the app closes the mental loop:

> 1. *"Anything urgent still open?"* → if yes: one-tap "push to tomorrow" or "handle now."
> 2. *"Tomorrow's Today list is ready: [N] things."* (auto-generated from the queue, nothing to
>    build manually)
> 3. Final screen: *"That's it for today. You're done."* — with no further nudges shown, no
>    tomorrow's list dangling as a guilt object, just a clean stop.

The last line matters most: it's the one piece of copy doing the actual job of the shutdown
ritual — giving explicit permission to stop thinking about it, which is the entire point of
including this feature.

---

## Sources

- [Open Trivia DB — API config / docs](https://opentdb.com/api_config.php)
- [Open Trivia API — PublicAPI](https://publicapi.dev/open-trivia-api)
- [Riddles API (Netlify)](https://riddles-api.netlify.app/)
- [FunGenerators Riddle API](https://fungenerators.com/api/riddle/)
- [Riddles API (Vercel)](https://riddles-api.vercel.app/)
- [API Ninjas Riddles API](https://api-ninjas.com/api/riddles)
- [Lichess API docs](https://lichess.org/api)
- [Lichess API Tips](https://lichess.org/page/api-tips)
- [Wikimedia Feed API — On this day](https://api.wikimedia.org/wiki/Feed_API/Reference/On_this_day)
- [MediaWiki REST API](https://www.mediawiki.org/wiki/API:REST_API)
- [FactFacts free random facts API](https://factfacts.com/api/)
- [API Ninjas Facts API](https://api-ninjas.com/api/facts)
- [Datamuse API](https://www.datamuse.com/api/)
- [Datamuse API overview — api-evangelist](https://github.com/api-evangelist/datamuse)
- [Sugoku (Sudoku generator/solver, GitHub)](https://github.com/bertoort/sugoku)
- [Zebra puzzle generator/solver (GitHub, tuchandra/zebra)](https://github.com/tuchandra/zebra)
- [zebra4j](https://murfffi.github.io/zebra4j/)
- [Wordle alternatives roundup 2026 — Crosswordle](https://crosswordle.com/blog/wordle-alternatives)
- [Free NYT Games alternatives 2026 — PuzzleBoxs](https://puzzleboxs.com/blog/free-nyt-games-alternatives/)
