import { expect, test } from 'bun:test';
import { onto, ZOOM_BELOW, ZOOM_MARGIN, zoomBox } from './zoomBox';

test('a wide window: the zoomed video takes the height above the microphone, centred', () => {
  const b = zoomBox(16 / 9, 2560, 1400);
  expect(b.height).toBe(1400 - ZOOM_MARGIN - ZOOM_BELOW);
  expect(b.width).toBeCloseTo(b.height * (16 / 9));
  expect(b.left).toBeCloseTo((2560 - b.width) / 2);
  expect(b.top).toBe(ZOOM_MARGIN);
});

test('a narrow window: the zoomed video takes the width and stands in the middle above the microphone', () => {
  const b = zoomBox(16 / 9, 1000, 1400);
  expect(b.width).toBe(1000 - 2 * ZOOM_MARGIN);
  expect(b.left).toBe(ZOOM_MARGIN);
  expect(b.top + b.height / 2).toBeCloseTo(ZOOM_MARGIN + (1400 - ZOOM_MARGIN - ZOOM_BELOW) / 2);
});

test('the transform puts the zoomed box back onto the card’s', () => {
  expect(onto({ left: 100, top: 200, width: 400, height: 225 }, { left: 50, top: 40, width: 1600, height: 900 })).toBe('translate(50px, 160px) scale(0.25)');
});
