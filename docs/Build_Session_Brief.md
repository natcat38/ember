# Ember: Build session brief

Written 2026-10-02 at the end of the spike, tech-scope, and design-direction session, for a fresh session started in `C:\Users\natal\Documents\Coding\ember\`. Open with: "Read docs/Build_Session_Brief.md and start."

## Where things stand

- `ROADMAP.md`: **Build** stage. Plan closed 2026-10-02. Its *Next up* line is current; read it first.
- Everything the build follows is approved and merged on `main`:
  - `docs/Tech_Scope.md`: stack and versions (§1), data model (§3), formulae with the worked example that becomes the golden test (§4.6), the 16 slices (§10), gotchas (§11).
  - `docs/adr/0001`–`0008`: why each tech choice was made.
  - `docs/Design_Direction.md`: Small Companion tokens, type, states, copy, accessibility findings. **It wins over the mockup canvas** wherever they disagree (§10 lists the known differences).
  - `docs/research/tech-spike.md`: what was proven on a live deploy, free-plan limits, and the **cleanup list for before the repo goes public**.
- Mockups (reference only): Claude Design canvas *Ember Mockups*, https://claude.ai/artifact/Q9P3CjtMh2Gv3GiVeSws5N, Small Companion column. Read boards with the Artifact tool (`read`, `path: project/<Screen>_SmallCompanion.dc.html`); the local copies from this session are gone.
- Repo: private `natcat38/ember`, default branch `main`, no CI yet, no branch protection.

## This session's job

**Slice 0, day-1 hygiene** (`Tech_Scope.md` §10 and `ROADMAP.md` Build): Vite + React + TypeScript skeleton served by one Worker, `ember-tasks`, with static assets (ADR-0004); pinned versions in `package.json`; `.gitignore`; README stub with the purpose paragraph; GitHub Actions CI running typecheck + Vitest; env config via wrangler vars. Then slices 1–7 in order to finish phase 1, if the session has room.

**Stopping rule for slice 0:** `wrangler deploy` serves a page reading "Ember" at the Worker's URL, CI is green on a PR, and the PR is merged with `mergedAt` verified.

## Ask Natalie before

- **The first deploy.** Wrangler auto-registered the account-wide workers.dev subdomain `cron-telegram` during the spike, so the app would land at `ember-tasks.cron-telegram.workers.dev`. Renaming the subdomain is an account setting and her call; ask once, before slice 0 deploys.
- **Slice 7** starts with a 5-minute test on her iPhone (`Tech_Scope.md` §7). Plan it with her; never assume the result.
- **Slice 11** needs a new production Telegram bot from her (BotFather). The spike bot is not reused.

## How Natalie works (learned this session, not in the docs)

- **Branch, PR, merge, verify.** Commit as each item settles on a feature branch, open a PR, merge when clean, and check `gh pr view <n> --json state,mergedAt` before saying it's merged. Leave a PR open only when it carries something she must approve (a scope or spec doc).
- **No job-search framing** in Ember work. She asked for it to stop.
- **She answers fast and picks the recommended option most of the time.** Put the full option text inside the question dialog, since chat text above it gets hidden.
- **Secrets:** she once typed a token as the secret's *name*. When she must set a secret, give her a command she runs with the app's Run button, with nothing to edit: copy the value first, then `Get-Clipboard | npx.cmd wrangler@4.145.0 secret put <NAME> --name <worker>`. Then verify with `wrangler secret list` filtered so values never print. **Never read her terminal tab while a secret is on screen.**
- **PowerShell blocks `npx.ps1`**: her commands use `npx.cmd` / `npm.cmd`. In the Bash tool, plain `npx` works.

## Gotchas hit this session

- **Line endings:** files checked out after a merge are CRLF. `sed` and `grep` in Git Bash hide the `\r`, so check with `file <path>`. Scripted edits must keep CRLF and assert every search string was found; `git diff --stat` should show only the lines you meant to change.
- **Long heredocs in the Bash tool break on quoting.** Write files and scripts with the Write tool, then run them.
- **wrangler 4.146.0 returned npm 404s on its release day.** The spike used 4.145.0; pin a version on purpose and bump it on purpose.
- **TypeScript 7.0 is the new native compiler.** If a tool in the chain (Vite plugin, `@cloudflare/vitest-pool-workers`) breaks on it, pin the last 5.x and note it in `Tech_Scope.md` §1.
- **The spike Worker `ember-spike` is still deployed** with a per-minute cron (free, sends nothing). It uses 1 of the account's 5 cron triggers. Leave it until the cleanup list runs.

## Suggested skills

- `tdd`: every slice is implement → test → commit; the §4.6 worked example is the first golden test (slice 4).
- `ponytail:ponytail`: smallest thing that satisfies each slice; no abstractions the slices don't need yet.
- `frontend-design` and `vercel-react-best-practices`: building screens from `Design_Direction.md` tokens.
- `superpowers:verification-before-completion`: a slice is done only with a passing test run, a deploy URL, or a merged PR, never from memory.
- `superpowers:systematic-debugging` or `diagnose`: when the Worker, CI, or a test fails; root cause before patching.
- Later: `web-design-guidelines` (Review stage), `protect-repo` (when the repo goes public, after the cleanup list).
