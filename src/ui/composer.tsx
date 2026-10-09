// The field the owner writes in under a conversation, the same on a card and in Obeya's sheet: one
// frame with the text, the screenshot button and Send (an arrow, as in chat apps) in its bottom
// corner, as wide as the conversation above it. The text grows with what is written, up to a part
// of the window.

import { useRef, useState } from 'react';
import { api } from './api';
import { useFitHeight } from './fitHeight';
import { AttachButton, ShotStrip, useShotInput } from './shots';
import { t } from './strings';

/**
 * What the owner writes to an agent or to Obeya; screenshots are pasted, dropped or picked, unless
 * `noImages`. `label` names what Send does (its tooltip); `action` puts words on the button instead
 * of the arrow, for a button that starts something rather than sends.
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
}: {
  placeholder: string;
  onSend: (text: string, images?: string[]) => Promise<void> | void;
  label?: string;
  action?: string;
  allowEmpty?: boolean;
  noImages?: boolean;
  /** Obeya reads what is typed: it gets ready while the owner types; a text here says so under the field. */
  obeya?: true | string;
  /** Hears the text as it is typed. */
  onText?: (text: string) => void;
  className?: string;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const shots = useShotInput({ off: noImages });
  const images = shots.images;
  const field = useRef<HTMLTextAreaElement>(null);
  // as high as the text; the stylesheet caps it, and beyond that it scrolls
  useFitHeight(field, text);
  const ready = (!!text.trim() || images.length > 0 || allowEmpty) && !busy && !shots.uploading;
  const send = async () => {
    if (!ready) return;
    setBusy(true);
    await onSend(text.trim(), images.length ? images : undefined);
    setBusy(false);
    setText('');
    onText?.('');
    shots.clear();
  };
  return (
    <div className={['composer', className, shots.dropping && 'dropping'].filter(Boolean).join(' ')} {...shots.drop}>
      <ShotStrip shots={shots} />
      <div className="c-field">
        <textarea
          ref={field}
          value={text}
          placeholder={placeholder}
          rows={1}
          onFocus={obeya ? () => api.warmVoice() : undefined}
          onChange={(e) => {
            setText(e.target.value);
            onText?.(e.target.value);
          }}
          onPaste={shots.onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="c-tools">
          <AttachButton shots={shots} />
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
      {typeof obeya === 'string' && <div className="c-listener">→ {obeya}</div>}
    </div>
  );
}
