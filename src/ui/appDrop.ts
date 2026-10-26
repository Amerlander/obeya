// Files dropped in the app. Its webview hands a drop from the desktop to the app instead of the page,
// with the files' paths (app/src/main.rs), and the page would hear nothing of it. The app passes on
// where the drag is and, at the drop, the paths; the page plays them to the element under the
// pointer as the browser's own drag events, with Files: an image with its bytes, read through
// Obeya on the same machine, to attach as a screenshot; any other file (or folder) empty, known by
// its path (`droppedPath`), which goes into the text as it is.

import { api } from './api';

declare global {
  interface Window {
    /** Called by the app while files are dragged over its window: where (CSS pixels), and at the drop their paths. */
    obeyaDrag?: (kind: 'over' | 'leave' | 'drop', x: number, y: number, paths?: string[]) => void;
  }
}

/** Images the page attaches as screenshots, by their extension; the server reads only these (`localImage`). */
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|heic|heif|tiff?)$/i;

const paths = new WeakMap<File, string>();
/** Where a file the app's drop brought lies on this machine. */
export const droppedPath = (f: File): string | undefined => paths.get(f);

/** A drag event at `el` carrying `files`, as the browser's own would. */
function play(type: 'dragover' | 'dragleave' | 'drop', el: Element, x: number, y: number, files: File[]) {
  const data = new DataTransfer();
  for (const f of files) data.items.add(f);
  el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data, clientX: x, clientY: y }));
}

/** What a drag carries before the drop: a file, so the places that take files light up. */
const some = () => [new File([], '')];

/** The file the page hands on for `path`: an image with its bytes, anything else by its path. */
async function fileOf(path: string): Promise<File> {
  const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  if (IMAGE.test(path)) {
    const image = await api.localImage(path).catch(() => null);
    if (image) return image;
  }
  const f = new File([], name);
  paths.set(f, path);
  return f;
}

/** In the app: the page hears what is dragged over its window and dropped there. */
export function takeAppDrops() {
  if (!window.obeyaApp) return;
  let over: Element | null = null;
  window.obeyaDrag = (kind, x, y, dropped = []) => {
    const el = kind === 'leave' ? null : document.elementFromPoint(x, y);
    if (over && over !== el) play('dragleave', over, x, y, some());
    over = kind === 'over' ? el : null;
    if (!el) return;
    if (kind === 'over') play('dragover', el, x, y, some());
    else void Promise.all(dropped.map(fileOf)).then((files) => play('drop', el, x, y, files));
  };
}
