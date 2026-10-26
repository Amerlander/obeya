// The queue's order: the cards waiting to start, in the order they came to the Koordinator
// (`since`). The owner moves a waiting card earlier or later, one place or several at once, past
// cards it has no wait with: the waits fix the order between the cards they join, the owner the rest.

import type { Item } from './types';

/** Waiting to start: being judged, behind others, or for a workspace. */
export const inQueue = (i: Pick<Item, 'state' | 'queue'>) => i.state === 'planned' && !!i.queue;

/** A card the Koordinator has decided on and that waits: the owner may move it. One being judged stays where it is. */
export const movable = (i: Item) => inQueue(i) && !('checking' in i.queue!);

/** The waiting cards, first in turn first. */
export function queueOrder(items: Item[]): Item[] {
  return items.filter(inQueue).sort((a, b) => a.queue!.since.localeCompare(b.queue!.since) || a.id.localeCompare(b.id));
}

const behind = (i: Item) => (i.queue && 'behind' in i.queue ? i.queue.behind : []);

/** A card that has not been started: planned and not in the queue (a stopped one too). */
export const notStarted = (i: Pick<Item, 'state' | 'queue'>) => i.state === 'planned' && !i.queue;

/** Whether `card` waits for `id`, directly or through cards it waits for. */
export function waitsOn(card: Item, id: string, items: Item[]): boolean {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const todo = [card];
  while (todo.length) {
    for (const b of behind(todo.pop()!)) {
      if (b === id) return true;
      if (seen.has(b)) continue;
      seen.add(b);
      const next = byId.get(b);
      if (next) todo.push(next);
    }
  }
  return false;
}

type Stuck = 'waitsFor' | 'waitedOn' | 'checking';

/** Why `card` cannot pass `past`, the next card in the way it moves, if so. */
function stuck(card: Item, past: Item, earlier: boolean): Stuck | undefined {
  const [first, second] = earlier ? [past, card] : [card, past];
  if (behind(second).includes(first.id)) return earlier ? 'waitsFor' : 'waitedOn';
  if (!movable(past)) return 'checking';
}

/**
 * Moving the card one place earlier or later: the card it passes, and why it cannot pass it, if so.
 * No `past`: it is first or last already. A card that waits for the next one up stays behind it,
 * one waited for stays ahead of the card waiting, and a card being judged is passed by none, since
 * what it may come to wait for is decided by the cards ahead of it.
 */
export function move(id: string, earlier: boolean, items: Item[]): { past?: Item; why?: Stuck } {
  const order = queueOrder(items);
  const n = order.findIndex((i) => i.id === id);
  const past = n < 0 ? undefined : order[earlier ? n - 1 : n + 1];
  if (!past) return {};
  return { past, why: stuck(order[n]!, past, earlier) };
}

/**
 * How many places the card can move earlier or later at once, passing card after card as `move`
 * does one; `stop` is the card it cannot pass, and `why`, or none where the queue ends.
 * Checking each card passed is enough: one it waits for through others lies behind those others.
 */
export function reach(id: string, earlier: boolean, items: Item[]): { places: number; stop?: Item; why?: Stuck } {
  const order = queueOrder(items);
  const n = order.findIndex((i) => i.id === id);
  if (n < 0) return { places: 0 };
  const step = earlier ? -1 : 1;
  for (let k = n + step; k >= 0 && k < order.length; k += step) {
    const why = stuck(order[n]!, order[k]!, earlier);
    if (why) return { places: Math.abs(k - n) - 1, stop: order[k], why };
  }
  return { places: earlier ? n : order.length - 1 - n };
}
