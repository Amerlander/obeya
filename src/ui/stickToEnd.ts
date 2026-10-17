import { type RefObject, type UIEvent, useEffect, useRef } from 'react';

/**
 * Keeps a conversation's newest message in view, on a card and in the Koordinator's sheet alike.
 * A change of `newest` (something new was said) takes the box to its end; while it stands there it
 * stays there as the messages grow after they are in (a comment's video frame loading, text
 * wrapping anew once the font is in), as rows come without a new message, or as the box shrinks,
 * unless the owner scrolled up to read further back. `content` is what the box shows. `start`: the
 * message the box opens at instead of its end, once its content is in, at its top as far as the box
 * scrolls; it stays there in the same way until the owner scrolls or something new is said.
 * Returns the box's onScroll.
 */
export function useStickToEnd(box: RefObject<HTMLElement | null>, newest: unknown, content: unknown, start?: (box: HTMLElement) => HTMLElement | null) {
  const atEnd = useRef(true);
  const seen = useRef<unknown>(undefined);
  const anchor = useRef<HTMLElement | null>(null);
  const started = useRef(false);
  // where the box was put last: the scroll event that follows is that move, not the owner's, also
  // when it arrives after the box shrank on (a panel coming up), which would read as scrolled up
  const put = useRef<number | null>(null);
  const place = (el: HTMLElement) => {
    if (anchor.current?.isConnected) el.scrollTop += anchor.current.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
    else if (atEnd.current) el.scrollTop = el.scrollHeight;
    else return;
    put.current = el.scrollTop;
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (newest !== seen.current) {
      atEnd.current = true;
      anchor.current = null;
    }
    seen.current = newest;
    if (content && !started.current) {
      started.current = true;
      anchor.current = start?.(el) ?? null;
    }
    place(el);
  }, [newest, content, box.current]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const follow = () => place(el);
    const keep = new ResizeObserver(follow);
    keep.observe(el);
    for (const x of el.children) keep.observe(x);
    // the note under the comments held back, say
    const rows = new MutationObserver((changes) => {
      for (const c of changes) for (const x of c.addedNodes) if (x instanceof Element) keep.observe(x);
      follow();
    });
    rows.observe(el, { childList: true });
    return () => {
      keep.disconnect();
      rows.disconnect();
    };
  }, [content, box.current]);
  return (e: UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    if (put.current !== null && Math.abs(el.scrollTop - put.current) < 2) return;
    put.current = null;
    anchor.current = null;
    atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
  };
}
