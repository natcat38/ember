# Ember: Wireframes

Status: **draft, awaiting Natalie's review** (Plan stage, design track, `UX_Flows.md` §8 step 1). Step 2 (critique + accessibility check) appends its findings to this file.

**Visual version:** the same 15 frames as grey-box artboards on the Claude Design canvas [Ember Wireframes](https://claude.ai/artifact/QhDkyqicqW946mMs25F9xf) (private). This file stays the written record; changes made on the canvas get written back here.

Plain-text layouts: what is on each screen and where. No colour, type, or style; those come from the chosen visual direction (§8 steps 3 to 5). All behaviour and copy come from `UX_Flows.md`; section references are given under each frame.

**Legend:** `=` drawer menu · `(2/5)` progress ring · `*` frog · `[ ]` chunk not done · `[x]` chunk done · `[>]` start · `...` more actions · `>` opens a sub-screen · `<-` back · `cat, <state>` where the cat sits and its state · `[Button]` tappable.

Phone frames are drawn at a 375px-wide screen.

## Global

- **Header:** drawer menu, screen title; on Today also the ring and the cat.
- **Capture bar:** pinned at the bottom of Today, Inbox, and Settings, showing *"What's on your mind?"*. Tapping it opens the capture sheet. During Focus it dims but stays usable (`UX_Flows.md` §3.1). Hidden on step cards (shutdown, onboarding), where onboarding step 1 *is* the capture field.

---

## 1. Today

```
+------------------------------------+
| =  Today              (2/5)  cat   |
+------------------------------------+
| +--------------------------------+ |
| | * DO THIS FIRST                | |
| | Outline DSA: heaps chapter     | |
| | from: Revise DSA basics        | |
| | [Do this first]   [Not today]  | |
| +--------------------------------+ |
| [ ] Apply: backend role   [>] ...  |
| [ ] Spring tutorial, ch.3 [>] ...  |
| [x] Fix resume bullet              |
| [x] Send follow-up email           |
|                                    |
| 4 more waiting. They'll come up    |
| when there's room.                 |
|                                    |
+------------------------------------+
| +--------------------------------+ |
| | What's on your mind?           | |
| +--------------------------------+ |
+------------------------------------+
```

- The frog card sits first and is larger. Its buttons are the scope's own pair, *Do this first* (starts Focus on it) and *Not today* (§3.4).
- Each other row has three controls: the checkbox marks the chunk done without Focus (goes to Reward), `[>]` starts Focus, and `...` offers *Not today* and *Open task*. Tapping the row text opens the Task view.
- Done chunks stay on the list, dimmed, below the open ones, so the day's progress stays visible.
- An overdue task shows *"Was due Tue"* in plain text under its title (§4). Overdue tasks rank at the top, so one is usually the frog.
- The overflow line links to Inbox (§3.4).

### Today, first open of the day (morning confirm)

```
+------------------------------------+
| =  Today              (0/5)  cat   |
+------------------------------------+
| +--------------------------------+ |
| | Here's today: 5 things.        | |
| | Good to go?                    | |
| |                                | |
| | [Let's go]            [Adjust] | |
| +--------------------------------+ |
| (Today's list below, as normal)    |
|                                    |
+------------------------------------+
| +--------------------------------+ |
| | What's on your mind?           | |
| +--------------------------------+ |
+------------------------------------+
```

- *Let's go* dismisses the card. *Adjust* dismisses it and shows *Not today* directly on every row, plus a *Pin a task* row that opens Inbox to choose from (§3.4).
- Dismissing without either button leaves Today as built; the card does not return that day.

## 2. Drawer

```
+------------------------------------+
| Ember                | (Today,     |
|                      |  dimmed)    |
| Today                |             |
| Inbox                |             |
| Settings             |             |
|                      |             |
| Wrap up the day      |             |
|                      |             |
+------------------------------------+
```

- Opened by `=` or a swipe from the left edge. Holds Inbox and Settings (§2), plus *Wrap up the day*, the manual shutdown trigger (§3.7).
- **No counts** in the drawer. A backlog number is the "list got too long" trigger the whole app avoids.

## 3. Capture sheet

```
+------------------------------------+
| (Today, dimmed behind the sheet)   |
+------------------------------------+
| - finish DS assignment             |
| - prep for interview               |
| +--------------------------------+ |
| | What's on your mind?_          | |
| +--------------------------------+ |
| [Deadline] [Quick]         [Send]  |
|                            [Done]  |
+------------------------------------+
| (keyboard)                         |
+------------------------------------+
```

- Rises from the capture bar with the field focused and the keyboard up. Each sent item stacks above the field, which clears and stays open (§3.1).
- *Deadline* opens the native date picker; *Quick* pre-sets size XS. Both optional.
- *Done* closes the sheet. On first run it reads *"That's it for now"* (§7). Swipe down also closes; unsent text is kept as a draft.

## 4. Focus

```
+------------------------------------+
| (header, dimmed)                   |
|                                    |
|                                    |
|   Outline DSA: heaps chapter       |
|   Revise DSA basics                |
|                                    |
|              18:42                 |
|                                    |
|  [Pause]     [Done]      [Exit]    |
|                                    |
|                                    |
|                   cat, stretching  |
+------------------------------------+
| (capture bar, dimmed but usable)   |
+------------------------------------+
```

- The chunk and its parent task fill the screen; everything else dims (§3.5). The timer counts down (25/5) or up (Flowtime).
- The cat sits small in a corner, stretching in a slow loop (§6).

### Pomodoro break

```
+------------------------------------+
|                                    |
|   Take 5?                          |
|   [Take 5]        [Skip break]     |
+------------------------------------+
|                                    |
|       (breathing guide)            |
|              4:12                  |
|                                    |
+------------------------------------+
|   Back to it?                      |
|   [Back to it]     [Stop here]     |
|                                    |
+------------------------------------+
```

- Top: the prompt when a 25 ends and the chunk isn't done. Middle: the restful break (breathing guide, remaining time). Bottom: the prompt when the break ends. *Stop here* returns to Today with the session logged (§3.5).
- No games on this screen; the unlock belongs to Reward.

## 5. Reward

```
+------------------------------------+
| (Focus, dimmed behind)             |
|                                    |
|              (3/5)                 |
|           cat, purring             |
|                                    |
| +--------------------------------+ |
| | Chunk done. Ninety seconds,    | |
| | if you want it.                | |
| |                                | |
| | [Play]                  [Skip] | |
| +--------------------------------+ |
|                                    |
+------------------------------------+
```

- An overlay on Focus (or on Today, when a chunk is checked off there). The ring ticks and the cat purrs before the card appears (§3.6).
- *Play* shows one unlock inline (a trivia question, the Lichess daily puzzle, or an "on this day" fact) with a thin 90-second bar; when it runs out, the card offers the next chunk. *Skip* goes straight there.

## 6. Task view

```
+------------------------------------+
| <-  Revise DSA basics          ... |
+------------------------------------+
| Not now? [Snooze]                  |
+------------------------------------+
| Has a deadline?                    |
| [Not yet]     [Pick a date]        |
| Is this holding up anything else?  |
| [No]  [Yes]                        |
| Size  [XS] [S] [M] [L] [XL]        |
+------------------------------------+
| Chunks                             |
| [x] Read heaps intro               |
| [ ] Outline heaps chapter [>] ...  |
| [ ] Do 3 heap problems    [>] ...  |
| +--------------------------------+ |
| | What's the very next physical  | |
| | action?                        | |
| +--------------------------------+ |
| [Break this down for me]           |
+------------------------------------+
| [Start]           [Pin to today]   |
| Let it go                          |
+------------------------------------+
```

- *"Not now? [Snooze]"* shows only when the user arrived from a notification (§5).
- Triage sits at the top until answered. Once it has answers it collapses to a one-line summary:

```
+------------------------------------+
| <-  Revise DSA basics          ... |
+------------------------------------+
| Due Fri  -  Holding things up  -  M|
|                            [Edit]  |
+------------------------------------+
| Chunks                             |
| (as above)                         |
+------------------------------------+
```

- *Pin to today* shows only when the task is not already in Today (§3.4).
- *Let it go* is a plain text button at the bottom: quiet, not red, not destructive-looking (§4).
- The header `...` holds *Rename* and *Let it go*.

## 7. Inbox

```
+------------------------------------+
| =  Inbox                           |
+------------------------------------+
| Needs sorting                      |
|   Fix bike light                   |
|   Book dentist                 XS  |
|                                    |
| Waiting                            |
|   Ethics essay         Due 14 Oct  |
|   Spring tutorial, ch.4            |
|   Mock interview prep              |
|                                    |
| > Let go                           |
|                                    |
+------------------------------------+
| +--------------------------------+ |
| | What's on your mind?           | |
| +--------------------------------+ |
+------------------------------------+
```

- Two sections: **Needs sorting** (untriaged, newest first) and **Waiting** (triaged, not in Today, in rank order). The morning Pick's "sort a few" offer opens Needs sorting (§3.2).
- **Let go** is collapsed at the bottom; tapping a let-go task offers *Restore* (§4).
- No counts on sections.

## 8. Settings

```
+------------------------------------+
| =  Settings                        |
+------------------------------------+
| Nudges                             |
|   Send to         Telegram     >   |
|   Quiet hours     22:00-08:00  >   |
| Your day                           |
|   Hard blocks     2 set        >   |
| Focus                              |
|   Timer           25 / 5       >   |
| Rewards                            |
|   Unlock          Surprise me  >   |
| Data                               |
|   Use Ember on another device  >   |
|   Your list is backed up, so it    |
|   won't get lost.                  |
+------------------------------------+
| +--------------------------------+ |
| | What's on your mind?           | |
| +--------------------------------+ |
+------------------------------------+
```

- *Send to* chooses Telegram or This device, one channel per message (§5). It shows *Not set up* when neither is linked.
- An *Add to Home Screen* row appears here on iPhone Safari when Ember isn't installed (§4, §7).
- The backup line appears from phase 2 (§7).

### Hard blocks (day shape)

```
+------------------------------------+
| <-  Hard blocks                    |
+------------------------------------+
| Hours you're already busy.         |
| Ember plans around them.           |
|                                    |
|   Mon Wed  10:00-12:00 Classes >   |
|   Fri      14:00-15:00 Call    >   |
|                                    |
| [+ Add a block]                    |
+------------------------------------+
| Add a block                        |
| Days [M][T][W][T][F][S][S]         |
| From [10:00]       To [12:00]      |
| Name (optional) [____________]     |
| [Save]                             |
+------------------------------------+
```

- Hard blocks are the only scheduled thing in Ember; chunks are never clock-pinned (`Product_Scope.md` §2, Day shape).
- Days are toggle chips; *From* and *To* use the native time input.

## 9. Step card (shutdown and onboarding)

One layout serves every step of the evening shutdown (§3.7) and the onboarding steps after capture (§7): one message, its content, one main button, progress dots when the step count is fixed.

```
+------------------------------------+
|                                    |
|                                    |
|  Anything urgent still open?       |
|                                    |
|  (the step's content: a short      |
|   list, a peek at tomorrow,        |
|   or nothing)                      |
|                                    |
|                                    |
|  [Next]                            |
|                                    |
|              o  .  .               |
+------------------------------------+
```

### Final shutdown step

```
+------------------------------------+
|                                    |
|  That's it for today.              |
|  You're done.                      |
|                                    |
|             cat, asleep            |
|                                    |
| +--------------------------------+ |
| | One line about today, whatever | |
| | comes to mind.                 | |
| +--------------------------------+ |
|                                    |
| Rough  Meh  Okay  Good  Great      |
|                                    |
|  [Close]                           |
|              .  .  o               |
+------------------------------------+
```

- The journal line and the mood row are optional; *Close* works with both empty (§3.7).
- On a zero-done day the message reads *"Some days are for resting. Tomorrow's list is ready when you are."*

## 10. Desktop

```
+------------------------------------------------------------------------+
| =  Ember   [ What's on your mind?                        ]             |
+------------------------------------------------------------------------+
| Today           (2/5)   cat  | Outline DSA: heaps chapter              |
|                              | Revise DSA basics                       |
| * Outline DSA: heaps ch.     |                                         |
|   [Do this first] [Not today]|              18:42                      |
| [ ] Apply: backend role      |                                         |
| [ ] Spring tutorial, ch.3    | [Pause]    [Done]    [Exit]             |
| [x] Fix resume bullet        |                                         |
|                              |                                         |
| 4 more waiting. They'll      |     (Focus while a session runs;        |
| come up when there's room.   |      otherwise the selected task)       |
+------------------------------------------------------------------------+
```

- The capture bar is always visible in the top bar (§2, desktop delta).
- Left: Today. Right: Focus while a session runs; otherwise the Task view of the selected row, with the frog selected by default, so the right pane is never empty.
- Inbox and Settings open from the same drawer and replace the left pane.

---

## Decisions made while wireframing

For Natalie's review; none of these change `UX_Flows.md` behaviour.

1. **Capture is a bottom bar** on phone (Natalie's call).
2. **Row controls are visible buttons** (checkbox, start, `...`), never swipe gestures. Swipes can't be discovered by looking and can't be done by keyboard or screen reader.
3. **Done chunks stay visible** on Today, dimmed, below open ones.
4. **No counts** in the drawer or on Inbox sections.
5. **Inbox has two sections**, Needs sorting and Waiting, plus the collapsed Let go.
6. **Wrap up the day** lives in the drawer.
7. **Triage collapses** to a one-line summary with *Edit* once answered.
8. **Rename a task** via the Task view's `...` menu. No document specified renaming until now.
9. **The desktop right pane** is never empty: Focus while running, otherwise the selected task.
10. **New copy:** *Let's go* / *Adjust*, *Pin a task*, *Take 5* / *Skip break*, *Back to it* / *Stop here*, *Needs sorting*, *Waiting*, *Not set up*, *Hours you're already busy. Ember plans around them.*, *Add a block*, *Rename*, *Close*.

## Accessibility targets (checked in step 2)

Targets to meet, not measurements. Step 2 checks the frames against them and the design direction must hold them.

- Touch targets at least 44 × 44 px (the three row controls fit at 375px width).
- Text contrast WCAG AA: 4.5:1 for body text, 3:1 for large text.
- Visible keyboard focus on every control; focus order follows reading order.
- Screen-reader labels: `[>]` → "Start *chunk name*", `...` → "More actions for *chunk name*", checkbox → "Mark *chunk name* done", ring → "2 of 5 done today". The cat is hidden from screen readers (§6).
- Reduced motion: still poses for the cat, no sheet or card animations.

## Open for `Tech_Scope.md`

- Ranking order when an overdue task and a due-today task compete for the frog. Both rank "at the top"; the formula decides which is first.
