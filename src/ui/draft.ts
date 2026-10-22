// What the owner is about to say or write, one draft per field: the text, the screenshots, the
// options picked for the questions above it and (in `reply.ts`) the message it replies to. The field of the open card and the one in Obeya's sidebar
// keep theirs here rather than in the field itself, so the microphone sends what stands in the field
// and dictates into it, and a draft outlives closing the card. Without a field to speak to, the
// screenshots for the next recording lie beside the microphone, in a draft of their own (`MIC`).
// These drafts (text, screenshots, picks, the message replied to) are written down per tab and canvas (`keepDrafts`), so they outlive a page load too:
// switching to another canvas and back, or a restart. So are the marks on screenshots (`Markup`).

import { useEffect, useSyncExternalStore } from 'react';
import type { Mark } from './marks';
import type { Reply } from './reply';

export interface Draft {
  text: string;
  images: string[];
  /** Screenshots still uploading. */
  uploading: number;
  /** The screenshots whose marked version is still uploading, to take their place. */
  marking: string[];
  error: string;
  /** A recording dictated into the field: while the owner speaks, then while Whisper writes it down. */
  dictation: '' | 'listening' | 'writing';
  /** What the field says about the last dictation: nothing was heard, say. */
  note: string;
  /** The options picked for each of the questions above the field, and which questions they are (`questionsKey`). */
  picks?: Picks;
  /** The message the words reply to (`reply.ts`). */
  reply?: Reply;
}

export interface Picks {
  of: string;
  picks: string[][];
}

/** Which questions picks belong to: they count only while the same questions stand. */
export const questionsKey = (questions: unknown[]) => JSON.stringify(questions);

type Kept = Pick<Draft, 'text' | 'images' | 'picks' | 'reply'>;
const keptOf = ({ text, images, picks, reply }: Draft): Kept | null => {
  const picked = picks?.picks.some((p) => p.length) ? picks : undefined;
  return text.trim() || images.length || picked || reply ? { text, images, ...(picked ? { picks: picked } : {}), ...(reply ? { reply } : {}) } : null;
};

const EMPTY: Draft = { text: '', images: [], uploading: 0, error: '', dictation: '', note: '', marking: [] };

/** The draft of a card's field. */
export const cardDraft = (id: string) => `card:${id}`;
/** The draft of the field in Obeya's sidebar. */
export const OBEYA_DRAFT = 'obeya';
/** The draft of the field under Obeya's conversation of a canvas, in the phone view, which shows every canvas. */
export const obeyaDraft = (canvas: string) => `${OBEYA_DRAFT}:${canvas}`;
/** The screenshots beside the microphone, where no field is spoken to. */
export const MIC_DRAFT = 'mic';
/** The field of the draft for Obeya's makers (`wish.tsx`). */
export const WISH_DRAFT = 'wish';

const drafts = new Map<string, Draft>();
/** The text field of each draft on the page. */
const fields = new Map<string, HTMLTextAreaElement>();
/** The fields that take no screenshots. */
const noImages = new Set<string>();
/** Where the cursor stood when a dictation started, for when the field has lost it by the time the words come. */
const carets = new Map<string, [number, number]>();
/** Where the cursor stood when the field on the page last lost it, for a quote put in from the conversation (`cite`). */
const left = new Map<string, number>();
const listeners = new Set<() => void>();
const changed = () => {
  for (const fn of listeners) fn();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** The drafts that last beyond their field: the cards', the sidebar's (the phone view's per canvas) and the microphone's, not those of a field of its own. */
const lasting = (key: string) => key.startsWith('card:') || key === OBEYA_DRAFT || key.startsWith(`${OBEYA_DRAFT}:`) || key === MIC_DRAFT || key === WISH_DRAFT;
const storeKey = (canvas: string) => `obeya-drafts-${canvas}`;
const markupsKey = (canvas: string) => `obeya-markups-${canvas}`;
let kept: { store: Store; canvas: string } | null = null;

/**
 * A screenshot the owner marked in a field: the original and the marks on it, by the id of the
 * marked image that the field holds in its place. Reopened, the original shows with its marks
 * still apart, to undo them; the agent gets the marked image.
 */
export interface Markup {
  original: string;
  marks: Mark[];
}
/** The latest markups, any field's (a planned card's task too): the newest last. */
const markups = new Map<string, Markup>();
/** How many markups are kept: the newest, more than the fields open at a time hold. */
const KEPT_MARKUPS = 100;

export const markupOf = (id: string): Markup | undefined => markups.get(id);

/** Keeps the marks of the marked image `id`, or forgets them (`null`). */
export function setMarkup(id: string, markup: Markup | null) {
  markups.delete(id);
  if (markup) markups.set(id, markup);
  for (const old of markups.keys()) if (markups.size > KEPT_MARKUPS) markups.delete(old);
  if (!kept) return;
  try {
    if (markups.size) kept.store.setItem(markupsKey(kept.canvas), JSON.stringify(Object.fromEntries(markups)));
    else kept.store.removeItem(markupsKey(kept.canvas));
  } catch {}
}

/**
 * Takes back the canvas's drafts that `store` kept (the phone view's, which shows every canvas, under
 * a name of its own) and writes them down there from now on, text,
 * screenshots, picks and the message replied to, whenever they change, and the marks on the screenshots. Once per page;
 * later calls change nothing.
 */
export function keepDrafts(store: Store, canvas: string) {
  if (kept) return;
  kept = { store, canvas };
  try {
    const saved = JSON.parse(store.getItem(storeKey(canvas)) ?? '{}') as Record<string, Kept>;
    for (const [key, { text, images, picks, reply }] of Object.entries(saved))
      if (!drafts.has(key)) drafts.set(key, { ...EMPTY, text, images, ...(picks ? { picks } : {}), ...(reply ? { reply } : {}) });
  } catch {}
  try {
    const saved = JSON.parse(store.getItem(markupsKey(canvas)) ?? '{}') as Record<string, Markup>;
    for (const [id, m] of Object.entries(saved)) if (!markups.has(id)) markups.set(id, m);
  } catch {}
  listeners.add(writeDown);
}

function writeDown() {
  if (!kept) return;
  const out: Record<string, Kept> = {};
  for (const [key, d] of drafts) {
    const k = lasting(key) && keptOf(d);
    if (k) out[key] = k;
  }
  try {
    if (Object.keys(out).length) kept.store.setItem(storeKey(kept.canvas), JSON.stringify(out));
    else kept.store.removeItem(storeKey(kept.canvas));
  } catch {}
}

export const draftOf = (key: string): Draft => drafts.get(key) ?? EMPTY;

export function updateDraft(key: string, change: Partial<Draft> | ((d: Draft) => Partial<Draft>)) {
  const d = draftOf(key);
  drafts.set(key, { ...d, ...(typeof change === 'function' ? change(d) : change) });
  changed();
}

/**
 * Words the owner took back before anyone read them go back into the draft, with their
 * screenshots, when it is empty; else they are gone, as the newer words in it count.
 */
export function giveBack(key: string, text: string, images: string[] = []) {
  const d = draftOf(key);
  if (d.text.trim() || d.images.length || d.uploading) return;
  updateDraft(key, { text, images });
}

/** Whether the draft's field speaks to Obeya, as the microphone does without one: the sidebar's, the phone view's under Obeya's conversation. */
export const toObeya = (key: string) => key === OBEYA_DRAFT || key.startsWith(`${OBEYA_DRAFT}:`);

/** The screenshots of draft `from` go into draft `to`, after those it has. */
export function moveImages(from: string, to: string) {
  const { images } = draftOf(from);
  if (!images.length || from === to) return;
  updateDraft(to, (d) => ({ images: [...d.images, ...images.filter((id) => !d.images.includes(id))] }));
  updateDraft(from, { images: [] });
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
    const blur = () => left.set(key, f.selectionEnd);
    f.addEventListener('blur', blur);
    return () => {
      f.removeEventListener('blur', blur);
      if (fields.get(key) !== f) return;
      // a field shown afresh has no cursor yet: a quote goes at its end
      left.delete(key);
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

/**
 * Where a quote goes into `text` with the cursor at `caret`, and what goes in: at the end, on a line
 * of its own (after a line break unless the cursor stands at a line's start); from the middle of the
 * text, as the line after the cursor's.
 */
export function citeAt(text: string, caret: number, quote: string): { at: number; piece: string } {
  if (caret >= text.length) return { at: text.length, piece: `${text && !text.endsWith('\n') ? '\n' : ''}${quote}` };
  const end = text.indexOf('\n', caret);
  return { at: end < 0 ? text.length : end, piece: `\n${quote}` };
}

/**
 * Puts a quote into the draft (`citeAt`, from where the cursor stood when it left the field, or at the
 * end if it never was there) and the cursor behind it, in the field, to type on at once. Typed in as
 * by hand, so ⌘Z takes it back.
 */
export function cite(key: string, quote: string) {
  const el = fields.get(key);
  const text = el?.value ?? draftOf(key).text;
  const caret = el && el === document.activeElement ? el.selectionEnd : (left.get(key) ?? text.length);
  const { at, piece } = citeAt(text, caret, quote);
  if (!el) return updateDraft(key, { text: text.slice(0, at) + piece + text.slice(at) });
  el.focus();
  el.setSelectionRange(at, at);
  typeInto(el, piece);
}

/** Types `s` into the focused field at its cursor, as a keystroke would: React hears it, ⌘Z takes it back. */
export function typeInto(el: HTMLTextAreaElement, s: string) {
  if (document.execCommand('insertText', false, s)) return;
  // a browser without it: set the text the way React notices
  el.setRangeText(s, el.selectionStart, el.selectionEnd, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
