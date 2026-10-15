// What Obeya knows about how a repository works: its defaults (`generic.ts`) with the repository's
// settings in front (`.obeya/settings.json`, then this machine's). The core only talks to this
// interface.

import type { DemoSite, StackSettings } from '../core/types';

export type { DemoSite, StackSettings };

export interface RepoInfo {
  path: string;
  /** `origin` URL, if any. */
  remote: string | null;
  /** Its main branch, where cards start from and work lands (`defaultBranch`). */
  branch: string;
}

export interface RepoAdapter {
  /** Where plan docs live, relative to the repository root. */
  planDocs: { dir: string; exclude: string[] };

  /** Command a worker runs first in a fresh clone (dependencies). */
  setup?: string;
  /** Checks a worker runs before it reports the card ready for review. */
  checks?: string[];
  /**
   * How approved work lands: `main` fast-forwards the checkout Obeya runs on to the worker's
   * branch (created clones then come from that checkout); `pr` leaves the branch for a pull
   * request (M5) and clones come from `origin`.
   */
  land: 'main' | 'pr';
  /**
   * With `land: 'pr'`: the owner may approve a card's work directly onto the default branch
   * instead, without a pull request. Obeya rebases it onto `origin`'s default branch and pushes it
   * there (never forced); review and the CI of a pull request are skipped.
   */
  direct?: boolean;
  /**
   * Paths (a trailing `/` covers a directory) whose edits never count as a merge conflict between
   * two cards: they are resolved when a branch is rebased (docs, plan docs).
   */
  softPaths: string[];
  /** Workers get full clones from a pool, or a worktree of the Obeya checkout per card. */
  workspaces: 'clones' | 'worktrees';

  /**
   * Demos, which every handover brings: how a worker runs the app to record one (for the `demo`
   * skill), and the static site Obeya keeps and deploys itself to share them (`src/server/site.ts`),
   * which goes before no share at all but after the share command of this machine's configuration.
   */
  demo?: { howToRun: string; site?: DemoSite };

  /** Accounts whose pull request comments are not review feedback (deploy bots and the like). */
  prNoise?: string[];

  /** How a worker brings up the app in its workspace and finds the frontend. */
  stack?: StackSettings;
}
