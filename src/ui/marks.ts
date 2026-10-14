// Marks the owner puts on a screenshot before sending it (shots.tsx Lightbox): a frame around a
// region (a drag) and numbered pins (a click), in the image's own pixels, so they stay put at any
// size. The page draws them as SVG over the image, `drawMarks` into the image the agent gets; both
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

/** The number each pin shows, 1, 2, 3 … in the order set; frames have none. */
export function pinNumbers(marks: Mark[]): (number | null)[] {
  let n = 0;
  return marks.map((m) => (m.kind === 'pin' ? ++n : null));
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
  const numbers = pinNumbers(marks);
  marks.forEach((m, i) => {
    ctx.beginPath();
    if (m.kind === 'frame') {
      ctx.roundRect(m.x, m.y, m.w, m.h, s.corner);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = EDGE;
      ctx.lineWidth = s.line + 2 * s.edge;
      ctx.stroke();
      ctx.strokeStyle = RED;
      ctx.lineWidth = s.line;
      ctx.stroke();
      return;
    }
    ctx.arc(m.x, m.y, s.radius, 0, 2 * Math.PI);
    ctx.fillStyle = RED;
    ctx.fill();
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = s.edge * 2;
    ctx.stroke();
    ctx.fillStyle = EDGE;
    ctx.font = `700 ${s.font}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(numbers[i]), m.x, m.y + s.font * 0.05);
  });
}
