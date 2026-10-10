// One message of a conversation, as cards and the Koordinator's sheet show it alike: who said it
// and when above, the text below as paragraphs and lists; a reply quotes the message it answers
// above its words, as chat apps do.

import type { ReactNode } from 'react';
import type { CardEvent } from '../core/types';
import { blocks, Inline, ListTree, plain, Table } from './markdown';
import { clock as time, t } from './strings';
import { parseQuestion } from './talk';

/**
 * A message's frame: `by` places and colours it (the owner's on the right), `who` heads it with its
 * time; `className` adds what kind it is (a question, the agent at work, the starting point).
 * `ev`: the log entry it shows, which a quote of it leads to; `onReply`: the owner can reply to it.
 */
export function Msg({ by, who, at, className, ev, onReply, children }: { by: string; who: ReactNode; at?: string; className?: string; ev?: number; onReply?: () => void; children?: ReactNode }) {
  return (
    <div className={['msg', `by-${by}`, className].filter(Boolean).join(' ')} data-ev={ev}>
      <div className="who">
        {who}
        {at && <span className="t">{time(at)}</span>}
      </div>
      {onReply && (
        <button className="msg-reply" title={t.talk.reply} aria-label={t.talk.reply} onMouseDown={(e) => e.preventDefault()} onClick={onReply}>
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
            <path d="M8 5 3 10l5 5M3.5 10H11a6 6 0 0 1 6 6v.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {children}
    </div>
  );
}

/** Who said a message, as a quote of it names them: the owner also for an answer given in their name. */
const quotedBy = (e: CardEvent) => (e.author === 'owner' || e.kind === 'answer' ? 'owner' : e.author);

/**
 * The message a reply answers, quoted above it or above the field the reply is written in: who said
 * it and its start, a few lines at most. A click on it goes to the message in the conversation
 * (`ev` in `Msg`); `onClear` takes it out of the field.
 */
export function Quote({ e, onClear }: { e: CardEvent; onClear?: () => void }) {
  const text = plain(e.kind === 'question' ? parseQuestion(e.text).text : e.text).replace(/\s+/g, ' ').trim();
  const go = () => {
    const el = document.querySelector<HTMLElement>(`.talk [data-ev="${e.id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // the message lights up once, so the eye finds it
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  };
  return (
    <div className={`quote q-by-${quotedBy(e)}`}>
      <button className="quote-go" title={t.talk.toQuoted} onMouseDown={(m) => m.preventDefault()} onClick={go}>
        <span className="quote-who">
          {t.author[quotedBy(e)]}
          {e.kind === 'question' ? ` · ${t.talk.question}` : e.kind === 'review' ? ` · ${t.talk.handover}` : ''}
        </span>
        <span className="quote-text">{text || '📷'}</span>
      </button>
      {onClear && (
        <button className="quote-clear" title={t.talk.replyCancel} aria-label={t.talk.replyCancel} onMouseDown={(m) => m.preventDefault()} onClick={onClear}>
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Text from a plan doc or an agent, as markdown: each line a paragraph, lists (list items as a
 * checklist), tables, code, quotes, and headings as bold lines.
 */
export function Body({ md }: { md: string }) {
  return (
    <>
      {blocks(md, { breaks: true }).map((b, i) => {
        switch (b.t) {
          case 'p':
            return (
              <p key={i} className="p-lead">
                <Inline md={b.text} />
              </p>
            );
          case 'h':
            return (
              <p key={i} className="p-lead">
                <b>
                  <Inline md={b.text} />
                </b>
              </p>
            );
          case 'list':
            return <ListTree key={i} list={b.list} className="p-list" />;
          case 'table':
            return (
              <div key={i} className="p-table">
                <Table head={b.head} rows={b.rows} />
              </div>
            );
          case 'code':
            return (
              <pre key={i} className="p-code">
                {b.text}
              </pre>
            );
          case 'quote':
            return (
              <blockquote key={i} className="p-quote">
                <Inline md={b.text} />
              </blockquote>
            );
          case 'hr':
            return <hr key={i} className="p-hr" />;
        }
      })}
    </>
  );
}
