// The height of the phone's conversation panel, as the owner drags its top.

/** How near the screen's top or bottom edge a dragged top has to be let go to take the full height or close, as a share of the screen. */
export const SNAP = 0.15;

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
