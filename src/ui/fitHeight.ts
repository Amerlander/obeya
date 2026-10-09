import { type RefObject, useLayoutEffect } from 'react';

/**
 * Keeps a text box as tall as its text (within its CSS min- and max-height), on every change and
 * when its width changes. A card's content renders before its panel shows: a hidden box has no
 * height to measure and keeps its one line until it shows.
 */
export function useFitHeight(ref: RefObject<HTMLTextAreaElement | null>, text: string, on = true) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    const fit = () => {
      el.style.height = 'auto';
      if (el.clientWidth) el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    };
    fit();
    // the panel unfolds from the card's width, and a narrower box needs more lines
    let width = el.clientWidth;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      // in the next frame: changing the height inside the callback makes it a resize loop
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [text, on]);
}
