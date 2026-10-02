import type { ReactNode } from "react";
import type { CatPose } from "../core/cat";

// The cat (UX_Flows.md §6, Design_Direction.md §4): flat peach shapes, a thin soft-brown outline, darker tabby stripes,
// round dark eyes and two blush dots. No mouth, no eyebrows, no text, no props. One drawing per pose.
// Watching, stretching and purring are copied from the approved Small Companion mockups (Today, Focus, Reward).
const OUTLINE = "#5A4A3F";
const PEACH = "#E8A87C";
const STRIPE = "#C9825A";
const EYE = "#3B3340";
const BLUSH = "#F2B9A0";
const BACKDROP = "#E0D8F1";

// A tail or leg: the outline colour drawn thick, the fill colour drawn thinner on top.
const Limb = ({ d }: { d: string }) => (
  <>
    <path d={d} fill="none" stroke={OUTLINE} strokeWidth="6.5" strokeLinecap="round" />
    <path d={d} fill="none" stroke={PEACH} strokeWidth="3.5" strokeLinecap="round" />
  </>
);
const Shape = ({ d }: { d: string }) => <path d={d} fill={PEACH} stroke={OUTLINE} strokeWidth="1.5" strokeLinejoin="round" />;
const Stripes = ({ d }: { d: string }) => <path d={d} fill="none" stroke={STRIPE} strokeWidth="2" strokeLinecap="round" />;
const Blush = ({ cx, cy, r = 2 }: { cx: number; cy: number; r?: number }) => <circle cx={cx} cy={cy} r={r} fill={BLUSH} />;

const WATCHING = (
  <>
    <circle cx="32" cy="36" r="28" fill={BACKDROP} />
    <Limb d="M44 56 C56 56 60 46 54 38" />
    <Shape d="M20 19 L19 5 L30 13 Z" />
    <Shape d="M44 19 L45 5 L34 13 Z" />
    <Shape d="M18 57 C16 42 22 35 32 35 C42 35 48 42 46 57 Z" />
    <circle cx="32" cy="24" r="13" fill={PEACH} stroke={OUTLINE} strokeWidth="1.5" />
    <Stripes d="M28 13 l1 4 M32 12 v5 M36 13 l-1 4 M23 46 h5 M36 46 h5" />
    <circle cx="27" cy="24" r="2.2" fill={EYE} />
    <circle cx="37" cy="24" r="2.2" fill={EYE} />
    <path d="M31 28.5 h2 l-1 1.4 z" fill={EYE} />
    <Blush cx={23.5} cy={28.5} />
    <Blush cx={40.5} cy={28.5} />
  </>
);

const STRETCHING = (
  <>
    <Limb d="M80 30 C88 20 86 12 92 9" />
    <Limb d="M70 40 L72 58 M77 40 L80 58 M26 52 L6 56 M30 55 L10 60" />
    <Shape d="M20 50 C22 40 34 38 48 34 C60 30 70 22 78 26 C84 30 82 40 76 42 C66 44 54 48 40 52 C32 54 24 54 20 50 Z" />
    <Shape d="M9 38 L7 26 L16 33 Z" />
    <Shape d="M21 34 L25 23 L27 35 Z" />
    <circle cx="17" cy="42" r="10.5" fill={PEACH} stroke={OUTLINE} strokeWidth="1.5" />
    <Stripes d="M46 36 l2 6 M56 32 l2 6 M66 28 l2 6" />
    <path d="M11 42 q2 1.6 4 0 M19 42 q2 1.6 4 0" fill="none" stroke={EYE} strokeWidth="1.6" strokeLinecap="round" />
    <Blush cx={10} cy={46} r={1.8} />
    <Blush cx={24} cy={46} r={1.8} />
  </>
);

const PURRING = (
  <>
    <ellipse cx="44" cy="34" rx="28" ry="16" fill={PEACH} stroke={OUTLINE} strokeWidth="1.5" />
    <Stripes d="M38 20 q4 6 1 12 M48 19 q4 7 1 13 M58 21 q4 6 1 11" />
    <Limb d="M70 38 C74 50 52 54 30 50" />
    <Shape d="M13 26 L11 13 L21 21 Z" />
    <Shape d="M26 22 L32 11 L33 25 Z" />
    <circle cx="22" cy="33" r="12.5" fill={PEACH} stroke={OUTLINE} strokeWidth="1.5" />
    <path d="M15 33 q2.5 2 5 0 M24 33 q2.5 2 5 0" fill="none" stroke={EYE} strokeWidth="1.6" strokeLinecap="round" />
    <path d="M21 37 h2 l-1 1.3 z" fill={EYE} />
    <Blush cx={14} cy={38} />
    <Blush cx={30} cy={38} />
  </>
);

// ponytail: draft art, needs Natalie's review. Asleep: curled like the purring cat, head tucked low, eyes closed in a
// flat downward curve, tail laid over the front, no marks beyond the tabby stripes. Same palette and stroke weights.
const ASLEEP = (
  <>
    <circle cx="32" cy="36" r="28" fill={BACKDROP} />
    <ellipse cx="33" cy="44" rx="21" ry="11" fill={PEACH} stroke={OUTLINE} strokeWidth="1.5" />
    <Stripes d="M29 34 q3 4 1 8 M36 33 q3 5 1 9 M43 35 q3 4 1 8" />
    <Limb d="M52 48 C54 57 36 58 24 55" />
    <Shape d="M10.5 37 L9.5 27 L18 33 Z" />
    <Shape d="M21 33 L27 26 L27.5 35.5 Z" />
    <circle cx="19" cy="43" r="10.5" fill={PEACH} stroke={OUTLINE} strokeWidth="1.5" />
    <path d="M13 43 q2 1.4 4 0 M21 43 q2 1.4 4 0" fill="none" stroke={EYE} strokeWidth="1.6" strokeLinecap="round" />
    <path d="M18 46 h2 l-1 1.2 z" fill={EYE} />
    <Blush cx={12.2} cy={47} r={1.8} />
    <Blush cx={25.8} cy={47} r={1.8} />
  </>
);

// ponytail: draft art, needs Natalie's review. By the door: sitting, seen side-on, one eye and the nose towards the
// edge of the screen. No door is drawn; the pose says it, the cat has no props.
const DOOR = (
  <>
    <circle cx="32" cy="36" r="28" fill={BACKDROP} />
    <Limb d="M16 57 C4 57 2 47 8 40" />
    <Shape d="M12 57 C8 42 20 33 32 35 C44 37 51 47 48 57 Z" />
    <Stripes d="M20 47 h5 M28 45 h5" />
    <Shape d="M31 21 L30 7 L41 15 Z" />
    <Shape d="M55 21 L56 7 L45 15 Z" />
    <circle cx="43" cy="26" r="13" fill={PEACH} stroke={OUTLINE} strokeWidth="1.5" />
    <Stripes d="M39 15 l1 4 M43 14 v5 M47 15 l-1 4" />
    <circle cx="49" cy="25" r="2.2" fill={EYE} />
    <path d="M52.5 28.5 h2 l-1 1.4 z" fill={EYE} />
    <Blush cx={47.5} cy={31.5} />
  </>
);

// Each drawing keeps its own mockup viewBox, so the stroke weights stay as drawn.
const DRAWINGS: Record<CatPose, { box: [number, number]; art: ReactNode }> = {
  watching: { box: [64, 64], art: WATCHING },
  stretching: { box: [96, 64], art: STRETCHING },
  purring: { box: [80, 56], art: PURRING },
  asleep: { box: [64, 64], art: ASLEEP },
  door: { box: [64, 64], art: DOOR },
};

// `size` is the drawing's width in px; its height follows from the drawing's own proportions.
// Decorative: the ring and the timer carry everything the cat shows, so it is hidden from screen readers.
// The stretching pose plays a one-shot stretch on mount, then holds (styles.css, under no-preference only).
export function Cat({ pose, size }: { pose: CatPose; size: number }) {
  const { box, art } = DRAWINGS[pose];
  return (
    <svg className="cat" data-pose={pose} width={size} height={Math.round((size * box[1]) / box[0])} viewBox={`0 0 ${box[0]} ${box[1]}`} aria-hidden="true" focusable="false">
      {art}
    </svg>
  );
}
