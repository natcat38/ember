import type { CatPose } from "../core/cat";

// The cat (UX_Flows.md §6, Design_Direction.md §4, ADR 0009): Natalie's five-pose raster pack in public/cat/. Each pose
// is a still WebP and an animated WebP with the pack's own gentle motion; the browser picks the animated one only when
// the system allows motion. Stretching plays once and holds its last frame. "door" is the pack's window scene.
// BOX is each cropped drawing's pixel size, so the width follows from `size` without a layout jump while it loads.
const FILE: Record<CatPose, string> = { asleep: "asleep", watching: "watching", stretching: "stretching", purring: "purring", door: "window" };
const BOX: Record<CatPose, [number, number]> = {
  asleep: [472, 320],
  watching: [337, 471],
  stretching: [484, 350],
  purring: [409, 428],
  door: [501, 374],
};

// `size` is the drawing's height in px: every pose fills the same nook height and its width follows, so a wide
// sleeping cat and a tall sitting one get the same presence. Decorative: the ring and the timer carry everything.
export function Cat({ pose, size }: { pose: CatPose; size: number }) {
  const file = FILE[pose];
  const [w, h] = BOX[pose];
  return (
    <picture className="cat" data-pose={pose} style={{ width: Math.round((size * w) / h) }}>
      <source srcSet={`/cat/${file}.webp`} type="image/webp" media="(prefers-reduced-motion: no-preference)" />
      <img src={`/cat/${file}-still.webp`} width={w} height={h} alt="" aria-hidden="true" decoding="async" />
    </picture>
  );
}
