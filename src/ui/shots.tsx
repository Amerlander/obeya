// Screenshots in what the owner writes: pasted, dropped or picked, scaled down so the agent can
// read them, uploaded at once; shown as thumbnails that grow large over the page on a click.

import { type ClipboardEvent, type DragEvent, type MouseEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, api, at } from './api';
import { draftOf, dropDraft, updateDraft, useDraft } from './draft';
import { errorText, t } from './strings';
import { behindThumb, type Box, onto, ZOOM_EASE, ZOOM_MS } from './zoomBox';

const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
/** The longest side the model looks at in detail; larger screenshots only cost upload and context. */
const MAX_SIDE = 2000;
/** What the server takes per image (the model's limit). */
const MAX_BYTES = 3_750_000;

/** The images among pasted or dropped files. */
export const imageFiles = (files: FileList | null | undefined) => [...(files ?? [])].filter((f) => f.type.startsWith('image/'));

/** A screenshot as the agent reads it: at most MAX_SIDE on its long side, PNG, or JPEG when that is too large. */
export async function prepareImage(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file).catch(() => null);
  // not an image the browser can read: the server says so
  if (!bmp) return file;
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (scale === 1 && TYPES.includes(file.type) && file.size <= MAX_BYTES) return file;
  const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  let blob = await canvas.convertToBlob({ type: 'image/png' });
  for (const quality of [0.9, 0.8, 0.65]) {
    if (blob.size <= MAX_BYTES) break;
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  return blob;
}

export const imageUrl = (id: string) => at(`/images/${encodeURIComponent(id)}`);

/** Screenshots for a draft, uploaded one after the other; `added` hears each one that arrived. */
export async function attachTo(key: string, files: File[], added?: () => void) {
  if (!files.length) return;
  updateDraft(key, (d) => ({ error: '', uploading: d.uploading + files.length }));
  for (const f of files) {
    try {
      const id = await api.uploadImage(await prepareImage(f));
      updateDraft(key, (d) => ({ images: [...d.images, id] }));
      added?.();
    } catch (e) {
      updateDraft(key, { error: e instanceof ApiError ? errorText(e.code) : t.offlineError });
    } finally {
      updateDraft(key, (d) => ({ uploading: d.uploading - 1 }));
    }
  }
}

/**
 * Screenshots going into a text field: pasted, dropped or picked, uploaded at once. They belong to
 * the field's `draft` (`draft.ts`), or without one to this field alone. `onChange` hears every
 * change the owner makes, so a card can keep them as they are added.
 */
export function useShotInput({ draft, initial = [], onChange, off = false }: { draft?: string; initial?: string[]; onChange?: (ids: string[]) => void; off?: boolean } = {}) {
  const own = useId();
  const key = draft ?? `shots:${own}`;
  // a field of its own starts with its screenshots, and they go with it
  useState(() => !draft && initial.length && updateDraft(key, { images: initial }));
  useEffect(() => (draft ? undefined : () => dropDraft(key)), [key]);
  const { images, uploading, error } = useDraft(key);
  const [dropping, setDropping] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const update = (fn: (cur: string[]) => string[]) => {
    updateDraft(key, (d) => ({ images: fn(d.images) }));
    change.current?.(draftOf(key).images);
  };
  const attach = (files: File[]) => (off ? Promise.resolve() : attachTo(key, files, () => change.current?.(draftOf(key).images)));
  return {
    off,
    images,
    uploading,
    dropping,
    error,
    picker,
    attach,
    remove: (id: string) => update((cur) => cur.filter((x) => x !== id)),
    /** After sending: the field is empty again, or without those sent while more were added. */
    clear: (sent?: string[]) => updateDraft(key, (d) => ({ images: sent ? d.images.filter((id) => !sent.includes(id)) : [] })),
    /** For the element screenshots may be dropped on. */
    drop: {
      onDragOver: (e: DragEvent) => {
        if (off || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDropping(true);
      },
      onDragLeave: () => setDropping(false),
      onDrop: (e: DragEvent) => {
        setDropping(false);
        const files = imageFiles(e.dataTransfer.files);
        if (off || !files.length) return;
        e.preventDefault();
        attach(files);
      },
    },
    /** For the text field: a pasted screenshot is attached instead of pasted as text. */
    onPaste: (e: ClipboardEvent) => {
      const files = imageFiles(e.clipboardData.files);
      if (off || !files.length) return;
      e.preventDefault();
      attach(files);
    },
  };
}
export type ShotInput = ReturnType<typeof useShotInput>;

/** The screenshots in a text field, each to enlarge or remove, and those still uploading. */
export function ShotStrip({ shots }: { shots: ShotInput }) {
  const enlarge = useEnlarge();
  if (!shots.images.length && !shots.uploading) return null;
  return (
    <div className="c-shots">
      {shots.images.map((id) => (
        <span key={id} className="c-shot">
          <button className="open" title={t.shots.enlarge} onClick={(e) => enlarge.open(id, e)}>
            <img src={imageUrl(id)} alt={t.shots.alt} />
          </button>
          <button className="remove" title={t.shots.remove} onClick={() => shots.remove(id)}>
            ×
          </button>
        </span>
      ))}
      {Array.from({ length: shots.uploading }, (_, i) => (
        <span key={`u${i}`} className="c-shot loading">
          {t.shots.uploading}
        </span>
      ))}
      {enlarge.view}
    </div>
  );
}

/** The button in the text field's corner that picks screenshots from disk. */
export function AttachButton({ shots, title = t.shots.attach }: { shots: ShotInput; title?: string }) {
  if (shots.off) return null;
  return (
    <>
      <button className="c-attach" title={title} aria-label={title} onClick={() => shots.picker.current?.click()}>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <rect x="2.5" y="4" width="15" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="7" cy="8.5" r="1.5" fill="currentColor" />
          <path d="M3.5 14.5 8 10.5l3 2.5 2.5-2 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
      <input
        ref={shots.picker}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          shots.attach(imageFiles(e.target.files));
          e.target.value = '';
        }}
      />
    </>
  );
}

/** Thumbnails of screenshots; a click shows one large, Esc or a click closes it. */
export function Shots({ ids }: { ids?: string[] }) {
  const enlarge = useEnlarge();
  if (!ids?.length) return null;
  return (
    <span className="shots">
      {ids.map((id) => (
        <button key={id} className="shot" title={t.shots.enlarge} onClick={(e) => enlarge.open(id, e)}>
          <img src={imageUrl(id)} alt={t.shots.alt} loading="lazy" />
        </button>
      ))}
      {enlarge.view}
    </span>
  );
}

/** One screenshot of a row of thumbnails shown large: `open` from the click on its thumbnail, `view` to render. */
function useEnlarge() {
  const [open, setOpen] = useState<{ id: string; thumb: HTMLImageElement } | null>(null);
  return {
    open: (id: string, e: MouseEvent<HTMLElement>) => {
      const thumb = e.currentTarget.querySelector('img');
      if (thumb) setOpen({ id, thumb });
    },
    view: open && <Lightbox src={imageUrl(open.id)} thumb={open.thumb} onClose={() => setOpen(null)} />,
  };
}


/**
 * One image over the whole page, outside the panel, which the camera transforms. Like the demo
 * video's zoom (detail.tsx useZoom) it grows out of its thumbnail and goes back into it, wherever
 * that stands by then; Esc or a click closes it.
 */
function Lightbox({ src, thumb, onClose }: { src: string; thumb: HTMLImageElement; onClose: () => void }) {
  const img = useRef<HTMLImageElement>(null);
  const [closing, setClosing] = useState(false);
  /** The transform and crop that put the large image onto its thumbnail, or none while the thumbnail is out of sight. */
  const onThumb = () => {
    const el = img.current!;
    const r = thumb.getBoundingClientRect();
    if (!thumb.isConnected || !r.width || !el.naturalWidth) return null;
    const { box, inset } = behindThumb({ left: r.left, top: r.top, width: r.width, height: r.height }, el.naturalWidth / el.naturalHeight);
    // where it stands large, untransformed (the lightbox covers the window from its corner)
    const large: Box = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
    return { transform: onto(box, large), clipPath: `inset(${inset.y * 100}% ${inset.x * 100}%)` };
  };
  const close = () => {
    if (closing) return;
    setClosing(true);
    const to = onThumb();
    if (!to) return onClose();
    // from where it is, also when still growing
    const el = img.current!;
    const { transform, clipPath } = getComputedStyle(el);
    el.getAnimations().forEach((a) => a.cancel());
    el.animate([{ transform, clipPath }, to], { duration: ZOOM_MS, easing: ZOOM_EASE, fill: 'forwards' }).onfinish = onClose;
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  // grows out of its thumbnail, which stays hidden while it is out
  useLayoutEffect(() => {
    const el = img.current!;
    const grow = () => {
      const from = onThumb();
      if (from) el.animate([from, { transform: 'none', clipPath: 'inset(0)' }], { duration: ZOOM_MS, easing: ZOOM_EASE });
    };
    if (el.complete) grow();
    else el.addEventListener('load', grow, { once: true });
    thumb.style.visibility = 'hidden';
    return () => {
      el.removeEventListener('load', grow);
      thumb.style.visibility = '';
    };
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, []);
  return createPortal(
    // a click here is not one on the card or field the thumbnail sits in
    <div
      className={closing ? 'lightbox closing' : 'lightbox'}
      title={t.shots.close}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        close();
      }}
    >
      <img ref={img} src={src} alt={t.shots.alt} />
    </div>,
    document.body,
  );
}
