// The files a card's work made or changed, as its result on the left beside the conversation: a
// tab for each above the view (the demo first), Markdown formatted, a PDF in the browser's viewer,
// an image, a page in the sandboxed frame of an HTML artifact, text as it is, anything else as a
// tile; each to open on the computer, show in its folder, or download. Folder and git cards alike.

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type CardDiff, splitDiff } from '../core/diff';
import { imageAt, type ShownFile, shownFiles } from '../core/files';
import type { Item } from '../core/types';
import { api, cardFile } from './api';
import { FileDiff } from './diff';
import { Doc, DocImages } from './markdown';
import { useReportedHeight } from './message';
import { t } from './strings';

/** How many files get a tab of their own; the others are a click on „N weitere“ away. */
const TABS = 6;
/** How much of a text file the view shows; the rest is a click on „Auf dem Rechner öffnen“ or ↓ away. */
const TEXT_CAP = 400_000;
/** The highest a page grows in its frame; a higher one scrolls inside it. */
const PAGE_CAP = 30000;

const DEMO = '';

/** The card's change, read as the work moves on; `given` where the card has read it already (a folder's change list). */
function useChange(item: Item, given: CardDiff | null | undefined): CardDiff | null {
  const [diff, setDiff] = useState<CardDiff | null>(null);
  const own = given === undefined;
  useEffect(() => {
    if (!own) return;
    let gone = false;
    api.diff(item.id).then((d) => !gone && setDiff(d), () => {});
    return () => {
      gone = true;
    };
  }, [own, item.id, item.state, item.need, item.summary, item.workspace, JSON.stringify(item.files)]);
  return own ? diff : given;
}

/**
 * The card's left column with its files: the tabs, the demo (`demo`) under the first, a file's view
 * under each other. Without files to show it is the demo alone. `diff`: the card's change where the
 * card has read it already.
 */
export function ResultFiles({ item, diff, demo }: { item: Item; diff?: CardDiff | null; demo: ReactNode }) {
  const change = useChange(item, diff);
  const files = shownFiles(change, item.files);
  const [tab, setTab] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const demoBox = useRef<HTMLDivElement>(null);
  // what the shown files are as of now: the change read and the latest handover
  const rev = revision(`${item.state}:${item.need ?? ''}:${item.summary ?? ''}:${JSON.stringify(change?.files ?? [])}:${JSON.stringify(change?.folder?.changes ?? [])}`);
  // the column keeps the height of its tallest tab so far: the card does not shrink and move under the tabs
  const box = useRef<HTMLDivElement>(null);
  const [tallest, setTallest] = useState(0);
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? 0;
    if (h > tallest) setTallest(h);
  });
  if (!files.length) return demo || (item.files && change ? <p className="hint">{t.files.none}</p> : null);
  const current = tab !== null && (tab === DEMO ? !!demo : files.some((f) => f.path === tab)) ? tab : demo ? DEMO : files[0]!.path;
  const pick = (path: string) => {
    // a video left playing under another tab would go on talking
    if (path !== DEMO) demoBox.current?.querySelectorAll('video').forEach((v) => v.pause());
    setTab(path);
    setMore(false);
  };
  // the files named and the first others get a tab; one picked from the rest gets one while it is shown
  const tabbed = files.filter((f, i) => i < TABS || f.caption !== undefined || f.path === current);
  const rest = files.filter((f) => !tabbed.includes(f));
  const file = files.find((f) => f.path === current);
  return (
    <div className="results" ref={box} style={tallest ? { minHeight: tallest } : undefined}>
      <div className="r-tabs" role="tablist">
        {demo && (
          <button role="tab" aria-selected={current === DEMO} className={current === DEMO ? 'r-tab on' : 'r-tab'} onClick={() => pick(DEMO)}>
            ▶ {t.files.demo}
          </button>
        )}
        {tabbed.map((f) => (
          <button
            key={f.path}
            role="tab"
            aria-selected={current === f.path}
            className={['r-tab', current === f.path && 'on', f.caption !== undefined && 'named'].filter(Boolean).join(' ')}
            title={f.caption !== undefined ? `${f.path}\n${t.files.named(f.caption)}` : f.path}
            onClick={() => pick(f.path)}
          >
            {base(f.path)}
          </button>
        ))}
        {rest.length > 0 && (
          <span className="r-more">
            <button className="r-tab" title={t.files.moreHint} aria-expanded={more} onClick={() => setMore(!more)}>
              {t.files.more(rest.length)} ▾
            </button>
            {more && (
              <div className="r-menu" role="menu">
                {rest.map((f) => (
                  <button key={f.path} role="menuitem" title={f.path} onClick={() => pick(f.path)}>
                    {f.path}
                  </button>
                ))}
              </div>
            )}
          </span>
        )}
      </div>
      {demo && (
        <div ref={demoBox} hidden={current !== DEMO}>
          {demo}
        </div>
      )}
      {/* a new handover (or the work going on) may change the file at the same path: its view is read afresh */}
      {file && <FileView key={`${file.path}:${rev}`} item={item} file={file} rev={rev} />}
    </div>
  );
}

const base = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** A short mark of `s` for an address and a key, which changes when `s` does. */
function revision(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * One file of the card's work: its path and caption, how it is shown (a changed one its changes
 * first, the file as it is a click away), and the ways to the file itself.
 */
function FileView({ item, file, rev }: { item: Item; file: ShownFile; rev: string }) {
  const [changes, setChanges] = useState(file.diff);
  const [note, setNote] = useState('');
  const url = `${cardFile(item.id, file.path)}?v=${rev}`;
  const open = (show: boolean) => {
    setNote('');
    api.openCardFile(item.id, file.path, show).catch(() => {
      // from another device, or where the system has no app for it: the browser saves it instead
      if (show) setNote(t.files.notHere);
      else location.assign(cardFile(item.id, file.path, true));
    });
  };
  return (
    <div className="r-file">
      <div className="r-head">
        <span className="r-path" title={file.path}>
          {file.path}
        </span>
        {file.caption && <span className="hint"> · {file.caption}</span>}
      </div>
      <div className="r-bar">
        {file.diff && (
          <span className="r-mode" role="group">
            <button className={changes ? '' : 'on'} aria-pressed={!changes} onClick={() => setChanges(false)}>
              {file.kind === 'markdown' || file.kind === 'page' ? t.files.formatted : t.files.whole}
            </button>
            <button className={changes ? 'on' : ''} aria-pressed={changes} onClick={() => setChanges(true)}>
              {t.files.changes}
            </button>
          </span>
        )}
        <span className="r-ways">
          <button className="link" title={t.files.openHint} onClick={() => open(false)}>
            {t.files.open}
          </button>
          {' · '}
          <button className="link" title={t.files.showHint} onClick={() => open(true)}>
            {t.files.show}
          </button>
          {' · '}
          <a className="link" href={cardFile(item.id, file.path, true)} title={t.files.download} aria-label={t.files.download}>
            ↓
          </a>
        </span>
      </div>
      {note && <p className="hint">{note}</p>}
      {changes ? <Changes item={item} path={file.path} /> : <Shown item={item} file={file} url={url} rev={rev} onOpen={() => open(false)} />}
    </div>
  );
}

/** The file as it is, shown by its kind. */
function Shown({ item, file, url, rev, onOpen }: { item: Item; file: ShownFile; url: string; rev: string; onOpen: () => void }) {
  switch (file.kind) {
    case 'markdown':
      return (
        <Text url={url}>
          {(md) => (
            // its images from beside it, as far as the card serves them
            <DocImages.Provider value={(src) => (imageAt(file.path, src) ? `${cardFile(item.id, imageAt(file.path, src)!)}?v=${rev}` : null)}>
              <div className="r-doc">
                <Doc md={md} />
              </div>
            </DocImages.Provider>
          )}
        </Text>
      );
    case 'text':
      return <Text url={url}>{(text) => <pre className="r-text">{text}</pre>}</Text>;
    case 'image':
      return (
        <a href={url} target="_blank" rel="noreferrer">
          <img className="r-image" src={url} alt={file.caption || file.path} />
        </a>
      );
    case 'page':
      return <Page url={url} title={file.caption || file.path} />;
    case 'pdf':
      return <Pdf url={url} title={file.caption || file.path} />;
    case 'other':
      return (
        <div className="r-tile">
          <span className="r-tile-name">{base(file.path)}</span>
          <span className="hint">{t.files.other}</span>
          <button className="btn" title={t.files.openHint} onClick={onOpen}>
            {t.files.open}
          </button>
        </div>
      );
  }
}

/** A text file's content, to show as `children` makes it; past `TEXT_CAP`, its start. */
function Text({ url, children }: { url: string; children: (text: string) => ReactNode }) {
  const [text, setText] = useState<string | null | 'failed'>(null);
  useEffect(() => {
    let gone = false;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(
        (s) => !gone && setText(s),
        () => !gone && setText('failed'),
      );
    return () => {
      gone = true;
    };
  }, [url]);
  if (text === null) return <p className="hint">{t.files.loading}</p>;
  if (text === 'failed') return <p className="hint">{t.files.failed}</p>;
  const cut = text.length > TEXT_CAP;
  return (
    <>
      {children(cut ? text.slice(0, TEXT_CAP) : text)}
      {cut && <p className="hint">{t.files.cut(Math.round(TEXT_CAP / 1000))}</p>}
    </>
  );
}

/** A page in the sandboxed frame of an HTML artifact, its scripts away from Obeya's API, as high as it reports. */
function Page({ url, title }: { url: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const height = useReportedHeight(frame, PAGE_CAP);
  return <iframe ref={frame} className="r-page" sandbox="allow-scripts" src={url} title={title} style={height ? { height } : undefined} />;
}

/**
 * A PDF in the browser's viewer, which shows nothing in a sandboxed frame: the file comes as a PDF
 * and nothing else. As high as the column shows, so that scrolled to it, the viewer's own scrollbar
 * is the only one.
 */
function Pdf({ url, title }: { url: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const column = frame.current?.closest('.split-main');
    if (!column) return;
    const fit = () => setHeight(Math.max(360, column.clientHeight - 8));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(column);
    return () => watch.disconnect();
  }, []);
  return <iframe ref={frame} className="r-pdf" src={url} title={title} style={height ? { height } : undefined} />;
}

/** What the card changed in the file, line by line. */
function Changes({ item, path }: { item: Item; path: string }) {
  const [diff, setDiff] = useState<CardDiff | null | 'failed'>(null);
  useEffect(() => {
    let gone = false;
    api.diff(item.id, true).then(
      (d) => !gone && setDiff(d ?? 'failed'),
      () => !gone && setDiff('failed'),
    );
    return () => {
      gone = true;
    };
  }, [item.id]);
  if (diff === null) return <p className="hint">{t.files.loading}</p>;
  const part = diff === 'failed' ? undefined : splitDiff(diff.patch ?? '').find((p) => p.file === path);
  return part ? (
    <div className="r-diff">
      <FileDiff part={part} />
    </div>
  ) : (
    <p className="hint">{t.files.noDiff}</p>
  );
}
