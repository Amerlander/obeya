import { defaultBranchCommit } from '../server/read-tree';
import { onGitHub } from '../server/repo';
import type { NESTED_SETTINGS, NestedSetting, RepoSettings, RepoValues, SharedSettings } from '../core/types';
import { detectedBranch, type GitSteps, gitStepsSync } from '../server/workspaces';
import { generic } from './generic';
import { checkShared } from './schema';
import type { RepoAdapter, RepoInfo } from './types';
import { messageOf } from '../core/text';

/** Where a repository kept an adapter module before its settings said it all (`hasAdapterModule`). */
export const REPO_ADAPTER_DIR = '.obeya/adapter';

/** Obeya's defaults for the repository: what it runs on where its settings say nothing. */
export const defaultsFor = (repo: RepoInfo): RepoAdapter => ({ ...generic, land: detectedLand(repo) });

/**
 * How work lands where the settings do not say: through pull requests where `origin` is on GitHub
 * (`onGitHub`), else on the main branch of the checkout, since a pull request needs somewhere to go.
 */
export const detectedLand = (repo: RepoInfo): RepoAdapter['land'] => (repo.remote && onGitHub(repo.remote) ? 'pr' : 'main');

/** The fields the settings may set, as `RepoAdapter` names them, read each time they are asked for. */
const LIVE = ['land', 'direct', 'checks', 'setup', 'planDocs', 'softPaths', 'prNoise', 'app', 'demo'] as const;

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
        if (field === 'app' || field === 'demo') return s?.[field] || a[field] ? { ...a[field], ...s?.[field] } : undefined;
        return s?.[field] ?? a[field];
      },
    });
  return b;
}

/**
 * The repository's settings as they stand without this machine's, with where each comes from: its
 * `.obeya/settings.json` (`shared`), the clones the configuration names, detection, the defaults.
 */
export function repoValues(repo: RepoInfo, clones = false, shared: SharedSettings = {}, detected = detectedBranch(repo.path)): RepoValues {
  const a = defaultsFor(repo);
  const value = <K extends Exclude<keyof SharedSettings, NestedSetting>, T>(v: T, field: K) =>
    shared[field] !== undefined ? { value: shared[field] as T, source: 'repository' as const } : { value: v, source: field === 'land' ? ('detected' as const) : ('default' as const) };
  // a field of `app` or `demo` from the repository, else none
  const nested = <K extends NestedSetting, F extends (typeof NESTED_SETTINGS)[K][number], T>(k: K, f: F, none: T) => {
    const v = (shared[k] as Record<string, unknown> | undefined)?.[f];
    return v !== undefined ? { value: v as T, source: 'repository' as const } : { value: none, source: 'default' as const };
  };
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
    app: { run: nested('app', 'run', ''), stop: nested('app', 'stop', ''), keep: nested('app', 'keep', '') },
    demo: { site: nested('demo', 'site', null) },
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
    return { problems: [`${REPO_SETTINGS_FILE} is no JSON: ${messageOf(e)}`] };
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
