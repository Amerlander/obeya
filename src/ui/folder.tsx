// What a card changed in a folder without git: the line in place of its branch, the list beside its
// handover, and „Änderungen verwerfen“, with a moment to take that back before it happens.

import { useEffect, useState } from 'react';
import { type CardDiff, diffSize, type FolderChange } from '../core/diff';
import type { CardAction, Item } from '../core/types';
import { api } from './api';
import { useCopy } from './copy';
import type { ActDone } from './detail';
import { DiffView, Lines } from './diff';
import { t } from './strings';

/** How often an open card at work reads its change list again: its agent changes the folder as it goes. */
const LOOK_MS = 5000;
/** How long „Änderungen verwerfen“ waits for „Rückgängig“ before it goes ahead: putting the files back cannot be taken back. */
const DISCARD_WAIT_S = 8;
/** How many changes the list beside the handover shows before „und N weitere“. */
const SHOWN = 8;

/** The card's change list in its folder, read again as the card moves on, while its agent works, and on `reload`. */
export function useFolderDiff(item: Item, on: boolean): { diff: CardDiff | null; reload: () => void } {
  const [diff, setDiff] = useState<CardDiff | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (!on) return;
    let gone = false;
    const look = () => api.diff(item.id).then((d) => !gone && setDiff(d), () => {});
    void look();
    const timer = item.state === 'working' ? setInterval(look, LOOK_MS) : undefined;
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, [on, item.id, item.state, item.need, item.statusLine, item.summary, item.noChange, asked]);
  return { diff, reload: () => setAsked((n) => n + 1) };
}

const MARK: Record<FolderChange['kind'], string> = { moved: '↪', added: '＋', modified: '✎', deleted: '✕' };

/** The changes as the owner reads them: a directory the card added shows through what it put in it, a deleted one stands for what it held. */
export function shownChanges(changes: FolderChange[]): FolderChange[] {
  const gone = changes.filter((c) => c.dir && c.kind === 'deleted').map((c) => c.path);
  return changes.filter((c) => {
    if (gone.some((d) => c.path.startsWith(`${d}/`))) return false;
    if (c.dir && c.kind === 'added') return !changes.some((x) => x !== c && x.path.startsWith(`${c.path}/`));
    return true;
  });
}

/** One change: what happened to which path, the lines of a text file, and what discarding would leave. */
export function ChangeLine({ c }: { c: FolderChange }) {
  const name = (p: string) => (c.dir ? `${p}/` : p);
  return (
    <>
      <span className="f-mark" aria-label={c.kind}>
        {MARK[c.kind]}
      </span>{' '}
      <span className="f-path">{c.kind === 'moved' ? `${name(c.from!)} → ${name(c.path)}` : name(c.path)}</span>
      {c.changed && <span className="hint"> {t.folder.alsoChanged}</span>}
      {c.added !== undefined && (c.added > 0 || c.removed! > 0) && (
        <>
          {' '}
          <Lines n={{ added: c.added, removed: c.removed! }} />
        </>
      )}
      {c.undo && c.undo !== 'yes' && (
        <span className="f-left" title={c.undo === 'lost' ? t.folder.lostHint : c.undo === 'shared' ? t.folder.sharedHint : t.folder.changedSinceHint}>
          {' '}
          · {t.folder.state[c.undo]}
        </span>
      )}
    </>
  );
}

/** Which undo the card has, with what it means on hover. */
function UndoKind({ undo }: { undo: 'full' | 'partial' }) {
  return (
    <span className={`f-undo ${undo}`} title={t.folder.undoHint[undo]}>
      {t.folder.undo[undo]}
    </span>
  );
}

/** The card's line in place of a branch: how much it changed in the folder, its undo, the folder's path to copy. */
export function FolderLine({ item, diff }: { item: Item; diff: CardDiff | null }) {
  const [open, setOpen] = useState(false);
  const [copied, copy] = useCopy(3000);
  const changes = diff?.folder?.changes ?? [];
  const size = diff && diffSize(diff.files);
  return (
    <>
      {t.folder.changed}
      {diff && (
        <>
          {': '}
          {changes.length ? (
            <button className="link diff-size" title={t.diff.show} onClick={() => setOpen(true)}>
              {t.folder.files(shownChanges(changes).length)}
              {size && (size.added || size.removed) ? (
                <>
                  {' '}
                  <Lines n={size} />
                </>
              ) : null}
            </button>
          ) : (
            t.folder.none
          )}
          {diff.folder?.undo && (
            <>
              {' · '}
              <UndoKind undo={diff.folder.undo} />
            </>
          )}
        </>
      )}
      {item.workspace && (
        <>
          {' · '}
          <button className={copied ? 'link copied' : 'link'} title={item.workspace} onClick={() => copy(item.workspace!)}>
            {copied ? t.diff.copied : t.diff.copyPath}
          </button>
        </>
      )}
      {open && <DiffView item={item} onClose={() => setOpen(false)} onRead={() => {}} />}
    </>
  );
}

/** What the card changed in the folder, beside its handover: each change as a line, the undo it has, and the whole list with the text diffs. */
export function FolderBox({ item, diff }: { item: Item; diff: CardDiff | null }) {
  const [open, setOpen] = useState(false);
  const changes = shownChanges(diff?.folder?.changes ?? []);
  if (!changes.length) return null;
  return (
    <div className="f-box">
      <b>{t.folder.changed}</b>
      <ul className="f-list">
        {changes.slice(0, SHOWN).map((c) => (
          <li key={`${c.kind}:${c.from ?? ''}:${c.path}`}>
            <ChangeLine c={c} />
          </li>
        ))}
      </ul>
      <p className="hint">
        {changes.length > SHOWN && `${t.folder.more(changes.length - SHOWN)} · `}
        <button className="link" onClick={() => setOpen(true)}>
          {t.folder.show}
        </button>
      </p>
      {open && <DiffView item={item} onClose={() => setOpen(false)} onRead={() => {}} />}
    </div>
  );
}

/**
 * „Änderungen verwerfen“ on a card waiting for approval: puts back what it changed in the folder.
 * That cannot be taken back once done, so the button first counts down, with „Rückgängig“ beside it.
 */
export function DiscardChanges({ diff, act, onDone }: { diff: CardDiff | null; act: (a: CardAction, done: ActDone) => Promise<void>; onDone: () => void }) {
  const [left, setLeft] = useState<number | null>(null);
  const undoable = (diff?.folder?.changes ?? []).filter((c) => c.undo === 'yes').length;
  useEffect(() => {
    if (left === null) return;
    if (left === 0) {
      setLeft(null);
      void act({ action: 'undo' }, { close: false }).then(onDone);
      return;
    }
    const h = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(h);
  }, [left]);
  if (!undoable && left === null) return null;
  return left === null ? (
    <button className="btn" title={t.folder.discardHint(undoable)} onClick={() => setLeft(DISCARD_WAIT_S)}>
      {t.folder.discard}
    </button>
  ) : (
    <>
      <button className="btn" title={t.folder.takeBackHint} onClick={() => setLeft(null)}>
        {t.undo}
      </button>
      <span className="f-discarding">{t.folder.discarding(left)}</span>
    </>
  );
}
