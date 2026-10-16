// A card's demo: the directory the `demo` skill rendered into, or an HTML artifact the worker
// made instead, read and served by Obeya.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { pagePolicy, withHeightReport } from '../core/frame';
import { chapterAt, type DemoKind } from '../core/types';
import { ownOrigin } from './access';
import { demoFile, esc } from './demo-page';
import { resource } from './resources';

/**
 * The plugin Obeya loads into its workers' sessions: it brings the demo skill (`obeya:demo`), the
 * pipeline that records a demo. A Claude Code session without Obeya reaches the same skill through
 * the plugin or a user skill that points to `plugin/skills/demo`.
 */
export const OBEYA_PLUGIN = resource('plugin');
export const DEMO_SKILL = 'obeya:demo';

/** The demo skill's instructions, for a session that does not know the skill to read. */
export const DEMO_SKILL_FILE = join(OBEYA_PLUGIN, 'skills', 'demo', 'SKILL.md');

/** What is wrong with the plugin workers load, for the log at start; null when nothing is. */
export function checkPlugin(dir = OBEYA_PLUGIN): string | null {
  for (const f of [join('.claude-plugin', 'plugin.json'), join('skills', 'demo', 'SKILL.md')])
    if (!existsSync(join(dir, f))) return `${join(dir, f)} is missing: workers' sessions have no demo skill`;
  return null;
}

const realpath = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
};

/**
 * The name of the demo skill in a worker's session on this machine. Claude Code lists a skill file
 * once: a user skill that links to the plugin's (`~/.claude/skills/demo` pointing to
 * `plugin/skills/demo`, as a session without Obeya reaches the skill) is listed under its own name
 * instead, and the session knows no `obeya:demo`.
 */
export function demoSkillName(skills = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'skills'), file = DEMO_SKILL_FILE): string {
  const own = realpath(file);
  if (!own || !existsSync(skills)) return DEMO_SKILL;
  return readdirSync(skills).find((name) => realpath(join(skills, name, 'SKILL.md')) === own) ?? DEMO_SKILL;
}

/** The files of a video demo the UI loads; nothing else in the directory is served. */
export const DEMO_FILES = ['demo.mp4', 'poster.jpg', 'captions.vtt'] as const;

/** The page of an HTML artifact; the files beside it (images, styles) are served too. */
export const ARTIFACT_PAGE = 'index.html';

/** What is wrong with an HTML artifact's directory, for the worker to fix; null when nothing is. */
export function checkArtifact(dir: string): string | null {
  return existsSync(join(dir, ARTIFACT_PAGE)) ? null : `${ARTIFACT_PAGE} is missing in ${dir}`;
}

/** The skill starts narration this long after its scene; a chapter starts at the scene. */
const NARRATION_LEAD = 0.35;

/**
 * Chapter marks for the scene titles, from the captions (one cue per scene, in order).
 * Returns what is wrong with the directory instead, for the worker to fix.
 */
export function readChapters(dir: string, titles: string[]): [number, string][] | string {
  for (const f of ['demo.mp4', 'captions.vtt']) if (!existsSync(join(dir, f))) return `${f} is missing in ${dir}`;
  const starts = cues(dir).map((c) => c.start);
  if (starts.length !== titles.length) return `captions.vtt has ${starts.length} cues but ${titles.length} chapter titles were given`;
  return titles.map((t, i) => [Math.max(0, Math.round((starts[i]! - NARRATION_LEAD) * 100) / 100), t]);
}

/** The cues of a demo's captions: one per scene, its narration. */
function cues(dir: string): { start: number; end: number; text: string }[] {
  let vtt: string;
  try {
    vtt = readFileSync(join(dir, 'captions.vtt'), 'utf8');
  } catch {
    return [];
  }
  const time = (h: string, m: string, s: string, ms: string) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  return [...vtt.matchAll(/^(\d+):(\d{2}):(\d{2})\.(\d{3}) --> (\d+):(\d{2}):(\d{2})\.(\d{3})[^\n]*\n([\s\S]*?)(?:\n\s*\n|$)/gm)].map((c) => ({
    start: time(c[1]!, c[2]!, c[3]!, c[4]!),
    end: time(c[5]!, c[6]!, c[7]!, c[8]!),
    text: c[9]!.replace(/\s+/g, ' ').trim(),
  }));
}

/**
 * The chapter at a place in a demo video and what its narration says around there: the sentence of
 * the scene's cue that the place falls on, by its share of the cue's time (the voice speaks evenly
 * enough for that); between cues, the last one's last sentence.
 */
export function placeIn(dir: string, chapters: [number, string][], at: number): { chapter?: string; narration?: string } {
  const chapter = chapters[chapterAt(chapters, at)]?.[1];
  const cue = cues(dir).findLast((c) => c.start <= at + 0.05);
  let narration: string | undefined;
  if (cue) {
    const sentences = cue.text.match(/[^.!?…]+(?:[.!?…]+[»«“”"']?|$)/g)?.map((x) => x.trim()).filter(Boolean) ?? [cue.text];
    const share = at >= cue.end ? 1 : (at - cue.start) / Math.max(0.1, cue.end - cue.start);
    const offset = Math.min(cue.text.length - 1, Math.max(0, share * cue.text.length));
    let passed = 0;
    narration = sentences.find((x) => (passed += x.length + 1) > offset) ?? sentences.at(-1);
  }
  return { ...(chapter ? { chapter } : {}), ...(narration ? { narration } : {}) };
}

/** Serves one demo file: a video's with byte ranges so the player can seek, any file of an HTML artifact's directory. */
export function serveDemoFile(demo: { dir: string; kind: DemoKind }, name: string, req: Request, route = '/demo/'): Response {
  if (demo.kind === 'html') return serveSandboxed(demo.dir, name, req, route, (path) => path === demoFile(demo.dir, ARTIFACT_PAGE));
  const dir = demo.dir;
  if (!(DEMO_FILES as readonly string[]).includes(name)) return notFound();
  const path = demoFile(dir, name);
  if (!path) return notFound();
  const size = statSync(path).size;
  const file = Bun.file(path);
  const type = name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.jpg') ? 'image/jpeg' : 'text/vtt; charset=utf-8';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (!range || (!range[1] && !range[2])) {
    return new Response(file, { headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes' } });
  }
  let start = range[1] ? Number(range[1]) : size - Number(range[2]);
  let end = range[1] && range[2] ? Number(range[2]) : size - 1;
  start = Math.max(0, start);
  end = Math.min(end, size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  return new Response(file.slice(start, end + 1), {
    status: 206,
    headers: {
      'content-type': type,
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
    },
  });
}

/** Keys the workers' files' addresses with; new at every start, so an address with an old key is sent on to the new one. */
const FILES_SECRET = crypto.getRandomValues(new Uint8Array(32));

/**
 * Lets a worker's page read the files beside it, and no other page. Its sandboxed frame's origin is
 * `null`, so what its page loads in CORS mode (a module script, `fetch()`, a font) needs
 * `Access-Control-Allow-Origin: null`, which any sandboxed page on any site matches; a request from
 * that frame carries neither a referrer nor anything else of its own. Its address does: the page is
 * sent on to `<directory>/~<key>/index.html`, so whatever it loads relative to itself carries the
 * key, which nobody can know without Obeya's API. Only an address with the key gets the header.
 *
 * `route`: where the route's file path begins (`/demo/`, `/demos/2/` for an earlier demo); `name`: the file path after it, decoded.
 * Returns the file path without the key, or the redirect to the address with it.
 */
function keyed(req: Request, route: string, name: string): string | Response {
  const url = new URL(req.url);
  const at = url.pathname.indexOf(route);
  if (at < 0) return notFound();
  const base = url.pathname.slice(0, at + route.length);
  const key = new Bun.CryptoHasher('sha256', FILES_SECRET).update(base).digest('hex').slice(0, 32);
  const given = /^~([0-9a-f]{32})\/(.*)$/s.exec(name);
  if (given?.[1] === key) return given[2]!;
  const file = (given ? given[2]! : name).split('/').map(encodeURIComponent).join('/');
  return new Response(null, { status: 302, headers: { location: `${base}~${key}/${file}${url.search}`, 'cache-control': 'no-store' } });
}

/**
 * A file a looked-up answer comes with, never one outside its thread's output directory. A page runs
 * sandboxed as an HTML artifact does, and tells its frame its height; `download`: as a file to save.
 */
export function serveAnswerFile(dir: string, asked: string, download: boolean, req: Request): Response {
  return serveSandboxed(dir, asked, req, '/files/', (path) => /\.html?$/i.test(path), download);
}

/**
 * What a worker's page may connect to beyond what its CSP covers (`Connection-Allowlist`, Chrome 152
 * on): only the address it was served from, so neither a `preconnect` nor WebRTC reaches another
 * server. It holds for the document, also once the page writes another into it.
 */
const OWN_CONNECTIONS = '(response-origin)';

/** The headers of a page that loads nothing from the internet, nor files of its own where `own` (the address they are served from) is missing; see `pagePolicy`. */
function sealedHeaders(own?: string): Record<string, string> {
  return {
    'content-security-policy': `sandbox allow-scripts; ${pagePolicy(own)}`,
    'connection-allowlist': own ? OWN_CONNECTIONS : '()',
    'x-dns-prefetch-control': 'off',
  };
}

/** The address a request was sent to, for a policy: only as plain a scheme and host as `refusal` lets through. */
function servedFrom(req: Request): string | undefined {
  const origin = ownOrigin(req);
  return /^https?:\/\/[a-z0-9.\-[\]:]+$/.test(origin) ? origin : undefined;
}

/**
 * A file of a worker's directory (an HTML artifact's, a looked-up answer's), never one outside it.
 * It is the worker's, so it runs sandboxed: scripts yes, but in an origin of its own, without
 * Obeya's API or the canvas's storage, and connecting to nothing but the address of the files beside
 * it (`pagePolicy`, `OWN_CONNECTIONS`). A `page` tells its frame its height, so the frame grows to it
 * instead of scrolling inside. Opened in a window of its own (a link on the card), a file that may run
 * scripts (HTML, SVG) comes in a frame of a page around it (`framed`): alone in its window a page
 * could navigate itself to another server, in the frame the page around it keeps it from that.
 */
function serveSandboxed(dir: string, asked: string, req: Request, route: string, page: (path: string) => boolean, download = false): Response {
  const name = keyed(req, route, asked);
  if (name instanceof Response) return name;
  const path = demoFile(dir, name);
  if (!path) return notFound();
  const file = Bun.file(path);
  if (!download && req.headers.get('sec-fetch-dest') === 'document' && /html|svg|xml/.test(file.type)) return framed(basename(path));
  // without an address to name, the page gets no files beside it rather than a policy that names something else
  const headers = { 'content-type': file.type, ...sealedHeaders(servedFrom(req)), 'cache-control': 'no-cache', 'access-control-allow-origin': 'null' };
  if (download) return new Response(file, { headers: { ...headers, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(basename(path))}` } });
  if (page(path)) return new Response(withHeightReport(readFileSync(path, 'utf8')), { headers });
  return new Response(file, { headers });
}

/** Points the frame at the page's own address, the part after `#` included, which never reaches the server. */
const FRAMED_SCRIPT = "document.querySelector('iframe').src = location.pathname + location.search + location.hash;";
const FRAMED_HASH = `'sha256-${new Bun.CryptoHasher('sha256').update(FRAMED_SCRIPT).digest('base64')}'`;

/** A page that holds the file at its own address in a sandboxed frame filling the window, and frames nothing from elsewhere. */
function framed(title: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block}</style></head><body><iframe sandbox="allow-scripts"></iframe><script>${FRAMED_SCRIPT}</script></body></html>`;
  const headers = { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; script-src ${FRAMED_HASH}; frame-src 'self'`, 'cache-control': 'no-cache' };
  return new Response(html, { headers });
}

/**
 * The frame an idea's mock is shown in (`MockFrame` in src/ui/detail.tsx): empty, sandboxed and
 * connecting to nothing, until the page around it sends the mock's page (`{ obeyaPage }`), which it
 * writes into itself; the policy stays with the document. A mock given as `srcdoc` would get no
 * `Connection-Allowlist`, which only a response can carry.
 */
const MOCK_FRAME = `<!doctype html><script>addEventListener('message', function once(e) {
  if (e.source !== parent || typeof (e.data && e.data.obeyaPage) !== 'string') return;
  removeEventListener('message', once);
  document.open();
  document.write(e.data.obeyaPage);
  document.close();
});</script>`;

export function serveMockFrame(): Response {
  return new Response(MOCK_FRAME, { headers: { 'content-type': 'text/html; charset=utf-8', ...sealedHeaders(), 'cache-control': 'no-cache' } });
}

const notFound = () => new Response('Not found', { status: 404 });
