import { type RefObject, type UIEvent, useEffect, useRef } from 'react';

/**
 * Keeps a conversation's newest message in view, on a card and in the Koordinator's sheet alike.
 * A change of `newest` (something new was said) takes the box to its end; while it stands there it
 * stays there as the messages grow after they are in (a comment's video frame loading, text
 * wrapping anew once the font is in) or the box shrinks, unless the owner scrolled up to read
 * further back. `content` is what the box shows, so new messages are watched as they come.
 * Returns the box's onScroll.
 */
export function useStickToEnd(box: RefObject<HTMLElement | null>, newest: unknown, content: unknown) {
  const atEnd = useRef(true);
  const seen = useRef<unknown>(undefined);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (newest !== seen.current) atEnd.current = true;
    seen.current = newest;
    if (atEnd.current) el.scrollTop = el.scrollHeight;
  }, [newest, content, box.current]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const keep = new ResizeObserver(() => {
      if (atEnd.current) el.scrollTop = el.scrollHeight;
    });
    keep.observe(el);
    for (const x of el.children) keep.observe(x);
    return () => keep.disconnect();
  }, [content, box.current]);
  return (e: UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
  };
}
