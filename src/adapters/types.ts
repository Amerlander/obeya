// What Obeya knows about how a repository works: its defaults (`generic.ts`) with the repository's
// settings in front (`.obeya/settings.json`, then this machine's). The core only talks to this
// interface.

import type { AppSettings, DemoSite, SharedSettings } from '../core/types';

export type { AppSettings, DemoSite };

export interface RepoInfo {
  path: string;
  /** `origin` URL, if any. */
  remote: string | null;
  /** Its main branch, where cards start from and work lands (`defaultBranch`). */
  branch: string;
}

/** The repository's settings in front of Obeya's defaults: a field with a default is always there. */
export type RepoAdapter = SharedSettings & Required<Pick<SharedSettings, 'planDocs' | 'land' | 'softPaths' | 'workspaces'>>;
