import { expect, test } from 'bun:test';
import { hintField } from './pasteHint';

test('the hint shows in the field it is due in', () => {
  expect(hintField('card-a', ['mic', 'card-a', 'sidebar'])).toBe('card-a');
});

test('while that field is gone, the hint shows in the field that appeared last', () => {
  expect(hintField('card-a', ['mic', 'sidebar'])).toBe('sidebar');
});

test('no hint when none is due or no field takes screenshots', () => {
  expect(hintField(null, ['mic'])).toBeNull();
  expect(hintField('card-a', [])).toBeNull();
});
