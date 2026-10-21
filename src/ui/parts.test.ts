import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Item } from '../core/types';
import { CardFace } from './parts';

const ws: Item = { id: 'w', kind: 'task', state: 'live', title: 'Cart model', body: '', x: 0, y: 0, parent: 'p', source: 'plan', repo: 'shop', label: 'W1' };
const face = (item: Item, chip?: boolean) => renderToStaticMarkup(createElement(CardFace, { item, chip }));

test('a delivered workstream keeps its label before its title as a chip', () => {
  expect(face(ws, true)).toContain('<div class="ttl"><span class="ws-no">W1</span>Cart model</div>');
  // at a task's size the kind line says it
  expect(face(ws)).toContain('<div class="ttl">Cart model</div>');
  expect(face(ws)).toContain('<span>W1</span>');
});
