// What changed on shared demo pages (site.ts writes them from demo-page.ts), as their viewers see
// it, oldest first. A page keeps the newest change it was published after (`version` of its share);
// the changes after that one which show on its kind of page are what sharing it again brings, and a
// page with none is up to date. Their words are in the UI's strings (`pageChanges`), by id.
//
// A change to the templates that shows on the pages gets an entry here; one that shows nowhere
// (a refactoring, a style only the other kind of page uses) gets none, so it marks no page.
// `PAGES_HASH` is the hash of sample pages these entries account for: site.test.ts fails once the
// pages come out different, and says what to do.

import type { DemoKind } from './types';

export interface PageChange {
  /** The day it came and a few words; stays for good, since shares keep it. */
  id: string;
  /** The kinds of page it shows on. */
  kinds: readonly DemoKind[];
}

export const PAGE_CHANGES = [
  { id: '2026-10-10-look', kinds: ['video', 'html'] },
  { id: '2026-10-16-alone', kinds: ['html'] },
  { id: '2026-10-16-offline', kinds: ['html'] },
  { id: '2026-10-19-credit', kinds: ['video', 'html'] },
] as const satisfies readonly PageChange[];

export type KnownChange = (typeof PAGE_CHANGES)[number];
export type PageChangeId = KnownChange['id'];

/** The sample pages' hash (`pagesHash` in site.ts) the changes above account for. */
export const PAGES_HASH = { video: 'c063085da519', html: '60d726c57456', stacked: '773662919636' };

/** The version a page published now gets: the newest change; '' while there is none. */
export const pagesVersion = (changes: readonly PageChange[] = PAGE_CHANGES): string => changes.at(-1)?.id ?? '';

/**
 * The changes a page of the kind published with `version` lacks, oldest first. A version that is
 * not a change's ('' or none: published before them all) lacks every one of its kind.
 */
export function missedChanges<C extends PageChange>(version: string | undefined, kind: DemoKind, changes: readonly C[]): C[] {
  const after = changes.findIndex((c) => c.id === version);
  return changes.slice(after + 1).filter((c) => c.kinds.includes(kind));
}
