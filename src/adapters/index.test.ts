import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoInfo } from '../server/repo';
import { gitRepo } from '../server/testing';
import { git } from '../server/workspaces';
import { adapterProblems, pickAdapter } from '.';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-adapters-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// an adapter as a repository carries it: Obeya's helpers come as the argument
const OWN = (name: string) => `export default (kit) => ({ name: '${name}', canvasId: () => 'shop', canvasName: () => kit.esc('Shop & Co'), land: 'main' });\n`;

describe('pickAdapter', () => {
  test("takes the repository's own adapter, filled from the generic one", () => {
    const repo = gitRepo(join(dir, 'shop'), { 'README.md': 'hi\n', '.obeya/adapter/index.ts': OWN('shop') });
    const a = pickAdapter(repoInfo(repo));
    expect(a.name).toBe('shop');
    expect(a.canvasName(repoInfo(repo))).toBe('Shop &amp; Co');
    expect(a.land).toBe('main');
    // what it leaves out comes from the generic adapter
    expect(a.planDocs.dir).toBe('docs/plan');
    expect(a.workspaces).toBe('clones');
  });

  test('reads it from the default branch, whatever the checkout is on', () => {
    const repo = gitRepo(join(dir, 'shop'), { 'README.md': 'hi\n', '.obeya/adapter/index.ts': OWN('first') });
    // a card's branch from before the adapter changed, and an edit not committed
    git(repo, 'checkout', '--quiet', '-b', 'card');
    git(repo, 'rm', '--quiet', '-r', '.obeya');
    git(repo, 'commit', '--quiet', '-m', 'no adapter on this branch');
    mkdirSync(join(repo, '.obeya/adapter'), { recursive: true });
    writeFileSync(join(repo, '.obeya/adapter/index.ts'), OWN('uncommitted'));
    expect(pickAdapter(repoInfo(repo)).name).toBe('first');

    // a new version on main: its files are written anew, the earlier version's go
    rmSync(join(repo, '.obeya'), { recursive: true });
    git(repo, 'checkout', '--quiet', 'main');
    writeFileSync(join(repo, '.obeya/adapter/index.ts'), OWN('second'));
    git(repo, 'commit', '--quiet', '-am', 'second adapter');
    expect(pickAdapter(repoInfo(repo)).name).toBe('second');
    expect(readdirSync(join(repo, '.git/obeya')).length).toBe(1);
    // the checkout stays as it was
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  test('takes a module the configuration names by its path, relative to the repository', () => {
    const repo = gitRepo(join(dir, 'shop'));
    writeFileSync(join(dir, 'outside.ts'), OWN('outside'));
    expect(pickAdapter(repoInfo(repo), '../outside.ts').name).toBe('outside');
    expect(pickAdapter(repoInfo(repo), join(dir, 'outside.ts')).name).toBe('outside');
    expect(() => pickAdapter(repoInfo(repo), '../missing.ts')).toThrow('does not exist');
    writeFileSync(join(dir, 'empty.ts'), 'export const x = 1;\n');
    expect(() => pickAdapter(repoInfo(repo), join(dir, 'empty.ts'))).toThrow('exports no adapter');
    expect(() => pickAdapter(repoInfo(repo), 'nonesuch')).toThrow('Unknown adapter "nonesuch"');
  });

  test('a built-in name wins over the repository, and a repository without its own gets the generic one', () => {
    const repo = gitRepo(join(dir, 'shop'), { 'README.md': 'hi\n', '.obeya/adapter/index.ts': OWN('shop') });
    expect(pickAdapter(repoInfo(repo), 'generic').name).toBe('generic');
    const plain = gitRepo(join(dir, 'plain'));
    expect(pickAdapter(repoInfo(plain)).name).toBe('generic');
    expect(existsSync(join(plain, '.git/obeya'))).toBe(false);
  });

  test('lands through pull requests where origin is on GitHub, else on the main branch, unless the adapter says otherwise', () => {
    const repo = gitRepo(join(dir, 'shop'));
    const land = (name?: string) => pickAdapter(repoInfo(repo), name).land;
    expect([land(), land('generic')]).toEqual(['main', 'main']);
    git(repo, 'remote', 'add', 'origin', 'git@github.com:acme/shop.git');
    expect([land(), land('generic')]).toEqual(['pr', 'pr']);
    git(repo, 'remote', 'set-url', 'origin', 'https://gitlab.com/acme/shop.git');
    expect(land()).toBe('main');
    // a GitHub Enterprise host the GitHub CLI is logged into
    const gh = join(dir, 'gh');
    mkdirSync(gh);
    writeFileSync(join(gh, 'hosts.yml'), 'github.acme.com:\n    user: t\n    git_protocol: https\n');
    git(repo, 'remote', 'set-url', 'origin', 'https://github.acme.com/acme/shop.git');
    const was = process.env.GH_CONFIG_DIR;
    process.env.GH_CONFIG_DIR = gh;
    try {
      expect(land()).toBe('pr');
    } finally {
      if (was === undefined) delete process.env.GH_CONFIG_DIR;
      else process.env.GH_CONFIG_DIR = was;
    }

    // the repository's own adapter: what it says wins, what it leaves out comes from detection
    const own = gitRepo(join(dir, 'own'), { '.obeya/adapter/index.ts': "export default { name: 'own', land: 'pr' };\n" });
    expect(pickAdapter(repoInfo(own)).land).toBe('pr');
    const silent = gitRepo(join(dir, 'silent'), { '.obeya/adapter/index.ts': "export default { name: 'silent' };\n" });
    expect(pickAdapter(repoInfo(silent)).land).toBe('main');
    git(silent, 'remote', 'add', 'origin', 'https://github.com/acme/silent.git');
    expect(pickAdapter(repoInfo(silent)).land).toBe('pr');
    // Obeya's own lands on main whatever its remote
    expect(land('obeya')).toBe('main');
  });

  test('a field that is misspelt, of the wrong type or incomplete is named and does not count; the rest of the adapter works', () => {
    const adapter = `export default {
      name: 'shop',
      check: ['bun test'],
      Setup: 'bun install',
      land: 'merge',
      softPaths: 'docs/',
      canvasName: 'Shop',
      demo: { required: true, howtorun: 'bun dev' },
      stack: { start: 'bun dev', refresh: 'bun dev', urls: { file: '.env', frontend: 'URL' } },
      workspaces: 'worktrees',
    };\n`;
    const repo = gitRepo(join(dir, 'shop'), { '.obeya/adapter/index.ts': adapter });
    const a = pickAdapter(repoInfo(repo));
    expect(adapterProblems(a)).toEqual([
      'canvasName: expected a function',
      'land: expected one of "main"|"pr"',
      'softPaths: expected array, received string',
      'demo.howToRun: missing',
      'demo.howtorun: no such field (did you mean howToRun?)',
      'stack.urls.frontendKey: missing',
      'stack.urls.frontend: no such field (did you mean frontendKey?)',
      'check: no such field (did you mean checks?)',
      'Setup: no such field (did you mean setup?)',
    ]);
    // what is wrong goes, detection's or the generic adapter's stands in its place: without a remote, work lands on main
    expect(a).toMatchObject({ name: 'shop', land: 'main', softPaths: ['docs/plan/'], workspaces: 'worktrees' });
    expect(a.canvasName(repoInfo(repo))).toBe('shop');
    expect(a.demo).toBeUndefined();
    expect(a.stack).toBeUndefined();
    expect('check' in a).toBe(false);
    // one without mistakes has none, a built-in one neither
    expect(adapterProblems(pickAdapter(repoInfo(gitRepo(join(dir, 'ok'), { '.obeya/adapter/index.ts': OWN('ok') }))))).toEqual([]);
    expect(adapterProblems(pickAdapter(repoInfo(repo), 'generic'))).toEqual([]);
  });
});
