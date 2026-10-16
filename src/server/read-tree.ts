// The Lesestand of a repository: the directory on its default branch that the canvas reads plan
// docs from and the agents that only read work in. Where work lands on the local main (Obeya's own
// checkout), that is the checkout itself; otherwise the checkout is one of the pool's clones, on
// whatever card's branch leased it last, and the Lesestand is a detached worktree of it under
// Obeya's home, kept on the default branch as `origin` has it.

import { existsSync, realpathSync, rmSync } from 'node:fs';
import { addDetachedTree, branchSetting, type Branches, detectingBranch, GIT, type GitSteps, gitOrNull, gitStepsSync, readingBranches } from './workspaces';

const gitIn =
  (path: string) =>
  (...args: string[]) =>
    gitOrNull(path, ...args);

/**
 * The default branch (`defaultBranch`) and its commit as Obeya reads it: the local branch where it
 * has everything `origin`'s has (work lands there first), else `origin`'s; HEAD in a repository
 * with neither.
 */
export function defaultBranchCommit(repoPath: string): { branch: string; commit: string } {
  return gitStepsSync(repoPath, readingDefaultBranch(repoPath));
}

/** `defaultBranchCommit` as git steps. */
function* readingDefaultBranch(repoPath: string): GitSteps<{ branch: string; commit: string }> {
  const branches = yield* readingBranches();
  const branch = branchSetting(repoPath) || (yield* detectingBranch(branches));
  return { branch, commit: yield* branchCommit(branch, branches) };
}

/** The commit of the default branch `branch` by `defaultBranchCommit`'s rule, as git steps, from `branches` where they were read already. */
export function* branchCommit(branch: string, branches?: Branches | null): GitSteps<string> {
  const b = branches !== undefined ? branches : yield* readingBranches();
  const local = b?.local.get(branch);
  const remote = b?.remote.get(branch);
  if (!local || !remote) return local ?? remote ?? 'HEAD';
  if (local === remote) return local;
  const [ahead] = yield [['merge-base', '--is-ancestor', remote, local]];
  return ahead != null ? local : remote;
}

export interface ReadTreeOptions {
  /** The repository's configured checkout. */
  repoPath: string;
  /** Where the worktree goes; null where the checkout itself is on the default branch. */
  dir: string | null;
  /** Whether the checkout has an `origin` to fetch from. */
  remote: boolean;
  /** The Lesestand moved to another commit. */
  onChange: () => void;
}

export class ReadTree {
  /** The directory to read from: the worktree, or the checkout where it could not be made. */
  path: string;
  private refreshing: Promise<void> | null = null;
  private stopped = false;

  constructor(private o: ReadTreeOptions) {
    this.path = o.repoPath;
    if (o.dir) this.sync();
  }

  /**
   * Fetches the default branch from `origin` and moves the Lesestand to the commit it now reads.
   * A fetch that fails (offline, a lock held by a lease at the same moment) is logged; the next
   * call tries again, and the Lesestand keeps its commit meanwhile. Calls while one runs share it.
   */
  refresh(): Promise<void> {
    if (!this.o.dir || this.stopped) return Promise.resolve();
    return (this.refreshing ??= this.fetch()
      .then(() => {
        if (!this.stopped && this.sync()) this.o.onChange();
      })
      .finally(() => (this.refreshing = null)));
  }

  stop() {
    this.stopped = true;
  }

  /**
   * Moves the Lesestand where it now belongs, once work lands elsewhere: the checkout (`null`), or
   * the worktree at `dir`, made or brought up to date. Tells `onChange` where it moved.
   */
  retarget(dir: string | null) {
    if (dir === this.o.dir || this.stopped) return;
    const was = this.path;
    this.o.dir = dir;
    if (dir) this.sync();
    else this.path = this.o.repoPath;
    if (this.path !== was) this.o.onChange();
  }

  /** The commit the Lesestand is on. */
  head(): string {
    return gitIn(this.path)('rev-parse', 'HEAD') ?? '';
  }

  /** Whether the Lesestand holds `commit`: it is the commit the Lesestand is on, or an ancestor of it. */
  holds(commit: string): boolean {
    return gitIn(this.path)('merge-base', '--is-ancestor', commit, 'HEAD') !== null;
  }

  private async fetch() {
    if (!this.o.remote) return;
    const { branch } = defaultBranchCommit(this.o.repoPath);
    // only the default branch, and no FETCH_HEAD: what a lease fetching in the same clone touches stays its own
    const p = Bun.spawn([GIT, '-C', this.o.repoPath, 'fetch', '--quiet', '--no-write-fetch-head', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'pipe',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
    if (code !== 0) console.error(`Lesestand: git fetch origin in ${this.o.repoPath}: ${err.trim()}`);
  }

  /**
   * Puts the worktree on the commit the default branch has now, making it afresh where it is
   * missing, broken or another repository's. Returns whether it moved. Where no worktree can be
   * made, the checkout is read instead.
   */
  private sync(): boolean {
    const dir = this.o.dir!;
    const repo = gitIn(this.o.repoPath);
    const { commit } = defaultBranchCommit(this.o.repoPath);
    const target = repo('rev-parse', '--verify', '--quiet', `${commit}^{commit}`);
    if (!target) return false;
    if (this.valid(dir)) {
      const tree = gitIn(dir);
      if (tree('rev-parse', 'HEAD') === target) {
        this.path = dir;
        return false;
      }
      // the hooks are the checkout's (a post-checkout installing dependencies, say), not the Lesestand's
      if (tree('-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', '--force', target) !== null) {
        this.path = dir;
        return true;
      }
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      // on Windows a process working in it (an agent reading there) keeps it: the server died of
      // that EBUSY; this time the checkout is read, and the next refresh tries again
      console.error(`Lesestand: ${dir} cannot be made afresh now (${(e as NodeJS.ErrnoException).code ?? e}); reading the checkout`);
      return this.readCheckout();
    }
    repo('worktree', 'prune');
    try {
      addDetachedTree(this.o.repoPath, dir, target);
    } catch {
      console.error(`Lesestand: no worktree of ${this.o.repoPath} at ${dir}; reading the checkout`);
      return this.readCheckout();
    }
    this.path = dir;
    return true;
  }

  /** The checkout is read where no worktree can be made; returns whether that moved the Lesestand. */
  private readCheckout(): boolean {
    const moved = this.path !== this.o.repoPath;
    this.path = this.o.repoPath;
    return moved;
  }

  /** Whether `dir` is a worktree of the checkout's repository, at its top. */
  private valid(dir: string): boolean {
    if (!existsSync(dir)) return false;
    const tree = gitIn(dir);
    const top = tree('rev-parse', '--show-toplevel');
    const common = tree('rev-parse', '--path-format=absolute', '--git-common-dir');
    const own = gitIn(this.o.repoPath)('rev-parse', '--path-format=absolute', '--git-common-dir');
    return !!top && !!common && !!own && real(top) === real(dir) && real(common) === real(own);
  }
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
