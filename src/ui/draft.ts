// What the owner is about to say or write, one draft per field: the text, the screenshots and (in
// `reply.ts`) the message it replies to. The field of the open card and the one in Obeya's sidebar
// keep theirs here rather than in the field itself, so the microphone sends what stands in the field
// and dictates into it, and a draft outlives closing the card. Without a field to speak to, the
// screenshots for the next recording lie beside the microphone, in a draft of their own (`MIC`).

import { useEffect, useSyncExternalStore } from 'react';

export interface Draft {
  text: string;
  images: string[];
  /** Screenshots still uploading. */
  uploading: number;
  error: string;
  /** A recording dictated into the field: while the owner speaks, then while Whisper writes it down. */
  dictation: '' | 'listening' | 'writing';
  /** What the field says about the last dictation: nothing was heard, say. */
  note: string;
}

const EMPTY: Draft = { text: '', images: [], uploading: 0, error: '', dictation: '', note: '' };

/** The draft of a card's field. */
export const cardDraft = (id: string) => `card:${id}`;
/** The draft of the field in Obeya's sidebar. */
export const OBEYA_DRAFT = 'obeya';
/** The screenshots beside the microphone, where no field is spoken to. */
export const MIC_DRAFT = 'mic';

const drafts = new Map<string, Draft>();
/** The text field of each draft on the page. */
const fields = new Map<string, HTMLTextAreaElement>();
/** The fields that take no screenshots. */
const noImages = new Set<string>();
/** Where the cursor stood when a dictation started, for when the field has lost it by the time the words come. */
const carets = new Map<string, [number, number]>();
const listeners = new Set<() => void>();
const changed = () => {
  for (const fn of listeners) fn();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const draftOf = (key: string): Draft => drafts.get(key) ?? EMPTY;

export function updateDraft(key: string, change: Partial<Draft> | ((d: Draft) => Partial<Draft>)) {
  const d = draftOf(key);
  drafts.set(key, { ...d, ...(typeof change === 'function' ? change(d) : change) });
  changed();
}

/** Forgets a draft whose field is gone for good. */
export function dropDraft(key: string) {
  if (drafts.delete(key)) changed();
}

/** The draft, live. */
export const useDraft = (key: string): Draft => useSyncExternalStore(subscribe, () => draftOf(key));

/** Makes `el` the text field of the draft while it is on the page; `images`: whether it takes screenshots. */
export function useDraftField(key: string, el: () => HTMLTextAreaElement | null, images: boolean) {
  useEffect(() => {
    const f = el();
    if (!f) return;
    fields.set(key, f);
    if (!images) noImages.add(key);
    changed();
    return () => {
      if (fields.get(key) !== f) return;
      fields.delete(key);
      noImages.delete(key);
      changed();
    };
  }, [key, images]);
}

/** Whether screenshots may go into the draft: its field takes them, or it has none. */
export const takesImages = (key: string) => !noImages.has(key);

/** Whether the draft has its field on the page, live. */
export const useFieldOn = (key: string | null) => useSyncExternalStore(subscribe, () => !!key && fields.has(key));
export const fieldOn = (key: string) => fields.has(key);

/** The draft whose field has the cursor, if any. */
export function focusedDraft(): string | null {
  for (const [key, el] of fields) if (el === document.activeElement) return key;
  return null;
}

/** The draft whose field has the cursor, live. */
export const useFocusedDraft = () =>
  useSyncExternalStore((fn) => {
    const off = subscribe(fn);
    addEventListener('focusin', fn);
    addEventListener('focusout', fn);
    return () => {
      off();
      removeEventListener('focusin', fn);
      removeEventListener('focusout', fn);
    };
  }, focusedDraft);

/** A dictation into the draft begins: its field is marked, and the cursor's place kept. */
export function beginDictation(key: string) {
  const el = fields.get(key);
  if (el) carets.set(key, [el.selectionStart, el.selectionEnd]);
  updateDraft(key, { dictation: 'listening', note: '' });
}

/**
 * Words dictated into the draft, at the cursor: typed into the field as if by hand while it has the
 * focus (⌘Z takes them back), else where the cursor stood. A space parts them from the words beside them.
 */
export function dictate(key: string, words: string) {
  const el = fields.get(key);
  const text = el?.value ?? draftOf(key).text;
  const focused = !!el && el === document.activeElement;
  const [start, end] = focused ? [el.selectionStart, el.selectionEnd] : (carets.get(key) ?? [text.length, text.length]).map((n) => Math.min(n, text.length));
  carets.delete(key);
  const before = text.slice(0, start);
  const after = text.slice(end);
  const piece = `${before && !/\s$/.test(before) ? ' ' : ''}${words}${after && !/^\s/.test(after) ? ' ' : ''}`;
  if (focused) typeInto(el, piece);
  else updateDraft(key, { text: before + piece + after });
}

/** Types `s` into the focused field at its cursor, as a keystroke would: React hears it, ⌘Z takes it back. */
export function typeInto(el: HTMLTextAreaElement, s: string) {
  if (document.execCommand('insertText', false, s)) return;
  // a browser without it: set the text the way React notices
  el.setRangeText(s, el.selectionStart, el.selectionEnd, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
