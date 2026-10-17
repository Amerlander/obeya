import { describe, expect, test } from 'bun:test';
import { goesAside } from './aside';

describe('goesAside', () => {
  test('a line pulled past a third of its width goes, either way', () => {
    expect(goesAside(130, 0, 360)).toBe(true);
    expect(goesAside(-130, 0, 360)).toBe(true);
    expect(goesAside(100, 0, 360)).toBe(false);
  });
  test('a flick the way it was pulled sends it, one back or a nudge does not', () => {
    expect(goesAside(40, 0.8, 360)).toBe(true);
    expect(goesAside(-40, -0.8, 360)).toBe(true);
    expect(goesAside(40, -0.8, 360)).toBe(false);
    expect(goesAside(16, 0.8, 360)).toBe(false);
  });
});
