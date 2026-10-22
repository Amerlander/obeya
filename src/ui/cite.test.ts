import { expect, test } from 'bun:test';
import { citable } from './cite';
import { citeAt } from './draft';

const q = '„so“ - ';
const put = (text: string, caret: number) => {
  const { at, piece } = citeAt(text, caret, q);
  return text.slice(0, at) + piece + text.slice(at);
};

test('a quote goes at the end of the field when the cursor stood there, on a line of its own', () => {
  expect(put('', 0)).toBe(q);
  expect(put('Erste Zeile', 11)).toBe(`Erste Zeile\n${q}`);
  // at the start of a line no break goes before it
  expect(put('Erste Zeile\n', 12)).toBe(`Erste Zeile\n${q}`);
});

test('from the middle of the text, the quote becomes the line after the cursor\'s', () => {
  expect(put('Zeile eins\nZeile zwei', 3)).toBe(`Zeile eins\n${q}\nZeile zwei`);
  expect(put('Zeile eins\nZeile zwei', 0)).toBe(`Zeile eins\n${q}\nZeile zwei`);
  // in the last line, but not at its end: after it
  expect(put('Zeile eins\nZeile zwei', 14)).toBe(`Zeile eins\nZeile zwei\n${q}`);
  // the cursor leaves the quote's end, so the owner types on right there
  expect(citeAt('Zeile eins\nZeile zwei', 3, q)).toEqual({ at: 10, piece: `\n${q}` });
});

test('the marked text is quoted on one line, without the spaces around it', () => {
  expect(citable('  erster Satz.\n\n  zweiter   Satz ')).toBe('erster Satz. zweiter Satz');
});
