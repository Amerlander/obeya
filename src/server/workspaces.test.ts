import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './db';
import { gitRepo } from './testing';
import { addTrailer, defaultBranch, git, Workspaces } from './workspaces';

let dir: string;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'obeya-branch-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the main branch', () => {
  test("is origin's HEAD where the checkout knows one, whatever branch it is on", () => {
    const origin = gitRepo(join(dir, 'origin'));
    git(origin, 'branch', '-m', 'trunk');
    git(dir, 'clone', '--quiet', origin, join(dir, 'clone'));
    git(join(dir, 'clone'), 'checkout', '--quiet', '-b', 'feature');
    expect(defaultBranch(join(dir, 'clone'))).toBe('trunk');
  });

  test("is the only branch of a repository without a remote, cards' branches aside", () => {
    const repo = gitRepo(join(dir, 'repo'));
    git(repo, 'branch', '-m', 'develop');
    expect(defaultBranch(repo)).toBe('develop');
    git(repo, 'checkout', '--quiet', '-b', 'obeya/export-abc123');
    expect(defaultBranch(repo)).toBe('develop');
    git(repo, 'checkout', '--quiet', '--detach');
    expect(defaultBranch(repo)).toBe('develop');
  });

  test('stays master or main while the owner has another branch checked out', () => {
    const repo = gitRepo(join(dir, 'repo'));
    git(repo, 'branch', '-m', 'master');
    git(repo, 'checkout', '--quiet', '-b', 'experiment');
    expect(defaultBranch(repo)).toBe('master');
    git(repo, 'config', 'init.defaultBranch', 'experiment');
    expect(defaultBranch(repo)).toBe('experiment');
  });

  test("is the branch the checkout is on where none of its branches is the usual one, else git's init.defaultBranch", () => {
    const repo = gitRepo(join(dir, 'repo'));
    git(repo, 'branch', '-m', 'develop');
    git(repo, 'checkout', '--quiet', '-b', 'release');
    expect(defaultBranch(repo)).toBe('release');
    git(repo, 'checkout', '--quiet', '--detach');
    git(repo, 'config', 'init.defaultBranch', 'trunk');
    expect(defaultBranch(repo)).toBe('trunk');
  });
});

describe("a follow-up's temporary worktree", () => {
  test("is at origin's copy of the card's branch where no clone here holds it, else at the default branch, and goes without a trace", () => {
    const origin = gitRepo(join(dir, 'origin'));
    git(origin, 'checkout', '--quiet', '-b', 'obeya/pushed-abc123');
    git(origin, 'commit', '--quiet', '--allow-empty', '-m', 'pushed');
    const pushed = git(origin, 'rev-parse', 'HEAD');
    git(origin, 'checkout', '--quiet', 'main');
    const checkout = join(dir, 'checkout');
    git(dir, 'clone', '--quiet', origin, checkout);
    const spaces = new Workspaces(new Store(':memory:'), 'c', { mode: 'clones', repoPath: checkout, dir: join(dir, 'ws') });
    const tree = spaces.followUpTree('card-1234567', 'obeya/pushed-abc123');
    expect(tree).toBe(join(dir, 'ws', 'follow-up', 'card-123'));
    expect(git(tree, 'rev-parse', 'HEAD')).toBe(pushed);
    // the checkout stays as it was: clean, on its branch
    expect(git(checkout, 'status', '--porcelain')).toBe('');
    expect(git(checkout, 'branch', '--show-current')).toBe('main');
    spaces.removeFollowUpTree(tree);
    expect(existsSync(tree)).toBe(false);
    expect(git(checkout, 'worktree', 'list').split('\n')).toHaveLength(1);
    const fresh = spaces.followUpTree('card-1234567', 'obeya/gone-def456');
    expect(git(fresh, 'rev-parse', 'HEAD')).toBe(git(checkout, 'rev-parse', 'origin/main'));
  });
});

test('a trailer goes beside the trailers a commit message ends with, else into a paragraph of its own', () => {
  const t = 'Demo-Video: https://demos.example.dev/a-1/';
  expect(addTrailer('Fix\n\nBody.\n\nCo-Authored-By: C <c@x>\n', t)).toBe(`Fix\n\nBody.\n\nCo-Authored-By: C <c@x>\n${t}\n`);
  expect(addTrailer('Fix\n\nBody: not a trailer, a sentence.\nIt goes on.', t)).toBe(`Fix\n\nBody: not a trailer, a sentence.\nIt goes on.\n\n${t}\n`);
  // a trailer needs no space after its colon
  expect(addTrailer('Fix\n\nCo-Authored-By:C <c@x>', t)).toBe(`Fix\n\nCo-Authored-By:C <c@x>\n${t}\n`);
  // a subject alone is no trailer block, even with a colon
  expect(addTrailer('Docs: typo', t)).toBe(`Docs: typo\n\n${t}\n`);
});
