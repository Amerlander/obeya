// Obeya's configuration: the canvases it serves, saved in `canvases.json` under its home. The owner
// reads and edits it in its sheet, the Koordinator on their word. A saved change applies while
// Obeya runs (`Canvases.apply`, see Live configuration in docs/design.md): what a repository's
// agents are set up by restarts that repository's agents alone, once they paused. The
// repositories' settings (`RepoSettings`) are read where they are used, apply at once, and saving
// them alone restarts nothing but where they change where the workers work.

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { REPO_ADAPTER_DIR, REPO_SETTINGS_FILE } from '../adapters';
import { settingsShape } from '../adapters/schema';
import { type AgentsView, blocksSaving, type CanvasConfig, type DemoSite, type ConfigChecked, type ConfigProblem, type ConfigSaved, type ConfigView, type RepoSettings, SHARED_FIELDS, NESTED_SETTINGS, type NestedSetting, isNested, type SettingsShared, type SharedSettings, type DemoSettingsProblem, type DemoSettingsView, type DemoVoiceCheck, type LanguageView, type ResolvedCanvas, type ThemeView, type VoiceInstallJob, layerSettings, type ProposedSetting, settingPatch } from '../core/types';
import {
  DEMO_SETTINGS_FILE,
  type DemoSettings,
  expandHome,
  NARRATION_LANGUAGES,
  narrationPerson,
  readDemoSettings,
  SERVICES,
  tidyDemoSettings,
  VOICES,
  writeDemoSettings,
} from '../../plugin/skills/demo/lib/settings.ts';
import { checkSetup, type SetupCheck } from '../../plugin/skills/demo/lib/setup.ts';
import { installState, installVoice, KEY_ENV, sample } from '../../plugin/skills/demo/lib/voices.ts';
import { BadRequest } from './board';
import { ConfigError, readingRepo, resolveCanvas } from './canvas';
import type { Store } from './db';
import { freshPath } from './path';
import type { Forge } from './forge';
import { commitShared, proposeShared, pushShared } from './shared-settings';
import { gitCalls, gitSteps } from './workspaces';
import { VERSION } from './resources';
import { agentsView, languageView, pushKeyChoice, saveAgents, saveLanguage, savePushKey, saveTheme, themeView } from './settings';
import { siteProblem } from './share';

export const CONFIG_FILE = 'canvases.json';

/** A path with `~` for the home directory, as the owner may write it. */
export const expand = (p: string) => p.replace(/^~(?=$|\/)/, homedir());

/** The configuration with its paths as the server uses them. */
export function expandConfig(canvases: CanvasConfig[]): CanvasConfig[] {
  return canvases.map((c) => ({
    ...c,
    repos: c.repos.map((r) => ({ ...r, path: expand(r.path), ...(r.workspaces ? { workspaces: r.workspaces.map(expand) } : {}) })),
  }));
}

/**
 * A repository's settings as they are saved: lists without empty lines, no main branch or plan
 * directory that is empty; none at all where nothing is set. An empty list or command is a value
 * of its own (no checks, no setup), unlike one left out.
 */
function tidySettings(s: z.infer<typeof settingsShape> | undefined): RepoSettings | undefined {
  if (!s) return undefined;
  const list = (l?: string[]) => l?.map((x) => x.trim()).filter(Boolean);
  const dir = s.planDocs?.dir.trim().replace(/\/+$/, '');
  const site = tidySite(s.demo?.site);
  const app = tidyApp(s.app);
  const out: RepoSettings = {
    ...(s.branch?.trim() ? { branch: s.branch.trim() } : {}),
    ...(s.land ? { land: s.land } : {}),
    ...(s.direct !== undefined ? { direct: s.direct } : {}),
    ...(s.checks ? { checks: list(s.checks)! } : {}),
    ...(s.setup !== undefined ? { setup: s.setup.trim() } : {}),
    ...(dir ? { planDocs: { dir, exclude: list(s.planDocs!.exclude)! } } : {}),
    ...(s.softPaths ? { softPaths: list(s.softPaths)! } : {}),
    ...(s.workspaces ? { workspaces: s.workspaces } : {}),
    ...(s.prNoise ? { prNoise: list(s.prNoise)! } : {}),
    ...(app ? { app } : {}),
    ...(site ? { demo: { site } } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/**
 * How the app runs, as it is saved: each field trimmed. An empty recipe is a value of its own (none,
 * over the repository's); an empty command is none and goes. None where nothing is left.
 */
function tidyApp(s: RepoSettings['app']): RepoSettings['app'] {
  if (!s) return undefined;
  const out = { ...(s.run !== undefined ? { run: s.run.trim() } : {}), ...(s.stop?.trim() ? { stop: s.stop.trim() } : {}), ...(s.keep?.trim() ? { keep: s.keep.trim() } : {}) };
  return Object.keys(out).length ? out : undefined;
}

/** A demo site as it is saved: its fields trimmed, those left empty out; none where nothing is filled in. */
function tidySite(s: DemoSite | undefined): DemoSite | undefined {
  if (!s) return undefined;
  const headers = Object.entries(s.headers ?? {}).filter(([k]) => k.trim());
  const out: DemoSite = {
    title: s.title.trim(),
    url: s.url.trim(),
    deploy: s.deploy.trim(),
    ...(s.env?.trim() ? { env: s.env.trim() } : {}),
    ...(headers.length ? { headers: Object.fromEntries(headers.map(([k, v]) => [k.trim(), v.trim()])) } : {}),
    ...(s.maxFile ? { maxFile: s.maxFile } : {}),
    ...(s.language ? { language: s.language } : {}),
  };
  return out.title || out.url || out.deploy || Object.keys(out).length > 3 ? out : undefined;
}

const shape = z.array(
  z
    .object({
      name: z.string().optional(),
      id: z.string().optional(),
      repos: z.array(
        z
          .object({
            path: z.string(),
            workspaces: z.array(z.string()).optional(),
            clones: z.number().int().min(0).max(20).optional(),
            slots: z.number().int().min(0).max(20).optional(),
            hosts: z
              .array(
                z
                  .object({
                    name: z
                      .string()
                      .regex(/^\s*[\w.-]*\s*$/, 'a host name is letters, digits, dots, dashes and underscores')
                      // a directory of its own under Obeya's home holds the host's copies
                      .refine((n) => !/^\.{1,2}$/.test(n.trim()), 'a host name is more than dots'),
                    // read by ssh as an option when it starts with a dash
                    ssh: z.string().refine((s) => !s.trim().startsWith('-'), 'an ssh target does not start with a dash'),
                    root: z.string(),
                    clones: z.number().int().min(0).max(20),
                    slots: z.number().int().min(0).max(20).optional(),
                  })
                  .strict(),
              )
              .optional(),
            settings: settingsShape.optional(),
          })
          .strict(),
      ),
    })
    .strict(),
);

/** The configuration as it is saved: no empty names, clone lists or counts. */
function tidy(canvases: z.infer<typeof shape>): CanvasConfig[] {
  return canvases.map((c) => ({
    ...(c.name?.trim() ? { name: c.name.trim() } : {}),
    ...(c.id?.trim() ? { id: c.id.trim() } : {}),
    repos: c.repos.map((r) => {
      const workspaces = (r.workspaces ?? []).map((w) => w.trim()).filter(Boolean);
      // a host without a name or a machine is a row still being filled in
      const hosts = (r.hosts ?? []).map((h) => ({ name: h.name.trim(), ssh: h.ssh.trim(), root: h.root.trim() || '~/obeya', clones: h.clones, ...(h.slots !== undefined ? { slots: h.slots } : {}) })).filter((h) => h.name && h.ssh);
      const settings = tidySettings(r.settings);
      return {
        path: r.path.trim(),
        ...(workspaces.length ? { workspaces } : {}),
        ...(r.clones ? { clones: r.clones } : {}),
        ...(r.slots !== undefined ? { slots: r.slots } : {}),
        ...(hosts.length ? { hosts } : {}),
        ...(settings ? { settings } : {}),
      };
    }),
  }));
}

/** Reads a configuration file; throws when it is no list of canvases. */
export function readConfigFile(file: string): CanvasConfig[] {
  return tidy(shape.parse(withoutGone(JSON.parse(readFileSync(file, 'utf8')))));
}

/** A file as read, without the settings Obeya no longer has: a repository's share command (its demo site took its place). */
function withoutGone(made: unknown): unknown {
  if (Array.isArray(made)) for (const c of made) for (const r of Array.isArray(c?.repos) ? c.repos : []) if (r && typeof r === 'object') delete r.share;
  return made;
}

export interface ConfigOptions {
  /** Where it is saved. */
  file: string;
  /** Whether the running canvases come from that file or from the command line. */
  source: 'file' | 'args';
  /** The configuration the server started with, paths as given. */
  started: CanvasConfig[];
  store: Store;
  /** The ids of the canvases the server runs. */
  running: () => string[];
  /** The running server's settings; `commit` the one its checkout stands at (none for the compiled binary). */
  server: { port: number; home: string; permissionMode: string; commit?: string | null };
  /** Where this Obeya answers, so a sample's voice is held by it (`narration.ts`); none in tests. */
  narrationUrl?: string;
  /** The lock a heavy voice's sample waits for; the machine's (TTS_LOCK) unless a test gives its own. */
  ttsLock?: string;
  /**
   * Starts Obeya again with the saved configuration, for canvases that came from the command line
   * (the file is the configuration from then on); absent where nothing restarts it (--dev).
   */
  restart?: () => void;
  /**
   * The running canvases take the saved configuration over without a restart (`Canvases.apply`):
   * `ids` are its canvases' ids, null where one does not resolve.
   */
  apply?: (canvases: CanvasConfig[], ids: (string | null)[]) => void;
  /** Repositories' settings for everyone were committed: the running canvases read them again. */
  onSettings?: () => void;
  /** Where „Für alle ins Repository übernehmen“ opens its pull request. */
  forge?: Forge;
}

/** Whether the repository has the branch, locally or as `origin`'s. */
async function hasBranch(path: string, branch: string): Promise<boolean> {
  const found = await gitSteps(path, gitCalls(...['refs/heads/', 'refs/remotes/origin/'].map((ref) => ['rev-parse', '--verify', '--quiet', `${ref}${branch}^{commit}`])));
  return found.some((x) => x !== null);
}

const demoShape = z
  .object({
    language: z.enum(NARRATION_LANGUAGES),
    voice: z.enum(VOICES),
    ownVoice: z.boolean().optional(),
    command: z.string().optional(),
    url: z.string().optional(),
    voiceName: z.string().optional(),
    reference: z.string().optional(),
    keyFile: z.string().optional(),
  })
  .strict();

function parseDemo(input: unknown): DemoSettings {
  const parsed = demoShape.safeParse(input);
  if (!parsed.success) throw new BadRequest('config', z.prettifyError(parsed.error));
  return tidyDemoSettings(parsed.data);
}

/** What keeps demo settings from working; saving them is allowed all the same. */
export function demoSettingsProblems(
  s: DemoSettings,
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): DemoSettingsProblem[] {
  const problems: DemoSettingsProblem[] = [];
  if (s.voice === 'command' && !s.command) problems.push('noCommand');
  if ((s.voice === 'http' || s.voice === 'azure') && !s.url) problems.push('noUrl');
  if (s.voice === 'say' && platform !== 'darwin') problems.push('notHere');
  const service = (SERVICES as readonly string[]).includes(s.voice) || s.voice === 'http';
  if (service && !env[KEY_ENV[s.voice as keyof typeof KEY_ENV]]) {
    if (s.keyFile && !existsSync(expandHome(s.keyFile))) problems.push('keyFileMissing');
    else if (!s.keyFile && s.voice !== 'http') problems.push('noKey');
  }
  if (s.voice === 'qwen3' && s.reference) {
    const clip = expandHome(s.reference);
    if (!existsSync(clip)) problems.push('referenceMissing');
    else if (!existsSync(clip.replace(/\.wav$/i, '.txt'))) problems.push('noTranscript');
  }
  return problems;
}

export class Config {
  private restarting = false;
  /** The file as last read, by its time and size: repositories' settings are read from it whenever they are used. */
  private read?: { stamp: string; canvases: CanvasConfig[] };

  constructor(private o: ConfigOptions) {}

  /** The configuration as saved, or as started when nothing is saved yet (or the file no longer reads). */
  current(): CanvasConfig[] {
    if (this.o.source === 'file' && existsSync(this.o.file)) {
      try {
        const { mtimeMs, size } = statSync(this.o.file);
        const stamp = `${mtimeMs}:${size}`;
        if (this.read?.stamp === stamp) return this.read.canvases;
        const canvases = readConfigFile(this.o.file);
        this.read = { stamp, canvases };
        return canvases;
      } catch {}
    }
    return this.o.started;
  }

  /** The settings the owner set for the repository at `path` (absolute) on this machine, as saved now; none where they set none. */
  repoSettings(path: string): RepoSettings | undefined {
    for (const c of this.current()) for (const r of c.repos) if (resolve(expand(r.path)) === path) return r.settings;
    return undefined;
  }

  /**
   * The repository's `.obeya/settings.json` changed from `before` to `after`: this machine's values
   * that it now holds, and did not before, were taken over for everyone (here, or by whoever
   * merged the same values), so they go from this machine's settings and come from the
   * repository. Saved without anything following; the caller follows.
   */
  takenOver(path: string, before: SharedSettings | undefined, after: SharedSettings | undefined) {
    if (!after) return;
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const changed = this.dropSettings(path, (s) => {
      for (const k of SHARED_FIELDS) {
        if (isNested(k)) {
          const [mine, theirs, was] = [s[k], after[k], before?.[k]] as (Record<string, unknown> | undefined)[];
          for (const f of NESTED_SETTINGS[k]) if (mine?.[f] !== undefined && same(mine[f], theirs?.[f]) && !same(was?.[f], theirs?.[f])) delete mine[f];
        } else if (s[k] !== undefined && same(s[k], after[k]) && !same(before?.[k], after[k])) delete s[k];
      }
    });
    if (changed) console.log(`Obeya: settings of ${path} now come from its ${REPO_SETTINGS_FILE}; removed from this machine's`);
  }

  /**
   * Removes from this machine's settings for the repository at `path` what `drop` deletes from a
   * copy of them, saved without anything following; whether something went.
   */
  private dropSettings(path: string, drop: (s: RepoSettings) => void): boolean {
    if (this.o.source !== 'file' || !existsSync(this.o.file)) return false;
    let changed = false;
    const canvases = this.current().map((c) => ({
      ...c,
      repos: c.repos.map((r) => {
        if (resolve(expand(r.path)) !== path || !r.settings) return r;
        const s: RepoSettings = { ...r.settings };
        for (const k of Object.keys(NESTED_SETTINGS) as NestedSetting[]) if (s[k]) (s as Record<string, unknown>)[k] = { ...s[k] };
        drop(s);
        for (const k of Object.keys(NESTED_SETTINGS) as NestedSetting[]) if (s[k] && !Object.keys(s[k]).length) delete s[k];
        if (JSON.stringify(s) === JSON.stringify(r.settings)) return r;
        changed = true;
        const { settings: _, ...rest } = r;
        return Object.keys(s).length ? { ...rest, settings: s } : rest;
      }),
    }));
    if (!changed) return false;
    writeFileSync(this.o.file, `${JSON.stringify(canvases, null, 2)}\n`);
    this.read = undefined;
    return true;
  }

  /**
   * A value for a repository's setting that the Arbeitsrückschau proposed, taken by the owner for
   * the repository at `path` (absolute): on this machine, or into its `.obeya/settings.json` for
   * everyone, the way „Für alle ins Repository übernehmen“ goes, with this value alone. Committed
   * on the main branch, this machine's own value for it goes, so the repository's applies here
   * too; as a pull request, it is set on this machine as well until the pull request is merged
   * (`takenOver` then removes it). Says where it went for everyone; nothing for this machine.
   */
  async takeSetting(path: string, field: ProposedSetting, value: string | string[], where: 'machine' | 'repository'): Promise<SettingsShared | null> {
    const canvases = this.current();
    const at = canvases.flatMap((c, canvas) => c.repos.map((r, repo) => ({ r, canvas, repo }))).find(({ r }) => resolve(expand(r.path)) === path);
    if (!at) throw new BadRequest('invalid', `no repository ${path} in the configuration`);
    const patch = settingPatch(field, value);
    const onMachine = () =>
      this.save(canvases.map((c, i) => (i !== at.canvas ? c : { ...c, repos: c.repos.map((r, j) => (j !== at.repo ? r : { ...r, settings: layerSettings(r.settings, patch) })) })));
    if (where === 'machine') {
      await onMachine();
      return null;
    }
    const to = (await this.check(canvases)).resolved[at.canvas]?.repos[at.repo]?.shareTo ?? 'main';
    if (to === 'pr') {
      if (!this.o.forge) throw new BadRequest('settingsShare', 'no forge to open a pull request with');
      const done = proposeShared(path, patch, this.o.forge);
      console.log(`Obeya: ${field} of ${path} for everyone, as a pull request: ${'pr' in done ? done.pr : ''}`);
      await onMachine();
      return done;
    }
    const { before: _, after, ...done } = commitShared(path, patch);
    console.log(`Obeya: ${field} of ${path} for everyone, committed on ${'branch' in done ? done.branch : ''}`);
    this.takenOver(path, undefined, after);
    // where this machine set another value, the repository's applies here as well from now on
    this.dropSettings(path, (s) => {
      if (field === 'run') delete s.app?.run;
      else delete s[field];
    });
    this.o.onSettings?.();
    return done;
  }

  /**
   * „Für alle ins Repository übernehmen“: the settings saved for the repository at `path` (as the
   * configuration names it) on this machine, but its main branch, go into its
   * `.obeya/settings.json`: committed on the main branch where work lands there (they then come
   * from the repository, here too), else as a pull request (once it is merged), or with `direct`,
   * where work may also go straight to main, pushed onto `origin`'s main branch.
   */
  async shareSettings(input: unknown): Promise<SettingsShared> {
    const parsed = z.object({ path: z.string(), direct: z.boolean().optional() }).safeParse(input);
    if (!parsed.success) throw new BadRequest('invalid', 'expected { path, direct? }');
    const canvases = this.current();
    const at = canvases.flatMap((c, canvas) => c.repos.map((r, repo) => ({ r, canvas, repo }))).find(({ r }) => r.path === parsed.data.path);
    if (!at) throw new BadRequest('noSettings', `no repository ${parsed.data.path} in the configuration`);
    const { branch: _, ...mine } = at.r.settings ?? {};
    if (!Object.keys(mine).length) throw new BadRequest('noSettings', `${at.r.path}: nothing set on this machine to take over`);
    const repoPath = resolve(expand(at.r.path));
    const resolved = (await this.check(canvases)).resolved[at.canvas];
    const to = resolved?.repos[at.repo]?.shareTo ?? 'main';
    if (to === 'pr' && parsed.data.direct) {
      if (!resolved?.repos[at.repo]?.shareDirect) throw new BadRequest('noDirect', `${repoPath}: work goes to main only through pull requests`);
      const { after, ...done } = pushShared(repoPath, mine);
      console.log(`Obeya: settings of ${repoPath} for everyone, pushed onto origin's ${'branch' in done ? done.branch : ''}`);
      this.takenOver(repoPath, undefined, after);
      this.o.onSettings?.();
      return done;
    }
    if (to === 'pr') {
      if (!this.o.forge) throw new BadRequest('settingsShare', 'no forge to open a pull request with');
      const done = proposeShared(repoPath, mine, this.o.forge);
      console.log(`Obeya: settings of ${repoPath} for everyone, as a pull request: ${'pr' in done ? done.pr : ''}`);
      return done;
    }
    const { before: _was, after, ...done } = commitShared(repoPath, mine);
    console.log(`Obeya: settings of ${repoPath} for everyone, committed on ${'branch' in done ? done.branch : ''}`);
    // all of them are in the file now, also those it held already
    this.takenOver(repoPath, undefined, after);
    this.o.onSettings?.();
    return done;
  }

  /** The configuration as saved, at once: what it amounts to and what is wrong with it come from `check`, which takes longer. */
  view(): ConfigView {
    return {
      file: this.o.file,
      source: this.o.source,
      canvases: this.current(),
      running: this.o.running(),
      server: { commit: null, ...this.o.server, version: VERSION, restarts: !!this.o.restart },
      restarting: this.restarting,
    };
  }

  /** The check of the configuration as saved while one runs: a page that loads and the dialog opening at the same time share it. */
  private checking?: { canvases: CanvasConfig[]; done: Promise<ConfigChecked> };

  /** `check` of the configuration as saved. */
  checkSaved(): Promise<ConfigChecked> {
    const canvases = this.current();
    if (this.checking?.canvases !== canvases) {
      const done = this.check(canvases).finally(() => {
        if (this.checking?.done === done) this.checking = undefined;
      });
      this.checking = { canvases, done };
    }
    return this.checking.done;
  }

  /**
   * Checks a configuration without saving it: every canvas resolves, and no two share an id. What
   * it reads of the repositories with git it reads once for each, all of them at once, without
   * blocking the server meanwhile.
   */
  async check(input: unknown): Promise<ConfigChecked> {
    const parsed = shape.safeParse(input);
    if (!parsed.success) return { canvases: [], resolved: [], problems: [{ code: 'invalid', detail: z.prettifyError(parsed.error) }] };
    const canvases = tidy(parsed.data);
    const expanded = expandConfig(canvases);
    const repos = expanded.flatMap((c) => c.repos);
    // a workspace needs only to be a repository; one that is also a repository of the configuration is read as that
    const paths = new Set(repos.map((r) => resolve(r.path)));
    const workspaces = new Set(repos.flatMap((r) => (r.workspaces ?? []).map((w) => resolve(w))).filter((w) => !paths.has(w)));
    const branches = repos.flatMap((r) => (r.settings?.branch && existsSync(r.path) ? [{ path: resolve(r.path), branch: r.settings.branch }] : []));
    const [reads, clones, found] = await Promise.all([
      Promise.all([...paths].map(async (p) => [p, await gitSteps(p, readingRepo(p))] as const)).then((x) => new Map(x)),
      Promise.all([...workspaces].map(async (w) => [w, (await gitSteps(w, gitCalls(['rev-parse', '--git-dir'])))[0] != null] as const)).then((x) => new Map(x)),
      Promise.all(branches.map(async (b) => [`${b.path}\0${b.branch}`, await hasBranch(b.path, b.branch)] as const)).then((x) => new Map(x)),
    ]);
    const isRepo = (path: string) => clones.get(path) ?? !!reads.get(path);
    const read = (path: string) => reads.get(path) ?? null;
    const problems: ConfigProblem[] = [];
    if (!canvases.length) problems.push({ code: 'noCanvas', detail: 'Obeya needs at least one canvas' });
    // a host's name stands for one machine across the configuration: its workspaces are named by it
    const machines = new Map<string, string>();
    const resolved = expanded.map((c, canvas): ResolvedCanvas | null => {
      c.repos.forEach((r, repo) =>
        (r.workspaces ?? []).forEach((w) => {
          if (!isRepo(resolve(w))) problems.push({ code: 'notClone', canvas, repo, detail: `workspace ${w} is not a git repository` });
        }),
      );
      c.repos.forEach((r, repo) => {
        const branch = r.settings?.branch;
        if (branch && found.get(`${resolve(r.path)}\0${branch}`) === false) problems.push({ code: 'noBranch', canvas, repo, detail: `${r.path} has no branch ${branch}, neither here nor on origin` });
      });
      c.repos.forEach((r, repo) =>
        (r.hosts ?? []).forEach((h) => {
          const other = machines.get(h.name);
          if (other !== undefined && other !== h.ssh) problems.push({ code: 'hostName', canvas, repo, detail: `host ${h.name} connects to ${other} elsewhere, here to ${h.ssh}` });
          machines.set(h.name, h.ssh);
        }),
      );
      try {
        const { id, name, adapters, reads: got, values, refs, config } = resolveCanvas(c, this.o.store, undefined, undefined, read);
        const without = values();
        // what is wrong in a repository's settings for everyone is fixed there, not here: it keeps nothing from being saved
        const leftover = c.repos.map((r) => got[config.repos.indexOf(r)]!.adapterModule);
        c.repos.forEach((r, repo) => {
          const adapter = adapters[config.repos.indexOf(r)]!;
          if (leftover[repo])
            problems.push({ code: 'adapterGone', canvas, repo, detail: `${REPO_ADAPTER_DIR}/ on the main branch is no longer read; what it says belongs in ${REPO_SETTINGS_FILE}` });
          if (r.hosts?.length) {
            const why = adapter.land === 'main' ? 'its work lands on the main of this checkout' : !got[config.repos.indexOf(r)]!.info.remote ? 'it has no remote to clone from' : null;
            if (why) problems.push({ code: 'hostRepo', canvas, repo, detail: `the repository cannot have workers on other machines: ${why}` });
          }
          const site = adapter.demo?.site;
          const wrong = site && siteProblem(site, resolve(r.path));
          if (wrong) problems.push({ code: 'demoSite', canvas, repo, detail: wrong });
          for (const detail of got[config.repos.indexOf(r)]!.shared.problems) problems.push({ code: 'repoSettings', canvas, repo, detail });
        });
        // the repositories in the order given, though the home one runs first
        return {
          id,
          name,
          repos: c.repos.map((r) => {
            const i = config.repos.indexOf(r);
            return {
              id: refs[i]!.id,
              workspaces: adapters[i]!.workspaces,
              ...(leftover[c.repos.indexOf(r)] ? { adapterGone: true } : {}),
              values: without[i]!,
              shareTo: adapters[i]!.land === 'main' ? 'main' : 'pr',
              ...(adapters[i]!.land === 'pr' && adapters[i]!.direct ? { shareDirect: true } : {}),
            };
          }),
        };
      } catch (e) {
        if (!(e instanceof ConfigError)) throw e;
        problems.push({ code: e.code, canvas, ...(e.repo !== undefined ? { repo: e.repo } : {}), detail: e.message });
        return null;
      }
    });
    resolved.forEach((r, canvas) => {
      const first = resolved.findIndex((x) => x?.id === r?.id);
      if (r && first !== canvas) problems.push({ code: 'sameId', canvas, detail: `canvas ${canvas + 1} has the id "${r.id}" of canvas ${first + 1}; give it another name` });
    });
    return { canvases, resolved, problems };
  }

  /** The demo settings in Obeya's home; a demo reads them when it renders, so no restart is needed. */
  demo(): DemoSettingsView {
    const settings = readDemoSettings(this.o.server.home);
    return {
      file: resolve(this.o.server.home, DEMO_SETTINGS_FILE),
      settings,
      check: this.voiceCheck(settings),
      ...(this.voiceJob ? { job: this.voiceJob } : {}),
      platform: process.platform,
    };
  }

  /** The language Obeya speaks to the owner, in `settings.json` in Obeya's home; saving it restarts nothing. */
  language(): LanguageView {
    return languageView(this.o.server.home);
  }

  saveLanguage(input: unknown): LanguageView {
    return saveLanguage(this.o.server.home, input);
  }

  /** Light or dark, in `settings.json` too; the page takes it at once. */
  theme(): ThemeView {
    return themeView(this.o.server.home);
  }

  saveTheme(input: unknown): ThemeView {
    return saveTheme(this.o.server.home, input);
  }

  /** The model and effort of each group of agents, in `settings.json` too; read whenever an agent starts. */
  agents(): AgentsView {
    return agentsView(this.o.server.home);
  }

  saveAgents(input: unknown): AgentsView {
    return saveAgents(this.o.server.home, input);
  }

  /** The push-to-talk key anywhere on the machine, in `settings.json` too; the app's shell reads it every few seconds. */
  pushKey() {
    return pushKeyChoice(this.o.server.home);
  }

  savePushKey(input: unknown) {
    return savePushKey(this.o.server.home, input);
  }

  saveDemo(input: unknown): DemoSettingsView {
    writeDemoSettings(parseDemo(input), this.o.server.home);
    console.log(`Obeya: demo settings saved to ${resolve(this.o.server.home, DEMO_SETTINGS_FILE)}`);
    return this.demo();
  }

  private voiceCheck(s: DemoSettings): DemoVoiceCheck {
    return { person: narrationPerson(s), problems: demoSettingsProblems(s), install: installState(s, this.o.server.home) };
  }

  /** A voice as the owner is choosing it, before it is saved. */
  checkDemo(input: unknown): DemoVoiceCheck {
    return this.voiceCheck(parseDemo(input));
  }

  /** What a render with these settings needs on this machine, and how to install what is missing. */
  async demoSetup(input: unknown): Promise<SetupCheck> {
    await freshPath();
    return checkSetup(parseDemo(input), { home: this.o.server.home });
  }

  private voiceJob?: VoiceInstallJob;

  /** Installs what the voice needs, in the background; the view says how far it got. */
  installDemoVoice(input: unknown): DemoSettingsView {
    const s = parseDemo(input);
    if (this.voiceJob?.running) throw new BadRequest('voiceInstalling', `${this.voiceJob.voice} is being installed`);
    const job: VoiceInstallJob = (this.voiceJob = { voice: s.voice, running: true, line: '' });
    console.log(`Obeya: installing the voice ${s.voice}`);
    installVoice(s, (line) => (job.line = line.slice(0, 300)), this.o.server.home).then(
      () => {
        job.running = false;
        console.log(`Obeya: voice ${s.voice} installed`);
      },
      (e: Error) => {
        job.running = false;
        job.error = e.message;
        console.error(`Obeya: installing the voice ${s.voice} failed: ${e.message}`);
      },
    );
    return this.demo();
  }

  /** One sentence in the voice, as WAV, so the owner hears it before choosing it. */
  async sampleDemoVoice(input: unknown): Promise<Uint8Array<ArrayBuffer>> {
    const s = parseDemo(input);
    const dir = mkdtempSync(join(tmpdir(), 'obeya-voice-'));
    try {
      const out = join(dir, 'sample.wav');
      await sample(s, out, this.o.server.home, this.o.narrationUrl, this.o.ttsLock).catch((e: Error) => {
        // tts.py says why on its last line: no key, no command, a service's refusal
        const why = e.message.trim().split('\n').at(-1) ?? e.message;
        throw new BadRequest('voiceSample', why);
      });
      return Uint8Array.from(readFileSync(out));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * Saves a configuration that works, and the running canvases take it over (design: Live
   * configuration). Where they came from the command line, Obeya starts again with it where
   * something restarts it.
   */
  async save(input: unknown): Promise<ConfigSaved> {
    const { canvases, resolved, problems: all } = await this.check(input);
    const problems = all.filter(blocksSaving);
    if (problems.length) throw new BadRequest('config', problems.map((p) => p.detail).join('; '));
    mkdirSync(dirname(this.o.file), { recursive: true });
    writeFileSync(this.o.file, `${JSON.stringify(canvases, null, 2)}\n`);
    this.read = undefined;
    if (this.o.source === 'file' && !this.restarting && this.o.apply) {
      console.log(`Obeya: configuration saved to ${this.o.file}; it applies at once`);
      this.o.apply(expandConfig(canvases), resolved.map((r) => r?.id ?? null));
      return { restarting: false, applied: true };
    }
    console.log(`Obeya: configuration saved to ${this.o.file}`);
    if (this.o.restart && !this.restarting) {
      this.restarting = true;
      this.o.restart();
    }
    return { restarting: this.restarting };
  }
}
