// The height of the phone's conversation panel, as the owner drags its top and throws it.

/** How near the screen's top or bottom edge a dragged top has to be let go to take the full height or close, as a share of the screen. */
export const SNAP = 0.15;
/** How fast a thrown top slows down, in px/ms². */
export const FRICTION = 0.002;
/** Let go slower than this (px/ms), the finger had stopped: the top stays where it was let go. */
export const THROWN = 0.3;
/** Over how many ms of its last moves the finger's speed is measured. */
const TRAIL = 80;
/** A finger that has not moved for this long (ms) when it lets go had stopped. */
const STILL = 50;

/**
 * Where the panel goes when its top is let go at `top` (0 the screen's top, 1 its bottom): within
 * `SNAP` of the top it takes the full height, within `SNAP` of the bottom it closes, and anywhere
 * between it stays as high as the owner left it. The answer is the panel's height as a share of the
 * screen, or `'close'`.
 */
export function settle(top: number): number | 'close' {
  if (top > 1 - SNAP) return 'close';
  if (top < SNAP) return 1;
  return 1 - top;
}

/** Where the finger was, at a time in ms. */
export type Mark = { t: number; y: number };

/**
 * How fast the finger moved down (px/ms, up negative) when it let go at `now`, from its last moves
 * (`trail`, the oldest first): over the last `TRAIL` ms of them, and none if it had not moved for
 * `STILL` ms.
 */
export function speed(trail: Mark[], now: number): number {
  const last = trail[trail.length - 1];
  if (!last || now - last.t > STILL) return 0;
  const recent = trail.filter((m) => last.t - m.t <= TRAIL);
  const first = recent[0]!;
  if (first === last) return 0;
  return (last.y - first.y) / Math.max(1, last.t - first.t);
}

/**
 * Where a top let go at `top` (a share of a screen `px` high) comes to rest when the finger was
 * moving at `v` px/ms: thrown, it glides on and slows by `FRICTION`; let go slower than `THROWN` it
 * stays.
 */
export function thrown(top: number, v: number, px: number): number {
  if (Math.abs(v) < THROWN) return top;
  return top + (Math.sign(v) * v * v) / (2 * FRICTION) / px;
}

/**
 * How the top glides `distance` px on from a finger let go at `v` px/ms: slowing evenly to a stop,
 * as long as that takes within bounds, and starting at the finger's speed (the curve's first slope)
 * as far as an easing without overshoot allows.
 */
export function glide(distance: number, v: number): { ms: number; ease: string } {
  const d = Math.max(1, Math.abs(distance));
  const s = Math.max(THROWN, Math.abs(v));
  const ms = Math.round(Math.min(500, Math.max(150, (2 * d) / s)));
  const slope = Math.min(3, (s * ms) / d);
  return { ms, ease: `cubic-bezier(.333, ${(slope / 3).toFixed(3)}, .667, 1)` };
}
