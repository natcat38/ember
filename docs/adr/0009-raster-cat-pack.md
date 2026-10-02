# 0009. The cat is a raster animation pack, and its idle loops are allowed

Date: 2026-10-03. Status: accepted.

## Context

The cat was five inline SVG drawings in `src/Cat.tsx`, one still pose each, with a single CSS one-shot stretch on Focus. The still poses read as lifeless in use. Hand-drawn SVG could not reach the illustration quality Natalie wanted, and the free-licence vector route turned up nothing in a matching style.

Natalie generated a five-pose pack with an AI image tool: a 512 px PNG still per pose and an eight-frame GIF per pose with a gentle breathing motion baked in. The pack also carried auto-traced SVGs, which were unusable (the tracer turned the drop shadow into bands across the canvas).

The accessibility pass of 2026-10-02 (`Design_Direction.md` §11, A1) had ruled that a loop playing for a whole Focus session fails WCAG 2.2.2, so the stretch was made a one-shot. A breathing loop on every pose reopens that call.

## Decision

- The cat ships as the pack's rasters, in `public/cat/`: one still WebP and one animated WebP per pose. The animated files are built from the GIF frames with the white background keyed out, in-between frames blended in, and the loop slowed from 0.9 s to about 2.4 s. The build script lives with the session notes, not the repo; the outputs are what is versioned.
- Idle loops are on. `Cat.tsx` serves the animated file under `prefers-reduced-motion: no-preference` and the still otherwise, through `<picture>`. This is the common reading of WCAG 2.2.2 for subtle decorative motion with a system-level off switch, and it reverses the strict reading in A1. Natalie made that call on 2026-10-02.
- Stretching plays once (loop count 1) and holds its last frame, which keeps the Focus screen still after the first few seconds, as before.
- The lapse-return pose uses the pack's window scene, full-bleed on the left of the Today nook, instead of a cat beside the ring.
- The traced SVGs and the GIFs are not in the repo.

## Consequences

- No per-part motion: the head, tail and eyes cannot be animated separately as they could in SVG. The motion is whatever the pack baked in.
- Five animated WebPs cost more bytes than five inline SVGs. They are static assets, cached by the service worker like the icons.
- The Design Direction's peach token no longer drives the cat; the pack's own orange does. The nook colour is unchanged.
- Re-generating a pose means re-running the conversion on a new PNG and GIF pair; the frame timing and keying are the knobs.
