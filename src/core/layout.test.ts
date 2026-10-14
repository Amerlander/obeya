import { describe, expect, test } from 'bun:test';
import { type Bounds, freeSpotNear, GAP, shapeOf } from './layout';

const clear = (a: Bounds, b: Bounds) => a.x + a.w + GAP <= b.x || b.x + b.w + GAP <= a.x || a.y + a.h + GAP <= b.y || b.y + b.h + GAP <= a.y;

describe('freeSpotNear', () => {
  test('takes the wanted spot when it is free', () => {
    expect(freeSpotNear({ x: 0, y: 200 }, [300, 136], [{ x: 0, y: 0, w: 300, h: 136 }])).toEqual({ x: 0, y: 200 });
  });

  test('moves out of a project to the nearest side', () => {
    const project = { x: 0, y: 0, w: 1000, h: 600 };
    // wanted near the right edge: right of the project is nearer than below it
    expect(freeSpotNear({ x: 800, y: 300 }, [300, 136], [project])).toEqual({ x: 1020, y: 300 });
    // wanted near the bottom: below it
    expect(freeSpotNear({ x: 400, y: 500 }, [300, 136], [project])).toEqual({ x: 400, y: 620 });
  });

  test('keeps clear of everything taken', () => {
    const taken = [
      { x: 0, y: 0, w: 1000, h: 600 },
      { x: 1020, y: 200, w: 300, h: 136 },
      { x: 400, y: 620, w: 300, h: 136 },
    ];
    const at = freeSpotNear({ x: 500, y: 400 }, [300, 136], taken);
    for (const b of taken) expect(clear({ ...at, w: 300, h: 136 }, b)).toBe(true);
  });

  test('inside the view: a wanted spot at its edge moves in', () => {
    const view = { x: 0, y: 0, w: 1200, h: 800 };
    expect(freeSpotNear({ x: 1100, y: 750 }, [300, 136], [], view)).toEqual({ x: 1200 - 300 - GAP, y: 800 - 136 - GAP });
  });

  test('inside the view: a free spot in view wins over a nearer one partly out of it', () => {
    const view = { x: 0, y: 0, w: 1200, h: 800 };
    // a column filling the view's right side: right of it is nearer, but out of view
    const taken = [{ x: 700, y: 0, w: 400, h: 800 }];
    const at = freeSpotNear({ x: 800, y: 300 }, [300, 136], taken, view);
    expect(at).toEqual({ x: 700 - 300 - GAP, y: 300 });
  });

  test('a view with no room left: the nearest free spot, out of view', () => {
    const view = { x: 0, y: 0, w: 1200, h: 800 };
    const taken = [{ x: -100, y: -100, w: 1400, h: 1000 }];
    const at = freeSpotNear({ x: 500, y: 400 }, [300, 136], taken, view);
    expect(clear({ ...at, w: 300, h: 136 }, taken[0]!)).toBe(true);
  });
});

describe('shapeOf', () => {
  const ws = { kind: 'task' as const, parent: 'p' };

  test('a delivered workstream shrinks to a chip', () => {
    expect(shapeOf({ ...ws, state: 'live' })).toBe('chip');
    expect(shapeOf({ ...ws, state: 'done' })).toBe('chip');
  });

  test('a workstream whose agent still works after the landing stays at the size of a task', () => {
    expect(shapeOf({ ...ws, state: 'live', finishing: true })).toBe('task');
    expect(shapeOf({ ...ws, state: 'done', finishing: true })).toBe('task');
    // once its agent is done, it shrinks
    expect(shapeOf({ ...ws, state: 'live', finishing: false })).toBe('chip');
  });

  test('a card on its own stays a task', () => {
    expect(shapeOf({ kind: 'task', state: 'live' })).toBe('task');
  });
});
