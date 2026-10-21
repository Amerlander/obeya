// The files a card's work made or changed, as its left column shows them beside its demo: which
// of them get a tab, in which order, and how each one is shown; the paths and images the server
// checks what it serves against.

import type { CardDiff } from './diff';

/** A file a card's worker named as its result at its handover: its path in the repository (or folder), with `/`, and a one-line caption. */
export interface CardFile {
  path: string;
  caption: string;
}

/**
 * Files that open in an app to look at them. Anything else an agent wrote (a `.command`, `.app`,
 * `.bat`, `.desktop`, a script) would run when opened, so it is shown in its folder instead.
 */
export const DOCUMENT = /\.(pdf|png|jpe?g|gif|webp|svg|html?|md|txt|csv|tsv|json|ya?ml|xml|log|xlsx?|docx?|pptx?|od[tsp]|rtf|mp4|mov|webm|mp3|wav|m4a|ogg)$/i;

/** Files read as text by their name, where the change list does not say (a file whose earlier version Obeya did not keep). */
const TEXT = /\.(md|markdown|txt|csv|tsv|json|ya?ml|xml|log|toml|ini|cfg|conf|html?|css|scss|svg|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|ps1|bat|sql|r|lua|pl|tex|bib|ipynb|env|gitignore)$/i;

/** How a file is shown: Markdown formatted, a PDF in the browser's viewer, an image, a page in a sandboxed frame, text as it is, anything else as a tile to open it on the computer. */
export type FileKind = 'markdown' | 'pdf' | 'image' | 'page' | 'text' | 'other';

export const isImage = (path: string) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(path);

/** How the file at `path` is shown; `text`: the change list read it as text, which a spreadsheet or a Word file by its name never is. */
export function fileKind(path: string, text = TEXT.test(path)): FileKind {
  if (/\.(md|markdown)$/i.test(path)) return 'markdown';
  if (/\.pdf$/i.test(path)) return 'pdf';
  if (isImage(path)) return 'image';
  if (/\.html?$/i.test(path)) return 'page';
  return text && (TEXT.test(path) || !DOCUMENT.test(path)) ? 'text' : 'other';
}

/** A file the card's left column has a tab for. */
export interface ShownFile {
  path: string;
  /** Its worker named it as the result, with this caption. */
  caption?: string;
  kind: FileKind;
  /** It is new: shown as it is. A changed one shows its changes first, the file as it is a click away. */
  added: boolean;
  /** Its changes can be shown line by line. */
  diff: boolean;
}

/**
 * The files of a card's change that get a tab, in order: those its worker named as the result, then
 * the others it made or changed that can be shown, documents before text and code. A deleted file or a directory gets none, nor does
 * one that is no document and no text (a `__pycache__/*.pyc`): it stays in the change list.
 */
export function shownFiles(diff: CardDiff | null, named: CardFile[] = []): ShownFile[] {
  const changed: ShownFile[] = [];
  if (diff?.folder) {
    for (const c of diff.folder.changes) {
      if (c.kind === 'deleted' || c.dir) continue;
      const lines = c.added !== undefined && c.added + c.removed! > 0;
      const added = c.kind === 'added' || (c.kind === 'moved' && !c.changed);
      changed.push({ path: c.path, kind: fileKind(c.path, c.added !== undefined || TEXT.test(c.path)), added, diff: lines && !added });
    }
  } else if (diff) {
    for (const f of diff.files) {
      if (f.status === 'deleted') continue;
      const added = f.status === 'added' || (f.status === 'renamed' && !f.added && !f.removed);
      changed.push({ path: f.file, kind: fileKind(f.file, !f.binary), added, diff: !f.binary && !added && f.added + f.removed > 0 });
    }
  }
  const shown = (f: ShownFile) => f.kind !== 'other' || DOCUMENT.test(f.path);
  const first = named.map((n) => ({ ...(changed.find((c) => c.path === n.path) ?? { path: n.path, kind: fileKind(n.path), added: true, diff: false }), caption: n.caption }));
  // of the others, documents come before text and code, which is more often what made them
  const rest = changed.filter((c) => shown(c) && !named.some((n) => n.path === c.path));
  return [...first, ...rest.filter((c) => c.kind !== 'text'), ...rest.filter((c) => c.kind === 'text')];
}

/** A path as the change list writes it: relative, with `/`, without `.` and `..` steps; null for one that leaves the root. */
export function normalPath(path: string): string | null {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.length ? out.join('/') : null;
}

/**
 * Where an image a Markdown file at `doc` shows lies, relative to the root as `doc` is; null for one
 * on the web, at an absolute path, or outside the root. `src` is as the file writes it.
 */
export function imageAt(doc: string, src: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(src)) return null;
  let name = src.replace(/[?#].*$/, '');
  try {
    name = decodeURIComponent(name);
  } catch {}
  const dir = doc.includes('/') ? doc.slice(0, doc.lastIndexOf('/') + 1) : '';
  return normalPath(dir + name);
}

/** The images a Markdown file at `doc` shows from beside it (`![…](bild.png)`), relative to the root. */
export function docImages(doc: string, md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const at = imageAt(doc, m[1]!);
    if (at && isImage(at)) out.add(at);
  }
  return [...out];
}
