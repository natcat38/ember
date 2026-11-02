# 0010. A sticky header with the wordmark, a quieter Today, and plainer words

Date: 2026-10-24. Status: accepted.

## Context

A UX audit on 2026-10-23 found three things that cut against the calm design (`Design_Direction.md` §1, §5):

- The header scrolled away, so a long Today or Settings page had to be scrolled back up to reach the menu. Nothing named the app on screen.
- Every Today row carried a play button, *Not today* and the title, and the morning confirm was a 125 px card. On a 390 px phone the controls took more room than the task names.
- Some copy asked more than it needed to: first run had two buttons on the first Today task, the way out of the capture step read *Close*, and the step prompt asked for "the very next physical action".

These were Natalie's calls in the 2026-10 UX polish pass: G1 (phone navigation), G3 as ember's D-D (identity), R5 (how quiet Today's rows are) and R6 (copy). Shipped in #78, #79 and #80.

## Decision

**G1, option A: a sticky compact header with a menu.** The 60 px header stays at the top while a page scrolls. From 1180 px the menu gives way to Today / Inbox / Settings tabs. No bottom tab bar: on Ember it would stack with the capture bar for about 140 px of the screen.

**D-D, option 2: a small "Ember" wordmark beside the menu.** No logo mark. First run has no menu, so the heading and cat there are left open (EMB-UX-7).

**R5, option 1: a Today row is a checkbox and a title.** *Start*, *Not today* and *Open task* move into the row's `...` menu. The frog card keeps its own *Start* and *Not today*. The morning confirm becomes a one-line strip with text buttons, so the frog's *Start* stays the one primary.

**R6, option 1: plainer words.** The frog's button says *Start*. With nothing typed, first run's way out is *Skip for now*. The first Today task has one button, *Break this down*. The step prompt asks *"What's the first small thing to do?"*.

Where each one lives: `Design_Direction.md` §3 (header), `Wireframes.md` (Today rows, the confirm strip), `UX_Flows.md` (first-run steps and the step prompt).

## Consequences

- Settings with sample data is 1.15 screens on a phone (was 1.77). The confirm strip is 56 px at 390 (was 125). A step title has 222 px at 390 (was 178).
- One more tap to start a non-frog task from Today: it goes through `...`. The checkbox still finishes a chunk in one tap.
- The confirm strip keeps the full wording, so it wraps to two lines on a phone.
- Three checks need a real iPhone (touch feedback and the capture bar against the home bar, the sticky header under the notch with the keyboard up, the row menu and the strip). They are in `Verify_List.md`.
