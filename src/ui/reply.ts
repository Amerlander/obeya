// The message of the open card's conversation the owner replies to, as in chat apps: the field
// under the conversation shows it as a quote, and what the owner types or says next goes with it.

import { useSyncExternalStore } from 'react';
import type { CardEvent } from '../core/types';

let current: CardEvent | null = null;
const listeners = new Set<() => void>();

/** Replies to the message, or with null to none. */
export function setReply(e: CardEvent | null) {
  if (current === e) return;
  current = e;
  for (const fn of listeners) fn();
}

/** The message the owner replies to on the card, if any. */
export const replyOn = (cardId: string): CardEvent | null => (current?.cardId === cardId ? current : null);

/** The same, live. */
export function useReply(cardId: string): CardEvent | null {
  const e = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
  return e?.cardId === cardId ? e : null;
}
