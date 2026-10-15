// Where a card's worker works, and how approved work lands.
//
// `clones`: a pool of full clones per canvas, leased one card at a time (for repositories with tools
// that break in worktrees, or one app stack per clone), here and on other machines; a new card
// takes a clone on the first machine whose busy workers leave it a slot (design: Hosts). `worktrees`: one worktree of the Obeya checkout per card,
// created on start, as many in parallel as there are cards unless the repository has slots; kept
// across stop and restart until the card's work has landed.

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { type CardDiff, cardDiff } from '../core/diff';
import type { PoolHost, WorkspaceShortage } from '../core/types';
import type { Store } from './db';
import { HostError, hostName, onHost, remote, sh as shWord, type SshHost, TOKEN_HELPER, tokenHelperArgs } from './hosts';

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
    throw new WorkspaceError(e instanceof Error ? e.message : String(e));
  }
}

/** `git` in `cwd`, which may be a workspace on another machine (`ssh://<host>/…`, see `hosts.ts`). */
export function git(cwd: string, ...args: string[]): string {
  const there = remoteWorkspace(cwd);
  if (there) {
    const r = there.host.runSync(['git', ...tokenHelperArgs(), '-C', there.path, ...args], there.path);
    if (r.code !== 0) throw new WorkspaceError(`git ${args.join(' ')} in ${cwd}: ${(r.stderr || r.stdout).trim() || `exit code ${r.code}`}`);
    return r.stdout.trim();
  }
  const r = Bun.spawnSync([GIT, '-C', cwd, ...args], { stderr: 'pipe' });
  if (r.exitCode !== 0) throw new WorkspaceError(`git ${args.join(' ')} in ${cwd}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString().trim();
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
  if (there) return there.host.run(['git', ...tokenHelperArgs(), '-C', there.path, ...args], { cwd: there.path });
  const p = Bun.spawn([GIT, '-C', cwd, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, stdout, stderr };
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

function oneAtATime<T>(key: string, f: () => Promise<T>): Promise<T> {
  const next = (landings.get(key) ?? Promise.resolve()).then(f);
  const done = next.catch(() => {});
  landings.set(key, done);
  void done.then(() => landings.get(key) === done && landings.delete(key));
  return next;
}

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
      detail: `rebase onto ${base} failed${files.length ? `; conflicts in ${files.join(', ')}` : ''}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
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

const SHORT_CODE = { none: 'noWorkspace', dirty: 'dirtyWorkspaces', slots: 'noSlot' } as const;
const SHORT_TEXT = { none: 'no workspace registered or all are leased', dirty: 'every free workspace has uncommitted changes', slots: 'every machine with a free workspace has as many busy workers as it has slots' };

export class Workspaces {
  /** What `leasable` last looked at (the free clones on machines with room, or on any with `overSlots`) when it found them all dirty, and when. */
  private dirty = new Map<boolean, { key: string; at: number }>();

  constructor(
    private store: Store,
    private canvasId: string,
    private o: WorkspaceOptions,
  ) {}

  get mode() {
    return this.o.mode;
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

  /** Makes sure `n` clones of `source` exist and are registered. */
  ensureClones(source: string, n: number) {
    mkdirSync(this.o.dir, { recursive: true });
    for (let i = 1; i <= n; i++) {
      const path = join(this.o.dir, String(i));
      if (!existsSync(path)) git(this.o.dir, 'clone', '--quiet', source, path);
      this.register(path);
    }
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
          const r = await host.run(['git', ...tokenHelperArgs(), 'clone', '--quiet', source, path], { cwd: dir });
          if (r.code !== 0) throw new HostError(`cloning ${source} on ${host.name}: ${(r.stderr || r.stdout).trim()}`);
        }
        // the worker's own push and gh go through the same login
        const helper = `git config --unset-all credential.helper; ${TOKEN_HELPER.map((h) => `git config --add credential.helper ${shWord(h)}`).join(' && ')}`;
        const c = await host.run(helper, { cwd: path });
        if (c.code !== 0) throw new HostError(`${host.name}: ${c.stderr.trim()}`);
        await host.trust(path);
        this.store.addWorkspace(this.canvasId, onHost(host.name, path), this.o.repo ?? null);
      }
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
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
      const base = this.o.mode === 'worktrees' ? this.main(ws) : `origin/${this.main(ws)}`;
      return git(ws, 'rev-list', '--count', `${base}..HEAD`) !== '0';
    } catch {
      return true;
    }
  }

  /** Frees the workspace for other cards; a worktree stays until the card's work has landed. */
  release(cardId: string) {
    const path = this.leasedBy(cardId);
    if (path) this.store.setLease(path, null);
  }

  /** The files under `dir` that the card's branch adds, against the branch it lands on. */
  addedFiles(cardId: string, dir: string): string[] {
    const ws = this.leasedBy(cardId);
    if (!ws) return [];
    try {
      const base = this.main(ws);
      const upstream = this.o.mode === 'worktrees' ? base : `origin/${base}`;
      return git(ws, 'diff', '--name-only', '--diff-filter=A', `${upstream}...HEAD`, '--', dir).split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Lands the card's committed branch on the Obeya checkout's default branch by rebasing (or,
   * when only the replay conflicts, squashing) and fast-forwarding. The workspace stays with the
   * card, so its worker can finish what remains; `removeLanded` frees it. Returns what went wrong
   * (`worker` problems are the worker's to fix, the others stop at the Obeya checkout), or how
   * the default branch moved.
   */
  landOnMain(cardId: string, branch: string): Promise<LandProblem | Landed> {
    return oneAtATime(this.o.repoPath, () => this.land(cardId, branch));
  }

  private async land(cardId: string, branch: string): Promise<LandProblem | Landed> {
    const ws = this.leasedBy(cardId);
    if (!ws) return { code: 'land', worker: false, detail: 'the card has no workspace' };
    try {
      if (await gitAsync(ws, 'status', '--porcelain')) return { code: 'landDirty', worker: true, detail: 'uncommitted changes in the workspace' };
      const base = this.main(ws);
      const upstream = this.o.mode === 'worktrees' ? base : `origin/${base}`;
      if (this.o.mode === 'clones') await gitAsync(ws, 'fetch', '--quiet', 'origin');
      const conflict = await rebaseOnto(ws, upstream, base);
      if (conflict) return conflict;
      if ((await gitAsync(ws, 'rev-list', '--count', `${upstream}..HEAD`)) === '0') return { code: 'landEmpty', worker: true, detail: 'the branch has no commits' };
      if ((await gitAsync(this.o.repoPath, 'branch', '--show-current')) !== base) return { code: 'landCheckout', worker: false, detail: `the Obeya checkout is not on ${base}` };
    } catch (e) {
      return { code: 'land', worker: false, detail: e instanceof Error ? e.message : String(e) };
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
      return { code: 'landMerge', worker: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Lands the card's committed branch on the default branch of `origin` without a pull request:
   * rebased (or squashed) onto it as in `landOnMain`, then pushed there, never forced. When the
   * push is turned away because the default branch moved meanwhile, it fetches, rebases and pushes
   * once more. The Obeya checkout is left as it is; the workspace stays with the card.
   */
  pushToMain(cardId: string): Promise<LandProblem | Landed> {
    return oneAtATime(this.o.repoPath, () => this.push(cardId));
  }

  private async push(cardId: string): Promise<LandProblem | Landed> {
    const ws = this.leasedBy(cardId);
    if (!ws) return { code: 'land', worker: false, detail: 'the card has no workspace' };
    for (let attempt = 0; ; attempt++) {
      let base: string;
      let from: string;
      try {
        if (await gitAsync(ws, 'status', '--porcelain')) return { code: 'landDirty', worker: true, detail: 'uncommitted changes in the workspace' };
        base = this.main(ws);
        const upstream = `origin/${base}`;
        await gitAsync(ws, 'fetch', '--quiet', 'origin');
        const conflict = await rebaseOnto(ws, upstream, base);
        if (conflict) return conflict;
        if ((await gitAsync(ws, 'rev-list', '--count', `${upstream}..HEAD`)) === '0') return { code: 'landEmpty', worker: true, detail: 'the branch has no commits' };
        from = await gitAsync(ws, 'rev-parse', upstream);
      } catch (e) {
        return { code: 'landPush', worker: false, detail: e instanceof Error ? e.message : String(e) };
      }
      try {
        await gitAsync(ws, 'push', '--quiet', 'origin', `HEAD:refs/heads/${base}`);
        return { from, to: await gitAsync(ws, 'rev-parse', 'HEAD') };
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
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
      const base = this.o.mode === 'worktrees' ? this.main(ws) : `origin/${this.main(ws)}`;
      const diff = git(ws, 'diff', '-U0', '--no-color', '--no-ext-diff', git(ws, 'merge-base', 'HEAD', base));
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
      const main = this.o.mode === 'worktrees' ? this.main(ws) : `origin/${this.main(ws)}`;
      const base = await gitAsync(ws, 'merge-base', 'HEAD', main);
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
   * The main branch as a workspace sees it: the repository's for a worktree; for a clone the one the
   * owner set for the repository, else the one its `origin` has.
   */
  private main(ws: string): string {
    if (this.o.mode === 'worktrees') return defaultBranch(this.o.repoPath);
    return branchSettings.get(resolve(this.o.repoPath))?.()?.trim() || defaultBranch(ws);
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
    const commit = (repo: string, ref: string) => {
      try {
        return git(repo, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`) || null;
      } catch {
        return null;
      }
    };
    const clones = [...this.list().map((w) => w.path), this.o.repoPath].filter((p) => hostName(p) === null && existsSync(p));
    const own = clones.find((p) => commit(p, `refs/heads/${branch}`));
    const [repo, ref] = own
      ? [own, `refs/heads/${branch}`]
      : [this.o.repoPath, [`refs/remotes/origin/${branch}`, `origin/${this.main(this.o.repoPath)}`, 'HEAD'].find((r) => commit(this.o.repoPath, r))!];
    this.removeFollowUpTree(path);
    mkdirSync(dirname(path), { recursive: true });
    // the hooks are the clone's (a post-checkout installing dependencies, say), not the worktree's
    git(repo, '-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--quiet', '--detach', '--force', path, commit(repo, ref) ?? ref);
    return path;
  }

  /** Removes a follow-up's temporary worktree (`followUpTree`) and its entry in the clone it was made from. */
  removeFollowUpTree(path: string) {
    if (!existsSync(path)) return;
    let common: string | null = null;
    try {
      common = git(path, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    } catch {}
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

/** The repository's main branch: the one the owner set for it on this machine, else the one detected (`detectedBranch`). */
export function defaultBranch(path: string): string {
  return branchSetting(path) || detectedBranch(path);
}

/**
 * The repository's main branch as git tells it, where cards start from and work lands: `origin`'s HEAD where the
 * checkout knows one. Else its only branch that is not a card's; else the one of them named as
 * git's `init.defaultBranch`, `main` or `master`, so that a branch the owner checks out for a
 * while does not take its place; else the branch the checkout is on, unless that is a card's;
 * else `init.defaultBranch`, else `main`.
 */
export const detectedBranch = (path: string): string => gitStepsSync(path, detectingBranch());

/** `detectedBranch` as git steps. */
export function* detectingBranch(): GitSteps<string> {
  const [origin] = yield [['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD']];
  if (origin) return origin.replace(/^origin\//, '');
  const [heads, init] = yield [['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], ['config', '--get', 'init.defaultBranch']];
  const own = (heads ?? '').split('\n').filter((b) => b && !b.startsWith(CARD_BRANCH));
  if (own.length === 1) return own[0]!;
  const usual = [init, 'main', 'master'].find((b) => b && own.includes(b));
  if (usual) return usual;
  const [current] = yield [['symbolic-ref', '--short', '-q', 'HEAD']];
  if (current && !current.startsWith(CARD_BRANCH)) return current;
  return init || 'main';
}

/**
 * What Obeya reads of a repository with git, written once for both ways it runs: batches of git
 * calls (their arguments) that do not depend on one another, each answered with the calls' output
 * (trimmed; null where git failed) before the next batch is asked.
 */
export type GitSteps<T> = Generator<string[][], T, (string | null)[]>;

/** Runs git steps in `cwd` one call after the other, the server waiting: for code that cannot wait otherwise. */
export function gitStepsSync<T>(cwd: string, steps: GitSteps<T>): T {
  const one = (args: string[]) => {
    try {
      return git(cwd, ...args);
    } catch {
      return null;
    }
  };
  for (let step = steps.next([]); ; step = steps.next(step.value.map(one))) if (step.done) return step.value;
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
