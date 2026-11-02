# 0011. Dependency patches from the 2026-11-02 sweep: vitest security backport and vite

Date: 2026-11-02. Status: accepted.

## Context

Two dependabot PRs had been open since 2026-10-22. Their green CI predated the UX passes
that landed on `main` after them (#78 to #81), so it no longer counted.

- #75: `vitest` and `@vitest/mocker` 4.1.11 to 4.1.12. The release notes call it
  "Harden manual and redirect mocks", a v4 backport of the fixes for GHSA-qxg6-89mg-rqv8
  and GHSA-xp26-3454-mjgp (mock-registration injection and a Windows backslash bypass).
  Both are dev-only. Neither ships to users.
- #76: `vite` 8.3.2 to 8.3.5, patch releases.

Every green push to `main` deploys itself (#63), so merging either one is a deploy.

## Decision

Rebase each one onto current `main`, re-run CI, and merge one at a time: #75 first, then
#76. The patch-level, dev-tooling scope and a fresh green `check` job were enough. No
manual app check on top.

## Consequences

- #75 merged at 2026-11-02T07:56:32Z, and its push run deployed cleanly (`check` and
  `deploy` both succeeded). #76 merged at 2026-11-02T08:03:45Z.
- Dependency bumps stay out of the roadmap's feature list. This ADR is their record.
