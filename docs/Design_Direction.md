# Ember: Design Direction

Status: **approved by Natalie, 2026-10-02**. Direction: **Small Companion**, picked by Natalie from the three-direction mockups (`Product_Scope.md` §7, decision 6). Mockups: the Claude Design canvas *Ember Mockups* (https://claude.ai/artifact/Q9P3CjtMh2Gv3GiVeSws5N), Small Companion column. Screens, flows, and copy: `UX_Flows.md`, `docs/Wireframes.md`. This file is the source of truth for how Ember looks; Build implements it as CSS tokens and never improvises a colour or font outside it.

## 1. The idea in one line

A soft, rounded, quiet app where the only lively thing on screen is a small orange cat keeping you company. Everything else stays calm, so that the cat, the progress ring, and the one primary action are the only things that draw the eye.

**The risk this direction carries:** the research ranked it third because Finch-style apps read as childish to adults (`research/competitors-and-design.md` Part C). §5's restraint rules exist to hold the line. When in doubt, choose the plainer option.

## 2. Tokens

### Colour

Values measured on 2026-10-02 (OKLCH from the hex, contrast by WCAG 2.x relative luminance). Every pairing used for text is listed in §2.3.

| Token | Hex | OKLCH | Role |
|---|---|---|---|
| `--color-oat` | `#F6F3EE` | `oklch(96.5% 0.007 81)` | Page ground |
| `--color-surface` | `#FFFFFF` | `oklch(100% 0 0)` | Cards, rows, sheets, fields |
| `--color-ink` | `#2E2A35` | `oklch(29.4% 0.020 302)` | Text, icons |
| `--color-lavender` | `#8C7BC4` | `oklch(62.8% 0.109 294)` | **Decoration only:** the ring, the frog card's border. Never text, never under white text |
| `--color-lavender-deep` | `#6B5BA8` | `oklch(52.2% 0.119 291)` | **Action:** primary buttons, selected pills, links, checkboxes, the focus ring |
| `--color-peach` | `#E8A87C` | `oklch(78.2% 0.096 55)` | The cat. Nothing else |

Supporting neutrals (not accents; derived, never chosen per screen):

| Token | Hex | OKLCH | Role |
|---|---|---|---|
| `--color-ink-soft` | `#625B6B` | `oklch(48.4% 0.027 305)` | Secondary text, placeholders, the overflow line |
| `--color-nook` | `#ECE7F6` | `oklch(93.6% 0.021 301)` | The cat's nook (§4) |
| `--color-done` | `#EFEBE4` | `oklch(94.1% 0.010 82)` | Background of a finished row |
| `--color-sage-deep` | `#4F7A45` | `oklch(53.4% 0.093 140)` | A finished row's ticked checkbox |
| `--color-line` | `#DDD6CC` | `oklch(87.9% 0.016 77)` | Decorative dividers only (1.30:1, not enough to mark a control) |
| `--color-line-control` | `#8A8296` | `oklch(62.0% 0.031 304)` | Outlines that identify a control: text fields, unselected pills and chips, unchecked checkboxes |

There is no red, no warning yellow, and no error colour. Ember never signals failure with colour (`UX_Flows.md` §4: "no red").

### Type

| Token | Face | Weights | Role |
|---|---|---|---|
| `--font-display` | **Nunito** (Google Fonts) | 800 | Screen titles, the frog's task name, the timer, the ring count, Inbox and Settings section headings |
| `--font-body` | **Karla** (Google Fonts) | 400, 600 | Everything else: rows, buttons, labels, fields, help text |

Two faces, no third. Headings are never italic. Load with `font-display: swap` and self-host the `woff2` files in Build so the PWA works offline.

| Step | Size / line height | Face | Used for |
|---|---|---|---|
| `--text-title` | 26 / 32 | display 800 | Screen title (*Today*, *Inbox*) |
| `--text-lead` | 19 / 25 | display 800 | Frog task name, *2 of 5 done* |
| `--text-timer` | 64 / 68 | display 800, tabular figures | Focus timer |
| `--text-body` | 16 / 24 | body 400 | Rows, fields, buttons (600) |
| `--text-small` | 14 / 20 | body 400 | Secondary lines, overflow line, help text |
| `--text-label` | 13 / 18 | body 600 | *Do this first*, section labels |

16 px is the floor for anything the user taps or types into (it also stops iOS zooming into fields).

### Shape and space

- **Spacing:** 4-point scale. `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-5` 20, `--space-6` 24, `--space-8` 32. Page gutter 16. Gap between rows 8.
- **Radius:** `--radius-row` 18, `--radius-card` 22, `--radius-button` 16, `--radius-sheet` 28 (top corners), `--radius-pill` 999.
- **Depth:** no shadows. Separation comes from white surfaces on the oat ground. Sheets get a scrim of ink at 45% behind them.

### Motion

| Token | Value | Used for |
|---|---|---|
| `--dur-fast` | 150 ms | Button press, pill select, checkbox tick |
| `--dur-base` | 250 ms | Sheet open and close, row leaving Today |
| `--dur-ring` | 400 ms | Ring filling; the last step of the day gets one slower 700 ms fill |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | Everything entering |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Everything leaving |

Animate `transform` and `opacity` only. No bounce, no overshoot, no confetti. With `prefers-reduced-motion: reduce`: sheets and rows appear without sliding, the ring jumps to its value, and the cat shows still poses (`UX_Flows.md` §6).

### 2.3 Measured contrast

| Pair | Ratio | Target |
|---|---|---|
| ink on oat / on surface / on nook | 12.66 / 14.01 / 11.56 | 4.5 ✓ |
| ink-soft on oat / surface / done / nook | 5.88 / 6.51 / 5.48 / 5.37 | 4.5 ✓ |
| white on lavender-deep (buttons) | 5.70 | 4.5 ✓ |
| lavender-deep on surface / oat / nook (links, labels) | 5.70 / 5.15 / 4.70 | 4.5 ✓ |
| white on lavender | 3.66 | **fails 4.5: never used for text** |
| line-control on surface / oat (control outlines) | 3.68 / 3.32 | 3.0 ✓ |
| lavender on surface (frog border, ring) | 3.66 | 3.0 ✓ |
| sage-deep on surface (ticked checkbox) | 5.00 | 3.0 ✓ |
| line on oat | 1.30 | decorative only |

## 3. Layout concept: one soft column

- **Phone (base, 375 px):** one column, 16 px gutters, a 60 px header (menu button, screen title), content, and the capture bar pinned to the bottom. Rows are white rounded strips with no border; the frog is the one card with a lavender border. Today shows the cat's nook between the header and the frog (§4).
- **Narrow phone (320 px):** the same layout. Row action buttons stay 44 × 44; long titles wrap to two lines inside the row rather than truncate. No horizontal scroll at 320, 375, 414, or 768 px.
- **Tablet and desktop (≥ 768 px):** the column centres at a maximum of 560 px on the oat ground. The capture bar moves to the top and is always visible (`UX_Flows.md` §3.1). Settings opens as a side drawer. Nothing becomes a multi-column dashboard; Ember stays one list.
- **Focus:** the step and timer sit in one large white card in the middle of the screen; everything else fades to ink-soft on the done background (the dimming in `UX_Flows.md` §3.5, done with colour, not opacity, so the dimmed text still passes 4.5:1).

## 4. Signature element: the cat's nook

The nook is a lavender-tinted rounded panel (`--color-nook`, radius 22) where the cat lives. It appears in exactly three places, matching `UX_Flows.md` §6:

| Screen | Nook | Cat pose |
|---|---|---|
| Today | A strip under the header: the cat on the left (72 px), *2 of 5 done* and the progress ring on the right | Watching (asleep before the first open of the day, by the door on a lapse return) |
| Focus | A small nook in the bottom-right corner, faded with the rest of the chrome | Stretching: plays once when the session starts (under 5 s), then holds a still stretch pose (§11, finding A1) |
| Reward | A 200 px circle in the centre of the screen, the ring beside it | Curled up, purring |

Nowhere else. Not in Capture, Task view, Inbox, Settings, notifications, empty states, or error lines. The cat is decorative (`aria-hidden="true"`); the ring and its label carry the information.

**Illustration style** (left open by `UX_Flows.md` §6, settled here): flat peach shapes with a thin soft-brown outline (`#5A4A3F`, 1.5 px at 64 px), darker peach tabby stripes, round dark eyes, two small blush dots. No mouth, no eyebrows, no text, no props, no accessories. One drawing per pose, as inline SVG, so the five states cost five small files. The mockups' drawings are the reference.

## 5. Restraint rules

These keep Small Companion adult. Each one is a check in the review stage.

1. **Lavender is rationed.** Decorative lavender appears only on the ring, the frog's border, and the nook. Action lavender appears only on the one primary button per view, selected pills, checkboxes, links, and the focus ring.
2. **One primary button per view.** Everything else is an outlined or text button.
3. **The cat never talks, reacts to absence, or shows a mood** (`UX_Flows.md` §6). No day-mood glow; that part of the original direction was dropped.
4. **Nunito only for display.** Body, buttons, and labels are always Karla. Rounded type everywhere is what tips into childish.
5. **No decoration that isn't information:** no gradients, glows, sparkles, emoji, stickers, patterns, or background illustrations.
6. **No celebratory motion** beyond the ring fill and the cat's pose change. The last step of the day gets a slower ring fill, nothing more.

## 6. States

### Interactive elements (all eight)

| State | Primary button | Outlined button, pill, chip | Row | Text field |
|---|---|---|---|---|
| Default | lavender-deep, white text | surface, line-control outline, ink text | surface | surface, line-control outline, ink-soft placeholder |
| Hover (pointer only) | 8% darker | nook fill | nook fill | — |
| Focus-visible | 2 px lavender-deep ring, 2 px offset, shown instantly | same | same, on the row's link | ring replaces the outline |
| Active | scale 0.98 | scale 0.98 | — | — |
| Disabled | 40% opacity, no pointer | same | — | ink-soft text |
| Loading | label kept, a small spinner replaces the icon | — | — | — |
| Error | not shown on the button; a line under the control (below) | — | — | an ink-soft line under the field |
| Success | silent: the result appears (row added, ring moves); no toast | selected = lavender-deep fill, white text | ticked: done background, struck-through ink-soft text | clears and keeps focus (Capture) |

### Loading

Phase 1 reads from the device, so there is nothing to wait for. Phase 2 can wait on the first sync:

- **First load with nothing on the device:** three row-shaped placeholders in `--color-done`, no shimmer, screen-reader text *"Loading today."* (approved 2026-10-02).
- **Any later load:** show what the device has at once; sync quietly behind it. Never a spinner over the list.
- **Breakdown in progress (phase 4):** the button keeps its label, shows a spinner, and is disabled until the steps arrive.

### Empty

Copy is fixed by `UX_Flows.md` §4. Empty states are a plain line plus the next action; no illustration, no cat.

| State | Copy |
|---|---|
| Empty Inbox | *"Nothing waiting here."* + capture bar |
| Empty Today: nothing lined up | *"Nothing's lined up for today yet."* → *[Sort a few from Inbox]* *[Capture something]* |
| Empty Today: all done | *"That's everything for today."* Ring full; the nook's cat curled up |

### Errors

No red, no icons of warning, no blame. Each error is one ink-soft line under the thing that failed, with what to do next.

| Situation | Copy | Source |
|---|---|---|
| Offline | *"Offline. Your changes will sync when you reconnect."* (small line under the header, not a banner) | `UX_Flows.md` §4 |
| Breakdown while offline | *"Breakdowns need a connection. Try: what's the very next physical action?"* | `UX_Flows.md` §4 |
| Breakdown cap reached | *"Out of breakdowns for today. Try: what's the very next physical action?"* | `Product_Scope.md` §3 |
| Breakdown failed (service error) | *"That breakdown didn't come through. Try again, or type the very next physical action."* | new, approved 2026-10-02 |
| A change the server rejected after a two-device race (`Tech_Scope.md` §5) | *"This changed on another device, so you're seeing the latest version."* | new, approved 2026-10-02 |
| Sign-in with a passkey failed | *"That didn't sign you in. Try again, or keep using Ember on this device."* | new, approved 2026-10-02 |

Status messages (*Added*, ring changes, the lines above) go through one polite live region and never move focus (`Wireframes.md`, accessibility targets).

## 7. Components (shadcn/ui patterns, checked 2026-10-02)

Build may use shadcn/ui (Radix underneath) or plain elements; either way, the pattern below is the one to follow.

| Ember element | Pattern | Note |
|---|---|---|
| Capture sheet | Drawer (bottom sheet) | Focus moves in, stays inside, Escape closes, focus returns (A4) |
| Step and task checkboxes | Checkbox | Real checkbox named by the step text (A2) |
| Triage yes/no, size picker, timer mode | Toggle Group, single select | Pills, radius 999 |
| *Remove from list* prompt | Alert Dialog | *[Keep it] [Remove]* |
| Task `...` menu | **Popover with plain buttons**, not Dropdown Menu | Dropdown Menu uses ARIA `menu`, which A5 ruled out |
| First-load placeholder | Skeleton | No shimmer animation |
| Settings drawer on desktop | Sheet (side) | |

## 8. Quality floor

- Visible focus on every control, 2 px lavender-deep ring at 2 px offset, never animated.
- Text 4.5:1, large text and control outlines 3:1, all measured in §2.3.
- Touch targets ≥ 44 × 44 px.
- Reduced motion honoured as in §2 (Motion).
- Works at 320, 375, 414, and 768 px with no horizontal scroll.
- Light theme only for phases 1–2. Dark mode is not designed; add it as a scoped decision before any phase that wants it.

## 9. Self-check: the generic default, and where Ember deviates

| The generic default would be | Ember instead |
|---|---|
| White page, grey 1 px bordered cards, Inter or system font | Oat ground, borderless white rounded rows, Nunito titles over Karla body |
| A blue primary (`#3B82F6`) on everything clickable | One lavender action colour, rationed to one primary button per view |
| Red badges for overdue, counts of missed tasks | No red anywhere; overdue is a plain date label (*"Was due Tue"*) |
| A mascot that talks in speech bubbles and celebrates with confetti | A cat that never speaks, sits in one nook, and only changes pose |
| Toasts for every save | Silent success: the result itself is the feedback |
| A dashboard on desktop | The same single column, centred |

## 10. Mockup fixes for Build

The canvas is a reference, not a spec; where they disagree, this file wins. Known differences:

- The capture field and the triage pills are outlined in `#DDD6CC` (1.30:1) or `#CFC6E6` on the canvas. Build uses `--color-line-control` (§2), which passes 3:1.
- Today's *2 of 5 done* is visible text in the nook; the ring keeps its screen-reader label *"2 of 5 done today"*, and the visible text is hidden from screen readers so it isn't read twice.
- Pills, chips, and secondary values on the canvas use 15 px text. Build uses 16 px (`--text-body`) for anything tapped.

## 11. Accessibility pass (design step 6, 2026-10-02)

**Standard:** WCAG 2.1 AA. **Scope:** this file plus the seven Small Companion boards on the canvas, read from their source. The wireframes' structure, labels, and focus rules passed step 2 (`Wireframes.md`, A1–A7 there); this pass checks what the direction adds: colour, outlines, focus, motion, the cat, and type. **Result:** 2 major, 4 minor, all fixed in this file. Not covered: a real screen-reader and keyboard run, which belongs to the Verify stage on the built app.

| # | Finding | WCAG | Severity | Fix (applied) |
|---|---|---|---|---|
| A1 | The Focus cat "stretching in a slow loop" (`UX_Flows.md` §6) moves for the whole 25-minute session, next to the timer, with no way to stop it | 2.2.2 Pause, Stop, Hide | Major | The stretch plays once when the session starts (under 5 s), then holds a still pose (§4). `UX_Flows.md` §6 updated to match. |
| A2 | Text fields and unselected pills and chips are outlined in `#CFC6E6` or `#DDD6CC`, about 1.3–1.5:1 against their background, so their edges cannot be seen by low-vision users | 1.4.11 Non-text contrast | Major | `--color-line-control` (`#8A8296`, 3.32–3.68:1) for every control outline (§2, §10). Selected pills fill lavender-deep, so the two states differ by fill as well as outline. |
| A3 | The boards have no designed focus indicator, so the browser default would show, which is faint on oat and invisible on lavender-deep buttons | 2.4.7 Focus visible | Minor (spec gap, not a shipped bug) | 2 px lavender-deep ring at 2 px offset, shown instantly (§6, §8). The offset puts oat or white between the ring and a lavender-deep button. |
| A4 | Today's nook shows *2 of 5 done* as text and the ring is labelled *"2 of 5 done today"*, so a screen reader says it twice | 1.3.1 (redundant announcement) | Minor | Visible text hidden from screen readers; the ring's label stays (§10). |
| A5 | Fixed-height headers (60 px) would clip a 26 px title when text is enlarged to 200% | 1.4.4 Resize text | Minor | Build uses `min-height` for headers and rows, never a fixed `height`. |
| A6 | Placeholder colour is left to the browser, which is often below 4.5:1 | 1.4.3 Contrast | Minor | Placeholders use `--color-ink-soft` (5.88:1 on oat, 6.51:1 on white). Placeholders never replace a label (step 2, A7 waiver stands). |

**Checked and passing:** every text colour pair (§2.3); state shown by more than colour (finished rows are ticked and struck through, selected pills have `aria-pressed` and a fill, the frog has a border and the *Do this first* label); every cat and icon SVG is `aria-hidden`; the focus dimming uses colour (5.48:1), not opacity; touch targets 44 × 44 or larger on all seven boards; the lavender frog border and ring reach 3.66:1.
