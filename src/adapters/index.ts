import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { defaultBranchCommit } from '../server/read-tree';
import { onGitHub } from '../server/repo';
import { COMPILED, resource } from '../server/resources';
import type { RepoSettings, RepoValues, SettingSource, SharedSettings } from '../core/types';
import { detectedBranch, GIT } from '../server/workspaces';
import { generic } from './generic';
import * as kit from './kit';
import { obeya } from './obeya';
import { checkAdapter, checkShared } from './schema';
import type { RepoAdapter, RepoInfo } from './types';

/** Specific adapters first; the generic one matches every repository. */
const ADAPTERS: RepoAdapter[] = [obeya, generic];

/** Where a repository keeps its own adapter (`index.ts` in it), like `.vscode/` or `.claude/`. */
export const REPO_ADAPTER_DIR = '.obeya/adapter';

/**
 * The module an adapter's own processes import Obeya's helpers from; passed to them as `OBEYA_KIT`.
 * The compiled binary's build bundles it with what it imports into one file among the resources.
 */
export const KIT_PATH = COMPILED ? resource('kit.js') : join(import.meta.dir, 'kit.ts');

export const adapterNames = () => ADAPTERS.map((a) => a.name);

/**
 * The repository's adapter: the one the configuration names (a built-in one's name, or the path of
 * a module, relative to the repository), else the repository's own (`.obeya/adapter/`), else the
 * first built-in one that matches.
 */
export function pickAdapter(repo: RepoInfo, name?: string): RepoAdapter {
  if (name) {
    const a = ADAPTERS.find((x) => x.name === name);
    if (a) return detected(a, repo);
    if (!/[/\\]|\.[cm]?[jt]s$/.test(name)) throw new Error(`Unknown adapter "${name}" (known: ${adapterNames().join(', ')}, or the path of a module)`);
    const file = isAbsolute(name) ? name : resolve(repo.path, name);
    if (!existsSync(file)) throw new Error(`adapter module ${file} does not exist`);
    return loadAdapter(file, repo);
  }
  const own = repoAdapterFile(repo.path);
  if (own) return loadAdapter(own, repo);
  return builtInAdapter(repo);
}

/** The first built-in adapter that matches the repository: what it runs on without an adapter of its own. */
export const builtInAdapter = (repo: RepoInfo): RepoAdapter => detected(ADAPTERS.find((a) => a.matches(repo))!, repo);

/**
 * How work lands where the adapter does not say: through pull requests where `origin` is on GitHub
 * (`onGitHub`), else on the main branch of the checkout, since a pull request needs somewhere to go.
 */
export const detectedLand = (repo: RepoInfo): RepoAdapter['land'] => (repo.remote && onGitHub(repo.remote) ? 'pr' : 'main');

// the generic adapter says nothing of the repository: how work lands comes from detection
const detected = (a: RepoAdapter, repo: RepoInfo): RepoAdapter => (a === generic ? { ...generic, land: detectedLand(repo) } : a);

// what was wrong with a loaded adapter's fields (`schema.ts`), by the adapter made of it
const problems = new WeakMap<RepoAdapter, string[]>();

// the fields an adapter's code gives itself, by the adapter made of it; a built-in one's are its own
const given = new WeakMap<RepoAdapter, Partial<RepoAdapter>>();
given.set(obeya, obeya);

/** What is wrong with an adapter's fields, one line each; none for a built-in one. */
export const adapterProblems = (a: RepoAdapter): string[] => problems.get(a) ?? [];

/**
 * The adapter with its workers in clones: for a repository whose configuration names clones
 * (`clones`, `workspaces` or `hosts`), whatever the adapter says.
 */
export function inClones(a: RepoAdapter): RepoAdapter {
  if (a.workspaces === 'clones') return a;
  const b: RepoAdapter = { ...a, workspaces: 'clones' };
  const p = problems.get(a);
  if (p) problems.set(b, p);
  const g = given.get(a);
  if (g) given.set(b, g);
  return b;
}

/** The fields this machine's settings may set, as the adapter names them. */
const LIVE = ['land', 'direct', 'checks', 'setup', 'planDocs', 'softPaths', 'prNoise', 'demo'] as const;

/**
 * The adapter with the settings the owner set for this machine (`RepoSettings`) in front of its
 * own values, each read from `settings` whenever it is asked for, so that a saved change applies
 * without a restart. `workspaces` is read once: clones or worktrees are set up when the canvas
 * starts. Clones the configuration names (`clones`) go before the setting.
 */
export function withSettings(a: RepoAdapter, settings: () => RepoSettings | undefined, clones = false): RepoAdapter {
  const set = settings()?.workspaces;
  const b: RepoAdapter = { ...a, workspaces: clones ? 'clones' : (set ?? a.workspaces) };
  for (const field of LIVE)
    Object.defineProperty(b, field, {
      enumerable: true,
      get: () => {
        const s = settings();
        if (field !== 'demo') return s?.[field] ?? a[field];
        if (!s?.demo) return a.demo;
        return { required: false, howToRun: '', ...a.demo, ...s.demo };
      },
    });
  const p = problems.get(a);
  if (p) problems.set(b, p);
  const g = given.get(a);
  if (g) given.set(b, g);
  return b;
}

/**
 * The repository's settings as they stand without this machine's, with where each comes from: its
 * `.obeya/settings.json` (`shared`), the adapter's code (a field it gives that differs from the generic adapter's; `land` whenever it
 * gives one), the clones the configuration names, detection, the generic adapter.
 */
export function repoValues(a: RepoAdapter, repo: RepoInfo, clones = false, shared: SharedSettings = {}): RepoValues {
  const own = given.get(a) ?? {};
  const from = (field: keyof RepoAdapter): SettingSource =>
    field in own && (field === 'land' || JSON.stringify(own[field]) !== JSON.stringify(generic[field])) ? 'adapter' : field === 'land' ? 'detected' : 'default';
  const value = <K extends Exclude<keyof SharedSettings, 'demo'>, T>(v: T, field: K) =>
    shared[field] !== undefined ? { value: shared[field] as T, source: 'repository' as const } : { value: v, source: from(field) };
  const demo = own.demo ? 'adapter' : 'default';
  const required = shared.demo?.required;
  const howToRun = shared.demo?.howToRun;
  return {
    branch: { value: detectedBranch(repo.path), source: 'detected' },
    land: value(a.land, 'land'),
    direct: value(!!a.direct, 'direct'),
    checks: value(a.checks ?? [], 'checks'),
    setup: value(a.setup ?? '', 'setup'),
    planDocs: value(a.planDocs, 'planDocs'),
    softPaths: value(a.softPaths, 'softPaths'),
    workspaces: clones ? { value: 'clones', source: 'clones' } : value(a.workspaces, 'workspaces'),
    prNoise: value(a.prNoise ?? [], 'prNoise'),
    demo: {
      required: required !== undefined ? { value: required, source: 'repository' } : { value: !!a.demo?.required, source: demo },
      howToRun: howToRun !== undefined ? { value: howToRun, source: 'repository' } : { value: a.demo?.howToRun ?? '', source: demo },
    },
  };
}

/** Where a repository keeps its settings for everyone (`SharedSettings`), beside its adapter, like `.vscode/settings.json`. */
export const REPO_SETTINGS_FILE = '.obeya/settings.json';

/** A repository's `.obeya/settings.json` as read: its settings that count, the file's own object, and what does not count. */
export interface SharedRead {
  settings?: SharedSettings;
  /** The object the file holds, every field as it is; none where there is no file or it is no JSON object. */
  raw?: Record<string, unknown>;
  problems: string[];
}

/** Reads the text of a `.obeya/settings.json`: a field that is unknown or of the wrong type does not count, the rest does. */
export function parseShared(text: string): SharedRead {
  let made: unknown;
  try {
    made = JSON.parse(text);
  } catch (e) {
    return { problems: [`${REPO_SETTINGS_FILE} is no JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  if (!made || typeof made !== 'object' || Array.isArray(made)) return { problems: [`${REPO_SETTINGS_FILE} holds no JSON object`] };
  const raw = made as Record<string, unknown>;
  const { settings, problems } = checkShared(raw);
  return { settings, raw, problems: problems.map((p) => `${REPO_SETTINGS_FILE}, ${p}`) };
}

/**
 * The repository's `.obeya/settings.json` as its default branch has it at `commit` (by
 * `defaultBranchCommit`'s rule, like its own adapter), not as the checkout has it; nothing where
 * the default branch has no such file.
 */
export function readShared(repoPath: string, commit = defaultBranchCommit(repoPath).commit): SharedRead {
  const r = Bun.spawnSync([GIT, '-C', repoPath, 'cat-file', 'blob', `${commit}:${REPO_SETTINGS_FILE}`], { stderr: 'ignore' });
  return r.exitCode === 0 ? parseShared(r.stdout.toString()) : { problems: [] };
}

/**
 * Loads the adapter module of `repo`: its default export is the adapter, or a function that makes
 * it from Obeya's helpers (`kit.ts`). What it leaves out, or gets wrong (`adapterProblems`), comes
 * from detection (`land`) and the generic adapter.
 */
export function loadAdapter(file: string, repo: RepoInfo): RepoAdapter {
  let made: unknown;
  try {
    const mod = require(file) as { default?: unknown };
    made = typeof mod.default === 'function' ? mod.default(kit) : mod.default;
  } catch (e) {
    throw new Error(`adapter module ${file} does not load: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!made || typeof made !== 'object' || typeof (made as RepoAdapter).name !== 'string')
    throw new Error(`adapter module ${file} exports no adapter (a default export with a name, or a function returning one)`);
  const checked = checkAdapter(made as Record<string, unknown>);
  const adapter = { ...detected(generic, repo), ...checked.adapter } as RepoAdapter;
  if (checked.problems.length) problems.set(adapter, checked.problems);
  given.set(adapter, checked.adapter);
  return adapter;
}

const gitIn =
  (repoPath: string) =>
  (...args: string[]) => {
    const r = Bun.spawnSync([GIT, '-C', repoPath, ...args], { stderr: 'ignore' });
    return r.exitCode === 0 ? r.stdout.toString() : null;
  };

/**
 * The git tree of the repository's own adapter (`.obeya/adapter/`) on its default branch: which
 * version of it `repoAdapterFile` loads. Null when the default branch has no `.obeya/adapter/index.ts`.
 */
export function repoAdapterTree(repoPath: string): string | null {
  return adapterTreeAt(repoPath, defaultBranchCommit(repoPath).commit);
}

/** The git tree of the repository's own adapter at `commit`; null when it has no `.obeya/adapter/index.ts` there. */
export function adapterTreeAt(repoPath: string, commit: string): string | null {
  const git = gitIn(repoPath);
  const tree = git('rev-parse', '--verify', '--quiet', `${commit}:${REPO_ADAPTER_DIR}`)?.trim();
  return tree && git('cat-file', '-e', `${tree}:index.ts`) !== null ? tree : null;
}

/**
 * The repository's own adapter as its default branch has it, not as the checkout has it: a clone
 * is on a card's branch most of the time, and a branch from before the adapter came would take it
 * away; which commit of the default branch counts is `defaultBranchCommit`'s rule. Its files are
 * written once per version into the repository's git directory (`obeya/adapter-<tree>/`), where
 * checkouts and `git clean` do not reach, and an earlier version's files go. Null when the default branch has no `.obeya/adapter/index.ts`.
 */
export function repoAdapterFile(repoPath: string): string | null {
  const git = gitIn(repoPath);
  const tree = repoAdapterTree(repoPath);
  if (!tree) return null;
  const common = git('rev-parse', '--path-format=absolute', '--git-common-dir')?.trim();
  if (!common) return null;
  const versions = join(common, 'obeya');
  const dir = join(versions, `adapter-${tree.slice(0, 12)}`);
  if (!existsSync(join(dir, 'index.ts'))) {
    const files = (git('ls-tree', '-r', '-z', '--name-only', tree) ?? '').split('\0').filter(Boolean);
    const temp = `${dir}.${process.pid}-${Date.now()}`;
    for (const f of files) {
      const r = Bun.spawnSync([GIT, '-C', repoPath, 'cat-file', 'blob', `${tree}:${f}`], { stderr: 'ignore' });
      if (r.exitCode !== 0) continue;
      mkdirSync(dirname(join(temp, f)), { recursive: true });
      writeFileSync(join(temp, f), r.stdout);
    }
    // another process may have written the same version meanwhile: then its files stand
    try {
      renameSync(temp, dir);
    } catch {
      rmSync(temp, { recursive: true, force: true });
    }
    for (const d of readdirSync(versions)) if (/^adapter-[0-9a-f]{12}$/.test(d) && join(versions, d) !== dir) rmSync(join(versions, d), { recursive: true, force: true });
  }
  return join(dir, 'index.ts');
}
