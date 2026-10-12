// A card's branch, with the size of its change beside it: a click shows the whole diff over the
// page. Where the branch is checked out is copied with another click. Both stay quiet: the owner
// rarely reads the code.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { type CardDiff, type DiffPart, diffSize, splitDiff } from '../core/diff';
import type { Item } from '../core/types';
import { api } from './api';
import { plain } from './markdown';
import { t } from './strings';

/** A file with more lines than this starts folded, so a generated file does not bury the rest. */
const FOLD_LINES = 1500;

/** The branch line of a card: its name, the size of its change, and its directory to copy. */
export function Branch({ item }: { item: Item }) {
  const [diff, setDiff] = useState<CardDiff | null>(null);
  const [open, setOpen] = useState(false);
  // read again when the work moves on; the line keeps the last size meanwhile
  useEffect(() => {
    let gone = false;
    api.diff(item.id).then((d) => !gone && setDiff(d), () => {});
    return () => {
      gone = true;
    };
  }, [item.id, item.state, item.need, item.statusLine, item.workspace, item.summary]);
  const size = diff && diffSize(diff.files);
  return (
    <>
      {t.branch} <code>{item.branch}</code>
      {diff && size && (
        <>
          {' · '}
          {diff.files.length ? (
            <button className="link diff-size" title={t.diff.show} onClick={() => setOpen(true)}>
              <span className="d-add">+{size.added}</span> <span className="d-del">−{size.removed}</span> {t.diff.size(diff.files.length)}
            </button>
          ) : (
            t.diff.none
          )}
        </>
      )}
      {item.workspace && (
        <>
          {' · '}
          <CopyPath path={item.workspace} />
        </>
      )}
      {open && <DiffView item={item} onClose={() => setOpen(false)} onRead={setDiff} />}
    </>
  );
}

function CopyPath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard.writeText(path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, console.error);
  return (
    <button className="link" title={path} onClick={copy}>
      {copied ? t.diff.copied : t.diff.copyPath}
    </button>
  );
}

/** The whole diff over the page, file by file; Esc, the × or a click beside it closes it. */
function DiffView({ item, onClose, onRead }: { item: Item; onClose: () => void; onRead: (d: CardDiff) => void }) {
  const [diff, setDiff] = useState<CardDiff | null | 'failed'>(null);
  useEffect(() => {
    let gone = false;
    api.diff(item.id, true).then(
      (d) => {
        if (gone) return;
        setDiff(d ?? 'failed');
        if (d) onRead(d);
      },
      () => !gone && setDiff('failed'),
    );
    return () => {
      gone = true;
    };
  }, [item.id]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [onClose]);
  const parts = diff && diff !== 'failed' ? splitDiff(diff.patch ?? '') : [];
  const size = diff && diff !== 'failed' ? diffSize(diff.files) : null;
  const go = (file: string) => document.getElementById(anchor(file))?.scrollIntoView({ block: 'start' });
  return createPortal(
    <div className="diff-view" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="d-sheet">
        <div className="d-head">
          <h2>{t.diff.title(plain(item.title))}</h2>
          <span className="hint">
            <code>{item.branch}</code>
            {diff && diff !== 'failed' && diff.source === 'landed' && ` · ${t.diff.landed}`}
            {size && (
              <>
                {' · '}
                <span className="d-add">+{size.added}</span> <span className="d-del">−{size.removed}</span>
              </>
            )}
          </span>
          <button className="d-close" title={t.diff.close} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="d-body">
          {diff === null && <p className="hint">{t.diff.loading}</p>}
          {diff === 'failed' && <p className="hint">{t.diff.failed}</p>}
          {diff && diff !== 'failed' && (
            <>
              <table className="d-files">
                <tbody>
                  {diff.files.map((f) => (
                    <tr key={f.file}>
                      <td>
                        <button className="link" onClick={() => go(f.file)}>
                          {f.file}
                        </button>{' '}
                        <span className="hint">{t.diff.status[f.status]}</span>
                      </td>
                      <td className="d-add">{f.binary ? '' : `+${f.added}`}</td>
                      <td className="d-del">{f.binary ? '' : `−${f.removed}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parts.map((p) => (
                <FileDiff key={p.file} part={p} />
              ))}
              {diff.truncated && <p className="hint d-cut">{t.diff.truncated}</p>}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const anchor = (file: string) => `diff-${file}`;

function FileDiff({ part }: { part: DiffPart }) {
  const lines = numbered(part.lines);
  const [folded, setFolded] = useState(lines.length > FOLD_LINES);
  return (
    <section className="d-file" id={anchor(part.file)}>
      <h3>
        <span className="d-name">{part.file}</span>
        {part.from && <span className="hint">{t.diff.renamedFrom(part.from)}</span>}
        <span className="hint">{t.diff.status[part.status]}</span>
        {!part.binary && (
          <span>
            <span className="d-add">+{part.added}</span> <span className="d-del">−{part.removed}</span>
          </span>
        )}
      </h3>
      {part.binary ? (
        <p className="hint">{t.diff.binary}</p>
      ) : folded ? (
        <p className="hint">
          {t.diff.big(lines.length)}{' '}
          <button className="link" onClick={() => setFolded(false)}>
            {t.diff.unfold}
          </button>
        </p>
      ) : (
        <pre className="d-lines">
          {lines.map((l, i) => (
            <div key={i} className={`d-${l.kind}`}>
              <span className="d-no">{l.old ?? ''}</span>
              <span className="d-no">{l.new ?? ''}</span>
              <span className="d-text">{l.text}</span>
            </div>
          ))}
        </pre>
      )}
    </section>
  );
}

interface Line {
  kind: 'hunk' | 'add' | 'del' | 'ctx' | 'note';
  text: string;
  old?: number;
  new?: number;
}

/** A file's hunks with the line numbers before and after; its header lines (names, modes, index) are left out. */
export function numbered(lines: string[]): Line[] {
  const out: Line[] = [];
  let old = 0;
  let now = 0;
  let inHunks = false;
  for (const text of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      [old, now, inHunks] = [Number(hunk[1]), Number(hunk[2]), true];
      out.push({ kind: 'hunk', text });
    } else if (!inHunks) continue;
    else if (text.startsWith('+')) out.push({ kind: 'add', text, new: now++ });
    else if (text.startsWith('-')) out.push({ kind: 'del', text, old: old++ });
    else if (text.startsWith('\\')) out.push({ kind: 'note', text });
    // an empty line of the file is a space; an empty string is what `split` leaves after a last newline
    else if (text) out.push({ kind: 'ctx', text, old: old++, new: now++ });
  }
  return out;
}
