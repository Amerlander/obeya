// Where a card's worker works, and how approved work lands.
//
// `clones`: a pool of full clones per canvas, leased one card at a time (for repositories with tools
// that break in worktrees, or one app per clone), here and on other machines; a new card
// takes a clone on the first machine whose busy workers leave it a slot (design: Hosts). `worktrees`: one worktree of the Obeya checkout per card,
// created on start, as many in parallel as there are cards unless the repository has slots; kept
// across stop and restart until the card's work has landed.

import { existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { type CardDiff, cardDiff } from '../core/diff';
import type { PoolHost, WorkspaceShortage } from '../core/types';
import type { Store } from './db';
import { HostError, hostName, onHost, remote, sh as shWord, type SshHost, TOKEN_HELPER, TOKEN_HELPER_ARGS } from './hosts';
import { messageOf } from '../core/text';
import { oneAtATime } from '../core/one-at-a-time';
import { demoFile } from './demo-page';
import { spawnOutput } from './spawn';

export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly code: 'noWorkspace' | 'dirtyWorkspaces' | 'noSlot' | 'workspace' = 'workspace',
  ) {
    super(message);
  }
}

export interface LandProblem {
  code: 'landDirty' | 'landConflict' | 'landEmpty' | 'landCheckout' | 'landMerge' | 'landPush' | 'land';
  /** Whether the worker can fix it in its workspace; otherwise it is the owner's (the Obeya checkout, a push turned away). */
  worker: boolean;
  detail: string;
  files?: string[];
}

/** Work that landed: the default branch (of the Obeya checkout, or of `origin` when pushed) moved from `from` to `to`. */
export interface Landed {
  from: string;
  to: string;
}

/**
 * The git binary. On macOS `/usr/bin/git` is a shim that asks xcrun for the real one on every
 * call, which more than doubles what a call costs; Obeya calls git often, so it asks once.
 */
export const GIT = gitBinary();

function gitBinary(): string {
  if (process.platform !== 'darwin' || Bun.which('git') !== '/usr/bin/git') return 'git';
  const r = Bun.spawnSync(['xcrun', '--find', 'git'], { stderr: 'ignore' });
  const path = r.exitCode === 0 ? r.stdout.toString().trim() : '';
  return path && existsSync(path) ? path : 'git';
}

/** The host of a workspace on another machine, as `remote` finds it; a host gone from the configuration is a workspace error. */
function remoteWorkspace(path: string) {
  try {
    return remote(path);
  } catch (e) {
    throw new WorkspaceError(messageOf(e));
  }
}

/** `git` in `cwd`, which may be a workspace on another machine (`ssh://<host>/…`, see `hosts.ts`). */
export function git(cwd: string, ...args: string[]): string {
  const there = remoteWorkspace(cwd);
  if (there) {
    const r = there.host.runSync(['git', ...TOKEN_HELPER_ARGS, '-C', there.path, ...args], there.path);
    if (r.code !== 0) throw new WorkspaceError(`git ${args.join(' ')} in ${cwd}: ${(r.stderr || r.stdout).trim() || `exit code ${r.code}`}`);
    return r.stdout.trim();
  }
  const r = Bun.spawnSync([GIT, '-C', cwd, ...args], { stderr: 'pipe' });
  if (r.exitCode !== 0) throw new WorkspaceError(`git ${args.join(' ')} in ${cwd}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString().trim();
}

/** `git` in `cwd`, or null where it fails (no repository there, a ref that does not exist). */
export function gitOrNull(cwd: string, ...args: string[]): string | null {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
}

/** Whether a workspace's directory exists, here or on its host (where an unreachable host counts as no). */
export function exists(path: string): boolean {
  const there = remoteWorkspace(path);
  return there ? there.host.exists(there.path) : existsSync(path);
}

/**
 * `git` without blocking the server while it runs: landing approved work fetches, rebases and
 * pushes, over the network seconds in which the server would answer nothing else.
 */
export async function gitAsync(cwd: string, ...args: string[]): Promise<string> {
  const r = await gitRun(cwd, args);
  if (r.code !== 0) throw new WorkspaceError(`git ${args.join(' ')} in ${cwd}: ${(r.stderr || r.stdout).trim() || `exit code ${r.code}`}`);
  return r.stdout.trim();
}

/** `git` in `cwd` without blocking, with its exit code: for commands whose exit code is an answer (`diff --no-index`). */
async function gitRun(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const there = remoteWorkspace(cwd);
  if (there) return there.host.run(['git', ...TOKEN_HELPER_ARGS, '-C', there.path, ...args], { cwd: there.path });
  return spawnOutput([GIT, '-C', cwd, ...args]);
}

/** `git diff` as Obeya shows it to the owner: plain, with renames found and file names unquoted. */
const DIFF = ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '-M'];

/** How many new files not yet added a branch's diff shows; a worker's stray build output should not flood it. */
const NEW_FILES_SHOWN = 200;

/** The whole diff from `base` to `to` (a commit; the working tree when left out), as `git diff` has it. */
export function gitDiff(cwd: string, base: string, to?: string): Promise<string> {
  return gitAsync(cwd, ...DIFF, base, ...(to ? [to] : []));
}

/** The landing under way per Obeya checkout: landings of one repository run one after the other. */
const landings = new Map<string, Promise<unknown>>();

/**
 * Puts the branch's whole change onto `upstream` as one commit, if it merges cleanly there; the
 * commits' messages are kept in order, their trailers once at the end. Returns whether it did.
 */
async function squashOnto(ws: string, upstream: string): Promise<boolean> {
  let tree: string;
  try {
    // exits non-zero on a conflict
    tree = (await gitAsync(ws, 'merge-tree', '--write-tree', upstream, 'HEAD')).split('\n')[0]!;
  } catch {
    return false;
  }
  const trailers: string[] = [];
  const bodies = (await gitAsync(ws, 'log', '--reverse', '--format=%B%x00', `${upstream}..HEAD`))
    .split('\0')
    .map((m) =>
      m
        .split('\n')
        .filter((line) => !(/^[\w-]+-by: /i.test(line) && trailers.push(line)))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);
  const message = [...bodies, [...new Set(trailers)].join('\n')].filter(Boolean).join('\n\n');
  const commit = await gitAsync(ws, 'commit-tree', tree, '-p', await gitAsync(ws, 'rev-parse', upstream), '-m', message);
  await gitAsync(ws, 'reset', '--quiet', '--hard', commit);
  return true;
}

/**
 * Rebases the workspace's branch onto `upstream`, or squashes it there when only the replay of its
 * commits conflicts. Returns the conflict if neither works, the branch then as it was.
 */
async function rebaseOnto(ws: string, upstream: string, base: string): Promise<LandProblem | null> {
  try {
    await gitAsync(ws, 'rebase', '--quiet', upstream);
    return null;
  } catch (e) {
    const files = (await gitAsync(ws, 'diff', '--name-only', '--diff-filter=U')).split('\n').filter(Boolean);
    await gitAsync(ws, 'rebase', '--abort');
    // replayed one by one, the commits may conflict where the change as a whole does not
    if (await squashOnto(ws, upstream)) return null;
    return {
      code: 'landConflict',
      worker: true,
      files,
      detail: `rebase onto ${base} failed${files.length ? `; conflicts in ${files.join(', ')}` : ''}: ${messageOf(e)}`,
    };
  }
}

/**
 * Brings the workspace's committed branch onto `upstream` (`base`, or `origin`'s copy of it, fetched
 * first) as `rebaseOnto` does: what stands in the way of landing it, or null once it is ready.
 */
async function rebased(ws: string, base: string, upstream: string): Promise<LandProblem | null> {
  if (await gitAsync(ws, 'status', '--porcelain')) return { code: 'landDirty', worker: true, detail: 'uncommitted changes in the workspace' };
  if (upstream !== base) await gitAsync(ws, 'fetch', '--quiet', 'origin');
  const conflict = await rebaseOnto(ws, upstream, base);
  if (conflict) return conflict;
  if ((await gitAsync(ws, 'rev-list', '--count', `${upstream}..HEAD`)) === '0') return { code: 'landEmpty', worker: true, detail: 'the branch has no commits' };
  return null;
}

/**
 * Adds `trailer` (`Demo-Video: <url>`) to the message of the workspace's last commit, the one that
 * lands, unless it has it already (a landing tried before). A commit that cannot be amended lands
 * without it.
 */
async function withTrailer(ws: string, trailer: string | undefined) {
  if (!trailer) return;
  const message = await gitAsync(ws, 'log', '-1', '--format=%B');
  if (message.split('\n').includes(trailer)) return;
  // the worker's commit as it was, its author kept; its hooks ran when it was made
  try {
    await gitAsync(ws, 'commit', '--amend', '--quiet', '--no-verify', '--allow-empty', '--cleanup=verbatim', '-m', addTrailer(message, trailer));
  } catch (e) {
    // the link is a convenience: the work lands without it
    console.error(`landing without ${trailer}:`, messageOf(e));
  }
}

/** The commit message with `trailer` in its trailers: beside those it ends with (`Co-Authored-By: …`), else in a paragraph of its own. */
export function addTrailer(message: string, trailer: string): string {
  const text = message.trimEnd();
  const paragraphs = text.split(/\n\s*\n/);
  const last = paragraphs.at(-1)!.split('\n');
  const trailers = paragraphs.length > 1 && last.every((l) => /^[\w-]+:/.test(l) || /^\s+\S/.test(l)) && /^[\w-]+:/.test(last[0]!);
  return `${text}${trailers ? '\n' : '\n\n'}${trailer}\n`;
}

/** How long free clones found dirty count as dirty before `leasable` looks again. */
export const RECHECK_MS = 60_000;

export interface WorkspaceOptions {
  mode: 'clones' | 'worktrees';
  /** The checkout Obeya runs on. */
  repoPath: string;
  /** Where worktrees and created clones go. */
  dir: string;
  /** The repository on the canvas these workspaces belong to; null is its home repository. */
  repo?: string | null;
  /**
   * The machines its clones are on, in the order a new card looks for room (`host` null: this one),
   * each with how many of the repository's workers may be busy there at once (none: as many as
   * there are clones). Without it, this machine alone.
   */
  machines?: { host: string | null; slots?: number }[];
  /** How many of the repository's workers are in a turn on a machine now (null: this one). */
  busy?: (host: string | null) => number;
}

/** The name of the machine Obeya runs on, as the Workspaces pill shows it. */
export const HERE = hostname().split('.')[0] || 'localhost';

/** The code `lease` refuses with for each reason it finds no workspace. */
const SHORT_CODE = { none: 'noWorkspace', dirty: 'dirtyWorkspaces', slots: 'noSlot' } as const;
/** Why `lease` found no workspace, by the code it refused with; none for any other refusal. */
export const shortageOf = (code: string) => (Object.keys(SHORT_CODE) as WorkspaceShortage[]).find((s) => SHORT_CODE[s] === code);
const SHORT_TEXT = { none: 'no workspace registered or all are leased', dirty: 'every free workspace has uncommitted changes', slots: 'every machine with a free workspace has as many busy workers as it has slots' };

/**
 * Where a repository's cards work, as the workers, the Koordinator and the canvas use it: clones or
 * worktrees of a git repository (`Workspaces`), or the folder itself where it has no git
 * (`FolderWorkspaces` in `folder.ts`, which has no branches and lands nothing).
 */
export interface CardWorkspaces {
  readonly mode: 'clones' | 'worktrees' | 'folder';
  readonly dir: string;
  readonly pooled: boolean;
  list(): { path: string; card_id: string | null }[];
  leasedBy(cardId: string): string | null;
  lease(cardId: string, branch: string, o?: { overSlots?: boolean }): string;
  leasable(overSlots?: boolean): boolean;
  pool(busy: string[]): PoolHost[];
  hasWork(cardId: string): boolean;
  release(cardId: string): void;
  abandon(cardId: string): boolean;
  retake(cardId: string, path: string): boolean;
  forkPoint(cardId: string): { ws: string; base: string } | null;
  addedFiles(cardId: string, dir: string): string[];
  landOnMain(cardId: string, branch: string, trailer?: string): Promise<LandProblem | Landed>;
  pushToMain(cardId: string, trailer?: string): Promise<LandProblem | Landed>;
  removeLanded(cardId: string, branch: string): void;
  discard(cardId: string, branch: string): void;
  transfer(from: string, to: string, branch: string, rename?: string): { path: string; branch: string };
  followUpTree(cardId: string, branch: string): string;
  removeFollowUpTree(path: string): void;
  changes(cardId: string): Change[];
  diff(cardId: string, full: boolean): Promise<CardDiff | null>;
  landedDiff(base: string, commit: string, full: boolean): Promise<CardDiff | null>;
  fileOf(cardId: string, path: string, ref?: string, local?: boolean): Promise<FileAt | null>;
  changedFiles(cardId: string, landed?: { base: string; commit: string }): Promise<string[]>;
}

/** A file of a card's work: where it lies on this machine, or what it holds (read from a commit). */
export type FileAt = { path: string } | { data: Uint8Array<ArrayBuffer> };

/**
 * The file at `path` in `root` itself, null where it is a link (or lies in a linked directory): a
 * link the card made could otherwise stand for any file of the root it did not change.
 */
export function ownFile(root: string, path: string): FileAt | null {
  const at = demoFile(root, path);
  try {
    return at && at === join(realpathSync(root), path) ? { path: at } : null;
  } catch {
    return null;
  }
}

export class Workspaces implements CardWorkspaces {
  /** What `leasable` last looked at (the free clones on machines with room, or on any with `overSlots`) when it found them all dirty, and when. */
  private dirty = new Map<boolean, { key: string; at: number }>();
  /** Clones the configuration no longer names that a card still holds: they leave the pool once it gives them back (`keepOnly`). */
  private leaving = new Set<string>();

  constructor(
    private store: Store,
    private canvasId: string,
    private o: WorkspaceOptions,
  ) {}

  get mode(): 'clones' | 'worktrees' {
    return this.o.mode;
  }

  /** The directory its clones or worktrees are made in (and follow-ups' temporary worktrees). */
  get dir() {
    return this.o.dir;
  }

  /** Registers a clone; with `origins`, only when its `origin` is one of them. */
  register(path: string, origins?: string[]) {
    git(path, 'rev-parse', '--git-dir');
    if (origins?.length) {
      let origin = '';
      try {
        origin = git(path, 'remote', 'get-url', 'origin');
      } catch {}
      const norm = (u: string) => u.replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
      if (!origins.some((o) => norm(o) === norm(origin))) throw new WorkspaceError(`${path} is not a clone of ${origins.join(' or ')} (its origin is ${origin || 'unset'})`);
    }
    this.store.addWorkspace(this.canvasId, path, this.o.repo ?? null);
  }

  /** Makes sure `n` clones of `source` exist and are registered; returns their paths. */
  ensureClones(source: string, n: number): string[] {
    mkdirSync(this.o.dir, { recursive: true });
    const paths: string[] = [];
    for (let i = 1; i <= n; i++) {
      const path = join(this.o.dir, String(i));
      if (!existsSync(path)) git(this.o.dir, 'clone', '--quiet', source, path);
      this.register(path);
      paths.push(path);
    }
    return paths;
  }

  /**
   * Takes the clones on `host` (null: this machine) that are not among `named` out of the pool: the
   * configuration no longer names them (fewer clones to create, an existing one or a host taken out).
   * A free one leaves at once; one a card holds stays with it and leaves once the card gives it
   * back. Nothing on disk goes: a clone keeps its branches, and naming it again brings it back.
   */
  keepOnly(host: string | null, named: string[]) {
    for (const w of this.list()) {
      if (hostName(w.path) !== host || named.includes(w.path)) continue;
      if (w.card_id) this.leaving.add(w.path);
      else this.store.removeWorkspace(w.path);
    }
    for (const path of this.leaving) if (named.includes(path)) this.leaving.delete(path);
  }

  /**
   * Makes sure `n` clones of `source` (the repository's remote) exist under `root` on `host` and
   * are registered (`ssh://<host>/<root>/<i>`), each with git's login through `GH_TOKEN`. Runs in
   * the background, so that an unreachable host does not hold up the start; a clone is leased only
   * once it is registered. `token` is the repository's GitHub login. Settles with what went wrong, if anything.
   */
  async ensureHostClones(host: SshHost, root: string, source: string, n: number, token: () => string | undefined): Promise<string | null> {
    try {
      const dir = await host.resolveDir(root);
      host.tokenFor(dir, token);
      for (let i = 1; i <= n; i++) {
        const path = `${dir}/${i}`;
        if ((await host.run(['test', '-d', `${path}/.git`])).code !== 0) {
          const r = await host.run(['git', ...TOKEN_HELPER_ARGS, 'clone', '--quiet', source, path], { cwd: dir });
          if (r.code !== 0) throw new HostError(`cloning ${source} on ${host.name}: ${(r.stderr || r.stdout).trim()}`);
        }
        // the worker's own push and gh go through the same login
        const helper = `git config --unset-all credential.helper; ${TOKEN_HELPER.map((h) => `git config --add credential.helper ${shWord(h)}`).join(' && ')}`;
        const c = await host.run(helper, { cwd: path });
        if (c.code !== 0) throw new HostError(`${host.name}: ${c.stderr.trim()}`);
        await host.trust(path);
        this.store.addWorkspace(this.canvasId, onHost(host.name, path), this.o.repo ?? null);
      }
      // those of fewer clones there, or under another directory, leave the pool
      this.keepOnly(host.name, Array.from({ length: n }, (_, i) => onHost(host.name, `${dir}/${i + 1}`)));
      return null;
    } catch (e) {
      return messageOf(e);
    }
  }

  list() {
    return this.store.workspaces(this.canvasId, this.o.repo ?? null);
  }

  leasedBy(cardId: string): string | null {
    return this.list().find((w) => w.card_id === cardId)?.path ?? null;
  }

  /**
   * Gives the card a workspace on `branch` and returns its path. A clone comes from the first
   * machine with a free slot, a worktree only while this machine has one; `overSlots` takes one on
   * a busy machine when none has a slot (an owner's question to a finished card, which should not wait).
   */
  lease(cardId: string, branch: string, o: { overSlots?: boolean } = {}): string {
    const own = this.leasedBy(cardId);
    if (own) return own;
    if (this.o.mode === 'clones') return this.leaseClone(cardId, branch, !!o.overSlots);
    if (!o.overSlots && !this.room(null)) throw new WorkspaceError(SHORT_TEXT.slots, SHORT_CODE.slots);
    return this.leaseWorktree(cardId, branch);
  }

  /** Whether its pool is worth showing: clones, or worktrees capped by slots. */
  get pooled(): boolean {
    return this.o.mode === 'clones' || Number.isFinite(this.slots(null));
  }

  /**
   * Whether `lease` would find a workspace for a new card now. A worktree can always be made, while
   * there is a slot for its worker; a clone must be free and clean, on a machine with a free slot.
   * Free clones that were dirty at the last look within RECHECK_MS are not asked again, since cards
   * waiting for one ask on every change of the board. `overSlots`: whether `lease` with it would.
   */
  leasable(overSlots = false): boolean {
    if (this.o.mode === 'worktrees') return overSlots || this.room(null);
    const free = this.list().filter((w) => !w.card_id);
    const key = [...free.map((w) => w.path), ...(overSlots ? [] : this.machines().filter((m) => this.room(m)))].join('\n');
    const dirty = this.dirty.get(overSlots);
    if (dirty?.key === key && Date.now() - dirty.at < RECHECK_MS) return false;
    const found = this.place(overSlots);
    if ('short' in found && found.short === 'dirty') this.dirty.set(overSlots, { key, at: Date.now() });
    else this.dirty.delete(overSlots);
    return 'path' in found;
  }

  /** The machines in the order a new card looks for room; a machine whose clones are registered but no longer configured comes last. */
  private machines(): (string | null)[] {
    const order = (this.o.machines ?? [{ host: null }]).map((m) => m.host);
    for (const w of this.list()) {
      const h = hostName(w.path);
      if (!order.includes(h)) order.push(h);
    }
    return order;
  }

  /** How many of the repository's workers may be busy on a machine at once; Infinity when its clones are the only cap. */
  private slots(host: string | null): number {
    const m = this.o.machines?.find((x) => x.host === host);
    if (!m) return this.o.machines ? 0 : Infinity;
    return m.slots ?? Infinity;
  }

  /** Whether a machine has a slot for one more busy worker. */
  private room(host: string | null): boolean {
    return (this.o.busy?.(host) ?? 0) < this.slots(host);
  }

  /**
   * The clean free clone a new card takes: on the first machine with a slot, else with `overSlots`
   * on the first busy one; or why there is none.
   */
  private place(overSlots: boolean): { path: string } | { short: WorkspaceShortage } {
    const free = this.list().filter((w) => !w.card_id);
    if (!free.length) return { short: 'none' };
    const machines = this.machines();
    const roomy = machines.filter((m) => this.room(m));
    let full = false;
    let dirty = false;
    for (const host of overSlots ? [...roomy, ...machines.filter((m) => !roomy.includes(m))] : machines) {
      const here = free.filter((w) => hostName(w.path) === host);
      if (!here.length) continue;
      if (!overSlots && !roomy.includes(host)) {
        full = true;
        continue;
      }
      for (const w of here) {
        try {
          // an unreachable machine's clones count as missing, not as dirty
          if (!exists(w.path)) continue;
          dirty = true;
          if (git(w.path, 'status', '--porcelain') === '') return { path: w.path };
        } catch {}
      }
    }
    return { short: full ? 'slots' : dirty ? 'dirty' : 'none' };
  }

  /**
   * The pool by machine for the Workspaces pill, `busy` the cards whose worker is in a turn. Worktrees
   * are never short, so their pool is this machine's slots, each taken while a worker is at work.
   */
  pool(busy: string[]): PoolHost[] {
    const all = this.list();
    if (this.o.mode === 'worktrees') {
      const slots = this.slots(null);
      const cards = all.flatMap((w) => (w.card_id && busy.includes(w.card_id) ? [w.card_id] : []));
      return [{ name: HERE, here: true, worktrees: true, slots, total: slots, cards, busy: cards }];
    }
    return this.machines().map((host) => {
      const ws = all.filter((w) => hostName(w.path) === host);
      const cards = ws.flatMap((w) => (w.card_id ? [w.card_id] : []));
      const slots = this.slots(host);
      return {
        name: host ?? HERE,
        ...(host === null ? { here: true } : {}),
        slots: Number.isFinite(slots) ? slots : ws.length,
        total: ws.length,
        cards,
        busy: cards.filter((c) => busy.includes(c)),
      };
    });
  }

  /** Whether the card's workspace holds work: uncommitted changes or commits beyond the base. */
  hasWork(cardId: string): boolean {
    const ws = this.leasedBy(cardId);
    if (!ws || !exists(ws)) return false;
    try {
      if (git(ws, 'status', '--porcelain')) return true;
      return git(ws, 'rev-list', '--count', `${this.upstream(ws)}..HEAD`) !== '0';
    } catch {
      return true;
    }
  }

  /** Frees the workspace for other cards; a worktree stays until the card's work has landed. A clone the configuration no longer names leaves the pool. */
  release(cardId: string) {
    const path = this.leasedBy(cardId);
    if (!path) return;
    if (this.leaving.delete(path)) this.store.removeWorkspace(path);
    else this.store.setLease(path, null);
  }

  /**
   * Frees the workspace of a card that will not work in it again (deleted, or its workstream done
   * without it), losing nothing: a clone keeps the card's branch and whatever else it holds, and is
   * free for other cards (one with uncommitted changes takes none until it is clean); a clean
   * worktree goes and its branch stays, a worktree with uncommitted changes stays as it is (it
   * takes no slot). Returns whether it freed it.
   */
  abandon(cardId: string): boolean {
    const ws = this.leasedBy(cardId);
    if (!ws) return false;
    if (this.o.mode === 'clones') {
      this.release(cardId);
      return true;
    }
    if (existsSync(ws)) {
      if (gitOrNull(ws, 'status', '--porcelain') !== '') return false;
      if (gitOrNull(this.o.repoPath, 'worktree', 'remove', ws) === null) return false;
    }
    this.store.removeWorkspace(ws);
    return true;
  }

  /** A deleted card restored takes back the clone it had, while that one is still free; a worktree is made again on its branch. */
  retake(cardId: string, path: string): boolean {
    if (this.leasedBy(cardId)) return true;
    if (this.o.mode !== 'clones' || !this.list().some((w) => w.path === path && !w.card_id)) return false;
    this.store.setLease(path, cardId);
    return true;
  }

  /**
   * The card's workspace and the commit its branch left the branch it lands on at, where it has
   * one: what the branch changes is told by comparing its `HEAD` with that commit.
   */
  forkPoint(cardId: string): { ws: string; base: string } | null {
    const ws = this.leasedBy(cardId);
    if (!ws) return null;
    try {
      return { ws, base: git(ws, 'merge-base', 'HEAD', this.upstream(ws)) };
    } catch {
      return null;
    }
  }

  /** The files under `dir` that the card's branch adds, against the branch it lands on. */
  addedFiles(cardId: string, dir: string): string[] {
    const ws = this.leasedBy(cardId);
    if (!ws) return [];
    try {
      return git(ws, 'diff', '--name-only', '--diff-filter=A', `${this.upstream(ws)}...HEAD`, '--', dir).split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Lands the card's committed branch on the Obeya checkout's default branch by rebasing (or,
   * when only the replay conflicts, squashing) and fast-forwarding. The workspace stays with the
   * card, so its worker can finish what remains; `removeLanded` frees it. Returns what went wrong
   * (`worker` problems are the worker's to fix, the others stop at the Obeya checkout), or how
   * the default branch moved. `trailer` goes into the message of the commit that lands last.
   */
  landOnMain(cardId: string, branch: string, trailer?: string): Promise<LandProblem | Landed> {
    return oneAtATime(landings, this.o.repoPath, () => this.land(cardId, branch, trailer));
  }

  private async land(cardId: string, branch: string, trailer?: string): Promise<LandProblem | Landed> {
    const ws = this.leasedBy(cardId);
    if (!ws) return { code: 'land', worker: false, detail: 'the card has no workspace' };
    try {
      const base = this.main(ws);
      const problem = await rebased(ws, base, this.upstream(ws, base));
      if (problem) return problem;
      await withTrailer(ws, trailer);
      if ((await gitAsync(this.o.repoPath, 'branch', '--show-current')) !== base) return { code: 'landCheckout', worker: false, detail: `the Obeya checkout is not on ${base}` };
    } catch (e) {
      return { code: 'land', worker: false, detail: messageOf(e) };
    }
    try {
      const from = await gitAsync(this.o.repoPath, 'rev-parse', 'HEAD');
      if (this.o.mode === 'worktrees') await gitAsync(this.o.repoPath, 'merge', '--ff-only', '--quiet', branch);
      else {
        await gitAsync(this.o.repoPath, 'fetch', '--quiet', ws, branch);
        await gitAsync(this.o.repoPath, 'merge', '--ff-only', '--quiet', 'FETCH_HEAD');
      }
      return { from, to: await gitAsync(this.o.repoPath, 'rev-parse', 'HEAD') };
    } catch (e) {
      // typically local changes in the Obeya checkout that the fast-forward would overwrite
      return { code: 'landMerge', worker: false, detail: messageOf(e) };
    }
  }

  /**
   * Lands the card's committed branch on the default branch of `origin` without a pull request:
   * rebased (or squashed) onto it as in `landOnMain`, then pushed there, never forced. When the
   * push is turned away because the default branch moved meanwhile, it fetches, rebases and pushes
   * once more. The Obeya checkout is left as it is; the workspace stays with the card. `trailer`
   * as in `landOnMain`.
   */
  pushToMain(cardId: string, trailer?: string): Promise<LandProblem | Landed> {
    return oneAtATime(landings, this.o.repoPath, () => this.push(cardId, trailer));
  }

  private async push(cardId: string, trailer?: string): Promise<LandProblem | Landed> {
    const ws = this.leasedBy(cardId);
    if (!ws) return { code: 'land', worker: false, detail: 'the card has no workspace' };
    for (let attempt = 0; ; attempt++) {
      let base: string;
      let from: string;
      try {
        base = this.main(ws);
        const upstream = `origin/${base}`;
        const problem = await rebased(ws, base, upstream);
        if (problem) return problem;
        await withTrailer(ws, trailer);
        from = await gitAsync(ws, 'rev-parse', upstream);
      } catch (e) {
        return { code: 'landPush', worker: false, detail: messageOf(e) };
      }
      try {
        await gitAsync(ws, 'push', '--quiet', 'origin', `HEAD:refs/heads/${base}`);
        return { from, to: await gitAsync(ws, 'rev-parse', 'HEAD') };
      } catch (e) {
        const detail = messageOf(e);
        // the default branch moved since the fetch, or while pushing; anything else (a protected branch, say) is the owner's
        if (attempt === 0 && /non-fast-forward|fetch first|\[rejected\]|cannot lock ref|failed to update ref/.test(detail)) continue;
        return { code: 'landPush', worker: false, detail };
      }
    }
  }

  /**
   * Frees the workspace of work that has landed, once its worker is done: a worktree and its
   * branch are removed (a branch with commits that never landed stays), a clone is free again.
   */
  removeLanded(cardId: string, branch: string) {
    const ws = this.leasedBy(cardId);
    if (!ws) return;
    if (this.o.mode === 'clones') return this.release(cardId);
    this.store.removeWorkspace(ws);
    if (existsSync(ws)) git(this.o.repoPath, 'worktree', 'remove', '--force', ws);
    try {
      if (git(this.o.repoPath, 'branch', '--list', branch)) git(this.o.repoPath, 'branch', '--quiet', '-d', branch);
    } catch (e) {
      console.error(`keeping branch ${branch}:`, e instanceof Error ? e.message : e);
    }
  }

  /**
   * Throws the card's work away: a prototype never lands. A worktree and its branch are
   * removed; a clone goes back to its default branch, without the card's branch, and is free again.
   */
  discard(cardId: string, branch: string) {
    const ws = this.leasedBy(cardId);
    if (!ws) return;
    if (this.o.mode === 'worktrees') {
      this.store.removeWorkspace(ws);
      if (existsSync(ws)) git(this.o.repoPath, 'worktree', 'remove', '--force', ws);
      if (git(this.o.repoPath, 'branch', '--list', branch)) git(this.o.repoPath, 'branch', '--quiet', '-D', branch);
      return;
    }
    if (exists(ws)) {
      git(ws, 'reset', '--quiet', '--hard');
      git(ws, 'clean', '--quiet', '-fd');
      git(ws, 'checkout', '--quiet', '--detach', `origin/${this.main(ws)}`);
      if (git(ws, 'branch', '--list', branch)) git(ws, 'branch', '--quiet', '-D', branch);
    }
    this.release(cardId);
  }

  /**
   * Hands card `from`'s workspace and branch to card `to`, which goes on with the work there (an
   * idea built on its prototype). The branch is renamed to `rename` when that name is free; the
   * worktree keeps its directory. Returns the workspace and the branch as they are now.
   */
  transfer(from: string, to: string, branch: string, rename?: string): { path: string; branch: string } {
    const path = this.leasedBy(from);
    if (!path) throw new WorkspaceError('the card has no workspace', 'noWorkspace');
    if (this.leasedBy(to)) throw new WorkspaceError('the card it goes to has a workspace of its own');
    // in a worktree the branch lives in the Obeya checkout, in a clone in the clone
    const repo = this.o.mode === 'worktrees' ? this.o.repoPath : path;
    let now = branch;
    if (rename && rename !== branch && !git(repo, 'branch', '--list', rename)) {
      git(repo, 'branch', '-m', branch, rename);
      now = rename;
    }
    this.store.setLease(path, to);
    return { path, branch: now };
  }

  /**
   * What the card's branch changes so far, committed or not: each file relative to the repository
   * root, with the changed line ranges and git's function context, so a judge can tell whether two
   * cards edit the same place. A new file has no ranges.
   */
  changes(cardId: string): Change[] {
    const ws = this.leasedBy(cardId);
    if (!ws || !exists(ws)) return [];
    try {
      const diff = git(ws, 'diff', '-U0', '--no-color', '--no-ext-diff', git(ws, 'merge-base', 'HEAD', this.upstream(ws)));
      const untracked = git(ws, 'ls-files', '--others', '--exclude-standard');
      return [...parseChanges(diff), ...untracked.split('\n').filter(Boolean).map((file) => ({ file, regions: [] }))];
    } catch {
      return [];
    }
  }

  /**
   * The card's change in its workspace: its branch against the default branch, committed or not,
   * with new files not yet added; null without a workspace (or one git cannot read).
   */
  async diff(cardId: string, full: boolean): Promise<CardDiff | null> {
    const ws = this.leasedBy(cardId);
    if (!ws || !exists(ws)) return null;
    try {
      const base = await gitAsync(ws, 'merge-base', 'HEAD', this.upstream(ws));
      const tracked = await gitDiff(ws, base);
      const untracked = (await gitAsync(ws, 'ls-files', '-z', '--others', '--exclude-standard')).split('\0').filter(Boolean);
      const added: string[] = [];
      // a new file against nothing; git answers 1 when there is a difference
      for (const file of untracked.slice(0, NEW_FILES_SHOWN)) {
        const r = await gitRun(ws, [...DIFF, '--no-index', '--', '/dev/null', file]);
        if (r.code === 1) added.push(r.stdout.trim());
      }
      return cardDiff('branch', [tracked, ...added].filter(Boolean).join('\n'), full);
    } catch {
      return null;
    }
  }

  /** What landed work changed on the default branch, from `base` to `commit`; null where the checkout does not hold them. */
  async landedDiff(base: string, commit: string, full: boolean): Promise<CardDiff | null> {
    try {
      return cardDiff('landed', await gitDiff(this.o.repoPath, base, commit), full);
    } catch {
      return null;
    }
  }

  /**
   * The files of the card's change as they are now (none deleted), as git names them: its branch
   * against the default branch, committed or not, with new files; with `landed`, what the landing
   * put on the default branch. Separated by NUL, so no name can pass for another, as a name with
   * ` b/` in it can in a diff's header; what `file` serves rests on this list. Empty where git
   * cannot tell.
   */
  async changedFiles(cardId: string, landed?: { base: string; commit: string }): Promise<string[]> {
    const names = async (cwd: string, args: string[]) => {
      const r = await gitRun(cwd, ['-c', 'core.quotePath=false', ...args]);
      if (r.code !== 0) throw new WorkspaceError(r.stderr);
      return r.stdout.split('\0').filter(Boolean);
    };
    try {
      if (landed) return await names(this.o.repoPath, ['diff', '--name-only', '-z', '-M', '--diff-filter=d', landed.base, landed.commit]);
      const ws = this.leasedBy(cardId);
      if (!ws || !exists(ws)) return [];
      const base = await gitAsync(ws, 'merge-base', 'HEAD', this.upstream(ws));
      return [...(await names(ws, ['diff', '--name-only', '-z', '-M', '--diff-filter=d', base])), ...(await names(ws, ['ls-files', '-z', '--others', '--exclude-standard']))];
    } catch {
      return [];
    }
  }

  /**
   * A file of the card's work as it is now, by its path relative to the repository: in its workspace
   * while it has one here, else as `ref` (the commit it landed with, its branch) holds it in the
   * repository. `local`: only a file on disk, to open it; for `ref` the checkout's copy. Null where
   * none holds it; a link out of the workspace holds none.
   */
  async fileOf(cardId: string, path: string, ref?: string, local = false): Promise<FileAt | null> {
    const ws = this.leasedBy(cardId);
    if (ws && !remoteWorkspace(ws) && existsSync(ws)) return ownFile(ws, path);
    if (!ref) return null;
    if (local) return ownFile(this.o.repoPath, path);
    const p = Bun.spawn([GIT, 'show', `${ref}:${path}`], { cwd: this.o.repoPath, stdout: 'pipe', stderr: 'ignore' });
    const data = new Uint8Array(await new Response(p.stdout).arrayBuffer());
    return (await p.exited) === 0 ? { data } : null;
  }

  /**
   * The main branch as a workspace sees it: the repository's for a worktree; for a clone the one the
   * owner set for the repository, else the one its `origin` has.
   */
  private main(ws: string): string {
    return branchSetting(this.o.repoPath) || defaultBranch(this.o.mode === 'worktrees' ? this.o.repoPath : ws);
  }

  /** The branch the workspace's work goes onto as the workspace has it: the main branch itself in a worktree, `origin`'s copy in a clone. */
  private upstream(ws: string, main = this.main(ws)): string {
    return this.o.mode === 'worktrees' ? main : `origin/${main}`;
  }

  private leaseClone(cardId: string, branch: string, overSlots: boolean): string {
    const found = this.place(overSlots);
    if ('short' in found) throw new WorkspaceError(SHORT_TEXT[found.short], SHORT_CODE[found.short]);
    const { path } = found;
    const base = this.main(path);
    git(path, 'fetch', '--quiet', 'origin');
    // a branch that already exists holds work: check it out, never reset it
    if (git(path, 'branch', '--list', branch)) git(path, 'checkout', '--quiet', branch);
    else git(path, 'checkout', '--quiet', '-b', branch, `origin/${base}`);
    this.store.setLease(path, cardId);
    return path;
  }

  /**
   * A temporary worktree for the owner's question to a finished card while no clone is free and
   * clean: detached at the head of the card's branch, made from the
   * clone on this machine that holds the branch (else from the configured checkout, at `origin`'s
   * copy of the branch or the default branch), as the Lesestand is made. It takes no clone and is
   * not in the pool; `removeFollowUpTree` removes it once the follow-up ends.
   */
  followUpTree(cardId: string, branch: string): string {
    const path = join(this.o.dir, 'follow-up', cardId.slice(0, 8));
    const commit = (repo: string, ref: string) => gitOrNull(repo, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`) || null;
    const clones = [...this.list().map((w) => w.path), this.o.repoPath].filter((p) => hostName(p) === null && existsSync(p));
    const own = clones.find((p) => commit(p, `refs/heads/${branch}`));
    const [repo, ref] = own
      ? [own, `refs/heads/${branch}`]
      : [this.o.repoPath, [`refs/remotes/origin/${branch}`, `origin/${this.main(this.o.repoPath)}`, 'HEAD'].find((r) => commit(this.o.repoPath, r))!];
    this.removeFollowUpTree(path);
    addDetachedTree(repo, path, commit(repo, ref) ?? ref);
    return path;
  }

  /** Removes a follow-up's temporary worktree (`followUpTree`) and its entry in the clone it was made from. */
  removeFollowUpTree(path: string) {
    if (!existsSync(path)) return;
    const common = gitOrNull(path, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    rmSync(path, { recursive: true, force: true });
    if (common) git(common, 'worktree', 'prune');
  }

  private leaseWorktree(cardId: string, branch: string): string {
    const path = join(this.o.dir, cardId.slice(0, 8));
    if (!existsSync(path)) {
      mkdirSync(this.o.dir, { recursive: true });
      const exists = git(this.o.repoPath, 'branch', '--list', branch) !== '';
      if (exists) git(this.o.repoPath, 'worktree', 'add', '--quiet', path, branch);
      else git(this.o.repoPath, 'worktree', 'add', '--quiet', '-b', branch, path, defaultBranch(this.o.repoPath));
    }
    this.store.addWorkspace(this.canvasId, path, this.o.repo ?? null);
    this.store.setLease(path, cardId);
    return path;
  }

}

/**
 * Adds a worktree of `repo` at `path`, detached at `commit`. The hooks are the repository's (a
 * post-checkout installing dependencies, say), not the worktree's: none run.
 */
export function addDetachedTree(repo: string, path: string, commit: string) {
  mkdirSync(dirname(path), { recursive: true });
  git(repo, '-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--quiet', '--detach', '--force', path, commit);
}

export interface Change {
  file: string;
  /** Changed ranges in the new file, as git's hunk header has them: "120-134 in function decide". */
  regions: string[];
}

/** Files and their hunks from a `git diff -U0`. */
export function parseChanges(diff: string): Change[] {
  const out: Change[] = [];
  let header = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      out.push({ file: '', regions: [] });
      header = true;
      continue;
    }
    const cur = out.at(-1);
    if (!cur) continue;
    // the file names come before the first hunk; later lines like these are content
    if (header && line.startsWith('--- a/')) cur.file = line.slice(6);
    else if (header && line.startsWith('+++ b/')) cur.file = line.slice(6);
    else if (header && line === '+++ /dev/null') cur.regions.push('deleted');
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);
    if (!hunk) continue;
    header = false;
    if (cur.regions[0] === 'deleted') continue;
    const start = Number(hunk[1]);
    const n = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const at = n === 0 ? `${start} (lines removed)` : n === 1 ? `${start}` : `${start}-${start + n - 1}`;
    cur.regions.push(hunk[3] ? `${at} in ${hunk[3].trim()}` : at);
  }
  return out.filter((c) => c.file);
}

/**
 * The main branches the owner set for repositories on this machine (`RepoSettings.branch`), by
 * the repository's path, each read when it is asked for: a running canvas registers its own.
 */
const branchSettings = new Map<string, () => string | undefined>();

/** Registers where the main branch the owner set for the repository at `repoPath` is read; returns what takes it back. */
export function useBranchSetting(repoPath: string, branch: () => string | undefined): () => void {
  const key = resolve(repoPath);
  branchSettings.set(key, branch);
  return () => {
    if (branchSettings.get(key) === branch) branchSettings.delete(key);
  };
}

/** The main branch the owner set on this machine for the repository at `path`; none where they set none. */
export const branchSetting = (path: string): string | undefined => branchSettings.get(resolve(path))?.()?.trim() || undefined;

/** The repository's main branch: the one the owner set for it on this machine, else the one detected (`detectedBranch`); none in a folder without git. */
export function defaultBranch(path: string): string {
  if (isFolder(path)) return '';
  return branchSetting(path) || detectedBranch(path);
}

/**
 * The folders without git in the configuration (`RepoConfig.git` false), by path: they have no
 * branch, and what Obeya reads of them (`.obeya/settings.json`, plan docs) it reads as the folder has
 * it. Marked whenever a configuration is resolved.
 */
const folders = new Set<string>();

/** Marks the path as a folder without git, or as a repository again. */
export function markFolder(path: string, folder: boolean) {
  if (folder) folders.add(resolve(path));
  else folders.delete(resolve(path));
}

/** Whether the path is a folder without git in the configuration. */
export const isFolder = (path: string): boolean => folders.has(resolve(path));

/**
 * The repository's main branch as git tells it, where cards start from and work lands: `origin`'s HEAD where the
 * checkout knows one. Else its only branch that is not a card's; else the one of them named as
 * git's `init.defaultBranch`, `main` or `master`, so that a branch the owner checks out for a
 * while does not take its place; else the branch the checkout is on, unless that is a card's;
 * else `init.defaultBranch`, else `main`.
 */
export const detectedBranch = (path: string): string => gitStepsSync(path, detectingBranch());

/** `detectedBranch` as git steps, from `branches` where they were read already. */
export function* detectingBranch(branches?: Branches | null): GitSteps<string> {
  const b = branches !== undefined ? branches : yield* readingBranches();
  if (b?.originHead) return b.originHead;
  const own = [...(b?.local.keys() ?? [])].filter((name) => !name.startsWith(CARD_BRANCH));
  if (own.length === 1) return own[0]!;
  const [init] = yield [['config', '--get', 'init.defaultBranch']];
  const usual = [init, 'main', 'master'].find((name) => name && own.includes(name));
  if (usual) return usual;
  const [current] = yield [['symbolic-ref', '--short', '-q', 'HEAD']];
  if (current && !current.startsWith(CARD_BRANCH)) return current;
  return init || 'main';
}

/** A repository's branches, what its main branch and that branch's commit are read from. */
export interface Branches {
  /** The branch `origin`'s HEAD names, where the checkout knows one. */
  originHead?: string;
  /** The local branches and their commits. */
  local: Map<string, string>;
  /** `origin`'s branches as the checkout last fetched them, and their commits. */
  remote: Map<string, string>;
}

/**
 * Reads `Branches` as git steps, all with one call: Obeya reads them each time it needs the main
 * branch, and each call of git takes a few milliseconds. Null where there is no git repository.
 */
export function* readingBranches(): GitSteps<Branches | null> {
  const [refs] = yield [['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)', 'refs/heads/', 'refs/remotes/origin/']];
  if (refs == null) return null;
  const b: Branches = { local: new Map(), remote: new Map() };
  const ORIGIN = 'refs/remotes/origin/';
  for (const line of refs.split('\n')) {
    const [ref = '', commit = '', symref = ''] = line.split('\0');
    if (ref === `${ORIGIN}HEAD`) {
      if (symref.startsWith(ORIGIN)) b.originHead = symref.slice(ORIGIN.length);
    } else if (ref.startsWith('refs/heads/')) b.local.set(ref.slice('refs/heads/'.length), commit);
    else if (ref.startsWith(ORIGIN)) b.remote.set(ref.slice(ORIGIN.length), commit);
  }
  return b;
}

/**
 * What Obeya reads of a repository with git, written once for both ways it runs: batches of git
 * calls (their arguments) that do not depend on one another, each answered with the calls' output
 * (trimmed; null where git failed) before the next batch is asked.
 */
export type GitSteps<T> = Generator<string[][], T, (string | null)[]>;

/** Runs git steps in `cwd` one call after the other, the server waiting: for code that cannot wait otherwise. */
export function gitStepsSync<T>(cwd: string, steps: GitSteps<T>): T {
  for (let step = steps.next([]); ; step = steps.next(step.value.map((args) => gitOrNull(cwd, ...args)))) if (step.done) return step.value;
}

/** Runs git steps in `cwd` without blocking the server, the calls of each batch at once. */
export async function gitSteps<T>(cwd: string, steps: GitSteps<T>): Promise<T> {
  const one = async (args: string[]) => {
    const r = await gitRun(cwd, args).catch(() => null);
    return r?.code === 0 ? r.stdout.trim() : null;
  };
  for (let step = steps.next([]); ; step = steps.next(await Promise.all(step.value.map(one)))) if (step.done) return step.value;
}

/** Git steps of their own that run beside each other: each batch holds the next calls of both. */
export function* together<A, B>(a: GitSteps<A>, b: GitSteps<B>): GitSteps<[A, B]> {
  let x = a.next([]);
  let y = b.next([]);
  while (!x.done || !y.done) {
    const asked = x.done ? 0 : x.value.length;
    const got = yield [...(x.done ? [] : x.value), ...(y.done ? [] : y.value)];
    if (!x.done) x = a.next(got.slice(0, asked));
    if (!y.done) y = b.next(got.slice(asked));
  }
  return [x.value, y.value];
}

/** Git steps of one batch: these calls. */
export function* gitCalls(...calls: string[][]): GitSteps<(string | null)[]> {
  return yield calls;
}

/** What every card's branch begins with. */
const CARD_BRANCH = 'obeya/';

/** `obeya/<slug>` from a card title, kept short and unique by the card id. */
export function branchName(title: string, cardId: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
  return `${CARD_BRANCH}${slug || 'card'}-${cardId.slice(0, 6)}`;
}
