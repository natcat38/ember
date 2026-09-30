"""Generates docs/Wireframes.md with ASCII frames padded to exact widths.

docs/Wireframes.md is generated: edit this file, then run
    python scripts/wireframes.py docs/Wireframes.md
Every frame asserts its lines fit, so an over-long line fails loudly instead of misaligning.
"""
import sys

W = 36  # phone inner width


def ib(lines, w=W):
    """Inner box with a one-space margin, total width w."""
    iw = w - 4
    for t in lines:
        assert len(t) <= iw, f"inner overflow ({len(t)}>{iw}): {t!r}"
    return [" +" + "-" * iw + "+ "] + [" |" + t.ljust(iw) + "| " for t in lines] + [" +" + "-" * iw + "+ "]


def frame(lines, w=W):
    out = ["+" + "-" * w + "+"]
    for t in lines:
        if t == "---":
            out.append("+" + "-" * w + "+")
            continue
        assert len(t) <= w, f"overflow ({len(t)}>{w}): {t!r}"
        out.append("|" + t.ljust(w) + "|")
    out.append("+" + "-" * w + "+")
    return "```\n" + "\n".join(out) + "\n```"


def cols(pairs, lw, rw):
    rows = []
    for l, r in pairs:
        assert len(l) <= lw and len(r) <= rw, (l, r)
        rows.append(l.ljust(lw) + "|" + r.ljust(rw))
    return rows


CAPTURE_BAR = ib([" What's on your mind?"])

TODAY = frame([
    " =  Today              (2/5)  cat",
    "---",
    *ib([" * DO THIS FIRST",
         " Outline DSA: heaps chapter",
         " from: Revise DSA basics",
         " [Do this first]   [Not today]"]),
    " [ ] Apply: backend role   [>] ...",
    " [ ] Spring tutorial, ch.3 [>] ...",
    " [x] Fix resume bullet",
    " [x] Send follow-up email",
    "",
    " 4 more waiting. They'll come up",
    " when there's room.",
    "",
    "---",
    *CAPTURE_BAR,
])

MORNING = frame([
    " =  Today              (0/5)  cat",
    "---",
    *ib([" Here's today: 5 things.",
         " Good to go?",
         "",
         " [Let's go]            [Adjust]"]),
    " (Today's list below, as normal)",
    "",
    "---",
    *CAPTURE_BAR,
])

DRAWER = frame(cols([
    (" Ember", " (Today,"),
    ("", "  dimmed)"),
    (" Today", ""),
    (" Inbox", ""),
    (" Settings", ""),
    ("", ""),
    (" Wrap up the day", ""),
    ("", ""),
], 22, W - 23))

CAPTURE = frame([
    " (Today, dimmed behind the sheet)",
    "---",
    " [Done]",
    " - finish DS assignment",
    " - prep for interview",
    " [Deadline] [Quick]",
    " +--------------------------+",
    " | What's on your mind?_    |  (>)",
    " +--------------------------+",
    "---",
    " (keyboard)",
])

FOCUS = frame([
    " (header, dimmed)",
    "",
    "",
    "   Outline DSA: heaps chapter",
    "   Revise DSA basics",
    "",
    "              18:42",
    "",
    "           ( || Pause )",
    "",
    "  [Stop for now]        [Done]",
    "",
    "                   cat, stretching",
    "---",
    " (capture bar, dimmed but usable)",
])

BREAK = frame([
    "",
    "   Take 5?",
    "   [Take 5]        [Skip break]",
    "---",
    "",
    "       (breathing guide)",
    "              4:12",
    "",
    "---",
    "   Back to it?",
    "   [Back to it]     [Stop here]",
    "",
])

REWARD = frame([
    " (Focus, dimmed behind)",
    "",
    "              (3/5)",
    "           cat, purring",
    "",
    *ib([" Chunk done. Ninety seconds,",
         " if you want it.",
         "",
         " [Try today's chess puzzle]",
         "             Skip"]),
    "",
])

TASK = frame([
    " <-  Revise DSA basics          ...",
    "---",
    " Has a deadline?",
    " [Not yet]     [Pick a date]",
    " Is this holding up anything else?",
    " [No]  [Yes]",
    " Size  [XS] [S] [M] [L] [XL]",
    "---",
    " Chunks",
    " [Break this down for me]",
    ' Splits "Revise DSA basics" into',
    " 3 to 6 steps you can edit.",
    " [x] Read heaps intro",
    " [ ] Outline heaps chapter     ...",
    "     [x] Open notes doc    [>] ...",
    "     [ ] List 5 heap ops   [>] ...",
    "     +--------------------+",
    "     | Add a smaller step |  (+)",
    "     +--------------------+",
    " [ ] Do 3 heap problems    [>] ...",
    " What's the very next physical",
    " action?",
    " +--------------------------+",
    " | Type one step            |  (+)",
    " +--------------------------+",
    "---",
    " [Start]           [Pin to today]",
])

TASK_TRIAGED = frame([
    " <-  Revise DSA basics          ...",
    "---",
    " Due Fri  -  Holding things up  -  M",
    "                            [Edit]",
    "---",
    " Chunks",
    " (as above)",
])

_menu = ["+------------------+", "| Rename task      |", "| Remove from list |", "+------------------+"]
_left = ["", " (Task view,", "  dimmed)", ""]
TASK_MENU = frame(
    [" <-  Revise DSA basics        (...)", "---"]
    + [l.ljust(16) + r for l, r in zip(_left, _menu)]
    + ["", ""]
)

STEP_MENU = frame([
    " (Task view, dimmed)",
    "",
    "---",
    " Outline heaps chapter",
    " Start this step",
    " Break this step down",
    " Move up",
    " Move down",
    " Rename",
    " Delete step",
    "---",
    "              Cancel",
])

INBOX = frame([
    " =  Inbox",
    "---",
    " Needs sorting",
    "   Fix bike light",
    "   Book dentist                 XS",
    "",
    " Waiting",
    "   Ethics essay         Due 14 Oct",
    "   Spring tutorial, ch.4",
    "   Mock interview prep",
    "",
    " > Removed",
    "",
    "---",
    *CAPTURE_BAR,
])

SETTINGS = frame([
    " =  Settings",
    "---",
    " Nudges",
    "   Send to         Telegram     >",
    "   Quiet hours     22:00-08:00  >",
    " Your day",
    "   Hard blocks     2 set        >",
    " Focus",
    "   Timer           25 / 5       >",
    " Rewards",
    "   Unlock          Surprise me  >",
    " Data",
    "   Use Ember on another device  >",
    "   Your list is backed up, so it",
    "   won't get lost.",
])

BLOCKS = frame([
    " <-  Hard blocks",
    "---",
    " Hours you're already busy.",
    " Ember plans around them.",
    "",
    "   Mon Wed  10:00-12:00 Classes >",
    "   Fri      14:00-15:00 Call    >",
    "",
    " [+ Add a block]",
    "---",
    " Add a block",
    " Days [M][T][W][T][F][S][S]",
    " From [10:00]       To [12:00]",
    " Name (optional) [____________]",
    " [Save]",
])

QUIET = frame([
    " <-  Quiet hours",
    "---",
    " No nudges between 22:00 and",
    " 08:00.",
    "",
    " From [22:00]       To [08:00]",
    "",
    " Your day starts when quiet hours",
    " end, so Today is rebuilt at",
    " 08:00.",
])

TIMER = frame([
    " <-  Focus timer",
    "---",
    " (o) 25 / 5",
    "     25 minutes of focus, then a",
    "     5-minute break.",
    " ( ) Flowtime",
    "     Count up and stop when you",
    "     stop. The break grows with",
    "     how long you worked.",
    "",
    " You can switch for one session",
    " when you start it.",
])

REWARDS = frame([
    " <-  Rewards",
    "---",
    " After each finished chunk, Ember",
    " offers one quick reward. You can",
    " always skip it.",
    "",
    " (o) Surprise me",
    " ( ) Chess puzzle",
    " ( ) Trivia question",
    " ( ) On this day",
])

STEP = frame([
    "",
    "",
    "  Anything urgent still open?",
    "",
    "  (the step's content: a short",
    "   list, a peek at tomorrow,",
    "   or nothing)",
    "",
    "",
    "  [Next]",
    "",
    "              o  .  .",
])

FINAL_STEP = frame([
    "",
    "  That's it for today.",
    "  You're done.",
    "",
    "             cat, asleep",
    "",
    *ib([" One line about today, whatever",
         " comes to mind."]),
    "",
    " Rough  Meh  Okay  Good  Great",
    "",
    "  [Close]",
    "              .  .  o",
])

DW, LW = 72, 30
RW = DW - LW - 1
DESKTOP = frame([
    " =  Ember   [ What's on your mind?" + " " * 24 + "]",
    "---",
    *cols([
        (" Today           (2/5)   cat", " Outline DSA: heaps chapter"),
        ("", " Revise DSA basics"),
        (" * Outline DSA: heaps ch.", ""),
        ("   [Do this first] [Not today]", "              18:42"),
        (" [ ] Apply: backend role", ""),
        (" [ ] Spring tutorial, ch.3", "             ( || Pause )"),
        (" [x] Fix resume bullet", "   [Stop for now]    [Done]"),
        ("", ""),
        (" 4 more waiting. They'll", "     (Focus while a session runs;"),
        (" come up when there's room.", "      otherwise the selected task)"),
    ], LW, RW),
], DW)

doc = f"""# Ember: Wireframes

Status: **approved by Natalie 2026-09-30**, with four open decisions listed below (Plan stage, design track, `UX_Flows.md` §8 step 1). Step 2 (critique + accessibility check) appends its findings to this file.

*Generated file: edit `scripts/wireframes.py`, then run `python scripts/wireframes.py docs/Wireframes.md`.*

**Visual version:** the same 20 frames as grey-box artboards on the Claude Design canvas [Ember Wireframes](https://claude.ai/artifact/QhDkyqicqW946mMs25F9xf) (private). This file stays the written record; changes made on the canvas get written back here.

Plain-text layouts: what is on each screen and where. No colour, type, or style; those come from the chosen visual direction (§8 steps 3 to 5). All behaviour and copy come from `UX_Flows.md`; section references are given under each frame.

**Legend:** `=` drawer menu · `(2/5)` progress ring · `*` frog · `[ ]` chunk not done · `[x]` chunk done · `[>]` start · `(>)` send · `(+)` add · `...` more actions · `>` opens a sub-screen · `<-` back · `cat, <state>` where the cat sits and its state · `[Button]` tappable.

Phone frames are drawn at a 375px-wide screen.

## Global

- **Header:** drawer menu, screen title; on Today also the ring and the cat.
- **Capture bar:** pinned at the bottom of Today and Inbox (not Settings, where there is nothing to capture into; Natalie's call, from canvas review), showing *"What's on your mind?"*. Tapping it opens the capture sheet. During Focus it dims but stays usable (`UX_Flows.md` §3.1). Hidden on step cards (shutdown, onboarding), where onboarding step 1 *is* the capture field.

---

## 1. Today

{TODAY}

- The frog card sits first and is larger. Its buttons are the scope's own pair, *Do this first* (starts Focus on it) and *Not today* (§3.4).
- Each other row has three controls: the checkbox marks the chunk done without Focus (goes to Reward), `[>]` starts Focus, and `...` offers *Not today* and *Open task*. Tapping the row text opens the Task view.
- Done chunks stay on the list, dimmed, below the open ones, so the day's progress stays visible.
- A smaller step (one split off a bigger step, `UX_Flows.md` §3.3) shows its parent step's name as a dimmed second line, so the row says where it belongs. Today counts smaller steps, never their parent. The frog card's *from:* line still names the task.
- An overdue task shows *"Was due Tue"* in plain text under its title (§4). Overdue tasks rank at the top, so one is usually the frog.
- The overflow line links to Inbox (§3.4).

### Today, first open of the day (morning confirm)

{MORNING}

- *Let's go* dismisses the card. *Adjust* dismisses it and shows *Not today* directly on every row, plus a *Pin a task* row that opens Inbox to choose from (§3.4).
- Dismissing without either button leaves Today as built; the card does not return that day.

## 2. Drawer

{DRAWER}

- Opened by `=` or a swipe from the left edge. Holds Inbox and Settings (§2), plus *Wrap up the day*, the manual shutdown trigger (§3.7).
- **No counts** in the drawer. A backlog number is the "list got too long" trigger the whole app avoids.

## 3. Capture sheet

{CAPTURE}

- Rises from the capture bar with the field focused and the keyboard up. Each sent item stacks above the field, which clears and stays open (§3.1).
- *Deadline* and *Quick* sit above the field (Natalie's call, from canvas review). *Deadline* opens the native date picker; *Quick* pre-sets size XS. Both optional.
- *Send* is a round icon button right beside the field, like WhatsApp (Natalie's call, from canvas review): typing and sending sit on one line, and it is the sheet's only action. Screen readers announce it as "Send".
- *Done* sits at the sheet's top-left and closes it; on first run it reads *"That's it for now"* (§7). Tapping the dimmed background or swiping down also closes it. Unsent text is kept as a draft, so an accidental tap on the background loses nothing.

## 4. Focus

{FOCUS}

- The chunk and its parent task fill the screen; everything else dims (§3.5). The timer counts down (25/5) or up (Flowtime).
- **Pause** is the large round button in the centre under the timer (Natalie's call, from canvas review): it stops the timer and resumes from the same button. **Stop for now** and **Done** sit smaller beneath it. Stop for now leaves without finishing (chunk back to Today, time logged); Done finishes the chunk and goes to Reward. (Renamed from *Exit* in canvas review so it can't be mistaken for Done.)
- The cat sits small in a corner, stretching in a slow loop (§6).

### Pomodoro break

{BREAK}

- Top: the prompt when a 25 ends and the chunk isn't done. Middle: the restful break (breathing guide, remaining time). Bottom: the prompt when the break ends. *Stop here* returns to Today with the session logged (§3.5).
- No games on this screen; the unlock belongs to Reward.

## 5. Reward

{REWARD}

- An overlay on Focus (or on Today, when a chunk is checked off there). The ring ticks and the cat purrs before the card appears (§3.6).
- The main button names the unlock being served (Natalie's call, from canvas review): *Try today's chess puzzle* (Lichess daily puzzle), *Answer a trivia question*, or *See what happened on this day* (Wikipedia). It opens the unlock inline with a thin 90-second bar; when the bar runs out, the card offers the next chunk. *Skip* goes straight there.

## 6. Task view

{TASK}

- This is the screen for one task, opened from Today, Inbox, or a notification. It is **not** a step after capture: a captured thought goes to Inbox, and triage happens here only when the user opens the task or the morning Pick offers to sort a few (§3.1, §3.2).
- Arriving from a **web-push notification** adds one line under the header, *"Not now? [Snooze]"*, because web push carries no buttons of its own (§5). It is not part of setting up a task, so this frame leaves it out (removed after Natalie's canvas review).
- Triage sits at the top until answered. Once it has answers it collapses to a one-line summary:

{TASK_TRIAGED}

- A line under *Break this down for me* names the task it splits: *Splits "Revise DSA basics" into 3 to 6 steps you can edit.* (Natalie's call, from canvas review: make it obvious which task gets broken down.) The button label itself is scope copy (`Product_Scope.md` §3) and is unchanged.
- In **Chunks**, *Break this down for me* sits first, above the list (Natalie's call, from canvas review): the task's name is already the big question, so breaking it down is the first move. The field under the list adds one step by hand (the only way before the AI breakdown ships in phase 4).
- **Adding a step by hand:** the question *"What's the very next physical action?"* is the field's label, *Type one step* is its placeholder. Enter or the round **(+)** button adds the step to the bottom of the list; the field clears and stays ready for the next one; an empty entry is ignored. Same pattern as the capture sheet's send button (canvas review).
- *Pin to today* shows only when the task is not already in Today (§3.4).
- *Remove from list* (Natalie's call, 2026-09-30; was *Let it go*) lives only in the header `...` menu, next to *Rename* (Natalie's call, from canvas review). A button under *Start* and *Pin to today* was too easy to hit by accident while setting a task up. It moves the task out of Today and Inbox into the collapsed Removed section; it is not the back arrow, which only leaves the screen (§4).

### Menus

The task menu (the header `...`), a small dropdown:

{TASK_MENU}

A step's menu (the `...` on a step row), a sheet from the bottom:

{STEP_MENU}

- **Task menu:** *Rename task* and *Remove from list*. Remove from list lives only here, away from Start and Pin (§4).
- **Step menu:** *Start this step*, *Move up*, *Move down*, *Rename*, *Delete step*, and *Cancel* (or a tap on the dimmed area).
- **Reordering steps** (Natalie's call, from canvas review): on touch, hold a step for about half a second, then drag it; with a mouse, click and drag it directly. No handle on the row. *Move up* / *Move down* in the step menu do the same for keyboard and screen-reader users, who cannot drag. The rows turn off the phone's press-and-hold text menu so the hold starts a drag instead. The big *Start* at the bottom always starts the first unfinished step in this order; each row's own start button starts that step directly. 
- **Smaller steps** (Natalie's call, 2026-09-30; full rules in `UX_Flows.md` §3.3): *Break this step down* turns the step into a heading with its smaller steps indented under it. Two levels at most. Before phase 4 the split is manual: an indented field labelled *Add a smaller step*, with its own **(+)**, opens under the heading, and works like the main add field. In the frame, *Outline heaps chapter* has been split: its checkbox ticks itself when both smaller steps are done (ticking it by hand finishes the rest), and it has no `[>]` because Focus runs on one smaller step at a time.
- **Menu differences by row:** a smaller step's menu has no *Break this step down* (no third level). A parent's menu swaps *Start this step* and *Break this step down* for *Add a smaller step*; its *Move up* / *Move down* move the whole group, and a smaller step moves only within its parent. *Delete step* on a parent asks *"Delete this step and its N smaller steps?"*

## 7. Inbox

{INBOX}

- Two sections: **Needs sorting** (untriaged, newest first) and **Waiting** (triaged, not in Today, in rank order). The morning Pick's "sort a few" offer opens Needs sorting (§3.2).
- **Removed** is collapsed at the bottom; tapping a removed task offers *Restore* (§4).
- No counts on sections.

## 8. Settings

{SETTINGS}

- *Send to* chooses Telegram or This device, one channel per message (§5). It shows *Not set up* when neither is linked.
- An *Add to Home Screen* row appears here on iPhone Safari when Ember isn't installed (§4, §7).
- The backup line appears from phase 2 (§7).

### Hard blocks (day shape)

{BLOCKS}

- Hard blocks are the only scheduled thing in Ember; chunks are never clock-pinned (`Product_Scope.md` §2, Day shape).
- Days are toggle chips; *From* and *To* use the native time input.

### Quiet hours

{QUIET}

- Default 22:00 to 08:00, editable (`Product_Scope.md` §2). The note explains the day boundary: a day starts when quiet hours end, which is when Today rebuilds and the daily nudge cap resets (`UX_Flows.md` §6). Changes save as you make them.

### Focus timer

{TIMER}

- One choice, 25/5 (default) or Flowtime (`UX_Flows.md` §3.5). The per-session switch lives on Focus at the start of a session.

### Rewards

{REWARDS}

- The unlock served after each chunk (`UX_Flows.md` §3.6). *Surprise me* rotates through the three and is the default. Every reward stays skippable, so there is no off switch.
- Settings rows for these three pages now open them; the pages were drawn after Natalie asked to see them (canvas review).

## 9. Step card (shutdown and onboarding)

One layout serves every step of the evening shutdown (§3.7) and the onboarding steps after capture (§7): one message, its content, one main button, progress dots when the step count is fixed.

{STEP}

### Final shutdown step

{FINAL_STEP}

- The journal line and the mood row are optional; *Close* works with both empty (§3.7).
- On a zero-done day the message reads *"Some days are for resting. Tomorrow's list is ready when you are."*

## 10. Desktop

{DESKTOP}

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
5. **Inbox has two sections**, Needs sorting and Waiting, plus the collapsed Removed.
6. **Wrap up the day** lives in the drawer.
7. **Triage collapses** to a one-line summary with *Edit* once answered.
8. **Rename a task** via the Task view's `...` menu. No document specified renaming until now. A step's own `...` menu holds *Start this step*, *Rename*, and *Delete step*; editing steps was also unspecified.
9. **The desktop right pane** is never empty: Focus while running, otherwise the selected task.
10. **New copy:** *Let's go* / *Adjust*, *Pin a task*, *Take 5* / *Skip break*, *Back to it* / *Stop here*, *Needs sorting*, *Waiting*, *Not set up*, *Hours you're already busy. Ember plans around them.*, *Add a block*, *Rename*, *Close*, and for the Settings pages: *Your day starts when quiet hours end, so Today is rebuilt at 08:00.*, *25 minutes of focus, then a 5-minute break.*, *Count up and stop when you stop. The break grows with how long you worked.*, *You can switch for one session when you start it.*, *After each finished chunk, Ember offers one quick reward. You can always skip it.*

## Accessibility targets (checked in step 2)

Targets to meet, not measurements. Step 2 checks the frames against them and the design direction must hold them.

- Touch targets at least 44 × 44 px (the three row controls fit at 375px width).
- Text contrast WCAG AA: 4.5:1 for body text, 3:1 for large text.
- Visible keyboard focus on every control; focus order follows reading order.
- Screen-reader labels: `[>]` → "Start *chunk name*", `...` → "More actions for *chunk name*", checkbox → "Mark *chunk name* done", ring → "2 of 5 done today". The cat is hidden from screen readers (§6).
- Reduced motion: still poses for the cat, no sheet or card animations.

## Open decisions (Natalie's)

Raised in canvas review, 2026-09-30; not yet answered. Nothing here is drawn until decided.

1. **Sub-steps. Decided 2026-09-30:** a step can be split once into smaller steps that stay under it; two levels at most. Drawn in the Task view (§6); rules in `UX_Flows.md` §3.3, state machine in `Product_Scope.md`.
2. **"Let it go" label. Decided 2026-09-30:** *Remove from list*, everywhere the button appears (task menu, overdue message, Telegram). The collapsed Inbox section and the task state are renamed *Removed*. Behaviour is unchanged: the task is restorable, so the confirmation copy stays. `Product_Scope.md` §3 and `UX_Flows.md` updated.
3. **"Chunk" or "step".** User-facing copy uses both (Reward and Rewards say *chunk*; Task view says *step*). Proposed: *step* everywhere the user can see it.
4. **Undo on removing.** Offered: an *Undo* button on the *"Moved out of the way. It's still here if you want it back."* confirmation.

## Open for `Tech_Scope.md`

- Ranking order when an overdue task and a due-today task compete for the frog. Both rank "at the top"; the formula decides which is first.
"""

with open(sys.argv[1], "w", encoding="utf-8", newline="\n") as f:
    f.write(doc)
print("written")
