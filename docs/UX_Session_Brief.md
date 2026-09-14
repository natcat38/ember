# Ember — UX deep-dive session brief

Written 2026-09-14 by the evaluator session for a fresh session started in `C:\Users\natal\Documents\Coding\ember\`. Open with: "Read docs/UX_Session_Brief.md and start."

## Where things stand

- `ROADMAP.md` is at **Define**. Natalie accepted `docs/Product_Scope.md` as the outline ("looks good") but says it lacks the detail of how a user actually moves through the app. This session fills that gap. Define exits when she signs off both documents.
- Everything decided so far is in `docs/Product_Scope.md` §7 and `docs/PROPOSAL.md`. Do not re-open those decisions; build on them.
- The five research reports in `docs/research/` are the evidence base. `user-interview.md` is Natalie's own answers. `competitors-and-design.md` Parts B–D hold the engagement patterns, the three visual directions, and the copy rules. Read those before designing anything.
- Stack is provisional (Cloudflare). This session does not touch tech; it designs behaviour.

## What this session produces

One document, `docs/UX_Flows.md`, signed off section by section by Natalie, then a roadmap update. Contents:

1. **Persona paths.** Mei (the persona in Product_Scope §1) and Natalie herself. For each: first run, a normal day, a bad day (nothing done), a deadline day, a return after a week away. Written as step-by-step narratives with what the screen shows and what the cat does at every step.
2. **Screen inventory and navigation.** Every screen, what it is for, how you reach it, how you leave. Phone-first, then how the desktop layout differs. Keep the count small; the research says the visible surface must stay tiny.
3. **The seven flows in detail.** Capture, triage, chunk, pick, focus, reward, review. For each: entry points, every tap, every decision the app makes silently, every place the user can bail out, and the exact copy. Product_Scope §3 copy is fixed; extend it, do not change it without asking.
4. **Edge and state screens.** Empty inbox, empty Today, overflow beyond 5, offline, Telegram not linked yet, web push not granted, iPhone not installed to home screen, AI-breakdown cap reached, overdue, let-go, restore, lapse return, quiet hours active.
5. **Notification interaction design.** What each notification says, which buttons it carries, what happens on tap from Telegram versus from a web push, and how snooze and dismiss are recorded.
6. **The cat.** When each of the five states triggers, transitions between them, what it never does. How it appears on each screen without becoming a second job.
7. **Onboarding.** Under 60 seconds to first value: first capture, first chunk, first Today. Where Telegram linking and home-screen install are asked for, and how the app works if the user says no to both.
8. **Design process plan.** The steps from these flows to visuals: low-fidelity wireframes in text or ASCII first, then Claude Design mockups of all three visual directions (Warm Paper, Focus Beam, Small Companion) for the same three screens, Natalie picks, then `docs/Design_Direction.md` per the roadmap's Plan stage. Name which skill runs each step.

## Rules for this session

- Natalie is the architect. Elicit every product and design decision with questions, one topic at a time, three options with trade-offs when she is stuck. Record; never decide for her.
- Ask before assuming. Her most common gap is a vague brief.
- Never publish an Artifact except the Claude Design canvas when she asks for mockups by name.
- Subagents default to Sonnet. This session is mostly dialogue and writing; agents only for parallel drafting of independent sections.
- All user-facing copy follows the rule set in `research/competitors-and-design.md` Part D. Run copy through the humanizer skill before showing her.
- Update `ROADMAP.md` before ending the turn.
- This project is secondary to the job search. Say so if she is spending a full day on it.

## Suggested skills, in order

1. `superpowers:brainstorming` — frame the session; architectural path, questions one at a time.
2. `design:user-research` — structure the persona-path interviews with Natalie.
3. `design:ux-copy` — notification and screen copy.
4. `humanizer` — pass over all copy before it reaches her.
5. `design:design-critique` — self-critique the flows before sign-off.
6. `design` (Claude Design canvas) — only at step 8, only when she asks for the mockups.
7. `hallmark` and `frontend-design` — inputs to `Design_Direction.md` after she picks a direction.
8. `design:accessibility-review` — check the flows for keyboard, contrast, touch targets before Plan.

## Stopping rule

Enough is: every flow in §3 has entry, taps, exits, and copy; every edge screen in §4 has copy; Natalie has signed off each section. Do not design the data model, the scheduler internals, or the API. Those belong to `Tech_Scope.md` in the Plan stage.
