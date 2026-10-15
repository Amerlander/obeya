import { expect, test } from 'bun:test';
import { badgeOf, drawMarks, markOf, markSize } from './marks';

test('a click sets a pin, a drag frames the region from where it began to where it ended, whichever way it went', () => {
  expect(markOf({ x: 10, y: 20 }, { x: 12, y: 21 }, 3)).toEqual({ kind: 'pin', x: 10, y: 20 });
  expect(markOf({ x: 100, y: 80 }, { x: 40, y: 120 }, 60)).toEqual({ kind: 'frame', x: 40, y: 80, w: 60, h: 40 });
});

test("a frame's number stands in a square on its top left corner, above it, or inside where the image ends above it", () => {
  const s = markSize(1000, 500);
  const high = badgeOf({ kind: 'frame', x: 100, y: 100, w: 50, h: 50 }, s);
  expect(high.side).toBe(2 * s.radius);
  expect(high.x).toBeCloseTo(100 - s.line / 2);
  expect(high.y + high.side).toBeCloseTo(100 + s.line / 2);
  const top = badgeOf({ kind: 'frame', x: 100, y: 5, w: 50, h: 50 }, s);
  expect(top.y).toBeCloseTo(5 - s.line / 2);
});

test('marks take the same share of a large and a small screenshot, and stay readable on a tiny one', () => {
  const large = markSize(2000, 1200);
  const small = markSize(1000, 600);
  expect(large.radius / 2000).toBeCloseTo(small.radius / 1000);
  expect(large.line / 2000).toBeCloseTo(small.line / 1000);
  expect(markSize(100, 80).radius).toBeGreaterThanOrEqual(10);
});

test('drawn into the image, a frame gets its white rim under the red line; frames and pins are numbered together in the order set', () => {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (o, k: string) => o[k] ?? ((...a: unknown[]) => calls.push(`${k}(${a.join(',')})`)),
    set: (o, k: string, v) => {
      o[k] = v;
      if (k === 'strokeStyle') calls.push(`stroke ${v}`);
      return true;
    },
  });
  drawMarks(ctx as never, [{ kind: 'frame', x: 1, y: 2, w: 3, h: 4 }, { kind: 'pin', x: 5, y: 6 }], 1000, 500);
  expect(calls.filter((c) => c.startsWith('stroke ') || c.startsWith('stroke(')).slice(0, 4)).toEqual(['stroke #fff', 'stroke()', 'stroke #e02b1e', 'stroke()']);
  const b = badgeOf({ kind: 'frame', x: 1, y: 2, w: 3, h: 4 }, markSize(1000, 500));
  expect(calls.filter((c) => c.startsWith('fillText(')).map((c) => c.split(',').slice(0, 2).join(','))).toEqual([`fillText(1,${b.x + b.side / 2}`, 'fillText(2,5']);
});
