// Pages Obeya shows in a sandboxed frame (a worker's HTML artifact, an idea's mock): they tell the
// page around them their height, so the frame grows to it instead of scrolling inside, and they
// load nothing from the internet.

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
 * The start of a mock's page, with the policy of a page without files of its own. It comes first,
 * so nothing in the page (a comment, a `<head>` of its own) can push it out of the head, where alone
 * the browser heeds it; the page's own doctype, `<html>` and `<head>` after it only add their
 * attributes. The frame the page is written into has the same policy already (`/api/mock-frame`);
 * this one holds where the page is shown otherwise.
 */
const SEALED = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${pagePolicy()}"><meta http-equiv="x-dns-prefetch-control" content="off">`;

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

/** A mock's few lines of HTML as a page of their own, in a plain sans-serif on white; a mock that is a whole page itself stays as it is. Either loads nothing from the internet. */
export function mockPage(html: string): string {
  if (/<html[\s>]/i.test(html)) return SEALED + withHeightReport(html);
  return `${SEALED}<meta charset="utf-8"><style>body{margin:8px;display:flow-root;font:14px/1.4 system-ui,sans-serif;color:#222;background:#fff}</style></head><body>${html}${CONTENT_HEIGHT_REPORT}</body></html>`;
}
