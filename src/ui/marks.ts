// Marks the owner puts on a screenshot before sending it (shots.tsx Lightbox): a frame around a
// region (a drag) and a pin on a spot (a click), numbered together in the order set, in the image's
// own pixels, so they stay put at any size. A pin shows its number in a circle, a frame in a square
// badge at its corner, so a small frame does not read as a pin. The page draws them as SVG over the image, `drawMarks` into the image the agent gets; both
// from the same sizes.

export type Mark = { kind: 'frame'; x: number; y: number; w: number; h: number } | { kind: 'pin'; x: number; y: number };
export type Point = { x: number; y: number };

/** A drag shorter than this, in screen pixels, is a click. */
export const CLICK_PX = 5;

export const RED = '#e02b1e';
export const EDGE = '#fff';

/** The mark of a gesture from `a` to `b` (image pixels) that went `moved` screen pixels at most from where it began. */
export const markOf = (a: Point, b: Point, moved: number): Mark =>
  moved < CLICK_PX ? { kind: 'pin', x: a.x, y: a.y } : { kind: 'frame', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };

/**
 * Where a frame's number stands: a square of `side` (a pin's width) on its top left corner,
 * outside above it like a tab, or inside where the image ends above the frame.
 */
export function badgeOf(m: Extract<Mark, { kind: 'frame' }>, s: ReturnType<typeof markSize>) {
  const side = 2 * s.radius;
  // flush with the red line's outer edge, the badge's white rim with the frame's
  const out = s.line / 2;
  const above = m.y - side + out;
  return { x: m.x - out, y: above - s.edge >= 0 ? above : m.y - out, side };
}

/**
 * How large marks are on an image of `w`×`h` pixels: the same share of its long side, so they look
 * the same however large it is shown. `line` the red line, `edge` the white rim on each side of it,
 * `radius` a pin's, `corner` a frame's rounding.
 */
export function markSize(w: number, h: number) {
  const long = Math.max(w, h);
  const line = Math.max(2, long * 0.003);
  const radius = Math.max(10, long * 0.015);
  return { line, edge: line * 0.5, radius, corner: line * 1.5, font: radius * 1.25 };
}

type Ctx = Pick<
  CanvasRenderingContext2D,
  'beginPath' | 'roundRect' | 'arc' | 'stroke' | 'fill' | 'fillText' | 'strokeStyle' | 'fillStyle' | 'lineWidth' | 'lineJoin' | 'font' | 'textAlign' | 'textBaseline'
>;

/** Draws the marks onto a context of the image's size, as the page shows them. */
export function drawMarks(ctx: Ctx, marks: Mark[], w: number, h: number) {
  const s = markSize(w, h);
  marks.forEach((m, i) => {
    ctx.beginPath();
    let at: Point = m;
    if (m.kind === 'frame') {
      ctx.roundRect(m.x, m.y, m.w, m.h, s.corner);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = EDGE;
      ctx.lineWidth = s.line + 2 * s.edge;
      ctx.stroke();
      ctx.strokeStyle = RED;
      ctx.lineWidth = s.line;
      ctx.stroke();
      const b = badgeOf(m, s);
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.side, b.side, s.corner);
      at = { x: b.x + b.side / 2, y: b.y + b.side / 2 };
    } else ctx.arc(m.x, m.y, s.radius, 0, 2 * Math.PI);
    ctx.fillStyle = RED;
    ctx.fill();
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = s.edge * 2;
    ctx.stroke();
    ctx.fillStyle = EDGE;
    ctx.font = `700 ${s.font}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), at.x, at.y + s.font * 0.05);
  });
}
