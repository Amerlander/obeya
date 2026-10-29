// Setting up demo sites from the configuration: the owner's personal site (Konfiguration → Demos),
// and a repository's own site („Demo-Seite einrichten“ at its settings). Each setup runs in the
// background, since a login in the browser may take minutes; the dialog follows its lines.

import { basename } from 'node:path';
import type { DemoSite } from '../adapters/types';
import type { PersonalSiteView, SiteSetupJob } from '../core/types';
import { BadRequest } from './board';
import { allowPrivate, cloudflareDeploy, connect, connectionCode, envFileFor, newToken, type PersonalSite, personalDemoSite, readPersonal, type SiteHost, writeEnv, writePersonal } from './personal-site';
import { siteMissing } from './site';
import { cloudflareAccounts, type Exec, GITHUB_PAGES, GITHUB_PAGES_MAX, setupCloudflare, setupGithub, SetupRefused } from './site-hosts';
import { messageOf } from '../core/text';

export interface SiteSetupOptions {
  home: string;
  /** The personal site changed: every canvas tells its cards where they share now. */
  changed: () => void;
  /** The repositories on the canvases, by checkout, for the list of private ones ticked. */
  repoName?: (path: string) => string | undefined;
  /** Who runs Obeya here, for the personal site's name at Cloudflare. */
  user?: string;
  /** Runs wrangler, gh and git; a stand-in in tests. */
  x?: Exec;
  /** How long to wait (ms, step by step) for a new site's address to answer; a stand-in in tests. */
  wait?: number[];
}

/** The jobs: `personal`, or a repository's by its checkout. */
export class SiteSetup {
  private jobs = new Map<string, SiteSetupJob>();

  constructor(private o: SiteSetupOptions) {}

  view(): PersonalSiteView {
    const p = readPersonal(this.o.home);
    const job = this.jobs.get(PERSONAL);
    return {
      site: p
        ? {
            host: p.host,
            url: p.url,
            project: p.project,
            example: `${p.url.replace(/\/+$/, '')}/${newToken()}/…/`,
            ...(siteMissing(this.o.home, personalDemoSite(p)) ? { needs: p.env! } : {}),
          }
        : null,
      ...(job ? { job } : {}),
      privateRepos: (p?.private ?? []).map((path) => ({ path, name: this.o.repoName?.(path) ?? basename(path) })),
      cloudflareAccounts: this.accounts(),
    };
  }

  /** The Cloudflare accounts of the sites this machine deploys to, by site, for a new site to go into. */
  accounts(): string[] {
    return cloudflareAccounts(this.o.home).map((a) => a.site);
  }

  /** „Einrichten“: the personal site at the host, unlisted. */
  setupPersonal(input: unknown): PersonalSiteView {
    const host = hostOf(input);
    const account = accountOf(input);
    if (readPersonal(this.o.home)) throw new BadRequest('invalid', 'this machine has a personal demo site already; remove it first');
    this.run(PERSONAL, host, async (log) => {
      const name = `obeya-${slug(this.o.user ?? '') || 'demos'}`.slice(0, 50);
      let site: PersonalSite;
      if (host === 'cloudflare') {
        const r = await setupCloudflare({ home: this.o.home, name, log, ...(account ? { account } : {}), ...(this.o.x ? { x: this.o.x } : {}), ...(this.o.wait ? { wait: this.o.wait } : {}) });
        site = { host, url: r.url, project: r.project, secret: newToken(128) };
        if (r.env) writeEnv(this.o.home, (site.env = envFileFor(r.url, host)), r.env);
      } else {
        // always private: a public repository would list every page's random address
        const r = await setupGithub({ name: 'obeya-demos', private: true, log, ...(this.o.x ? { x: this.o.x } : {}), ...(this.o.wait ? { wait: this.o.wait } : {}) });
        site = { host, url: r.url, project: r.project, secret: newToken(128) };
      }
      writePersonal(this.o.home, site);
      this.o.changed();
      log(`Ready: ${site.url}`);
      return {};
    });
    return this.view();
  }

  /** „Mit vorhandener Seite verbinden“: the personal site another machine of the owner's set up, by its code. */
  connect(input: unknown): PersonalSiteView {
    const code = (input as { code?: unknown } | null)?.code;
    if (typeof code !== 'string' || !code.trim()) throw new BadRequest('invalid', 'expected { code }');
    try {
      connect(this.o.home, code);
    } catch (e) {
      throw new BadRequest('invalid', messageOf(e));
    }
    this.jobs.delete(PERSONAL);
    this.o.changed();
    return this.view();
  }

  /** The code that connects another machine: the site and its credentials. */
  code(): { code: string } {
    const p = readPersonal(this.o.home);
    if (!p) throw new BadRequest('invalid', 'no personal demo site on this machine');
    return { code: connectionCode(this.o.home, p) };
  }

  /** „Von diesem Rechner entfernen“: this machine no longer shares there; the pages online stay, as does the project at the host. */
  remove(): PersonalSiteView {
    writePersonal(this.o.home, null);
    this.jobs.delete(PERSONAL);
    this.o.changed();
    return this.view();
  }

  /** Ticks or unticks a private repository for the personal site. */
  allow(input: unknown): PersonalSiteView {
    const { path, on } = (input ?? {}) as { path?: unknown; on?: unknown };
    if (typeof path !== 'string' || typeof on !== 'boolean') throw new BadRequest('invalid', 'expected { path, on }');
    try {
      allowPrivate(this.o.home, path, on);
    } catch (e) {
      throw new BadRequest('invalid', messageOf(e));
    }
    this.o.changed();
    return this.view();
  }

  /** „Demo-Seite einrichten“ at a repository's settings: a listed site at the host, its `demo.site` for the dialog to take in. */
  setupRepo(input: unknown): SiteSetupJob | null {
    const { path, host: h, name } = (input ?? {}) as { path?: unknown; host?: unknown; name?: unknown };
    if (typeof path !== 'string' || !path) throw new BadRequest('invalid', 'expected { path, host }');
    const host = hostOf({ host: h });
    const account = accountOf(input);
    const title = typeof name === 'string' && name.trim() ? name.trim() : basename(path);
    const project = `${slug(title) || 'demos'}-demos`.slice(0, 50);
    this.run(path, host, async (log) => {
      let site: DemoSite;
      if (host === 'cloudflare') {
        const r = await setupCloudflare({ home: this.o.home, name: project, log, ...(account ? { account } : {}), ...(this.o.x ? { x: this.o.x } : {}), ...(this.o.wait ? { wait: this.o.wait } : {}) });
        site = { title: `${title} demos`, url: r.url, deploy: cloudflareDeploy(r.project) };
        if (r.env) writeEnv(this.o.home, (site.env = envFileFor(r.url, host)), r.env);
      } else {
        // listed: the repository behind it may be public, as everything on the site is
        const r = await setupGithub({ name: project, private: false, log, ...(this.o.x ? { x: this.o.x } : {}), ...(this.o.wait ? { wait: this.o.wait } : {}) });
        site = { title: `${title} demos`, url: r.url, deploy: `${GITHUB_PAGES} ${r.project}`, maxFile: GITHUB_PAGES_MAX };
      }
      log(`Ready: ${site.url}`);
      return { site };
    });
    return this.jobs.get(path) ?? null;
  }

  /** A repository's setup, as far as it got; null without one. */
  repoJob(path: string): SiteSetupJob | null {
    return this.jobs.get(path) ?? null;
  }

  /** The dialog took in a repository's finished setup. */
  doneWith(path: string) {
    if (!this.jobs.get(path)?.running) this.jobs.delete(path);
  }

  private run(key: string, host: SiteHost, fn: (log: (line: string) => void) => Promise<{ site?: DemoSite }>) {
    if (this.jobs.get(key)?.running) throw new BadRequest('invalid', 'a setup is running already');
    const job: SiteSetupJob = { host, running: true, lines: [] };
    this.jobs.set(key, job);
    const log = (line: string) => {
      job.lines = [...job.lines, line.slice(0, 400)].slice(-12);
    };
    fn(log).then(
      ({ site }) => {
        job.running = false;
        if (site) job.site = site;
      },
      (e) => {
        job.running = false;
        job.error = messageOf(e);
        if (e instanceof SetupRefused && e.offer) job.offer = e.offer;
        console.error(`Obeya: setting up a demo site at ${host} failed: ${job.error}`);
      },
    );
  }
}

const PERSONAL = 'personal';

function hostOf(input: unknown): SiteHost {
  const host = (input as { host?: unknown } | null)?.host;
  if (host !== 'cloudflare' && host !== 'github') throw new BadRequest('invalid', 'expected { host: "cloudflare" | "github" }');
  return host;
}

/** The Cloudflare account to set up in, by the site whose credentials it takes; none: the machine's own `wrangler login`. */
function accountOf(input: unknown): string | undefined {
  const a = (input as { account?: unknown } | null)?.account;
  return typeof a === 'string' && a ? a : undefined;
}

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
