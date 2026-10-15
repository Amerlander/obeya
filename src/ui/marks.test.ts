import { expect, test } from 'bun:test';
import { badgeOf, drawMarks, markOf, markSize, roundedRect } from './marks';

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

test('a badge is one shape with its frame: square where they meet, rounded like the frame where it is outside', () => {
  const s = markSize(1000, 500);
  const outer = s.corner + s.line / 2;
  const high = badgeOf({ kind: 'frame', x: 100, y: 100, w: 50, h: 50 }, s);
  expect(high.corners).toEqual([outer, outer, 0, 0]);
  expect(high.frame).toEqual([0, s.corner, s.corner, s.corner]);
  const top = badgeOf({ kind: 'frame', x: 100, y: 5, w: 50, h: 50 }, s);
  expect(top.corners).toEqual([outer, 0, outer, 0]);
  expect(top.frame).toEqual([s.corner, s.corner, s.corner, s.corner]);
});

test('a rounded rectangle is no rounder than half its width', () => {
  expect(roundedRect(0, 0, 10, 4, [0, 0, 0, 0])).toBe('M0,0H10A0,0 0 0 1 10,0V4A0,0 0 0 1 10,4H0A0,0 0 0 1 0,4V0A0,0 0 0 1 0,0Z');
  expect(roundedRect(0, 0, 10, 4, [5, 0, 0, 0])).toStartWith('M2,0H10');
});

test('marks take the same share of a large and a small screenshot, and stay readable on a tiny one', () => {
  const large = markSize(2000, 1200);
  const small = markSize(1000, 600);
  expect(large.radius / 2000).toBeCloseTo(small.radius / 1000);
  expect(large.line / 2000).toBeCloseTo(small.line / 1000);
  expect(markSize(100, 80).radius).toBeGreaterThanOrEqual(10);
});

test('drawn into the image, the white rims of a frame and its badge go under their red; frames and pins are numbered together in the order set', () => {
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
  expect(calls.filter((c) => /^(stroke |stroke\(|fill\()/.test(c)).slice(0, 5)).toEqual(['stroke #fff', 'stroke()', 'stroke()', 'fill()', 'stroke #e02b1e']);
  const b = badgeOf({ kind: 'frame', x: 1, y: 2, w: 3, h: 4 }, markSize(1000, 500));
  expect(calls.filter((c) => c.startsWith('fillText(')).map((c) => c.split(',').slice(0, 2).join(','))).toEqual([`fillText(1,${b.x + b.side / 2}`, 'fillText(2,5']);
});
