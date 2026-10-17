import { expect, test } from 'bun:test';
import { settle } from './panelHeight';

test('a top let go between the edges keeps the height the owner dragged it to', () => {
  expect(settle(0.5)).toBeCloseTo(0.5);
  expect(settle(0.2)).toBeCloseTo(0.8);
  expect(settle(0.8)).toBeCloseTo(0.2);
});

test('a top let go near the screen top takes the full height', () => {
  expect(settle(0.1)).toBe(1);
  expect(settle(-0.05)).toBe(1);
});

test('a top let go near the screen bottom closes the panel', () => {
  expect(settle(0.9)).toBe('close');
  expect(settle(1.2)).toBe('close');
});
