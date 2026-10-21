// What a card changed in a folder without git: the line in place of its branch, the list beside its
// handover, and „Änderungen verwerfen“, with a moment to take that back before it happens.

import { useEffect, useState } from 'react';
import { type CardDiff, diffSize, type FolderChange } from '../core/diff';
import { shownFiles } from '../core/files';
import type { CardAction, Item } from '../core/types';
import { api } from './api';
import { useCopy } from './copy';
import type { ActDone } from './detail';
import { DiffView, Lines } from './diff';
import { t } from './strings';

/** How often an open card at work reads its change list again: its agent changes the folder as it goes. */
const LOOK_MS = 5000;
/** How long „Änderungen verwerfen“ waits for a second click that calls it off before it goes ahead: putting the files back cannot be taken back. */
const DISCARD_WAIT_S = 8;

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

/**
 * The changes as a table: what happened to which path, the lines of a text file in columns of their
 * own (never broken), and what discarding would leave. A path `diffed` names opens its diff with
 * `onFile` on a click on it, and with `lines` on a click on its lines too; where `onTab` opens the
 * tabs of the files beside it, a click on a path `tabbed` names opens its tab instead.
 */
export function ChangeTable({
  changes,
  diffed,
  onFile,
  lines,
  tabbed,
  onTab,
}: {
  changes: FolderChange[];
  diffed: (c: FolderChange) => boolean;
  onFile: (path: string) => void;
  lines?: boolean;
  tabbed?: (c: FolderChange) => boolean;
  onTab?: (path: string) => void;
}) {
  return (
    <table className="f-list">
      <tbody>
        {changes.map((c) => {
          const diff = diffed(c) ? () => onFile(c.path) : undefined;
          const tab = onTab && tabbed?.(c) ? () => onTab(c.path) : undefined;
          return (
            <ChangeRow
              key={`${c.kind}:${c.from ?? ''}:${c.path}`}
              c={c}
              onName={onTab ? tab : diff}
              nameTitle={onTab ? t.files.showTab : t.diff.showFile}
              onLines={lines ? diff : undefined}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function ChangeRow({ c, onName, nameTitle, onLines }: { c: FolderChange; onName?: () => void; nameTitle: string; onLines?: () => void }) {
  const name = (p: string) => (c.dir ? `${p}/` : p);
  const path = c.kind === 'moved' ? `${name(c.from!)} → ${name(c.path)}` : name(c.path);
  const lines = c.added !== undefined && (c.added > 0 || c.removed! > 0);
  // the lines added and removed are one link in two columns
  const count = (text: string) =>
    onLines ? (
      <button className="link f-lines" title={t.diff.showFile} onClick={onLines}>
        {text}
      </button>
    ) : (
      text
    );
  return (
    <tr>
      <td className="f-mark" aria-label={c.kind}>
        {MARK[c.kind]}
      </td>
      <td className="f-path">
        {onName ? (
          <button className="link" title={nameTitle} onClick={onName}>
            {path}
          </button>
        ) : (
          path
        )}
        {c.changed && <span className="hint"> {t.folder.alsoChanged}</span>}
        {c.undo && c.undo !== 'yes' && (
          <span className="f-left" title={c.undo === 'lost' ? t.folder.lostHint : c.undo === 'shared' ? t.folder.sharedHint : t.folder.changedSinceHint}>
            {' '}
            · {t.folder.state[c.undo]}
          </span>
        )}
      </td>
      <td className="d-add">{lines && count(`+${c.added}`)}</td>
      <td className="d-del">{lines && count(`−${c.removed}`)}</td>
    </tr>
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

/**
 * What the card changed in the folder, beside its handover: each change as a line, the undo it has,
 * the whole list with the text diffs, and on a click on a file its tab in the left column (`onTab`,
 * where the column shows), on a click on its lines its diff.
 */
export function FolderBox({ item, diff, onTab }: { item: Item; diff: CardDiff | null; onTab?: (path: string) => void }) {
  // the whole list (`true`) or one file's diff
  const [open, setOpen] = useState<string | boolean>(false);
  const changes = shownChanges(diff?.folder?.changes ?? []);
  if (!changes.length) return null;
  const files = shownFiles(diff, item.files);
  return (
    <div className="f-box">
      <b>{t.folder.changed}</b>
      {/* all of them, a long list scrolling in a few lines' height of its own */}
      <div className="f-scroll">
        <ChangeTable
          changes={changes}
          diffed={(c) => !!(c.added || c.removed)}
          onFile={setOpen}
          lines
          tabbed={(c) => files.some((f) => f.path === c.path)}
          onTab={onTab}
        />
      </div>
      <p className="hint">
        <button className="link" onClick={() => setOpen(true)}>
          {t.folder.show}
        </button>
      </p>
      {open && <DiffView item={item} file={typeof open === 'string' ? open : undefined} onClose={() => setOpen(false)} onRead={() => {}} />}
    </div>
  );
}

/**
 * „Änderungen verwerfen“ on a card waiting for approval: puts back what it changed in the folder.
 * That cannot be taken back once done, so the button first counts down, and a second click on it (or its ×) calls it off.
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
  // the button stays itself while it counts down: a second click on it, or its ×, calls it off
  const counting = left !== null;
  return (
    <>
      <button
        className={counting ? 'btn f-discard counting' : 'btn f-discard'}
        title={counting ? t.folder.cancelHint : t.folder.discardHint(undoable)}
        onClick={() => setLeft(counting ? null : DISCARD_WAIT_S)}
      >
        {t.folder.discard}
        {counting && (
          <>
            <span className="f-count">{t.folder.seconds(left)}</span>
            <span className="f-cancel" aria-label={t.folder.cancel}>
              ×
            </span>
          </>
        )}
      </button>
      {counting && <span className="f-discarding">{t.folder.clickToCancel}</span>}
    </>
  );
}
