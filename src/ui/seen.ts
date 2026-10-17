// What of each card's conversation the owner has had in view, in this browser: its messages after
// that are new to them (counted on the phone's button, marked in the conversation).
import { useEffect, useRef, useState } from 'react';

/** The last event of each card's conversation the owner had in view, by card. */
const SEEN = 'obeya-seen';
// until 2026-10-17 only the phone kept it, under its own name
const BEFORE = 'obeya-phone-seen';

function all(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN) ?? localStorage.getItem(BEFORE) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

/** The last event of the card's conversation the owner had in view; -1 before they ever had it. */
export const seenOf = (card: string): number => all()[card] ?? -1;

export function markSeen(card: string, id: number) {
  try {
    const kept = Object.entries(all()).filter(([c]) => c !== card);
    localStorage.setItem(SEEN, JSON.stringify(Object.fromEntries([...kept.slice(-299), [card, id]])));
    localStorage.removeItem(BEFORE);
  } catch {}
}

/** Whether the page is in view: not in a background tab, not behind a locked screen. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const seen = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', seen);
    return () => document.removeEventListener('visibilitychange', seen);
  }, []);
  return visible;
}

/**
 * A card's conversation in view: what of it the owner had seen when it came into view (so what came
 * after stays marked as new until it goes), while all it holds counts as seen as long as the page is
 * in view. `last`: the conversation's last event.
 */
export function useSeen(card: string, last: number | undefined): number {
  const atOpen = useRef<{ card: string; seen: number } | null>(null);
  if (atOpen.current?.card !== card) atOpen.current = { card, seen: seenOf(card) };
  const visible = usePageVisible();
  useEffect(() => {
    if (!visible || last === undefined || last <= seenOf(card)) return;
    markSeen(card, last);
  }, [card, last, visible]);
  return atOpen.current.seen;
}
