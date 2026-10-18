import { afterEach, expect, test } from 'bun:test';
import { api, cardsOn, setCanvas } from './api';

const fetched: string[] = [];
const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
  fetched.length = 0;
});

test('a call about a card goes to its canvas, though another is in view as it goes out', async () => {
  globalThis.fetch = (async (url: string) => {
    fetched.push(url);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  // the phone view: a card of the website's canvas closes, Obeya's conversation is with the shop's
  cardsOn('website', ['c1']);
  setCanvas('shop');
  await api.act('c1', { action: 'release' });
  await api.command('Das Logo ist zu klein.', { card: 'c1' });
  // a card the page knows no canvas for, and words about nothing: the canvas in view
  await api.act('c2', { action: 'release' });
  await api.command('Neue Karte', null);
  expect(fetched).toEqual(['/api/c/website/cards/c1/act', '/api/c/website/command?card=c1', '/api/c/shop/cards/c2/act', '/api/c/shop/command']);
});
