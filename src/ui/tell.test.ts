import { describe, expect, test } from 'bun:test';
import { noticeLine } from './tell';

describe('the line above the microphone', () => {
  test('an answer in Markdown shows plain, on one line, cut short', () => {
    expect(noticeLine("**Start W2 (Price API) next.** The plan doc says so.\n\n- **W3 (Cart page)** can't start yet.\n- W4 waits for it.")).toBe(
      "Start W2 (Price API) next. The plan doc says so. W3 (Cart page) can't start yet. W4 waits for it.",
    );
    expect(noticeLine(`**${'a'.repeat(400)}**`)).toBe(`${'a'.repeat(299)}…`);
  });

  test('a confirmation that is plain already stays as it is', () => {
    expect(noticeLine('„Export“ startet.')).toBe('„Export“ startet.');
    expect(noticeLine('5 * 3 = 15, see snake_case_name')).toBe('5 * 3 = 15, see snake_case_name');
  });
});
