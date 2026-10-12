import { expect, test } from 'bun:test';
import { firstFit, STEPS, stepsUpTo } from './barFit';

test('the bar takes the first step at which its contents fit, and the last when none does', () => {
  expect(firstFit(() => true)).toBe(0);
  expect(firstFit((s) => s >= 2)).toBe(2);
  expect(firstFit(() => false)).toBe(STEPS);
});

test('each step reached is in the attribute, for the stylesheet to test for', () => {
  expect(stepsUpTo(0)).toBe('');
  expect(stepsUpTo(3)).toBe('1 2 3');
});
