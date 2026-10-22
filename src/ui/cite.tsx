// Answering a part of a message: text the owner marks in a conversation, an agent's or their own,
// gets a small button beside it, which puts it into the field below in quotation marks, followed
// by " - ", with the cursor behind it (`cite` in `draft.ts` says where). Until the owner has used it
// once the button names what it does beside its icon, so it is found.

import { type RefObject, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cite } from './draft';
import { know, known } from './known';
import { t } from './strings';

const KNOWN = 'obeya-cite-known';

/** The marked text as the quote has it: one line, without the spaces around it. */
export const citable = (marked: string) => marked.replace(/\s+/g, ' ').trim();

interface Marked {
  text: string;
  /** Where the button goes, in the window: the point it is centred on, and whether it hangs below that point rather than standing above it. */
  x: number;
  y: number;
  below: boolean;
}

/**
 * The button at text marked in the messages of the conversation in `box`, for the field of draft
 * `draft`. At the desk it stands at the end of the marking, where the pointer let go; on a touch
 * screen below the middle of the marking's last line, clear of the handles and of the system's menu
 * above it.
 */
export function CiteButton({ box, draft }: { box: RefObject<HTMLElement | null>; draft: string }) {
  const [marked, setMarked] = useState<Marked | null>(null);
  const [named, setNamed] = useState(() => !known(KNOWN));
  useEffect(() => {
    const touch = matchMedia('(pointer: coarse)').matches;
    // while the mouse still drags out the marking, the button waits for it to let go
    let dragging = false;
    const place = () => {
      const b = box.current;
      const sel = getSelection();
      if (dragging || !b || !sel || sel.isCollapsed || !sel.rangeCount) return setMarked(null);
      const r = sel.getRangeAt(0);
      const inMessage = (n: Node) => {
        const m = (n instanceof Element ? n : n.parentElement)?.closest('.msg');
        return !!m && b.contains(m);
      };
      if (!inMessage(r.startContainer) || !inMessage(r.endContainer)) return setMarked(null);
      const text = citable(sel.toString());
      const rects = [...r.getClientRects()].filter((c) => c.width > 0);
      if (!text || !rects.length) return setMarked(null);
      const view = b.getBoundingClientRect();
      const backwards = sel.anchorNode === r.endContainer && sel.anchorOffset === r.endOffset;
      const first = rects[0]!;
      const last = rects.at(-1)!;
      // scrolled out of the conversation's view, the marking takes its button along
      if (last.bottom < view.top || first.top > view.bottom) return setMarked(null);
      // beside where the pointer let go, outside the marking: below its last line, or above its first
      // when marked backwards; on the other side where the conversation has no room for it
      const below = touch || !backwards ? view.bottom - last.bottom > 40 || first.top - view.top < 36 : first.top - view.top < 36;
      const x = touch ? (last.left + last.right) / 2 : backwards ? first.left : last.right;
      setMarked({ text, x: Math.min(Math.max(x, view.left + 24), view.right - 24), y: below ? last.bottom : first.top, below });
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && !(e.target as Element).closest?.('.cite')) {
        dragging = true;
        setMarked(null);
      }
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      place();
    };
    const b = box.current;
    document.addEventListener('selectionchange', place);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    b?.addEventListener('scroll', place);
    addEventListener('resize', place);
    return () => {
      document.removeEventListener('selectionchange', place);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      b?.removeEventListener('scroll', place);
      removeEventListener('resize', place);
    };
  }, [box]);
  if (!marked) return null;
  return createPortal(
    <button
      className={['cite', marked.below && 'below', named && 'named'].filter(Boolean).join(' ')}
      style={{ left: marked.x, top: marked.y }}
      title={t.talk.citeHint}
      aria-label={t.talk.citeHint}
      // the marking stays while the button is pressed, and so does the focus where it is
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        getSelection()?.removeAllRanges();
        setMarked(null);
        cite(draft, t.talk.cited(marked.text));
        know(KNOWN);
        setNamed(false);
      }}
    >
      <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
        <path d="M3.5 15v-3.6c0-3 1.3-5.3 4-6.6l.8 1.3c-1.5.9-2.3 2-2.5 3.4H8.5V15zM11.5 15v-3.6c0-3 1.3-5.3 4-6.6l.8 1.3c-1.5.9-2.3 2-2.5 3.4h2.7V15z" fill="currentColor" />
      </svg>
      {named && <span>{t.talk.cite}</span>}
    </button>,
    document.body,
  );
}
