// Obeya's configuration: the canvases it serves, saved in `canvases.json` under its home. The owner
// reads and edits it in its sheet, the Koordinator on their word; a saved change takes effect when
// Obeya starts again, which it does by itself once no agent is in the middle of a turn. The
// repositories' settings (`RepoSettings`) are the exception: read where they are used, they apply
// at once, and saving them alone restarts nothing.

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { adapterNames, readShared, REPO_SETTINGS_FILE, type SharedRead } from '../adapters';
import { settingsShape } from '../adapters/schema';
import { type AgentsView, blocksSaving, type CanvasConfig, type ConfigProblem, type ConfigSaved, type ConfigView, type RepoSettings, SHARED_FIELDS, type SettingsShared, type SharedSettings, type DemoSettingsProblem, type DemoSettingsView, type DemoVoiceCheck, type LanguageView, type ResolvedCanvas, type ThemeView, type VoiceInstallJob, layerSettings, type ProposedSetting, settingPatch } from '../core/types';
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
import { ConfigError, resolveCanvas } from './canvas';
import type { Store } from './db';
import { freshPath } from './path';
import { repoInfo } from './repo';
import type { Forge } from './forge';
import { commitShared, proposeShared, pushShared } from './shared-settings';
import { GIT } from './workspaces';
import { VERSION } from './resources';
import { agentsView, languageView, pushKeyChoice, saveAgents, saveLanguage, savePushKey, saveTheme, themeView } from './settings';
import { adapterRepoProblems, shareArgv, shareProblem } from './share';

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
  const demo = s.demo?.howToRun !== undefined ? { howToRun: s.demo.howToRun.trim() } : undefined;
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
    ...(demo && Object.keys(demo).length ? { demo } : {}),
  };
  return Object.keys(out).length ? out : undefined;
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
            adapter: z.string().optional(),
            workspaces: z.array(z.string()).optional(),
            clones: z.number().int().min(0).max(20).optional(),
            slots: z.number().int().min(0).max(20).optional(),
            share: z.string().optional(),
            hosts: z
              .array(
                z
                  .object({
                    name: z.string().regex(/^\s*[\w.-]*\s*$/, 'a host name is letters, digits, dots, dashes and underscores'),
                    ssh: z.string(),
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

/** The configuration as it is saved: no empty names, adapters, clone lists or counts. */
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
        ...(r.adapter?.trim() ? { adapter: r.adapter.trim() } : {}),
        ...(workspaces.length ? { workspaces } : {}),
        ...(r.clones ? { clones: r.clones } : {}),
        ...(r.slots !== undefined ? { slots: r.slots } : {}),
        ...(r.share?.trim() ? { share: r.share.trim() } : {}),
        ...(hosts.length ? { hosts } : {}),
        ...(settings ? { settings } : {}),
      };
    }),
  }));
}

/** The `origin` of a repository here, none when it has none (or is no repository, a problem of its own). */
function remoteOf(path: string): string | undefined {
  try {
    return repoInfo(resolve(path)).remote || undefined;
  } catch {
    return undefined;
  }
}

/** Reads a configuration file; throws when it is no list of canvases. */
export function readConfigFile(file: string): CanvasConfig[] {
  return tidy(shape.parse(JSON.parse(readFileSync(file, 'utf8'))));
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
function hasBranch(path: string, branch: string): boolean {
  return ['refs/heads/', 'refs/remotes/origin/'].some((ref) => Bun.spawnSync([GIT, '-C', path, 'rev-parse', '--verify', '--quiet', `${ref}${branch}^{commit}`], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0);
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
    listenBack: z.literal(false).optional(),
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

/** A configuration checked: what it amounts to, and what keeps it from working. */
export interface Checked {
  canvases: CanvasConfig[];
  resolved: (ResolvedCanvas | null)[];
  problems: ConfigProblem[];
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
        if (k === 'demo') continue;
        if (s[k] !== undefined && same(s[k], after[k]) && !same(before?.[k], after[k])) delete s[k];
      }
      for (const k of ['howToRun'] as const)
        if (s.demo?.[k] !== undefined && same(s.demo[k], after.demo?.[k]) && !same(before?.demo?.[k], after.demo?.[k])) delete s.demo[k];
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
        const s: RepoSettings = { ...r.settings, ...(r.settings.demo ? { demo: { ...r.settings.demo } } : {}) };
        drop(s);
        if (s.demo && !Object.keys(s.demo).length) delete s.demo;
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
  takeSetting(path: string, field: ProposedSetting, value: string | string[], where: 'machine' | 'repository'): SettingsShared | null {
    const canvases = this.current();
    const at = canvases.flatMap((c, canvas) => c.repos.map((r, repo) => ({ r, canvas, repo }))).find(({ r }) => resolve(expand(r.path)) === path);
    if (!at) throw new BadRequest('invalid', `no repository ${path} in the configuration`);
    const patch = settingPatch(field, value);
    const onMachine = () =>
      this.save(canvases.map((c, i) => (i !== at.canvas ? c : { ...c, repos: c.repos.map((r, j) => (j !== at.repo ? r : { ...r, settings: layerSettings(r.settings, patch) })) })));
    if (where === 'machine') {
      onMachine();
      return null;
    }
    const to = this.check(canvases).resolved[at.canvas]?.repos[at.repo]?.shareTo ?? 'main';
    if (to === 'pr') {
      if (!this.o.forge) throw new BadRequest('settingsShare', 'no forge to open a pull request with');
      const done = proposeShared(path, patch, this.o.forge);
      console.log(`Obeya: ${field} of ${path} for everyone, as a pull request: ${'pr' in done ? done.pr : ''}`);
      onMachine();
      return done;
    }
    const { before: _, after, ...done } = commitShared(path, patch);
    console.log(`Obeya: ${field} of ${path} for everyone, committed on ${'branch' in done ? done.branch : ''}`);
    this.takenOver(path, undefined, after);
    // where this machine set another value, the repository's applies here as well from now on
    this.dropSettings(path, (s) => {
      if (field === 'howToRun') delete s.demo?.howToRun;
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
  shareSettings(input: unknown): SettingsShared {
    const parsed = z.object({ path: z.string(), direct: z.boolean().optional() }).safeParse(input);
    if (!parsed.success) throw new BadRequest('invalid', 'expected { path, direct? }');
    const canvases = this.current();
    const at = canvases.flatMap((c, canvas) => c.repos.map((r, repo) => ({ r, canvas, repo }))).find(({ r }) => r.path === parsed.data.path);
    if (!at) throw new BadRequest('noSettings', `no repository ${parsed.data.path} in the configuration`);
    const { branch: _, ...mine } = at.r.settings ?? {};
    if (!Object.keys(mine).length) throw new BadRequest('noSettings', `${at.r.path}: nothing set on this machine to take over`);
    const repoPath = resolve(expand(at.r.path));
    const resolved = this.check(canvases).resolved[at.canvas];
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

  view(): ConfigView {
    const { canvases, resolved, problems } = this.check(this.current());
    return {
      file: this.o.file,
      source: this.o.source,
      canvases,
      resolved,
      problems,
      running: this.o.running(),
      adapters: adapterNames(),
      server: { commit: null, ...this.o.server, version: VERSION, restarts: !!this.o.restart },
      restarting: this.restarting,
    };
  }

  /** Checks a configuration without saving it: every canvas resolves, and no two share an id. */
  check(input: unknown): Checked {
    const parsed = shape.safeParse(input);
    if (!parsed.success) return { canvases: [], resolved: [], problems: [{ code: 'invalid', detail: z.prettifyError(parsed.error) }] };
    const canvases = tidy(parsed.data);
    const problems: ConfigProblem[] = [];
    if (!canvases.length) problems.push({ code: 'noCanvas', detail: 'Obeya needs at least one canvas' });
    // a host's name stands for one machine across the configuration: its workspaces are named by it
    const machines = new Map<string, string>();
    const resolved = expandConfig(canvases).map((c, canvas): ResolvedCanvas | null => {
      c.repos.forEach((r, repo) =>
        (r.workspaces ?? []).forEach((w) => {
          try {
            repoInfo(resolve(w));
          } catch {
            problems.push({ code: 'notClone', canvas, repo, detail: `workspace ${w} is not a git repository` });
          }
        }),
      );
      c.repos.forEach((r, repo) => {
        const wrong = r.share && shareProblem(shareArgv(r.share, resolve(r.path)));
        if (wrong) problems.push({ code: 'shareCommand', canvas, repo, detail: wrong });
      });
      c.repos.forEach((r, repo) => {
        const branch = r.settings?.branch;
        if (branch && existsSync(r.path) && !hasBranch(resolve(r.path), branch)) problems.push({ code: 'noBranch', canvas, repo, detail: `${r.path} has no branch ${branch}, neither here nor on origin` });
      });
      c.repos.forEach((r, repo) =>
        (r.hosts ?? []).forEach((h) => {
          const other = machines.get(h.name);
          if (other !== undefined && other !== h.ssh) problems.push({ code: 'hostName', canvas, repo, detail: `host ${h.name} connects to ${other} elsewhere, here to ${h.ssh}` });
          machines.set(h.name, h.ssh);
        }),
      );
      try {
        // each repository's `.obeya/settings.json`, read once for its values and its problems
        const shared = new Map<string, SharedRead>();
        const sharedOf = (path: string) => {
          if (!shared.has(path)) shared.set(path, readShared(path));
          return () => shared.get(path)!.settings;
        };
        const { id, name, adapters, infos, values, broken, refs, config } = resolveCanvas(c, this.o.store, undefined, sharedOf);
        const without = values();
        // what is wrong in a repository's own adapter is fixed there, not here: it keeps nothing from being saved
        c.repos.forEach((r, repo) => {
          const adapter = adapters[config.repos.indexOf(r)]!;
          const error = broken[config.repos.indexOf(r)];
          if (error) problems.push({ code: 'adapterLoad', canvas, repo, detail: error });
          if (r.hosts?.length) {
            const why = adapter.land === 'main' ? 'its work lands on the main of this checkout' : !remoteOf(r.path) ? 'it has no remote to clone from' : null;
            if (why) problems.push({ code: 'hostRepo', canvas, repo, detail: `the repository cannot have workers on other machines: ${why}` });
          }
          for (const detail of adapterRepoProblems(adapter, resolve(r.path), !!r.share))
            problems.push({ code: 'adapterField', canvas, repo, detail });
          for (const detail of shared.get(infos[config.repos.indexOf(r)]!.path)?.problems ?? []) problems.push({ code: 'repoSettings', canvas, repo, detail });
        });
        // the repositories in the order given, though the home one runs first
        return {
          id,
          name,
          repos: c.repos.map((r) => {
            const i = config.repos.indexOf(r);
            const demo = adapters[i]!.demo;
            return {
              id: refs[i]!.id,
              adapter: adapters[i]!.name,
              workspaces: adapters[i]!.workspaces,
              values: without[i]!,
              shareTo: adapters[i]!.land === 'main' ? 'main' : 'pr',
              ...(adapters[i]!.land === 'pr' && adapters[i]!.direct ? { shareDirect: true } : {}),
              ...(demo?.site ? { adapterSite: demo.site.url } : demo?.share ? { adapterShares: true } : {}),
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
  save(input: unknown): ConfigSaved {
    const { canvases, resolved, problems: all } = this.check(input);
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
