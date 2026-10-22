// Pages Obeya shows in a sandboxed frame (a worker's HTML artifact, an idea's mock): they tell the
// page around them their height, so the frame grows to it instead of scrolling inside, and on
// Obeya's own page what the owner marks in them, to quote it; they load nothing from the internet.

/**
 * What a worker's page may load (an HTML artifact, an answer's page, an idea's mock): the files beside
 * it, where it has some (`own`: the address they are served from), inline styles and scripts, `data:`
 * and `blob:`, and nothing from anywhere else, be it a CDN, a font host or any other server, by
 * `fetch`, an image, a font, a script, a form or a frame alike. An agent steered by text it read (a
 * comment, a file) could otherwise write a page that sends what it read to another server the moment
 * the owner opens the card; writing a file passes the checks a `curl` to that server would not. The
 * address is named beside `'self'`: in a sandbox Safari matches `'self'` against the page's own
 * origin, which is `null`. A frame navigating itself elsewhere is stopped by `FRAMES_POLICY` of the
 * page around it; what a CSP does not reach (a connection opened ahead with `preconnect`, whose host
 * name alone can carry data; WebRTC) by `Connection-Allowlist`, which the server sends beside it.
 */
export function pagePolicy(own?: string): string {
  const here = own ? `'self' ${own} ` : '';
  return `default-src ${here}data: blob:; script-src ${here}'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' data: blob:; style-src ${here}'unsafe-inline' data: blob:; form-action 'none'`;
}

/** What Obeya's page (`src/ui/index.html`) may show in its frames: its own addresses, where the workers' pages are served, and nothing a frame navigates to elsewhere. */
export const FRAMES_POLICY = "frame-src 'self' data: blob:";

/**
 * A page that loads its own files alone, those at `own` (none: a page without files of its own): the
 * policy comes first, so nothing in the page (a comment, a `<head>` of its own) can push it out of
 * the head, where alone the browser heeds it; the page's own doctype, `<html>` and `<head>` after it
 * only add their attributes. It says UTF-8 ahead of the page too, for a page opened from disk, whose
 * own `<meta charset>` may come too late after the policy.
 */
export function sealed(html: string, own?: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${pagePolicy(own)}"><meta http-equiv="x-dns-prefetch-control" content="off">${html}`;
}

/**
 * The page's height, sent to the page around it whenever it changes, by a pixel too: there the
 * frame grows to it. Rounded up (scrollHeight rounds, and a page a fraction of a pixel higher than
 * its frame scrolls), and a page wider than its frame adds the scrollbar across its foot.
 */
const HEIGHT_REPORT = `<script>(() => {
  let last = 0;
  const say = () => {
    const html = document.documentElement;
    const h = Math.max(html.scrollHeight, Math.ceil(html.getBoundingClientRect().height)) + innerHeight - html.clientHeight;
    if (h !== last) { last = h; parent.postMessage({ obeyaHeight: h }, '*'); }
  };
  addEventListener('load', say);
  new ResizeObserver(say).observe(document.documentElement);
})();</script>`;

/** The page with its height report, at the end of its body (or of the page, without one). */
export function withHeightReport(html: string): string {
  const at = html.toLowerCase().lastIndexOf('</body>');
  return at < 0 ? html + HEIGHT_REPORT : html.slice(0, at) + HEIGHT_REPORT + html.slice(at);
}

/**
 * What the owner marks in the page, sent to Obeya's page around it, where a button beside it quotes
 * it into the card's field (`CiteButton` in src/ui/cite.tsx): the text, its first and last line in
 * the frame's window, and whether it was marked backwards; null once nothing is marked. While the
 * mouse still drags it out, the marking is not said. `{ obeyaUnmark }` from the page around takes the
 * marking away, as a click elsewhere there would on a page of its own.
 */
const MARK_REPORT = `<script>(() => {
  let last = 'null', down = false;
  const tell = (m) => {
    const now = JSON.stringify(m);
    if (now !== last) { last = now; parent.postMessage({ obeyaMarked: m }, '*'); }
  };
  const say = () => {
    if (down) return;
    const s = getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return tell(null);
    const r = s.getRangeAt(0);
    const lines = [...r.getClientRects()].filter((c) => c.width > 0);
    const text = s.toString();
    if (!text.trim() || !lines.length) return tell(null);
    const at = (c) => [c.left, c.top, c.right, c.bottom];
    tell({ text, first: at(lines[0]), last: at(lines[lines.length - 1]), backwards: s.anchorNode === r.endContainer && s.anchorOffset === r.endOffset });
  };
  document.addEventListener('selectionchange', say);
  addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') { down = true; tell(null); } }, true);
  addEventListener('pointerup', () => { if (down) { down = false; say(); } }, true);
  addEventListener('blur', () => { if (down) { down = false; say(); } });
  addEventListener('scroll', say, true);
  addEventListener('resize', say);
  addEventListener('message', (e) => { if (e.source === parent && e.data && e.data.obeyaUnmark) getSelection().removeAllRanges(); });
})();</script>`;

/** The page with its marking report (`MARK_REPORT`), for a page shown on Obeya's own page: at the end of its body, or of the page without one. */
export function withMarkReport(html: string): string {
  const at = html.toLowerCase().lastIndexOf('</body>');
  return at < 0 ? html + MARK_REPORT : html.slice(0, at) + MARK_REPORT + html.slice(at);
}

/**
 * The height of a mock's content, not of its frame's window (that one only grows as the frame does):
 * a frame laid out narrow first shrinks back once it is wide.
 */
const CONTENT_HEIGHT_REPORT = `<script>(() => {
  let last = 0;
  const say = () => {
    const h = Math.ceil(document.body.getBoundingClientRect().height) + 16;
    if (Math.abs(h - last) > 2) { last = h; parent.postMessage({ obeyaHeight: h }, '*'); }
  };
  addEventListener('load', say);
  new ResizeObserver(say).observe(document.body);
})();</script>`;

/**
 * A mock's few lines of HTML as a page of their own, in a plain sans-serif on white; a mock that is a
 * whole page itself stays as it is. Either says what the owner marks in it (`MARK_REPORT`) and
 * loads nothing from the internet (`sealed`). The frame the page is written into has the same policy
 * already (`/api/mock-frame`); this one holds where the page is shown otherwise.
 */
export function mockPage(html: string): string {
  if (/<html[\s>]/i.test(html)) return sealed(withMarkReport(withHeightReport(html)));
  return sealed(`<style>body{margin:8px;display:flow-root;font:14px/1.4 system-ui,sans-serif;color:#222;background:#fff}</style></head><body>${html}${CONTENT_HEIGHT_REPORT}${MARK_REPORT}</body></html>`);
}
