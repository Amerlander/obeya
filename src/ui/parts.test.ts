import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Item } from '../core/types';
import { CardFace, linkPath } from './parts';

const ws: Item = { id: 'w', kind: 'task', state: 'live', title: 'Cart model', body: '', x: 0, y: 0, parent: 'p', source: 'plan', repo: 'shop', label: 'W1' };
const face = (item: Item, chip?: boolean) => renderToStaticMarkup(createElement(CardFace, { item, chip }));

test('a delivered workstream keeps its label before its title as a chip', () => {
  expect(face(ws, true)).toContain('<div class="ttl"><span class="ws-no">W1</span>Cart model</div>');
  // at a task's size the kind line says it
  expect(face(ws)).toContain('<div class="ttl">Cart model</div>');
  expect(face(ws)).toContain('<span>W1</span>');
});

/** The numbers of a path `M x1,y1 C c1 c2 x2,y2`, as points. */
const points = (d: string) => (d.match(/-?[\d.]+,-?[\d.]+/g) ?? []).map((p) => p.split(',').map(Number) as [number, number]) as [[number, number], [number, number], [number, number], [number, number]];

test('a link with a head stops at its base and runs into it square to the card, however short or bent', () => {
  const a = { x: 0, y: 0, w: 300, h: 136 };
  // beside each other, close and far apart sideways: ends 15 short of the left side, last leg level
  for (const b of [{ x: 330, y: 110, w: 300, h: 136 }, { x: 380, y: 130, w: 300, h: 136 }, { x: 1000, y: 0, w: 300, h: 136 }]) {
    const [start, c1, c2, end] = points(linkPath(a, b, 15));
    expect(start).toEqual([300, 68]);
    expect(end).toEqual([b.x - 15, b.y + 68]);
    expect(c1[1]).toBe(start[1]);
    expect(c2[1]).toBe(end[1]);
    expect(c2[0]).toBeLessThan(end[0]);
    expect(c1[0]).toBeGreaterThan(start[0]);
  }
  // above each other, the waiting card above and to the left: ends 15 below its bottom, last leg upward
  const [start, , c2, end] = points(linkPath(a, { x: -200, y: -170, w: 300, h: 136 }, 15));
  expect(start).toEqual([150, 0]);
  expect(end).toEqual([-50, -34 + 15]);
  expect(c2[0]).toBe(end[0]);
  expect(c2[1]).toBeGreaterThan(end[1]);
});
