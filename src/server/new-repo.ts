// A repository Obeya creates for a card that is to be built in one that does not exist yet: the
// folder where there is none, then git as "Hier ein git-Repository einrichten" sets it up (the
// default .gitignore, a first commit under git's name and e-mail), local only. A folder that is a
// repository already is taken as it is. What it did can be taken back while the steps after it
// (the canvas, the move) fail.

import { existsSync, mkdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { BadRequest } from './board';
import { setUpGit } from './git-setup';
import { expandHome } from '../../plugin/skills/demo/lib/settings.ts';
import { GIT } from './workspaces';
import type { Messages } from '../core/messages';

type Words = Messages['newRepo'];

export interface MadeRepo {
  /** The folder, absolute. */
  path: string;
  /** Obeya set git up in it (false: it was a repository already). */
  made: boolean;
  /** Takes back what was done: the folder where Obeya created it, else git and the `.gitignore` it wrote. */
  undo: () => void;
}

/** The folder a new repository's path names, absolute; refused where it is none Obeya could make one in. */
export function newRepoPath(path: string, t: Words): string {
  const p = path.trim();
  if (!p) throw new BadRequest('newRepoPath', t.noPath);
  if (!p.startsWith('~') && !/^([a-zA-Z]:)?[/\\]/.test(p)) throw new BadRequest('newRepoPath', `${p}: an absolute path, or one from ~`);
  return resolve(expandHome(p));
}

const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync([GIT, ...args], { cwd, env: process.env, stderr: 'pipe' });
  return r.exitCode === 0 ? r.stdout.toString().trim() : null;
};

/**
 * Makes the folder at `path` (absolute) a repository: created where it is missing, git set up where
 * it has none. A folder inside another repository is refused, since git there would find that one.
 */
export function makeRepo(path: string, t: Words): MadeRepo {
  const existed = existsSync(path);
  if (existed && !statSync(path).isDirectory()) throw new BadRequest('newRepoPath', t.notFolder(path));
  if (existed) {
    const top = git(path, 'rev-parse', '--show-toplevel');
    // git names the folder by its real path (on macOS the temp directory's /private/var, say)
    if (top && realpathSync(top) === realpathSync(path)) return { path, made: false, undo: () => {} };
    if (top) throw new BadRequest('newRepoPath', t.inside(path, top));
  } else {
    // the nearest folder that exists decides whether the new one would lie inside a repository
    let up = dirname(path);
    while (!existsSync(up) && dirname(up) !== up) up = dirname(up);
    const top = existsSync(up) && statSync(up).isDirectory() ? git(up, 'rev-parse', '--show-toplevel') : null;
    if (top) throw new BadRequest('newRepoPath', t.inside(path, top));
  }
  // the topmost folder Obeya creates, to remove again
  let created: string | null = null;
  if (!existed) {
    let top = path;
    while (!existsSync(dirname(top)) && dirname(top) !== top) top = dirname(top);
    mkdirSync(path, { recursive: true });
    created = top;
  }
  const gitignore = `${path}/.gitignore`;
  const hadIgnore = existsSync(gitignore);
  const undo = () => {
    if (created) return rmSync(created, { recursive: true, force: true });
    rmSync(`${path}/.git`, { recursive: true, force: true });
    if (!hadIgnore) rmSync(gitignore, { force: true });
  };
  try {
    setUpGit(path);
  } catch (e) {
    if (created) rmSync(created, { recursive: true, force: true });
    throw e;
  }
  return { path, made: true, undo };
}
