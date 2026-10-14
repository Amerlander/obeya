import { expect, test } from 'bun:test';
import { drawMarks, markOf, markSize, pinNumbers } from './marks';

test('a click sets a pin, a drag frames the region from where it began to where it ended, whichever way it went', () => {
  expect(markOf({ x: 10, y: 20 }, { x: 12, y: 21 }, 3)).toEqual({ kind: 'pin', x: 10, y: 20 });
  expect(markOf({ x: 100, y: 80 }, { x: 40, y: 120 }, 60)).toEqual({ kind: 'frame', x: 40, y: 80, w: 60, h: 40 });
});

test('pins count 1, 2, 3 in the order set, past frames; taking back the last frees its number', () => {
  const pin = (x: number) => ({ kind: 'pin' as const, x, y: 0 });
  const frame = { kind: 'frame' as const, x: 0, y: 0, w: 5, h: 5 };
  const marks = [pin(1), frame, pin(2), pin(3)];
  expect(pinNumbers(marks)).toEqual([1, null, 2, 3]);
  expect(pinNumbers([...marks.slice(0, -1), pin(4)])).toEqual([1, null, 2, 3]);
});

test('marks take the same share of a large and a small screenshot, and stay readable on a tiny one', () => {
  const large = markSize(2000, 1200);
  const small = markSize(1000, 600);
  expect(large.radius / 2000).toBeCloseTo(small.radius / 1000);
  expect(large.line / 2000).toBeCloseTo(small.line / 1000);
  expect(markSize(100, 80).radius).toBeGreaterThanOrEqual(10);
});

test('drawn into the image, a frame gets its white rim under the red line, a pin its number', () => {
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
  expect(calls.some((c) => c.startsWith('fillText(1,5,'))).toBe(true);
});
