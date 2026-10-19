// Sharing a card's demo with colleagues, a video or an HTML artifact: a page outside Obeya, on the
// static site Obeya keeps itself (`demo.site` of the repository's settings, site.ts). Obeya writes
// the page's text when the worker did not. A page keeps the newest page change (page-changes.ts) it
// was published after: one that lacks a change since is offered to share again ("Erneut teilen"),
// with what that brings, on its card, or many at once from the Koordinator's sheet.
// Once the card has a pull request, its description links the page and the page links it. A
// repository without a site (or with a site whose credentials are not on this machine) exports
// the demo instead: the same page as a ZIP with its files, or as one HTML file.
// Pages of one target are on one site, so each publish names the others.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { LANGUAGE_NAMES } from '../core/locale';
import { MESSAGES, type Messages } from '../core/messages';
import { type Demo, type DemoKind, type DemoPage, EXPORT_HTML_MAX, type Item } from '../core/types';
import { BadRequest, type Board, cardDemos, type DemoRef, type PrState, reshareable, sameDemo, type SharedDemo, sharedDemos, type StoredDemo, type StoredReshare, type StoredShare } from './board';
import { PAGE_CHANGES, pagesVersion } from '../core/page-changes';
import type { DemoSite } from '../adapters/types';
import { expandHome, readDemoSettings } from '../../plugin/skills/demo/lib/settings.ts';
import { type Gone, siteBase, siteMissing, siteTarget } from './site';
import { artifactCopy } from './artifact-copy';
import { ARTIFACT_DIR, artifactFiles, artifactPageHtml, type DemoPageParts, day, demoFile, demoPageHtml, ON_DISK, PAGE_WORDS, type PageLanguage } from './demo-page';
import { type Forge, parsePrUrl } from './forge';
import type { AgentRuntime } from './runtime';
import { readSession } from './koordinator';
import type { CardRow } from './db';
import { branchName } from './workspaces';
import { zip } from './zip';
import { messageOf } from '../core/text';

/** A later demo version on a page, below the first as an addendum. */
export interface PageDemo {
  title: string;
  text: string;
  kind: DemoKind;
  chapters: [number, string][];
  dir: string;
  /** When it was handed over, which its section is headed with. */
  at?: string;
}

/** What a page on the site is made of: the first demo version shared, and the later ones below it. */
export interface SharePage {
  /** Stays the same for a card, so a shared link keeps working when the page is published again. */
  slug: string;
  title: string;
  text: string;
  /** A video, or an HTML artifact. */
  kind: DemoKind;
  /** Seconds and title of each scene; none for an artifact. */
  chapters: [number, string][];
  /** The card's pull request, once it has one. */
  pr: string | null;
  /** The demo's language, for the page's own words (`language` of the page templates). */
  language: PageLanguage;
  /** The demo's directory: `demo.mp4`, `poster.jpg`, `captions.vtt`; an artifact's `index.html` and the files it loads. */
  dir: string;
  /** The slugs of the other pages Obeya has stored as shared on this site: the site must still hold them. */
  shared: string[];
  /** The later demo versions on the page, in order of handover. */
  more?: PageDemo[];
}

/** Where a repository's demos go: the site its settings name; with its checkout. */
export interface ShareSource {
  site: DemoSite;
  repo: string;
}

/**
 * Where a card's pages go. Pages whose targets have the same key are on one site: a publish or
 * withdrawal names the others as shared. Keys are not stored, so they only need to stay the same
 * across a restart.
 */
export interface ShareTarget {
  key: string;
  /** The card's repository checkout. */
  repo: string;
  /**
   * The page's URL, or why it did not go out; what the target said on the way goes into the card's
   * log, and what it says while it goes on (`log`). `gone`: pages another machine withdrew, found
   * on the way.
   */
  publish(page: SharePage, log?: (text: string) => void): Promise<({ url: string; said: string } | { why: string; said: string }) & { gone?: Gone[] }>;
  withdraw(slug: string, shared: string[], log?: (text: string) => void): Promise<{ why?: string; said: string; gone?: Gone[] }>;
  /**
   * The pages another machine withdrew (their cards here lose their link), and the pages shared
   * from here (`shared`) that the live site lacks or has older, taken offline by another machine's
   * deployment that came in between.
   */
  audit(shared: string[]): Promise<{ gone: Gone[]; missing: string[] }>;
  /** Where the page of `slug` is, before it is published. */
  pageUrl(slug: string): string;
  /** Deploys again what this machine has, for the pages `audit` found missing. */
  repair(shared: string[], log?: (text: string) => void): Promise<{ why?: string; said: string; gone?: Gone[] }>;
}

/**
 * Where a site's deploy runs, under Obeya's home: not in the checkout, which is often a workspace
 * of the pool too, and a file a command leaves in its working directory (`wrangler pages deploy`
 * writes its cache there) would keep the workspace from being leased until someone cleans up.
 */
export const SHARE_CWD = 'share';

export interface SharingOptions {
  board: Board;
  runtime: AgentRuntime;
  /** Where the card's repository shares demos; null when it shares none. */
  sourceFor: (card: Item) => ShareSource | null;
  /** The language the card's repository names for its demos (`demo.language` of its settings); none where it names none. */
  languageFor?: (card: Item) => PageLanguage | undefined;
  /** Obeya's data directory, passed to a site's deploy as `OBEYA_HOME`; the deploy runs in a directory of it (`SHARE_CWD`). */
  home: string;
  /** Where the card's pull request is, for the page's link in its description. */
  forge: Forge;
}

/** A site's deploy that has not finished by then is stopped (an upload of a few files takes seconds). */
export const COMMAND_TIMEOUT = 15 * 60_000;

/** The pages of all canvases go out one at a time: a site directory takes one change at a time. */
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
};

export class Sharing {
  /** When the versions were last asked for because the owner came back. */
  private checked = 0;
  /** A page of the run sharing many again is waiting for its turn, or going out. */
  private resharing = false;

  constructor(private o: SharingOptions) {}

  /**
   * "Teilen", "Auf der Seite ersetzen" or "Zur Seite dazunehmen": one of the card's demos (by its handover; the latest
   * without) is published right away, on the card's page in place of the versions there, or beside
   * them in its place by handover (`add`). A demo on the page already goes out again with the rest.
   * There is no hold to take it back: "Nicht mehr teilen" withdraws it just as easily.
   */
  share(cardId: string, { demo: handover, add = false }: { demo?: number | undefined; add?: boolean } = {}) {
    const card = this.card(cardId);
    const demo = handover === undefined ? this.demo(cardId) : this.cardDemo(cardId, { handover, dir: '' });
    if (card.prototypeOf || !demo || !this.target(card)) throw new BadRequest('noShare', 'the card has no demo, or its repository shares none');
    const s = this.stored(cardId);
    if (s?.state) throw new BadRequest('shareBusy', 'the page is being shared or withdrawn');
    const now: DemoRef[] = s?.url ? sharedDemos(s) : [];
    const ref = refOf(demo);
    const on = now.some((d) => sameDemo(d, ref));
    const next = on ? now : add ? inOrder([...now, ref]) : [ref];
    this.set(cardId, { ...(s ? atRest(s) : { slug: slugOf(card) }), state: 'publishing', next: next.map(refOf) });
    const t = this.o.board.t.share;
    const said = !s?.url ? t.share : on ? t.again : add ? t.added : t.newDemo;
    this.o.board.log(cardId, 'state', 'owner', said);
    void serial(() => this.publish(cardId));
  }

  /**
   * The owner approved the card's work. Where its repository's site publishes on approval
   * (`demo.site.publish`), its latest demo goes on its page unless it is there: beside the versions
   * there where its worker said it only supplements them, else in their place. It goes out through
   * the queue like any share, so the landing does not wait for it; a failure goes into the card's
   * log. Returns the trailer for the commit that lands, for a card with a page (`Demo-Video: <url>`,
   * `Demo-Page:` for an artifact): its URL is known before the deploy is done.
   */
  approved(cardId: string): string | null {
    try {
      return this.publishApproved(cardId);
    } catch (e) {
      // the work lands all the same
      this.o.board.log(cardId, 'error', 'obeya', `${this.o.board.t.share.notShared}: ${messageOf(e)}`);
      return null;
    }
  }

  private publishApproved(cardId: string): string | null {
    const card = this.find(cardId);
    if (!card || card.prototypeOf) return null;
    const target = this.target(card);
    const demo = this.demo(cardId);
    const s = this.stored(cardId);
    if (target && demo && this.o.sourceFor(card)?.site.publish === 'approved' && !s?.state) {
      const now: DemoRef[] = s?.url ? sharedDemos(s) : [];
      const ref = refOf(demo);
      if (!now.some((d) => sameDemo(d, ref))) {
        const add = now.length > 0 && demo.follows === 'supplements';
        this.set(cardId, { ...(s ? atRest(s) : { slug: slugOf(card) }), state: 'publishing', next: (add ? inOrder([...now, ref]) : [ref]).map(refOf) });
        this.o.board.log(cardId, 'state', 'obeya', this.o.board.t.share.approved(!now.length ? 'share' : add ? 'add' : 'replace'));
        void serial(() => this.publish(cardId));
      }
    }
    // the page as it is about to be, or as it is
    const page = this.stored(cardId);
    if (!page || page.state === 'withdrawing') return null;
    const first = page.state === 'publishing' && page.next ? page.next[0] : page.url ? sharedDemos(page)[0] : undefined;
    const url = target ? target.pageUrl(page.slug) : page.url;
    if (!first || !url) return null;
    const kind = this.cardDemo(cardId, first)?.kind ?? sharedDemos(page).find((d) => sameDemo(d, first))?.shown.kind;
    return `${kind === 'html' ? 'Demo-Page' : 'Demo-Video'}: ${url}`;
  }

  /**
   * Takes one demo version off the page (by its handover), which goes out again without it; the
   * last one, or without a handover the whole page, is withdrawn.
   */
  unshare(cardId: string, handover?: number) {
    const s = this.stored(cardId);
    if (s?.state) throw new BadRequest('shareBusy', 'the page is being shared or withdrawn');
    if (!s?.url) throw new BadRequest('notShared', 'the demo is not shared');
    const t = this.o.board.t.share;
    const now = sharedDemos(s);
    const demo = handover === undefined ? null : (this.cardDemo(cardId, { handover, dir: '' }) ?? { handover, dir: '' });
    const rest = demo ? now.filter((d) => !sameDemo(d, refOf(demo))) : [];
    if (demo && rest.length === now.length) throw new BadRequest('notShared', 'the demo is not on the page');
    if (rest.length) {
      this.set(cardId, { ...s, state: 'publishing', next: rest.map(refOf) });
      this.o.board.log(cardId, 'state', 'owner', t.unshareOne);
      void serial(() => this.publish(cardId));
      return;
    }
    this.set(cardId, { ...s, state: 'withdrawing' });
    this.o.board.log(cardId, 'state', 'owner', t.unshare);
    void serial(() => this.withdraw(cardId));
  }

  /**
   * The card's pull request is open: a page shared before gets its link. A share under way picks
   * it up when it is done.
   */
  prOpened(cardId: string) {
    const s = this.stored(cardId);
    const pr = this.prOf(cardId);
    if (pr && s?.url && !s.state && s.pr !== pr) this.refresh(cardId);
  }

  /** After a restart: a share under way goes on, a withdrawal too. */
  resume() {
    this.convert();
    for (const { r, s } of this.shares()) {
      // one of many shared again goes on with the rest of them
      if (s.state === 'publishing' && s.again && this.o.board.reshareRun()?.queue[0] === r.id) continue;
      if (s.state === 'publishing') void serial(() => this.publish(r.id));
      else if (s.state === 'withdrawing') void serial(() => this.withdraw(r.id));
    }
    void serial(() => this.checkSites());
    this.nextAgain();
  }

  /**
   * Pages published before Obeya kept the page changes (until 2026-10-16) kept a hash of sample
   * pages instead, which says nothing about what changed: their change is read off the page as the
   * site has it (the style for an artifact alone came with the security fix, Newsreader with the
   * look), and one whose page is not there counts as published before both.
   */
  private convert() {
    const known = new Set<string>(['', ...PAGE_CHANGES.map((c) => c.id)]);
    for (const { r, s } of this.shares()) {
      if (!s.url || (s.version !== undefined && known.has(s.version))) continue;
      const card = this.find(r.id);
      const source = card && this.o.sourceFor(card);
      let page = '';
      try {
        if (source) page = readFileSync(join(siteBase(this.o.home, source.site), 'site', s.slug, 'index.html'), 'utf8');
      } catch {}
      const version = page.includes('body.alone') ? '2026-10-16-alone' : page.includes('Newsreader') ? '2026-10-10-look' : '';
      const { outdated: _, ...rest } = s as StoredShare & { outdated?: true };
      this.set(r.id, { ...rest, version });
    }
    // pages from before several versions (until 2026-10-16) showed one demo: a list of one, the
    // card's demo in that directory (the latest one rendered there) named by its handover
    for (const { r, s } of this.shares()) {
      if (s.demos || !s.dir || !s.shown) continue;
      const { dir: _, shown: __, ...rest } = s;
      const demo = cardDemos(r).findLast((d) => d.dir === s.dir);
      const one: SharedDemo = { ...(demo ? refOf(demo) : { dir: s.dir }), ...(demo?.at ? { at: demo.at } : {}), dir: s.dir, shown: s.shown };
      this.set(r.id, { ...rest, demos: [one] });
    }
  }

  /**
   * "Erneut teilen" for many pages at once, from the Koordinator's sheet: the outdated pages, the
   * newest demos first, `count` of them or all. They go out one after the other, each as it shows
   * now, so a newer demo on a card still waits for its "Neu teilen"; a share the owner starts
   * meanwhile goes out between two of them.
   */
  reshareMany(count: number | null) {
    const run = this.o.board.reshareRun();
    if (run?.queue.length) throw new BadRequest('reshareBusy', 'pages are being shared again already');
    const rows = this.o.board
      .outdatedRows()
      .filter(({ r }) => this.find(r.id) && this.target(this.find(r.id)!))
      .map(({ r }) => ({ r, s: JSON.parse(r.share!) as StoredShare }));
    if (!rows.length) throw new BadRequest('nothingOutdated', 'no shared page is outdated');
    const made = (dir?: string) => (dir ? (statOr(join(dir, 'demo.mp4')) ?? statOr(join(dir, 'index.html')) ?? statOr(dir) ?? 0) : 0);
    // newest by the newest version on the page
    const queue = rows
      .map(({ r, s }) => ({ id: r.id, at: Math.max(0, ...sharedDemos(s).map((d) => made(d.dir))) }))
      .sort((a, b) => b.at - a.at)
      .slice(0, count ?? undefined)
      .map((r) => r.id);
    this.o.board.setReshareRun({ queue, total: queue.length, done: 0, failed: [] });
    this.nextAgain();
  }

  /** Stops sharing many again: the page going out finishes, the rest stay as they are. */
  stopResharing() {
    const run = this.o.board.reshareRun();
    if (!run?.queue.length) return;
    const going = this.resharing && this.stored(run.queue[0]!)?.state === 'publishing' ? [run.queue[0]!] : [];
    this.o.board.setReshareRun({ ...run, queue: going, stopped: true });
  }

  /** "Ausblenden": puts away what the finished run says, and the notice of outdated pages until a newer change. */
  dismissResharing() {
    if (this.o.board.reshareRun()?.queue.length) throw new BadRequest('reshareBusy', 'pages are being shared again');
    this.o.board.dismissOutdated();
  }

  /** The next page of the run sharing many again, once the site is free. */
  private nextAgain() {
    if (this.resharing || !this.o.board.reshareRun()?.queue.length) return;
    this.resharing = true;
    void serial(() => this.again()).finally(() => {
      this.resharing = false;
      this.nextAgain();
    });
  }

  private async again() {
    const id = this.o.board.reshareRun()?.queue[0];
    if (!id) return;
    const s = this.stored(id);
    let ok: boolean | null = null;
    if (s?.state === 'publishing' && s.again) ok = await this.publish(id);
    else {
      const row = this.find(id) && this.o.board.row(id);
      if (s && row && reshareable(row).length) {
        this.set(id, { ...s, state: 'publishing', refresh: true, again: true });
        this.o.board.log(id, 'state', 'owner', this.o.board.t.share.againWithOthers);
        ok = await this.publish(id);
      }
    }
    // shared again meanwhile on its own, withdrawn or gone: it no longer counts
    const run = this.o.board.reshareRun();
    if (!run) return;
    const next: StoredReshare = { ...run, queue: run.queue.filter((x) => x !== id) };
    if (ok === true) next.done++;
    else if (ok === false) next.failed = [...next.failed, id];
    else next.total--;
    this.o.board.setReshareRun(next);
  }

  /**
   * The owner came back to Obeya: each site is asked again (at most once a minute) which pages
   * another machine withdrew, or took offline.
   */
  soon() {
    if (Date.now() - this.checked < 60_000) return;
    this.checked = Date.now();
    void serial(() => this.checkSites());
  }

  /**
   * Asks each site with pages out which of them another machine withdrew (their cards lose their
   * link), or took offline (deployed again).
   */
  async checkSites() {
    const targets = new Map<string, ShareTarget>();
    for (const { r, s } of this.shares()) {
      const card = this.find(r.id);
      const target = card && s.url ? this.target(card) : null;
      if (target) targets.set(target.key, target);
    }
    for (const target of targets.values()) {
      const shared = this.others('', target.key);
      const { gone, missing } = await target.audit(shared);
      this.lost(target.key, gone);
      if (missing.length) await this.repair(target, shared, missing);
    }
  }

  /** Pages shared from here that another machine's deployment took offline: deployed again, a line on each card. */
  private async repair(target: ShareTarget, shared: string[], missing: string[]) {
    const ids = this.shares()
      .filter(({ s }) => missing.includes(s.slug))
      .map(({ r }) => r.id);
    const log = (kind: 'activity' | 'state' | 'error', text: string) => ids.forEach((id) => this.o.board.log(id, kind, 'obeya', text));
    const t = this.o.board.t.share;
    const r = await target.repair(shared, (text) => log('activity', text));
    this.lost(target.key, r.gone);
    if (r.why) return log('error', [t.notRestored(r.why), r.said].filter(Boolean).join('\n\n'));
    if (r.said) log('activity', r.said);
    log('state', t.restored);
  }

  /** Pages withdrawn on another machine: their cards here lose their link. */
  private lost(key: string, gone: Gone[] = []) {
    for (const g of gone) {
      const { r, s } = this.shares().find(({ s }) => s.slug === g.slug) ?? {};
      const card = r && this.find(r.id);
      if (!r || !s?.url || s.state || !card || this.target(card)?.key !== key) continue;
      this.set(r.id, { slug: s.slug });
      this.o.board.log(r.id, 'state', 'obeya', this.o.board.t.share.withdrawnElsewhere(g.machine));
    }
  }

  /** Publishes again what the page shows, with the pull request's link. */
  private refresh(cardId: string) {
    const s = this.stored(cardId);
    if (!s?.url || s.state) return;
    this.set(cardId, { ...s, state: 'publishing', refresh: true });
    void serial(() => this.publish(cardId));
  }

  /** Publishes the card's page; whether it went out (null: nothing to publish). */
  private async publish(cardId: string): Promise<boolean | null> {
    const s = this.stored(cardId);
    const card = this.find(cardId);
    if (s?.state !== 'publishing' || !card) return null;
    const t = this.o.board.t.share;
    const failed = s.again ? t.notAgain : s.refresh ? t.notLinked : t.notShared;
    const back = (why: string, out = '') => {
      this.set(cardId, atRest(s));
      this.o.board.log(cardId, 'error', 'obeya', [`${failed}: ${why}`, out].filter(Boolean).join('\n\n'));
      return false;
    };
    const target = this.target(card);
    let demos: SharedDemo[];
    if (s.refresh) {
      // the page as it is: a newer demo on the card waits for "Auf der Seite ersetzen" or "Zur Seite dazunehmen"
      demos = sharedDemos(s);
      if (!demos.length || !target) {
        if (s.again) return back(t.demoGone);
        this.set(cardId, atRest(s));
        this.o.board.log(cardId, 'activity', 'obeya', t.linkLater);
        return null;
      }
    } else {
      // the versions the owner chose; a share from before them (until 2026-10-16) meant the latest demo
      const latest = this.demo(cardId);
      const want = s.next ?? (latest ? [refOf(latest)] : []);
      if (!want.length || !target) return back(t.noDemo);
      demos = [];
      for (const ref of want) {
        const kept = s.url ? sharedDemos(s).find((d) => sameDemo(d, ref)) : undefined;
        if (kept) {
          demos.push(kept);
          continue;
        }
        const demo = this.cardDemo(cardId, ref);
        if (!demo) return back(t.noDemo);
        const page = await this.page(card, demo);
        demos.push({ ...refOf(demo), ...(demo.at ? { at: demo.at } : {}), shown: { title: page.title, text: page.text, chapters: demo.chapters, kind: demo.kind } });
      }
    }
    const [first, ...later] = demos as [SharedDemo, ...SharedDemo[]];
    const pr = this.prOf(cardId);
    const input: SharePage = {
      slug: s.slug,
      ...first.shown,
      pr,
      language: this.languageOf(first.dir, card),
      dir: first.dir,
      shared: this.others(cardId, target.key),
      ...(later.length ? { more: later.map((d) => ({ ...d.shown, dir: d.dir, ...(d.at ? { at: d.at } : {}) })) } : {}),
    };
    const r = await target.publish(input, (text) => this.o.board.log(cardId, 'activity', 'obeya', text));
    this.lost(target.key, r.gone);
    if ('why' in r) return back(r.why, r.said);
    const { url } = r;
    this.set(cardId, { slug: s.slug, url, demos, ...(pr ? { pr } : {}), version: pagesVersion() });
    if (r.said) this.o.board.log(cardId, 'activity', 'obeya', r.said);
    this.o.board.log(cardId, 'state', 'obeya', s.again ? t.sharedAgain(url) : s.refresh ? t.linksPr(url) : t.shared(url));
    if (pr) this.linkPr(cardId, pr, url, target.repo, first.shown.kind);
    // the pull request was opened while the page went out: once more, with its link
    const now = this.prOf(cardId);
    if (now && now !== pr) this.refresh(cardId);
    return true;
  }

  /**
   * Puts the page's link into the pull request's description, unless it is there already (the
   * worker put it there, or Obeya did before). A line of Obeya's own is found again by its marker.
   */
  private linkPr(cardId: string, pr: string, url: string, cwd: string, kind: DemoKind) {
    const n = parsePrUrl(pr)?.number;
    try {
      const body = withDemoLink(this.o.forge.body(cwd, pr), url, kind, this.o.board.t);
      if (body === null) return;
      this.o.forge.setBody(cwd, pr, body);
      this.o.board.log(cardId, 'state', 'obeya', this.o.board.t.share.prLinked(n));
    } catch (e) {
      this.o.board.log(cardId, 'error', 'obeya', this.o.board.t.share.prNotLinked(n, messageOf(e)));
    }
  }

  private async withdraw(cardId: string) {
    const s = this.stored(cardId);
    const card = this.find(cardId);
    if (s?.state !== 'withdrawing' || !card) return;
    const back = (why: string, out = '') => {
      this.set(cardId, atRest(s));
      this.o.board.log(cardId, 'error', 'obeya', [why, out].filter(Boolean).join('\n\n'));
    };
    const target = this.target(card);
    const t = this.o.board.t.share;
    if (!target) return back(t.notWithdrawnNoShare);
    const r = await target.withdraw(s.slug, this.others(cardId, target.key), (text) => this.o.board.log(cardId, 'activity', 'obeya', text));
    this.lost(target.key, r.gone);
    if (r.why) return back(r.why, r.said);
    this.set(cardId, { slug: s.slug });
    if (r.said) this.o.board.log(cardId, 'activity', 'obeya', r.said);
    this.o.board.log(cardId, 'state', 'obeya', t.withdrawn);
  }

  /**
   * The card's demo as a file to pass on, for a repository without a share target: the page in a
   * ZIP with the video, poster and captions beside it, or one HTML file that holds them all (videos
   * up to EXPORT_HTML_MAX). An HTML artifact goes beside its page in the ZIP, or into the one file
   * when it is its `index.html` alone. Nothing leaves Obeya, so nothing is held.
   */
  async export(cardId: string, as: 'zip' | 'html', handover?: number): Promise<{ name: string; type: string; data: Uint8Array<ArrayBuffer> }> {
    const card = this.card(cardId);
    const demo = handover === undefined ? this.demo(cardId) : this.cardDemo(cardId, { handover, dir: '' });
    if (demo?.kind === 'html' && !card.prototypeOf) return this.exportArtifact(card, demo, as);
    const video = demo && demoFile(demo.dir, 'demo.mp4');
    if (card.prototypeOf || !demo || !video || !existsSync(video)) throw new BadRequest('noShare', 'the card has no demo');
    const size = statSync(video).size;
    if (as === 'html' && size > EXPORT_HTML_MAX)
      throw new BadRequest('exportTooLarge', `the video is ${(size / 1024 / 1024).toFixed(1)} MiB; one HTML file takes at most ${EXPORT_HTML_MAX / 1024 / 1024} MiB`);
    const page = await this.page(card, demo);
    const slug = this.stored(cardId)?.slug ?? slugOf(card);
    const file = (f: string) => {
      const path = demoFile(demo.dir, f);
      return path ? new Uint8Array(readFileSync(path)) : null;
    };
    const poster = file('poster.jpg');
    const captions = file('captions.vtt');
    const language = this.languageOf(demo.dir, card);
    const parts: Omit<DemoPageParts, 'video' | 'poster'> = {
      title: page.title,
      text: page.text,
      chapters: demo.chapters,
      pr: this.prOf(cardId),
      when: PAGE_WORDS[language].demoOf(day(statSync(video).mtime, language)),
      tabTitle: page.title,
      language,
      // a page opened from disk may not load a caption file
      captions: { vtt: captions ? new TextDecoder().decode(captions) : 'WEBVTT\n' },
    };
    let out: { name: string; type: string; data: Uint8Array<ArrayBuffer> };
    if (as === 'html') {
      const html = demoPageHtml({
        ...parts,
        video: { base64: Buffer.from(readFileSync(video)).toString('base64') },
        ...(poster ? { poster: `data:image/jpeg;base64,${Buffer.from(poster).toString('base64')}` } : {}),
      });
      out = { name: `${slug}.html`, type: 'text/html; charset=utf-8', data: new TextEncoder().encode(html) };
    } else {
      const html = demoPageHtml({ ...parts, video: { src: 'demo.mp4' }, ...(poster ? { poster: 'poster.jpg' } : {}) });
      const entries = [
        { name: `${slug}/index.html`, data: new TextEncoder().encode(html) },
        { name: `${slug}/demo.mp4`, data: new Uint8Array(readFileSync(video)) },
        ...(poster ? [{ name: `${slug}/poster.jpg`, data: poster }] : []),
        ...(captions ? [{ name: `${slug}/captions.vtt`, data: captions }] : []),
      ];
      out = { name: `${slug}.zip`, type: 'application/zip', data: zip(entries) };
    }
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.share.exported(as === 'zip', out.name));
    return out;
  }

  private async exportArtifact(card: Item, demo: Demo & { dir: string }, as: 'zip' | 'html') {
    const files = artifactFiles(demo.dir);
    if (!files.includes('index.html')) throw new BadRequest('noShare', 'the card has no demo');
    if (as === 'html' && files.length > 1) throw new BadRequest('exportNotAlone', 'the artifact loads files beside its index.html; it goes out as a ZIP only');
    const page = await this.page(card, demo);
    const slug = this.stored(card.id)?.slug ?? slugOf(card);
    const index = readFileSync(join(demo.dir, 'index.html'), 'utf8');
    const language = this.languageOf(demo.dir, card);
    const when = PAGE_WORDS[language].demoOf(day(statSync(join(demo.dir, 'index.html')).mtime, language));
    const parts = { title: page.title, text: page.text, pr: this.prOf(card.id), when, tabTitle: page.title, language };
    let out: { name: string; type: string; data: Uint8Array<ArrayBuffer> };
    if (as === 'html') {
      out = { name: `${slug}.html`, type: 'text/html; charset=utf-8', data: new TextEncoder().encode(artifactPageHtml({ ...parts, artifact: { html: index } })) };
    } else {
      const copy = await artifactCopy(demo.dir, files, ON_DISK);
      const entries = [
        { name: `${slug}/index.html`, data: new TextEncoder().encode(artifactPageHtml({ ...parts, artifact: { src: `${ARTIFACT_DIR}/index.html` }, disk: true })) },
        ...files.map((f) => ({
          name: `${slug}/${ARTIFACT_DIR}/${f}`,
          data: copy.has(f) ? new TextEncoder().encode(copy.get(f)) : new Uint8Array(readFileSync(join(demo.dir, f))),
        })),
      ];
      out = { name: `${slug}.zip`, type: 'application/zip', data: zip(entries) };
    }
    this.o.board.log(card.id, 'state', 'owner', this.o.board.t.share.exported(as === 'zip', out.name));
    return out;
  }

  /** The page's title and text: the worker's, else written now and kept with the demo, so it is not written again. */
  private async page(card: Item, demo: Demo & { dir: string }): Promise<DemoPage> {
    if (demo.page) return demo.page;
    const page = await this.writePage(card, demo, this.languageOf(demo.dir, card));
    const row = this.o.board.row(card.id);
    const latest = this.demo(card.id);
    if (latest && sameDemo(latest, demo)) this.o.board.work(card.id, { demo: JSON.stringify({ ...latest, page }) });
    else if (row.demos)
      this.o.board.work(card.id, { demos: JSON.stringify((JSON.parse(row.demos) as StoredDemo[]).map((d) => (sameDemo(d, demo) ? { ...d, page } : d))) });
    return page;
  }

  /**
   * The page's text for a demo handed over without one (its repository did not share then): a short
   * session writes it from the worker's summary. Without one, the card's title and the summary's start stand in.
   */
  private async writePage(card: Item, demo: Demo, language: PageLanguage): Promise<DemoPage> {
    // a card's summary goes with its approval; the log keeps every handover
    const summary = this.o.board.summary(card.id) ?? this.o.board.events(card.id).filter((e) => e.kind === 'review' && e.author === 'worker').at(-1)?.text ?? '';
    const fallback: DemoPage = { title: plainText(card.title), text: plainText(summary).split(/(?<=[.!?])\s+/).slice(0, 4).join(' ') || plainText(card.title) };
    let page: DemoPage | null = null;
    await readSession(this.o.runtime, {
      cwd: this.target(card)?.repo ?? this.o.home,
      role: 'chores',
      system: pageSystem(LANGUAGE_NAMES[language]),
      tools: (finish) => [
        {
          name: 'page',
          description: `The page's title and text, in ${LANGUAGE_NAMES[language]}.`,
          schema: { title: z.string(), text: z.string() },
          run: ({ title, text }) => {
            if (page) return 'Already written.';
            page = { title: String(title).trim().slice(0, 200) || fallback.title, text: String(text).trim().slice(0, 2000) || fallback.text };
            return finish('Recorded. End your turn now.');
          },
        },
      ],
      brief: [
        `The card: “${plainText(card.title)}”.`,
        card.body.trim() ? `Its task:\n${card.body.trim().slice(0, 3000)}` : '',
        summary ? `What its worker handed over:\n${summary.slice(0, 4000)}` : '',
        demo.kind === 'html'
          ? 'The demo is a page to look at (an HTML artifact: charts, a comparison, an analysis), not a video.'
          : demo.chapters.length
            ? `The demo video's chapters: ${demo.chapters.map(([, t]) => t).join(' · ')}`
            : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    });
    return page ?? fallback;
  }

  /** The slugs of the other pages shared through the target. */
  private others(cardId: string, key: string): string[] {
    return this.shares()
      .filter(({ r }) => r.id !== cardId)
      .flatMap(({ r, s }) => {
        const card = this.find(r.id);
        return s.url && s.state !== 'withdrawing' && card && this.target(card)?.key === key ? [s.slug] : [];
      })
      .sort();
  }

  /** Where the card's pages go; null when its repository shares none, or its site's credentials are not on this machine. */
  private target(card: Item): ShareTarget | null {
    const src = this.o.sourceFor(card);
    if (!src || siteMissing(this.o.home, src.site)) return null;
    const language = this.o.languageFor?.(card);
    return siteTarget(src.site, src.repo, this.o.home, this.o.board.t.share, language ? { language } : {});
  }

  private card(cardId: string): Item {
    const card = this.o.board.card(cardId);
    if (!card) throw new BadRequest('unknownCard', 'unknown card');
    return card;
  }

  /** A card on the canvas or in the archive; none once it was deleted. */
  private find(cardId: string): Item | undefined {
    try {
      return this.o.board.card(cardId);
    } catch {
      return undefined;
    }
  }

  /** The card's pull request, once its worker opened it. */
  private prOf(cardId: string): string | null {
    const pr = this.o.board.row(cardId).pr;
    return pr ? ((JSON.parse(pr) as PrState).url ?? null) : null;
  }

  /**
   * The language a demo is in: the one its `index.html` names (the report page of a video, which the
   * director writes in the narration language, or the artifact itself), else the language the
   * card's repository names for its demos, else the narration language of the demo settings.
   */
  private languageOf(dir: string, card: Item): PageLanguage {
    try {
      const lang = /<html\b[^>]*\blang=["']?([a-z]{2})/i.exec(readFileSync(join(dir, 'index.html'), 'utf8').slice(0, 2000))?.[1]?.toLowerCase();
      if (lang === 'de' || lang === 'en') return lang;
    } catch {}
    return this.o.languageFor?.(card) ?? readDemoSettings(this.o.home).language;
  }

  /** One of the card's demos a page may show (`cardDemos`), by its handover, else by its directory. */
  private cardDemo(cardId: string, ref: DemoRef): StoredDemo | null {
    return cardDemos(this.o.board.row(cardId)).findLast((d) => sameDemo(d, ref)) ?? null;
  }

  private demo(cardId: string): (Demo & { dir: string }) | null {
    const d = this.o.board.row(cardId).demo;
    return d ? (JSON.parse(d) as Demo & { dir: string }) : null;
  }

  /** The cards of the canvas, archived ones too, that were ever shared or are about to be, with their shares. */
  private shares(): { r: CardRow; s: StoredShare }[] {
    return this.o.board.sharedRows().map((r) => ({ r, s: JSON.parse(r.share!) as StoredShare }));
  }

  private stored(cardId: string): StoredShare | null {
    if (!this.find(cardId)) return null;
    const s = this.o.board.row(cardId).share;
    return s ? (JSON.parse(s) as StoredShare) : null;
  }

  private set(cardId: string, s: StoredShare) {
    this.o.board.work(cardId, { share: JSON.stringify(s) });
  }
}

const pageSystem = (language: string) => `You write the page on which the demo of a change (a video, or a page with charts or an analysis) is shared with colleagues of the team. They have never seen the tool the change was planned in, its cards or plan docs; they know the product. Read the card's task and its worker's summary, and call the tool page once with:
- title: what changes, for a user of the product, in a few words (not the card's internal wording).
- text: two to five sentences in ${language}: what changes for the user and why. No findings, no test details, no internal process (cards, workers, demos, reviews), no markdown.
Then end your turn. Read code only if the summary leaves unclear what the change does for the user.`;

/** A share at rest: neither held, nor publishing, nor withdrawing. */
function atRest({ state: _, refresh: __, again: ___, next: ____, ...s }: StoredShare): StoredShare {
  return s;
}

/** What names a demo among the card's: its handover, and its directory. */
const refOf = (d: DemoRef): DemoRef => ({ ...(d.handover !== undefined ? { handover: d.handover } : {}), dir: d.dir });

/** Demo versions in order of handover; one without (from before handovers were kept) comes first. */
const inOrder = <T extends DemoRef>(demos: T[]): T[] => [...demos].sort((a, b) => (a.handover ?? -1) - (b.handover ?? -1));

/** When the file was last written, in ms; null when it is not there. */
function statOr(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/** Marks the line Obeya put into a pull request's description, so it is found again. */
export const DEMO_MARKER = '<!-- obeya:demo -->';

/** The description with a line linking the demo's page; null when it links the page already. */
export function withDemoLink(body: string, url: string, kind: DemoKind = 'video', t: Messages = MESSAGES.de): string | null {
  if (body.includes(url)) return null;
  const line = `${t.share.prLine(kind === 'html')}: ${url} ${DEMO_MARKER}`;
  const lines = body.split('\n');
  const i = lines.findIndex((l) => l.includes(DEMO_MARKER));
  if (i >= 0) {
    lines[i] = line;
    return lines.join('\n');
  }
  return body.trim() ? `${body.trimEnd()}\n\n${line}\n` : `${line}\n`;
}

/** A card's page keeps this slug for good: a shared link stays the same, and an export is named by it. */
const slugOf = (card: Item) => branchName(card.title, card.id).slice('obeya/'.length);

/** The words of a command line, as a shell would split it where quotes ("…", '…') keep spaces. */
export const commandWords = (line: string): string[] => [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);

/**
 * Argv whose program, given as a path, is found in the repository (`~` is the home directory), and
 * a script (`.ts`, `.js`) runs with Obeya's own Bun, on every platform.
 */
export function scriptArgv(words: string[], repoPath: string): string[] {
  if (!words.length) return [];
  let [program, ...rest] = words as [string, ...string[]];
  program = expandHome(program);
  const script = /\.(m?[jt]sx?|cjs)$/.test(program);
  if ((script || /[\\/]/.test(program)) && !isAbsolute(program)) program = resolve(repoPath, program);
  return script ? [process.execPath, program, ...rest] : [program, ...rest];
}

/** What the demo site lacks to be shared on (a title, an http(s) URL, a deploy command); null where it has it. */
export function siteIncomplete(site: DemoSite): string | null {
  if (!site.title.trim()) return 'demo.site.title: missing';
  if (!/^https?:\/\/[^\s/]+[^\s]*$/.test(site.url)) return 'demo.site.url: expected an http(s) URL';
  if (!site.deploy.trim()) return 'demo.site.deploy: missing';
  return null;
}

/**
 * Why the demo site a repository's settings name cannot be used, in English, starting with its
 * field (`demo.site.url: …`); null where it can. The configuration reports it.
 */
export function siteProblem(site: DemoSite, repoPath: string): string | null {
  const incomplete = siteIncomplete(site);
  if (incomplete) return incomplete;
  const argv = scriptArgv(commandWords(site.deploy), repoPath);
  const program = argv[0] === process.execPath ? argv[1] : argv[0];
  if (!program) return 'demo.site.deploy: the deploy command is empty';
  if (isAbsolute(program)) return existsSync(program) ? null : `demo.site.deploy: the deploy command's program ${program} does not exist`;
  return Bun.which(program) ? null : `demo.site.deploy: the deploy command's program ${program} is not on the PATH`;
}

/** The last lines of a command's output, for the card's log. */
export function tail(s: string, lines = 20): string {
  const all = s.trim().split('\n');
  return (all.length > lines ? ['…', ...all.slice(-lines)] : all).join('\n').slice(-3000);
}

const plainText = (s: string) => s.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
