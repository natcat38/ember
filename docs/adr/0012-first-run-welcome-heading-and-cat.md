# 0012. First run opens with a visible "Welcome to Ember" and the watching cat

Date: 2026-11-09. Status: accepted.

## Context

The 2026-10-23 UX audit (EMB-UX-7) found that first run said nothing about which app it was. The
"Welcome to Ember" heading existed but was visually hidden. ADR 0010 put the wordmark in the sticky
header, but first run has no header, so that fix did not reach it. Verify_List left this open as a call
for Natalie.

## Decision

Natalie chose option 1 of D-D on 2026-11-09: the capture step opens with the watching cat beside a
visible "Welcome to Ember" heading.

Her condition: the cat keeps the drawing's exact width-to-height ratio and is never stretched. The heading
therefore uses the `<Cat>` component, not a raw `<img>`. `<Cat>` sets the width from the height and the
drawing's own box (337 x 471 for *watching*). A raw image inside the step card's flex column was measured
stretching in the mockup.

## Consequences

- The cat is 96 px tall and about 69 px wide. It stays decorative (`aria-hidden`), and the heading
  carries the name.
- `e2e/onboarding.spec.ts` asserts that the rendered width/height of the picture box and of the image
  is within 0.015 of 337/471, in Chromium and WebKit. A future CSS change that stretches the cat fails
  that test.
- The capture field moves down by the height of the welcome row. It still has focus on load, so typing
  works at once.
