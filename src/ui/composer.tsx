// The field the owner writes in under a conversation, the same on a card and in Obeya's sheet: one
// frame with the text, the screenshot button, the microphone and Send (an arrow, as in chat apps) in
// its bottom corner, as wide as the conversation above it. The text grows with what is written, up
// to a part of the window. A message replied to stands above the text as a quote. With the cursor in
// the field, speaking dictates into it: hold its microphone, the one at the bottom, or Space.

import { type ReactNode, useContext, useEffect, useId, useRef, useState } from 'react';
import { api } from './api';
import { dropDraft, typeInto, updateDraft, useDraft, useDraftField } from './draft';
import { useFitHeight } from './fitHeight';
import { Quote } from './message';
import { type Reply, replyOn, setReply, useReply } from './reply';
import { AttachButton, ShotStrip, useShotInput } from './shots';
import { t } from './strings';
import { HoldToTalk, MicIcon, TAP_MS } from './voice';

/**
 * How long Space stays down before it is held to speak rather than typed. Typing presses it for
 * well under this, and a key pressed meanwhile (fast typing overlaps keys) makes it a typed space at once.
 */
const HOLD_MS = 250;

/**
 * What the owner writes to an agent or to Obeya; screenshots are pasted, dropped or picked, unless
 * `noImages`. `draft`: the draft it shows and keeps (`draft.ts`), which the microphone reads; without
 * one the field keeps its own. `label` names what Send does (its tooltip); `action` puts words on the button instead
 * of the arrow, for a button that starts something rather than sends. The message the words reply
 * to stands in the draft (`reply.ts`): quoted above the text, with × to take it out (Escape takes it
 * out too, before it closes the card or the sidebar), and `onSend` gets it.
 */
export function Composer({
  placeholder,
  onSend,
  label = t.send,
  action,
  allowEmpty = false,
  noImages = false,
  obeya,
  onText,
  className,
  draft,
  chip,
}: {
  draft?: string;
  placeholder: string;
  onSend: (text: string, images?: string[], replyTo?: Reply['to']) => Promise<void> | void;
  label?: string;
  action?: string;
  allowEmpty?: boolean;
  noImages?: boolean;
  /** Obeya reads what is typed: it gets ready while the owner types; a text here says so under the field. */
  obeya?: true | string;
  /** Hears the text as it is typed. */
  onText?: (text: string) => void;
  className?: string;
  /** What else the words go out with, above them beside the quote (a place in the demo video). */
  chip?: ReactNode;
}) {
  const own = useId();
  const key = draft ?? `field:${own}`;
  useEffect(() => (draft ? undefined : () => dropDraft(key)), [key]);
  const { text, dictation, note } = useDraft(key);
  const setText = (text: string) => updateDraft(key, { text });
  const [busy, setBusy] = useState(false);
  const shots = useShotInput({ draft: key, off: noImages });
  const images = shots.images;
  const field = useRef<HTMLTextAreaElement>(null);
  useDraftField(key, () => field.current, !noImages);
  // as high as the text; the stylesheet caps it, and beyond that it scrolls
  useFitHeight(field, text);
  const listen = useRef(onText);
  listen.current = onText;
  useEffect(() => listen.current?.(text), [text]);
  const reply = useReply(key);
  // replying to a message is writing to it: the field takes the focus (not for a reply kept from before)
  const quoted = useRef(reply?.quote.ev);
  useEffect(() => {
    if (reply && reply.quote.ev !== quoted.current) field.current?.focus();
    quoted.current = reply?.quote.ev;
  }, [reply?.quote.ev]);
  const talk = useContext(HoldToTalk);
  // Space pressed in the field: typed, or held to speak once it stays down (`held`)
  const space = useRef<number | 'held' | null>(null);
  const spaceDown = useRef(0);
  // While Space is down the field is read-only: the browser on the Mac hides the pointer at every key
  // pressed into a text field, so the key repeating while held made it flicker as the mouse moved.
  const spaceUp = () => {
    space.current = null;
    if (field.current) field.current.readOnly = false;
  };
  const typeSpace = () => {
    const s = space.current;
    if (s === null || s === 'held') return;
    clearTimeout(s);
    spaceUp();
    if (field.current) typeInto(field.current, ' ');
  };
  const ready = (!!text.trim() || images.length > 0 || allowEmpty) && !busy && !shots.uploading && !shots.marking.length;
  const send = async () => {
    if (!ready) return;
    setBusy(true);
    await onSend(text.trim(), images.length ? images : undefined, reply?.to);
    setBusy(false);
    setText('');
    shots.clear();
    // a reply chosen meanwhile stays for the next words
    if (reply && replyOn(key) === reply) setReply(key, null);
  };
  return (
    <div className={['composer', className, shots.dropping && 'dropping', dictation && 'dictating'].filter(Boolean).join(' ')} {...shots.drop}>
      <ShotStrip shots={shots} />
      <div className="c-field">
        {reply && <Quote q={reply.quote} onClear={() => setReply(key, null)} />}
        {chip}
        <textarea
          ref={field}
          value={text}
          placeholder={placeholder}
          rows={1}
          onFocus={obeya ? () => api.warmVoice() : undefined}
          onChange={(e) => setText(e.target.value)}
          onPaste={shots.onPaste}
          onBlur={() => {
            if (typeof space.current === 'number') clearTimeout(space.current);
            spaceUp();
          }}
          onKeyUp={(e) => {
            if (e.code !== 'Space') return;
            // a held Space ends the recording wherever it is let go (App); too short for one, it was typed
            if (space.current !== 'held') return typeSpace();
            spaceUp();
            if (e.timeStamp - spaceDown.current < HOLD_MS + TAP_MS && field.current) typeInto(field.current, ' ');
          }}
          onKeyDown={(e) => {
            if (talk && e.code === 'Space' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.nativeEvent.isComposing) {
              // the key repeating while held types nothing
              if (space.current !== null) return e.preventDefault();
              if (!e.repeat) {
                e.preventDefault();
                e.currentTarget.readOnly = true;
                spaceDown.current = e.timeStamp;
                space.current = window.setTimeout(() => {
                  space.current = 'held';
                  talk();
                }, HOLD_MS);
              }
              return;
            }
            // another key while Space is down: Space was typed, before it
            typeSpace();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="c-tools">
          <AttachButton shots={shots} />
          {talk && (
            <button
              className={dictation === 'listening' ? 'c-mic on' : 'c-mic'}
              title={t.voice.dictate}
              aria-label={t.voice.dictate}
              onPointerDown={(e) => {
                // the cursor stays in the field, or goes there: what is said is written into it
                e.preventDefault();
                field.current?.focus();
                talk();
              }}
            >
              <MicIcon size={18} />
            </button>
          )}
          {action ? (
            <button className="btn primary c-send" disabled={!ready} onClick={send}>
              {action}
            </button>
          ) : (
            <button className="btn primary c-send c-arrow" title={label} aria-label={label} disabled={!ready} onClick={send}>
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                <path d="M10 16V4M4.5 9.5 10 4l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {shots.error && <p className="p-error c-error">{shots.error}</p>}
      {dictation === 'listening' ? (
        <div className="c-listener c-dictation">
          → <b>{t.voice.intoField}</b> · {t.voice.sendWithEnter}
        </div>
      ) : dictation === 'writing' ? (
        <div className="c-listener c-dictation">{t.voice.writing}</div>
      ) : note ? (
        <div className="c-listener c-note">{note}</div>
      ) : (
        typeof obeya === 'string' && <div className="c-listener">→ {obeya}</div>
      )}
    </div>
  );
}
