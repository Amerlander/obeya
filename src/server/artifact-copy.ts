// The copy of an HTML artifact on a shared page (a site's page, a ZIP). There the artifact runs in
// a sandboxed frame whose origin is `null`, so what it loads in CORS mode (a module script, a
// `fetch()` of a file beside it, a font) needs the site to answer with `Access-Control-Allow-Origin`;
// behind a login (Cloudflare Access, say) those requests carry no cookie and get the login page, and
// from a ZIP opened from disk none of them loads at all. Inside Obeya the files are served under a
// keyed address instead (`keyed` in demo.ts); a static site cannot do that. So the copy makes no
// such request: its module scripts are bundled into the page, its stylesheets carry their fonts,
// and the files its scripts may fetch go into the page, answered by `fetch` and `XMLHttpRequest`
// without asking the site. Images, media, classic scripts and stylesheets load without CORS and stay
// files beside it.

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { withHeightReport } from '../core/frame';

const FONTS = /\.(?:woff2?|ttf|otf|eot)$/i;
/** What a page loads without CORS (or the copy inlines), so it stays out of the page. */
const LOADED = /\.(?:[cm]?js|css|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|bmp|ico|mp4|webm|mov|m4v|mp3|wav|ogg|oga|m4a|flac)$/i;

/**
 * The artifact's files whose copy differs from the artifact's own: its `index.html` always (with
 * the height report, see `withHeightReport`), and stylesheets that load fonts.
 */
export async function artifactCopy(dir: string, files: string[]): Promise<Map<string, string>> {
  const copy = new Map<string, string>();
  for (const f of files) if (f.endsWith('.css')) {
    const css = readFileSync(join(dir, f), 'utf8');
    const inlined = withFonts(css, dir, dirname(f));
    if (inlined !== css) copy.set(f, inlined);
  }
  const embedded = files.filter((f) => f !== 'index.html' && !LOADED.test(f));
  let html = withFonts(await withModules(readFileSync(join(dir, 'index.html'), 'utf8'), dir), dir, '.');
  if (embedded.length) html = withFiles(html, dir, embedded);
  copy.set('index.html', withHeightReport(html));
  return copy;
}

/** A file's path relative to the artifact's directory, when it lies inside it. */
function inside(dir: string, from: string, ref: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(ref)) return null;
  let path: string;
  try {
    path = relative(dir, join(dir, from, decodeURIComponent(ref.replace(/[?#].*$/, ''))));
  } catch {
    return null;
  }
  return path && !path.startsWith('..') ? path.split('\\').join('/') : null;
}

/** CSS with its fonts of the artifact's directory as `data:` URLs (`from` is where the CSS sits). */
function withFonts(css: string, dir: string, from: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g, (all, _q, ref: string) => {
    const path = FONTS.test(ref.replace(/[?#].*$/, '')) && inside(dir, from, ref);
    if (!path) return all;
    try {
      const file = Bun.file(join(dir, path));
      return `url("data:${file.type.split(';')[0]};base64,${readFileSync(join(dir, path)).toString('base64')}")`;
    } catch {
      return all;
    }
  });
}

/** Text inside a `<script>` element must not close it. */
const inScript = (s: string) => s.replace(/<\/(script)/gi, '<\\/$1');

/**
 * The page with each module script that loads files of the directory bundled into it: one with a
 * `src` there, an inline one that imports a file there. Imports from elsewhere (a CDN, a package
 * an import map names) stay imports. A script that does not bundle stays as it is.
 */
async function withModules(html: string, dir: string): Promise<string> {
  const scripts: { src: string | null; text: string }[] = [];
  let current: { src: string | null; text: string } | null = null;
  new HTMLRewriter()
    .on('script', {
      element(el) {
        current = null;
        if (el.getAttribute('type')?.trim().toLowerCase() !== 'module') return;
        current = { src: el.getAttribute('src'), text: '' };
        scripts.push(current);
      },
      text(chunk) {
        if (current && current.src === null) current.text += chunk.text;
      },
    })
    .transform(html);
  const bundles = await Promise.all(
    scripts.map(async (s, i) => {
      if (s.src !== null) {
        const path = inside(dir, '.', s.src);
        return path ? bundle(dir, join(dir, path)) : null;
      }
      if (!/(?:\bfrom|\bimport)\s*\(?\s*['"]\.{1,2}\//.test(s.text)) return null;
      const entry = join(dir, `.obeya-module-${i}.js`);
      return bundle(dir, entry, { [entry]: s.text });
    }),
  );
  if (bundles.every((b) => b === null)) return html;
  let i = 0;
  return new HTMLRewriter()
    .on('script', {
      element(el) {
        if (el.getAttribute('type')?.trim().toLowerCase() !== 'module') return;
        const code = bundles[i++];
        if (code === null || code === undefined) return;
        el.removeAttribute('src');
        el.setInnerContent(inScript(code), { html: true });
      },
    })
    .transform(html);
}

async function bundle(dir: string, entry: string, files?: Record<string, string>): Promise<string | null> {
  try {
    const r = await Bun.build({
      entrypoints: [entry],
      ...(files ? { files } : {}),
      root: dir,
      target: 'browser',
      format: 'esm',
      packages: 'external',
      external: ['http://*', 'https://*'],
      throw: false,
    });
    // a module that loads a stylesheet or splits into chunks needs files the copy does not have
    if (!r.success || r.outputs.length !== 1) return null;
    // the comments naming each module's path, which would tell where the artifact lay on this machine
    return (await r.outputs[0]!.text()).replace(/^\/\/ \S+\.(?:[cm]?[jt]sx?|json)\n/gm, '');
  } catch {
    return null;
  }
}

/**
 * The page with the files its scripts may fetch inside it, as the first script of its head: GET
 * requests through `fetch` and `XMLHttpRequest` for a file of the directory are answered from there.
 */
function withFiles(html: string, dir: string, files: string[]): string {
  const table = Object.fromEntries(files.map((f) => [f, [Bun.file(join(dir, f)).type, readFileSync(join(dir, f)).toString('base64')]]));
  const script = `<script>(() => {
  const files = ${inScript(JSON.stringify(table))};
  const base = new URL('.', location.href);
  const file = (url, method) => {
    if (String(method || 'GET').toUpperCase() !== 'GET') return null;
    let u;
    try { u = new URL(url, document.baseURI); } catch { return null; }
    if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname)) return null;
    let f;
    try { f = files[decodeURIComponent(u.pathname.slice(base.pathname.length))]; } catch { return null; }
    return f && { type: f[0], blob: new Blob([Uint8Array.from(atob(f[1]), (c) => c.charCodeAt(0))], { type: f[0] }) };
  };
  const fetch0 = window.fetch;
  window.fetch = function (input, init) {
    const req = input instanceof Request ? input : null;
    const f = file(req ? req.url : input, (init && init.method) || (req && req.method));
    return f ? Promise.resolve(new Response(f.blob, { headers: { 'content-type': f.type } })) : fetch0.apply(this, arguments);
  };
  const open0 = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const f = file(url, method);
    return open0.call(this, method, f ? URL.createObjectURL(f.blob) : url, ...rest);
  };
})();</script>`;
  const head = /<head\b[^>]*>/i.exec(html) ?? /<html\b[^>]*>/i.exec(html) ?? /<!doctype[^>]*>/i.exec(html);
  return head ? html.slice(0, head.index + head[0].length) + script + html.slice(head.index + head[0].length) : script + html;
}
