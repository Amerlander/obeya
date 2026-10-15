import { join } from 'node:path';
import { defaultBranchCommit } from '../server/read-tree';
import { onGitHub } from '../server/repo';
import { COMPILED, resource } from '../server/resources';
import type { RepoSettings, RepoValues, SharedSettings, StackSettings } from '../core/types';
import { detectedBranch, type GitSteps, gitStepsSync } from '../server/workspaces';
import { generic } from './generic';
import { checkShared } from './schema';
import type { RepoAdapter, RepoInfo } from './types';

/** Where a repository kept an adapter module before its settings said it all (`hasAdapterModule`). */
export const REPO_ADAPTER_DIR = '.obeya/adapter';

/**
 * The module a share script imports Obeya's helpers from; passed to it as `OBEYA_KIT`. The
 * compiled binary's build bundles it with what it imports into one file among the resources.
 */
export const KIT_PATH = COMPILED ? resource('kit.js') : join(import.meta.dir, 'kit.ts');

/** Obeya's defaults for the repository: what it runs on where its settings say nothing. */
export const defaultsFor = (repo: RepoInfo): RepoAdapter => ({ ...generic, land: detectedLand(repo) });

/**
 * How work lands where the settings do not say: through pull requests where `origin` is on GitHub
 * (`onGitHub`), else on the main branch of the checkout, since a pull request needs somewhere to go.
 */
export const detectedLand = (repo: RepoInfo): RepoAdapter['land'] => (repo.remote && onGitHub(repo.remote) ? 'pr' : 'main');

/** The fields the settings may set, as `RepoAdapter` names them, read each time they are asked for. */
const LIVE = ['land', 'direct', 'checks', 'setup', 'planDocs', 'softPaths', 'prNoise', 'stack', 'demo'] as const;

/**
 * The repository's settings (`RepoSettings`: its `.obeya/settings.json` with this machine's in
 * front) in front of the defaults, each read from `settings` whenever it is asked for, so that a
 * changed value applies without a restart. `workspaces` is read once: clones or worktrees are set
 * up when the canvas starts. Clones the configuration names (`clones`) go before the setting.
 */
export function withSettings(a: RepoAdapter, settings: () => RepoSettings | undefined, clones = false): RepoAdapter {
  const set = settings()?.workspaces;
  const b: RepoAdapter = { ...a, workspaces: clones ? 'clones' : (set ?? a.workspaces) };
  for (const field of LIVE)
    Object.defineProperty(b, field, {
      enumerable: true,
      get: () => {
        const s = settings();
        if (field === 'stack') return usableStack(s?.stack ?? a.stack);
        if (field !== 'demo') return s?.[field] ?? a[field];
        if (!s?.demo) return a.demo;
        return { howToRun: s.demo.howToRun ?? a.demo?.howToRun ?? '', ...(s.demo.site ? { site: s.demo.site } : {}) };
      },
    });
  return b;
}

/** The stack where it says how the app starts; none for one the owner is still filling in. */
export const usableStack = (stack: StackSettings | undefined): StackSettings | undefined => (stack?.start.trim() ? stack : undefined);

/**
 * The repository's settings as they stand without this machine's, with where each comes from: its
 * `.obeya/settings.json` (`shared`), the clones the configuration names, detection, the defaults.
 */
export function repoValues(repo: RepoInfo, clones = false, shared: SharedSettings = {}, detected = detectedBranch(repo.path)): RepoValues {
  const a = defaultsFor(repo);
  const value = <K extends Exclude<keyof SharedSettings, 'demo'>, T>(v: T, field: K) =>
    shared[field] !== undefined ? { value: shared[field] as T, source: 'repository' as const } : { value: v, source: field === 'land' ? ('detected' as const) : ('default' as const) };
  const { howToRun, site } = shared.demo ?? {};
  return {
    branch: { value: detected, source: 'detected' },
    land: value(a.land, 'land'),
    direct: value(!!a.direct, 'direct'),
    checks: value(a.checks ?? [], 'checks'),
    setup: value(a.setup ?? '', 'setup'),
    planDocs: value(a.planDocs, 'planDocs'),
    softPaths: value(a.softPaths, 'softPaths'),
    workspaces: clones ? { value: 'clones', source: 'clones' } : value(a.workspaces, 'workspaces'),
    prNoise: value(a.prNoise ?? [], 'prNoise'),
    stack: value(null, 'stack'),
    demo: {
      howToRun: howToRun !== undefined ? { value: howToRun, source: 'repository' } : { value: a.demo?.howToRun ?? '', source: 'default' },
      site: site ? { value: site, source: 'repository' } : { value: null, source: 'default' },
    },
  };
}

/** Where a repository keeps its settings for everyone (`SharedSettings`), like `.vscode/settings.json`. */
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
 * `defaultBranchCommit`'s rule), not as the checkout has it, which is on a card's branch most of
 * the time; nothing where the default branch has no such file.
 */
export function readShared(repoPath: string, commit = defaultBranchCommit(repoPath).commit): SharedRead {
  return gitStepsSync(repoPath, readingShared(commit));
}

/** `readShared` at `commit` as git steps. */
export function* readingShared(commit: string): GitSteps<SharedRead> {
  const [text] = yield [['cat-file', 'blob', `${commit}:${REPO_SETTINGS_FILE}`]];
  return text != null ? parseShared(text) : { problems: [] };
}

/**
 * Whether the repository's main branch still has a `.obeya/adapter/index.ts`: a module that said
 * what its settings say now, which Obeya no longer reads (problem `adapterGone`).
 */
export function hasAdapterModule(repoPath: string, commit = defaultBranchCommit(repoPath).commit): boolean {
  return gitStepsSync(repoPath, readingAdapterModule(commit));
}

/** `hasAdapterModule` at `commit` as git steps. */
export function* readingAdapterModule(commit: string): GitSteps<boolean> {
  const [found] = yield [['cat-file', '-e', `${commit}:${REPO_ADAPTER_DIR}/index.ts`]];
  return found != null;
}
