# Ember: design review session brief

Written 2026-09-30 at the end of the UX + wireframes session, for a fresh session started in `C:\Users\natal\Documents\Coding\ember\`. Open with: "Read docs/Design_Review_Session_Brief.md and start."

## Where things stand

- `ROADMAP.md`: **Plan** stage. Its *Next up* line is current; read it first.
- Define is closed: `docs/Product_Scope.md` and `docs/UX_Flows.md` are signed off. Changes made during wireframe review are marked inline "(wireframe review, 2026-09-30)"; `git log` has one commit per change.
- Design track step 1 is done: `docs/Wireframes.md` (20 frames) and the grey-box Claude Design canvas **Ember Wireframes** are approved by Natalie, with **four open decisions** listed in the wireframes doc under "Open decisions".
- Tech track has not started (feasibility spike, then `docs/Tech_Scope.md`); the three things the spike must confirm are in `ROADMAP.md`.

## This session's job

1. **Settle the four open decisions**, one at a time, three options with trade-offs each (they are already written out in `docs/Wireframes.md`). Decision 1 (sub-steps) is the big one: Natalie replied "3", which was applied as the *reordering* choice; confirm whether she also wants nesting before touching anything. Decision 2 ("Let it go") is signed-off scope copy; changing it means editing `Product_Scope.md` §3 too.
2. **Apply each decision** to the canvas, `scripts/wireframes.py`, and `UX_Flows.md` / `Product_Scope.md` where behaviour or scope copy changes. Commit after each.
3. **Run design step 2** (`UX_Flows.md` §8): usability critique, then accessibility check against the targets already in `docs/Wireframes.md` ("Accessibility targets"). Append findings to the wireframes doc (via the script). Contrast is stated as a target (WCAG AA 4.5:1), never picked as a value here.
4. Update `ROADMAP.md` *Next up* before ending.

Stopping rule: the four decisions are recorded and applied, and step 2's findings are in `docs/Wireframes.md` with each one either fixed or explicitly waived by Natalie. Do not start styled mockups (step 3) unless she asks for them by name.

## How the pieces fit (not obvious from the files)

- **`docs/Wireframes.md` is generated.** Edit `scripts/wireframes.py`, run `python scripts/wireframes.py docs/Wireframes.md`, then check every code block has one line width. The script asserts widths, so an over-long line fails loudly. Never hand-edit the `.md`.
- **The canvas source is not in the repo.** It lives in the artifact at `https://claude.ai/artifact/QhDkyqicqW946mMs25F9xf`; comment notifications address the same canvas as `https://claude.ai/code/artifact/bfdfcd73-b1a4-44dd-be64-d749f10f224c`. To change a board, `read_file` it (e.g. `project/TaskView.dc.html`) into a scratchpad folder, edit with the file tools (the canvas type asks for no scripts on its files), and publish with `url`, `root` = that folder, `file_path` = the changed file. Send `project/canvas.json` only when boards are added, moved, or resized, and read it right before sending.
- **`/design` cannot be invoked by the agent**; only Natalie can start it. The canvas already exists, so edits go through the Artifact tool directly.
- **Review happens in canvas comment threads.** Each comment arrives as a message; reply in its thread, resolve it when acted on, leave it open when a question is pending, and keep the in-session reply to one line. Notifications sometimes arrive twice; check the thread before replying so there are no duplicates.

## Working with Natalie on this (learned this session)

- She reviews visually and fast: short comments anchored to elements. Act on clear requests; for anything that changes a signed-off rule or scope copy, say so plainly and give options before changing it. Two changes were held back for that reason ("Let it go", flat steps).
- She resolves ambiguity when asked; a bare number ("3", "yeah") answers the last question asked, but confirm when it could also answer an earlier one.
- Every canvas change also goes into `scripts/wireframes.py` (and `UX_Flows.md` if behaviour changed), then a commit. She asked for "commit as you go".
- This project is secondary to her job search; say so if a session runs long.

## Suggested skills

- `design:design-critique`: step 2, usability critique of the wireframes.
- `design:accessibility-review`: step 2, WCAG AA check against the targets in the wireframes doc.
- `humanizer`: any new user-facing copy before it goes into a doc or board (the copy rules are `docs/research/competitors-and-design.md` Part D).
- Later, not this session: `hallmark` and `frontend-design` for `docs/Design_Direction.md` (§8 step 5), after she picks a visual direction from the step-3 mockups.
