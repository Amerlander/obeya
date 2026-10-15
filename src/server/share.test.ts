import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DemoSite } from '../adapters/types';
import { BadRequest, Board } from './board';
import { Store } from './db';
import { EXPORT_HTML_MAX } from '../core/types';
import type { Forge } from './forge';
import { demoPageHtml } from './demo-page';
import { DEMO_MARKER, SHARE_CWD, Sharing, withDemoLink } from './share';
import { siteVersions } from './site';
import { FakeRuntime, gitRepo } from './testing';
import { git } from './workspaces';

let dir: string;
let board: Board;
let runtime: FakeRuntime;
let sharing: Sharing;
/** The descriptions of the fake forge's pull requests, and each edit Obeya made. */
let bodies: Map<string, string>;
let edits: string[];
/** The site's title: a new one changes what its pages show, so the version of its pages. */
let title: string;

/** A page in the site's manifest, as far as the tests look at it. */
interface Entry {
  rev: number;
  withdrawn?: true;
  meta?: { kind?: 'html'; title: string; text: string; chapters: [number, string][]; pr: string | null; language: string };
}
/**
 * Each deploy of the site: the pages of its manifest, those it changed (`wrote`), and where it
 * ran. Only whole lines: the one without its newline yet is still being written.
 */
const calls = () => {
  if (!existsSync(join(dir, 'calls'))) return [];
  const all = readFileSync(join(dir, 'calls'), 'utf8')
    .split('\n')
    .slice(0, -1)
    .map((l) => JSON.parse(l) as { pages: Record<string, Entry>; home: string; cwd: string; repo: string });
  return all.map((c, i) => ({ ...c, wrote: Object.keys(c.pages).filter((slug) => c.pages[slug]!.rev !== all[i - 1]?.pages[slug]?.rev) }));
};

// the deploy line's stand-in: records the site's manifest, then copies the site's directory to
// `deployed/` (the host's snapshot), or fails with some output while the file `fail` exists. While
// the file `hold` exists, a deploy waits after it is recorded. Like `wrangler pages deploy`, it
// leaves its cache in its working directory.
const DEPLOY = `
const { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const [site, out] = process.argv.slice(2);
mkdirSync('.wrangler/cache', { recursive: true });
writeFileSync('.wrangler/cache/pages.json', '{}');
const { pages } = JSON.parse(readFileSync(site + '/obeya-site.json', 'utf8'));
appendFileSync(out + '/calls', JSON.stringify({ pages, home: process.env.OBEYA_HOME, cwd: process.cwd(), repo: process.env.OBEYA_REPO }) + '\\n');
while (existsSync(out + '/hold')) await Bun.sleep(10);
if (existsSync(out + '/fail')) { console.error('upload refused: token expired'); process.exit(2); }
console.error('Uploading 3 files');
rmSync(out + '/deployed', { recursive: true, force: true });
cpSync(site, out + '/deployed', { recursive: true });
`;

// the host: serves what was deployed last
const server = Bun.serve({
  port: 0,
  fetch(req) {
    let path = decodeURIComponent(new URL(req.url).pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(dir, 'deployed', path);
    return !path.includes('..') && existsSync(file) && statSync(file).isFile() ? new Response(Bun.file(file)) : new Response('not found', { status: 404 });
  },
});
afterAll(() => server.stop(true));
const SITE_URL = `http://localhost:${server.port}/`;
const site = (): DemoSite => ({ title, url: SITE_URL, deploy: `${join(dir, 'deploy.ts')} {dir} ${dir}`, language: 'de' });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-share-'));
  writeFileSync(join(dir, 'deploy.ts'), DEPLOY);
  title = 'Demos';
  board = new Board(new Store(':memory:'), { id: 'c', name: 'C', repos: [{ id: 'home', name: 'Home', path: dir, branch: 'main' }] }, () => ({ docs: [], dirs: [] }));
  runtime = new FakeRuntime();
  bodies = new Map();
  edits = [];
  sharing = make();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function make(repo = dir) {
  return new Sharing({
    board,
    runtime,
    home: join(dir, 'home'),
    forge,
    sourceFor: (card) => (card.title.startsWith('Ohne') ? null : { site: site(), repo }),
  });
}

const forge: Forge = {
  open: () => '',
  status: () => ({}) as never,
  body: (_cwd, url) => {
    const b = bodies.get(url);
    if (b === undefined) throw new Error(`gh pr view: no pull request ${url}`);
    return b;
  },
  setBody: (_cwd, url, body) => {
    bodies.set(url, body);
    edits.push(url);
  },
  merge: () => {},
};

const PR = 'https://github.com/acme/app/pull/42';
/** The worker opened the card's pull request, with a description of its own. */
function openPr(id: string, body = 'Exportiert Zählerstände.') {
  bodies.set(PR, body);
  board.work(id, { pr: JSON.stringify({ url: PR, number: 42, seen: [], reported: [] }) });
}

/** A card with a video demo, as a worker hands it over: its report page says the narration language. */
function card(title = 'Zählerstände exportieren', demo: Record<string, unknown> = {}, language: string | null = 'de') {
  const c = board.create({ title, x: 0, y: 0 });
  const d = join(dir, `demo-${c.id}`);
  if (demo.kind !== 'html') videoDir(d);
  else mkdirSync(d);
  if (demo.kind !== 'html' && language) writeFileSync(join(d, 'index.html'), `<!doctype html>\n<html lang="${language}">\n<head><title>Bericht</title></head></html>`);
  board.work(c.id, {
    state: 'live',
    demo: JSON.stringify({ kind: 'video', dir: d, chapters: [[0, 'Vorher']], page: { title: 'CSV-Export', text: 'Vermieter laden Zählerstände als CSV.' }, ...demo }),
  });
  return board.item(c.id)!;
}

/** A video demo's directory: the video and its captions. */
function videoDir(d: string) {
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'demo.mp4'), 'video');
  writeFileSync(join(d, 'captions.vtt'), 'WEBVTT\n');
  return d;
}

const share = (id: string) => board.item(id)!.share;
/** The card's page on the site, by its slug. */
const slug = (id: string) => (JSON.parse(board.row(id).share!) as { slug: string }).slug;
/** What the latest deploy said of the card's page. */
const meta = (id: string) => calls().at(-1)!.pages[slug(id)]!.meta!;
async function until(ok: () => boolean) {
  for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(ok()).toBe(true);
}
const log = (id: string) => board.events(id).map((e) => e.text);

describe('sharing a demo', () => {
  test('publishes the page on the site right away, keeps its link, and withdraws it', async () => {
    const c = card();
    sharing.share(c.id);
    expect(share(c.id)).toEqual({ state: 'publishing' });
    expect(log(c.id).at(-1)).toBe('Teilen: Die Seite geht online.');
    await until(() => share(c.id)?.state === 'shared');
    const slug = 'zahlerstande-exportieren-' + c.id.slice(0, 6);
    expect(share(c.id)).toEqual({ state: 'shared', url: `${SITE_URL}${slug}/` });
    const [call] = calls();
    expect(call!.wrote).toEqual([slug]);
    expect(call!.pages[slug]!.meta).toMatchObject({ title: 'CSV-Export', text: 'Vermieter laden Zählerstände als CSV.', chapters: [[0, 'Vorher']], pr: null, language: 'de' });
    expect(readFileSync(join(dir, 'deployed', slug, 'demo.mp4'), 'utf8')).toBe('video');
    // the deploy runs under Obeya's home, and learns the checkout from the environment
    expect(call!.home).toBe(join(dir, 'home'));
    expect(call!.cwd).toBe(realpathSync(join(dir, 'home', SHARE_CWD)));
    expect(call!.repo).toBe(dir);
    // the deploy's output goes into the card's log
    expect(log(c.id)).toContain('Uploading 3 files');
    expect(log(c.id).at(-1)).toBe(`Geteilt: ${SITE_URL}${slug}/`);

    sharing.unshare(c.id);
    expect(share(c.id)!.state).toBe('withdrawing');
    await until(() => !share(c.id));
    expect(calls().at(-1)!.pages[slug]!.withdrawn).toBe(true);
    expect(existsSync(join(dir, 'deployed', slug))).toBe(false);
    expect(log(c.id).at(-1)).toBe('Die Seite ist zurückgezogen.');
    // shared again, under the same link
    sharing.share(c.id);
    await until(() => share(c.id)?.state === 'shared');
    expect(share(c.id)!.url).toBe(`${SITE_URL}${slug}/`);
  });

  test('a deploy that leaves files in its working directory leaves the checkout clean, so its workspace can still be leased', async () => {
    const repo = gitRepo(join(dir, 'checkout'));
    sharing = make(repo);
    const c = card();
    sharing.share(c.id);
    await until(() => share(c.id)?.state === 'shared');
    sharing.unshare(c.id);
    await until(() => !share(c.id));
    expect(calls().map((c) => c.repo)).toEqual([repo, repo]);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(dir, 'home', SHARE_CWD, '.wrangler/cache/pages.json'))).toBe(true);
  });

  test('a newer demo is not shared on its own: the card says so, and "Neu teilen" replaces the page', async () => {
    const c = card();
    sharing.share(c.id);
    await until(() => share(c.id)?.state === 'shared');
    const newer = videoDir(join(dir, 'newer'));
    writeFileSync(join(newer, 'demo.mp4'), 'newer video');
    board.work(c.id, { demo: JSON.stringify({ kind: 'video', dir: newer, chapters: [], page: { title: 'CSV-Export 2', text: 'T.' } }) });
    expect(share(c.id)).toMatchObject({ state: 'shared', stale: true });
    expect(calls()).toHaveLength(1);
    sharing.share(c.id);
    // the page stays up with its link while the new one is published
    expect(share(c.id)).toMatchObject({ state: 'publishing', url: expect.stringContaining(SITE_URL) });
    await until(() => share(c.id)?.state === 'shared');
    expect(share(c.id)!.stale).toBeUndefined();
    expect(calls().at(-1)!.wrote).toEqual([slug(c.id)]);
    expect(meta(c.id).title).toBe('CSV-Export 2');
    expect(readFileSync(join(dir, 'deployed', slug(c.id), 'demo.mp4'), 'utf8')).toBe('newer video');
  });

  test('a failed deploy leaves the card as it was, with the output in its log', async () => {
    const c = card();
    writeFileSync(join(dir, 'fail'), '');
    sharing.share(c.id);
    await until(() => !share(c.id));
    const err = board.events(c.id).at(-1)!;
    expect(err.kind).toBe('error');
    expect(err.text).toContain('Exit-Code 2');
    expect(err.text).toContain('token expired');
    // shared, then a failed withdrawal: the page stays shared
    rmSync(join(dir, 'fail'));
    sharing.share(c.id);
    await until(() => share(c.id)?.state === 'shared');
    writeFileSync(join(dir, 'fail'), '');
    sharing.unshare(c.id);
    await until(() => share(c.id)?.state === 'shared');
    expect(board.events(c.id).at(-1)!.text).toContain('Nicht zurückgezogen');
  });

  test('a site that lost a page shared from here is not deployed, so the page does not go offline', async () => {
    const a = card('A');
    sharing.share(a.id);
    await until(() => share(a.id)?.state === 'shared');
    // the site's directory on this machine and the host both lost it
    rmSync(join(dir, 'home', 'sites'), { recursive: true });
    rmSync(join(dir, 'deployed'), { recursive: true });
    const b = card('B');
    sharing.share(b.id);
    await until(() => !share(b.id));
    expect(log(b.id).at(-1)).toContain(`(${slug(a.id)})`);
    expect(calls()).toHaveLength(1);
  });

  test('an HTML artifact goes out as a page too, and the pull request names it as a page', async () => {
    const c = card('Auswertung', { kind: 'html', chapters: [], page: { title: 'Verlust und Zapfung', text: 'Geschätzt aus den Messdaten.' } });
    writeFileSync(join(dir, `demo-${c.id}`, 'index.html'), '<!doctype html><body>Chart</body>');
    openPr(c.id);
    sharing.share(c.id);
    await until(() => share(c.id)?.state === 'shared');
    expect(meta(c.id)).toMatchObject({ kind: 'html', title: 'Verlust und Zapfung', chapters: [], pr: PR });
    expect(readFileSync(join(dir, 'deployed', slug(c.id), 'artifact', 'index.html'), 'utf8')).toContain('Chart');
    expect(bodies.get(PR)).toContain(`Demo-Seite: ${share(c.id)!.url} ${DEMO_MARKER}`);
  });

  test("writes the page in the demo's language: its report page's, else the demo settings'", async () => {
    const en = card('English', {}, 'en');
    sharing.share(en.id);
    await until(() => share(en.id)?.state === 'shared');
    expect(meta(en.id).language).toBe('en');
    // an artifact names its own; a demo without a page that names one takes the settings' narration language
    const artifact = card('Artifact', { kind: 'html', chapters: [], page: { title: 'Loss', text: 'From the readings.' } });
    writeFileSync(join(dir, `demo-${artifact.id}`, 'index.html'), '<html lang="en-GB"><body>Chart</body></html>');
    sharing.share(artifact.id);
    await until(() => share(artifact.id)?.state === 'shared');
    expect(meta(artifact.id).language).toBe('en');
    mkdirSync(join(dir, 'home'), { recursive: true });
    for (const language of ['en', 'de'] as const) {
      writeFileSync(join(dir, 'home', 'demo.json'), JSON.stringify({ language }));
      const c = card(`Without ${language}`, {}, null);
      sharing.share(c.id);
      await until(() => share(c.id)?.state === 'shared');
      expect(meta(c.id).language).toBe(language);
    }
  });

  test('only where the repository shares, never twice at once', () => {
    const none = card('Ohne Teilen');
    expect(() => sharing.share(none.id)).toThrow(BadRequest);
    const c = card();
    sharing.share(c.id);
    expect(() => sharing.share(c.id)).toThrow(BadRequest);
    expect(() => sharing.unshare(card('X').id)).toThrow(BadRequest);
  });

  test('a demo handed over without its page gets its text from a short session over the summary', async () => {
    const c = card('Zähler', { page: undefined });
    board.log(c.id, 'review', 'worker', 'Export gebaut: CSV mit Semikolon.');
    sharing.share(c.id);
    await until(() => runtime.sessions.length === 1);
    const s = runtime.last;
    expect(s.spec.readOnly).toBe(true);
    expect(s.inbox[0]).toContain('Export gebaut: CSV mit Semikolon.');
    s.call('page', { title: 'Zählerstände als CSV', text: 'Vermieter laden Zählerstände als CSV herunter.' });
    s.emit({ type: 'idle' });
    await until(() => share(c.id)?.state === 'shared');
    expect(meta(c.id)).toMatchObject({ title: 'Zählerstände als CSV', text: 'Vermieter laden Zählerstände als CSV herunter.' });
    // kept with the demo: the next share needs no session
    expect(board.item(c.id)!.demo!.page).toEqual({ title: 'Zählerstände als CSV', text: 'Vermieter laden Zählerstände als CSV herunter.' });
  });

  test('after a restart, a share under way goes on', async () => {
    const a = card('A');
    board.work(a.id, { share: JSON.stringify({ slug: 'a', state: 'publishing' }) });
    sharing.resume();
    await until(() => share(a.id)?.state === 'shared');
    expect(calls().map((c) => c.wrote)).toEqual([['a']]);
  });
});

describe("a page published with an earlier version of the site's pages", () => {
  const stored = (id: string) => JSON.parse(board.row(id).share!) as { version?: string; outdated?: true };
  const versions = () => siteVersions(site());

  test('is offered to share again once the site writes its pages differently, and "Erneut teilen" brings it up to date', async () => {
    const c = card();
    sharing.share(c.id);
    await until(() => share(c.id)?.state === 'shared');
    expect(stored(c.id).version).toBe(versions().video);
    await sharing.checkVersions();
    expect(share(c.id)!.outdated).toBeUndefined();

    title = 'Demos des Teams';
    await sharing.checkVersions();
    expect(share(c.id)).toEqual({ state: 'shared', url: expect.stringContaining(SITE_URL), outdated: true });
    expect(calls()).toHaveLength(1);
    sharing.share(c.id);
    expect(log(c.id).at(-1)).toBe('Erneut teilen: Die Seite wird mit dem neuen Stand erzeugt.');
    expect(share(c.id)).toMatchObject({ state: 'publishing', url: expect.stringContaining(SITE_URL) });
    await until(() => share(c.id)?.state === 'shared');
    expect(share(c.id)!.outdated).toBeUndefined();
    expect(stored(c.id).version).toBe(versions().video);
    expect(calls().at(-1)!.wrote).toEqual([slug(c.id)]);
  });

  test('video and artifact pages each have their version: a change to one marks only its pages', async () => {
    const v = card();
    const h = card('Auswertung', { kind: 'html', chapters: [] });
    writeFileSync(join(dir, `demo-${h.id}`, 'index.html'), '<!doctype html>');
    sharing.share(v.id);
    sharing.share(h.id);
    await until(() => share(v.id)?.state === 'shared' && share(h.id)?.state === 'shared');
    expect([stored(v.id).version, stored(h.id).version]).toEqual([versions().video, versions().html]);
    // the artifact page went out before the artifact pages changed
    board.work(h.id, { share: JSON.stringify({ ...stored(h.id), version: 'earlier' }) });
    await sharing.checkVersions();
    expect([share(v.id)!.outdated, share(h.id)!.outdated]).toEqual([undefined, true]);
  });

  test('a page shared without a version counts as earlier', async () => {
    const c = card();
    sharing.share(c.id);
    await until(() => share(c.id)?.state === 'shared');
    const { version: _, ...without } = stored(c.id);
    board.work(c.id, { share: JSON.stringify(without) });
    await sharing.checkVersions();
    expect(share(c.id)!.outdated).toBe(true);
  });

  test('a newer demo is "Neu teilen", not "Erneut teilen"', async () => {
    const c = card();
    sharing.share(c.id);
    await until(() => share(c.id)?.state === 'shared');
    title = 'Demos des Teams';
    await sharing.checkVersions();
    board.work(c.id, { demo: JSON.stringify({ kind: 'video', dir: join(dir, 'newer'), chapters: [], page: { title: 'T', text: 'T.' } }) });
    expect(share(c.id)).toMatchObject({ stale: true });
    expect(share(c.id)!.outdated).toBeUndefined();
  });

  test('each page is brought up to date on its own: sharing one again leaves the others marked', async () => {
    const a = card('A');
    const b = card('B');
    for (const c of [a, b]) {
      sharing.share(c.id);
      await until(() => share(c.id)?.state === 'shared');
    }
    const earlier = versions().video;
    title = 'Demos des Teams';
    await sharing.checkVersions();
    sharing.share(a.id);
    await until(() => share(a.id)?.state === 'shared' && !share(a.id)!.outdated);
    expect(share(b.id)!.outdated).toBe(true);
    expect(stored(b.id).version).toBe(earlier);
  });

  test('a version that changes while nobody looks is marked after the next deploy', async () => {
    const a = card('A');
    const b = card('B');
    for (const c of [a, b]) {
      sharing.share(c.id);
      await until(() => share(c.id)?.state === 'shared');
    }
    title = 'Demos des Teams';
    sharing.unshare(b.id);
    await until(() => !share(b.id));
    expect(share(a.id)!.outdated).toBe(true);
  });

  test('marked after a restart', async () => {
    const c = card();
    board.work(c.id, { share: JSON.stringify({ slug: 's', url: `${SITE_URL}s/`, dir: join(dir, `demo-${c.id}`), shown: { title: 'T', text: '', chapters: [], kind: 'video' }, version: 'v1' }) });
    sharing.resume();
    await until(() => !!share(c.id)?.outdated);
  });
});

describe('sharing many outdated pages again at once', () => {
  const reshare = () => board.snapshot().reshare;
  /** Cards shared on the site whose demos were rendered `ages` minutes ago, then outdated by a new title of the site. */
  async function outdated(...ages: number[]) {
    const cards = ages.map((age, n) => {
      const c = card(`Demo ${n}`);
      const video = join(dir, `demo-${c.id}`, 'demo.mp4');
      const t = new Date(Date.now() - age * 60_000);
      utimesSync(video, t, t);
      return c;
    });
    for (const c of cards) {
      sharing.share(c.id);
      await until(() => share(c.id)?.state === 'shared');
    }
    title = 'Demos des Teams';
    await sharing.checkVersions();
    return cards;
  }
  /** The pages the deploys since the `before`th wrote. */
  const wrote = (before: number) => calls().slice(before).flatMap((c) => c.wrote);

  test('shares the newest again, one after the other, and says how far it got', async () => {
    const [old, newest, middle] = await outdated(30, 1, 10);
    expect(reshare()).toEqual({ outdated: 3 });
    const before = calls().length;
    sharing.reshareMany(2);
    expect(reshare()).toMatchObject({ outdated: 1, run: { total: 2, done: 0, left: 2, failed: [] } });
    await until(() => reshare()?.run?.left === 0);
    expect(reshare()).toEqual({ outdated: 1, run: { total: 2, done: 2, failed: [], left: 0 } });
    expect(wrote(before)).toEqual([slug(newest!.id), slug(middle!.id)]);
    for (const c of [newest!, middle!]) {
      expect(share(c.id)!.outdated).toBeUndefined();
      expect(log(c.id)).toContain('Erneut teilen, mit anderen geteilten Demos: Die Seite wird mit dem neuen Stand erzeugt.');
      expect(log(c.id).at(-1)).toBe(`Erneut geteilt: ${share(c.id)!.url}`);
    }
    expect(share(old!.id)!.outdated).toBe(true);
    // the result stays until the owner puts it away
    sharing.dismissResharing();
    expect(reshare()).toEqual({ outdated: 1 });
    sharing.reshareMany(null);
    await until(() => reshare()?.run?.left === 0);
    expect(reshare()).toEqual({ outdated: 0, run: { total: 1, done: 1, failed: [], left: 0 } });
    expect(() => sharing.reshareMany(null)).toThrow(BadRequest);
  });

  test('a page that fails stays outdated, with the reason in its log, and the rest go on', async () => {
    const [a, b] = await outdated(2, 1);
    writeFileSync(join(dir, 'fail'), '');
    sharing.reshareMany(null);
    await until(() => reshare()?.run?.left === 0);
    expect(reshare()!.run).toEqual({ total: 2, done: 0, failed: [b, a].map((c) => ({ id: c!.id, title: c!.title })), left: 0 });
    expect(share(a!.id)).toMatchObject({ state: 'shared', outdated: true });
    expect(log(a!.id).at(-1)).toStartWith('Nicht erneut geteilt: Der Deploy der Site ist gescheitert (Exit-Code 2).');
    expect(reshare()!.outdated).toBe(2);
  });

  test('a page whose demo files were deleted is neither counted nor offered, and drops out of a run', async () => {
    const [a, b, c] = await outdated(3, 2, 1);
    rmSync(join(dir, `demo-${a!.id}`), { recursive: true });
    // the canvas shows it with its next change
    board.changed();
    expect(reshare()).toEqual({ outdated: 2 });
    expect(share(a!.id)).toEqual({ state: 'shared', url: expect.stringContaining(SITE_URL) });
    const before = calls().length;
    sharing.reshareMany(null);
    rmSync(join(dir, `demo-${b!.id}`, 'demo.mp4'));
    await until(() => reshare()?.run?.left === 0);
    expect(reshare()).toEqual({ outdated: 0, run: { total: 1, done: 1, failed: [], left: 0 } });
    expect(wrote(before)).toEqual([slug(c!.id)]);
    sharing.dismissResharing();
    expect(reshare()).toBeUndefined();
  });

  test('one run at a time; stopped before a page went out, all stay as they were', async () => {
    await outdated(2, 1);
    const before = calls().length;
    sharing.reshareMany(null);
    expect(() => sharing.reshareMany(null)).toThrow(BadRequest);
    expect(() => sharing.dismissResharing()).toThrow(BadRequest);
    sharing.stopResharing();
    await new Promise((r) => setTimeout(r, 50));
    expect(reshare()).toEqual({ outdated: 2, run: { total: 2, done: 0, failed: [], left: 0, stopped: true } });
    expect(calls()).toHaveLength(before);
  });

  test('a card with a newer demo gets its page as it shows, the newer demo still waits for "Neu teilen"', async () => {
    const [c] = await outdated(1);
    board.work(c!.id, { demo: JSON.stringify({ kind: 'video', dir: join(dir, 'newer'), chapters: [], page: { title: 'Neu', text: 'Neu.' } }) });
    expect(reshare()).toEqual({ outdated: 1 });
    const before = calls().length;
    sharing.reshareMany(null);
    await until(() => reshare()?.run?.left === 0);
    expect(wrote(before)).toEqual([slug(c!.id)]);
    expect(meta(c!.id).title).toBe('CSV-Export');
    expect(share(c!.id)).toMatchObject({ stale: true });
  });

  test('a page shared again on its own meanwhile no longer counts', async () => {
    const [a, b] = await outdated(2, 1);
    sharing.reshareMany(null);
    sharing.share(a!.id);
    await until(() => reshare()?.run?.left === 0);
    expect(reshare()!.run).toMatchObject({ total: 1, done: 1 });
    expect(share(b!.id)!.outdated).toBeUndefined();
  });

  test('goes on after a restart', async () => {
    const [a, b] = await outdated(2, 1);
    // the restart came while b went out
    board.work(b!.id, { share: JSON.stringify({ ...JSON.parse(board.row(b!.id).share!), state: 'publishing', refresh: true, again: true }) });
    board.setReshareRun({ queue: [b!.id, a!.id], total: 2, done: 0, failed: [] });
    sharing = make();
    sharing.resume();
    await until(() => reshare()?.run?.left === 0);
    expect(reshare()!.run).toMatchObject({ total: 2, done: 2 });
    expect(share(a!.id)!.outdated).toBeUndefined();
    expect(share(b!.id)!.outdated).toBeUndefined();
  });

  test('a restart keeps the marks of stored shares and the run under way as they were', async () => {
    const [a, b, c, d] = await outdated(4, 3, 2, 1);
    // d is up to date again on its own; the restart came while b went out, a still to go, c left out
    sharing.share(d!.id);
    await until(() => share(d!.id)?.state === 'shared' && !share(d!.id)!.outdated);
    board.work(b!.id, { share: JSON.stringify({ ...JSON.parse(board.row(b!.id).share!), state: 'publishing', refresh: true, again: true }) });
    board.setReshareRun({ queue: [b!.id, a!.id], total: 2, done: 0, failed: [] });
    const stored = (id: string) => board.row(id).share;
    const before = [a, c, d].map((x) => stored(x!.id));
    writeFileSync(join(dir, 'hold'), '');
    const n = calls().length;
    sharing = make();
    sharing.resume();
    // b goes out again once the versions were asked for
    await until(() => calls().length === n + 1);
    expect(wrote(n)).toEqual([slug(b!.id)]);
    expect([a, c, d].map((x) => stored(x!.id))).toEqual(before);
    expect(reshare()).toEqual({ outdated: 1, run: { total: 2, done: 0, failed: [], left: 2, current: b!.title } });
    rmSync(join(dir, 'hold'));
    await until(() => reshare()?.run?.left === 0);
    expect(reshare()).toEqual({ outdated: 1, run: { total: 2, done: 2, failed: [], left: 0 } });
    expect([a, b, c, d].map((x) => !!share(x!.id)!.outdated)).toEqual([false, false, true, false]);
  });
});

describe('the link in the pull request', () => {
  test('a page shared before the PR is published again with its link, and the description links the page', async () => {
    const c = card();
    sharing.share(c.id);
    await until(() => share(c.id)?.state === 'shared');
    expect(meta(c.id).pr).toBeNull();
    openPr(c.id);
    sharing.prOpened(c.id);
    // the card goes on showing the page while it goes out again
    expect(share(c.id)).toMatchObject({ state: 'shared', url: expect.stringContaining(SITE_URL) });
    await until(() => calls().length === 2);
    await until(() => edits.length === 1);
    const url = share(c.id)!.url!;
    expect(calls()[1]!.wrote).toEqual([slug(c.id)]);
    expect(meta(c.id)).toMatchObject({ title: 'CSV-Export', pr: PR });
    expect(bodies.get(PR)).toBe(`Exportiert Zählerstände.\n\nDemo-Video: ${url} ${DEMO_MARKER}\n`);
    expect(log(c.id)).toContain(`Die geteilte Seite verlinkt jetzt den Pull Request: ${url}`);
    expect(log(c.id).at(-1)).toBe('Den Link zur Demo in die Beschreibung von Pull Request #42 eingetragen.');
    // once: the PR is linked, and the description is not touched again
    sharing.prOpened(c.id);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls()).toHaveLength(2);
    expect(edits).toHaveLength(1);
  });

  test('a page shared after the PR links it at once; a description that links the page already stays', async () => {
    const c = card();
    openPr(c.id, `Exportiert Zählerstände.\n\nDemo: ${SITE_URL}zahlerstande-exportieren-${c.id.slice(0, 6)}/`);
    sharing.share(c.id);
    await until(() => share(c.id)?.state === 'shared');
    expect(calls()).toHaveLength(1);
    expect(meta(c.id).pr).toBe(PR);
    expect(edits).toEqual([]);
  });

  test('a PR opened while the page goes out gets a second round with its link', async () => {
    const c = card();
    sharing.share(c.id);
    // the deploy is running
    await until(() => calls().length === 1);
    openPr(c.id);
    sharing.prOpened(c.id);
    await until(() => calls().length === 2 && edits.length === 1);
    expect(calls().map((x) => x.pages[slug(c.id)]!.meta!.pr)).toEqual([null, PR]);
  });

  test('a newer demo on the card is not put out with the link: the page goes out again as it is', async () => {
    const c = card();
    sharing.share(c.id);
    await until(() => share(c.id)?.state === 'shared');
    const newer = videoDir(join(dir, 'newer'));
    writeFileSync(join(newer, 'demo.mp4'), 'newer video');
    board.work(c.id, { demo: JSON.stringify({ kind: 'video', dir: newer, chapters: [[0, 'Neu']], page: { title: 'CSV-Export 2', text: 'T.' } }) });
    openPr(c.id);
    sharing.prOpened(c.id);
    // the link goes in once the deploy is done: recorded, it is still copying the site
    await until(() => calls().length === 2 && edits.length === 1);
    expect(meta(c.id)).toMatchObject({ title: 'CSV-Export', chapters: [[0, 'Vorher']], pr: PR });
    expect(readFileSync(join(dir, 'deployed', slug(c.id), 'demo.mp4'), 'utf8')).toBe('video');
    expect(share(c.id)!.stale).toBe(true);
  });

  test('a description that cannot be read leaves the page shared, with the reason in the log', async () => {
    const c = card();
    board.work(c.id, { pr: JSON.stringify({ url: PR, number: 42, seen: [], reported: [] }) });
    sharing.share(c.id);
    await until(() => board.events(c.id).at(-1)!.kind === 'error');
    expect(share(c.id)!.state).toBe('shared');
    expect(log(c.id).at(-1)).toContain('nicht in Pull Request #42 eingetragen: gh pr view: no pull request');
  });

  test('withDemoLink adds a line once and replaces its own', () => {
    expect(withDemoLink('', 'https://d/a/')).toBe(`Demo-Video: https://d/a/ ${DEMO_MARKER}\n`);
    expect(withDemoLink('Text\n\n', 'https://d/a/')).toBe(`Text\n\nDemo-Video: https://d/a/ ${DEMO_MARKER}\n`);
    expect(withDemoLink('Siehe https://d/a/', 'https://d/a/')).toBeNull();
    expect(withDemoLink(`Text\n\nDemo-Video: https://d/old/ ${DEMO_MARKER}\n\nFooter`, 'https://d/a/')).toBe(`Text\n\nDemo-Video: https://d/a/ ${DEMO_MARKER}\n\nFooter`);
    expect(withDemoLink(`Text\n\nDemo-Video: https://d/old/ ${DEMO_MARKER}`, 'https://d/a/', 'html')).toBe(`Text\n\nDemo-Seite: https://d/a/ ${DEMO_MARKER}`);
  });
});

describe('exporting a demo, where the repository has no demo site', () => {
  /** A demo directory as the demo skill leaves it. */
  function files(c: { id: string }, video = 'MP4DATA') {
    const d = join(dir, `demo-${c.id}`);
    writeFileSync(join(d, 'demo.mp4'), video);
    writeFileSync(join(d, 'poster.jpg'), 'JPEG');
    writeFileSync(join(d, 'captions.vtt'), 'WEBVTT\n\n00:00.000 --> 00:02.500\nDer Export </script> beginnt.\n');
  }

  test('as a ZIP: the page in a folder with the video, poster and captions beside it', async () => {
    const c = card('Ohne Ziel');
    files(c);
    const out = await sharing.export(c.id, 'zip');
    const slug = 'ohne-ziel-' + c.id.slice(0, 6);
    expect(out.name).toBe(`${slug}.zip`);
    writeFileSync(join(dir, out.name), out.data);
    // a ZIP every system opens: checked by unzip
    const p = Bun.spawnSync(['unzip', '-o', '-d', join(dir, 'unzipped'), join(dir, out.name)]);
    expect(p.exitCode).toBe(0);
    const at = join(dir, 'unzipped', slug);
    expect(readFileSync(join(at, 'demo.mp4'), 'utf8')).toBe('MP4DATA');
    expect(readFileSync(join(at, 'poster.jpg'), 'utf8')).toBe('JPEG');
    const html = readFileSync(join(at, 'index.html'), 'utf8');
    expect(html).toContain('<h1>CSV-Export</h1>');
    expect(html).toContain('<p>Vermieter laden Zählerstände als CSV.</p>');
    expect(html).toContain('src="demo.mp4"');
    expect(html).toContain('Vorher');
    // the captions are in the page too, for a page opened from disk; they cannot end its script
    expect(html).toContain('Der Export <\\/script> beginnt.');
    // a big play button over the video, so a click anywhere on it starts it
    expect(html).toContain('<button class="start" aria-label="Abspielen">');
    // in the demo's language throughout
    expect(html).toContain('<html lang="de">');
    expect(html).toContain('<div class="when">Demo vom ');
    expect(html).toContain(`v.addTextTrack('captions', "Deutsch", "de")`);
    expect(log(c.id).at(-1)).toBe(`Exportiert als ZIP: ${slug}.zip`);
    // exporting publishes nothing
    expect(calls()).toEqual([]);
    expect(share(c.id)).toBeUndefined();
  });

  test('as one HTML file holding the video, for short videos only', async () => {
    const c = card('Ohne Ziel');
    files(c);
    const out = await sharing.export(c.id, 'html');
    const html = new TextDecoder().decode(out.data);
    expect(out.name).toMatch(/^ohne-ziel-.*\.html$/);
    expect(html).toContain(Buffer.from('MP4DATA').toString('base64'));
    expect(html).toContain(`poster="data:image/jpeg;base64,${Buffer.from('JPEG').toString('base64')}"`);
    expect(html).not.toContain('src="demo.mp4"');

    const big = card('Lang');
    files(big, 'x'.repeat(EXPORT_HTML_MAX + 1));
    await expect(sharing.export(big.id, 'html')).rejects.toMatchObject({ code: 'exportTooLarge' });
    expect((await sharing.export(big.id, 'zip')).name).toEndWith('.zip');
  });

  test('an English demo gets an English page throughout', async () => {
    const c = card('Ohne Ziel', { page: { title: 'CSV export', text: 'Landlords download meter readings as CSV.' } }, 'en');
    files(c);
    openPr(c.id);
    utimesSync(join(dir, `demo-${c.id}`, 'demo.mp4'), new Date('2026-10-07T12:00:00Z'), new Date('2026-10-07T12:00:00Z'));
    const html = new TextDecoder().decode((await sharing.export(c.id, 'html')).data);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<div class="when">Demo from October 7, 2026</div>');
    expect(html).toContain('<button class="start" aria-label="Play">');
    expect(html).toContain(`>View pull request</a>`);
    expect(html).toContain(`v.addTextTrack('captions', "English", "en")`);
    for (const german of ['Deutsch', 'Abspielen', 'Demo vom', 'ansehen', 'lang="de"']) expect(html).not.toContain(german);
    // a site's page, with the caption file beside it, names the track in English too
    const parts = { title: 'CSV export', text: '', chapters: [], pr: null, when: '', tabTitle: '', video: { src: 'demo.mp4' }, captions: { src: 'captions.vtt' } };
    expect(demoPageHtml({ ...parts, language: 'en' })).toContain('<track kind="captions" src="captions.vtt" srclang="en" label="English">');
    // without a language the page is German
    expect(demoPageHtml(parts)).toContain('<track kind="captions" src="captions.vtt" srclang="de" label="Deutsch">');
  });

  test('a demo without its page gets one written first, kept for the next time', async () => {
    const c = card('Zähler', { page: undefined });
    files(c);
    const out = sharing.export(c.id, 'zip');
    await until(() => runtime.sessions.length === 1);
    runtime.last.call('page', { title: 'Zählerstände als CSV', text: 'Vermieter laden sie herunter.' });
    runtime.last.emit({ type: 'idle' });
    expect((await out).name).toEndWith('.zip');
    expect(board.item(c.id)!.demo!.page).toEqual({ title: 'Zählerstände als CSV', text: 'Vermieter laden sie herunter.' });
  });

  test('an HTML artifact: beside its page in the ZIP, in one HTML file only when it is its index.html alone', async () => {
    const c = card('Ohne Ziel', { kind: 'html', chapters: [], page: { title: 'Auswertung', text: 'Verlust aus den Messdaten.' } });
    const d = join(dir, `demo-${c.id}`);
    writeFileSync(join(d, 'index.html'), '<html lang="de"><body><h2>Graph</h2></body></html>');
    const one = new TextDecoder().decode((await sharing.export(c.id, 'html')).data);
    expect(one).toContain('<h1>Auswertung</h1>');
    // the artifact in a sandboxed frame, telling the page its height
    expect(one).toContain('srcdoc="&lt;html lang=&quot;de&quot;&gt;&lt;body&gt;&lt;h2&gt;Graph&lt;/h2&gt;');
    expect(one).toContain('obeyaHeight');
    expect(one).toContain('sandbox="allow-scripts');

    mkdirSync(join(d, 'data'));
    writeFileSync(join(d, 'data', 'chart.js'), 'draw()');
    writeFileSync(join(d, '.DS_Store'), 'x');
    await expect(sharing.export(c.id, 'html')).rejects.toMatchObject({ code: 'exportNotAlone' });
    const out = await sharing.export(c.id, 'zip');
    writeFileSync(join(dir, out.name), out.data);
    expect(Bun.spawnSync(['unzip', '-o', '-d', join(dir, 'unzipped'), join(dir, out.name)]).exitCode).toBe(0);
    const at = join(dir, 'unzipped', out.name.replace(/\.zip$/, ''));
    expect(readFileSync(join(at, 'index.html'), 'utf8')).toContain('<iframe src="artifact/index.html"');
    expect(readFileSync(join(at, 'index.html'), 'utf8')).toContain('>In eigenem Fenster öffnen</a>');
    expect(readFileSync(join(at, 'artifact/data/chart.js'), 'utf8')).toBe('draw()');
    expect(readFileSync(join(at, 'artifact/index.html'), 'utf8')).toMatch(/<h2>Graph<\/h2><script>[\s\S]*obeyaHeight[\s\S]*<\/script><\/body>/);
    expect(existsSync(join(at, 'artifact/.DS_Store'))).toBe(false);
  });

  test('an English artifact gets an English page around it', async () => {
    const c = card('Ohne Ziel', { kind: 'html', chapters: [], page: { title: 'Analysis', text: 'Loss from the readings.' } });
    writeFileSync(join(dir, `demo-${c.id}`, 'index.html'), '<!doctype html><html lang="en"><body><h2>Graph</h2></body></html>');
    openPr(c.id);
    const out = await sharing.export(c.id, 'zip');
    writeFileSync(join(dir, out.name), out.data);
    expect(Bun.spawnSync(['unzip', '-o', '-d', join(dir, 'unzipped'), join(dir, out.name)]).exitCode).toBe(0);
    const html = readFileSync(join(dir, 'unzipped', out.name.replace(/\.zip$/, ''), 'index.html'), 'utf8');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('>Open in its own window</a><a href="https://github.com/acme/app/pull/42">View pull request</a>');
    expect(html).toMatch(/<div class="when">Demo from \w+ \d+, \d{4}<\/div>/);
  });

  test('no demo, no export', async () => {
    // an artifact without its page, a video demo whose file is gone
    await expect(sharing.export(card('Logo', { kind: 'html' }).id, 'zip')).rejects.toMatchObject({ code: 'noShare' });
    const gone = card('Weg');
    rmSync(join(dir, `demo-${gone.id}`, 'demo.mp4'));
    await expect(sharing.export(gone.id, 'zip')).rejects.toMatchObject({ code: 'noShare' });
  });
});
