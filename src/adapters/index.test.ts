import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoInfo } from '../server/repo';
import { gitRepo } from '../server/testing';
import { git } from '../server/workspaces';
import { layerSettings, type RepoSettings } from '../core/types';
import { defaultsFor, hasAdapterModule, parseShared, readShared, repoValues, withSettings } from '.';
import { generic } from './generic';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-adapters-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('defaultsFor', () => {
  test("Obeya's own repository brings its settings like any other, with no problems in them", () => {
    const root = join(import.meta.dir, '../..');
    const read = parseShared(readFileSync(join(root, '.obeya/settings.json'), 'utf8'));
    expect(read.problems).toEqual([]);
    expect(read.settings).toMatchObject({ land: 'main', workspaces: 'worktrees', checks: ['bun test', 'bun run typecheck'] });
  });

  test('lands through pull requests where origin is on GitHub, else on the main branch', () => {
    const repo = gitRepo(join(dir, 'shop'));
    const land = () => defaultsFor(repoInfo(repo)).land;
    expect(land()).toBe('main');
    git(repo, 'remote', 'add', 'origin', 'git@github.com:acme/shop.git');
    expect(land()).toBe('pr');
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
  });
});

describe('withSettings', () => {
  test("reads the settings whenever a field is asked for; clones or worktrees once", () => {
    let s: RepoSettings | undefined = { land: 'main', workspaces: 'clones' };
    const a = withSettings({ ...generic, checks: ['bun test'] }, () => s);
    expect([a.land, a.checks, a.workspaces]).toEqual(['main', ['bun test'], 'clones']);
    s = { checks: [], workspaces: 'worktrees' };
    expect([a.land, a.checks, a.workspaces]).toEqual(['pr', [], 'clones']);
    // the defaults have no recipe for a demo; one set goes in front of it, the demo site beside it
    expect(a.demo).toEqual({ howToRun: '' });
    s = { demo: { howToRun: 'bun dev' } };
    expect(a.demo).toEqual({ howToRun: 'bun dev' });
    const site = { title: 'Demos', url: 'https://demos.example.dev', deploy: 'git {dir}' };
    s = { demo: { site } };
    expect(a.demo).toEqual({ howToRun: '', site });
    // the configuration's clones go before the setting
    expect(withSettings(generic, () => ({ workspaces: 'worktrees' }), true).workspaces).toBe('clones');
  });

  test('a stack counts once it says how the app starts', () => {
    let s: RepoSettings | undefined = { stack: { start: ' ', stop: 'docker compose down' } };
    const a = withSettings(generic, () => s);
    expect(a.stack).toBeUndefined();
    s = { stack: { start: 'docker compose up -d', stop: 'docker compose down' } };
    expect(a.stack).toEqual({ start: 'docker compose up -d', stop: 'docker compose down' });
  });
});

describe('.obeya/settings.json', () => {
  test('is read from the default branch, not the checkout; a field that is wrong does not count, the rest does', () => {
    const repo = gitRepo(join(dir, 'shop'), { 'README.md': 'hi\n', '.obeya/settings.json': '{ "land": "main", "checks": ["bun test"] }\n' });
    expect(readShared(repo)).toEqual({ settings: { land: 'main', checks: ['bun test'] }, raw: { land: 'main', checks: ['bun test'] }, problems: [] });
    // the checkout's own change counts once it is committed on the default branch
    writeFileSync(join(repo, '.obeya/settings.json'), '{ "land": "pr" }\n');
    expect(readShared(repo).settings).toEqual({ land: 'main', checks: ['bun test'] });
    expect(readShared(gitRepo(join(dir, 'plain'))).settings).toBeUndefined();

    const read = parseShared('{ "check": ["x"], "land": "sideways", "branch": "develop", "setup": "bun install", "demo": { "howToRun": "bun dev" } }');
    expect(read.settings).toEqual({ setup: 'bun install', demo: { howToRun: 'bun dev' } });
    expect(read.problems).toEqual([
      '.obeya/settings.json, land: expected one of "main"|"pr"',
      '.obeya/settings.json, check: no such field (did you mean checks?)',
      '.obeya/settings.json, branch: the main branch is set on each machine (or detected), not in the repository',
    ]);
    expect(parseShared('{ land: main }').problems[0]).toStartWith('.obeya/settings.json is no JSON');
    expect(parseShared('[]').problems).toEqual(['.obeya/settings.json holds no JSON object']);
  });

  test('holds the stack and the demo site; a field misspelt in them is named and the whole field does not count', () => {
    const stack = { start: 'bun dev', refresh: 'bun dev', urls: { file: '.env', frontendKey: 'URL' }, stop: 'pkill -F .pid' };
    const site = { title: 'Demos', url: 'https://demos.example.dev', deploy: 'bunx wrangler pages deploy {dir}', env: 'sites/demos.env', headers: { 'X-Key': '${KEY}' }, language: 'de' };
    expect(parseShared(JSON.stringify({ stack, demo: { site } }))).toMatchObject({ settings: { stack, demo: { site } }, problems: [] });
    const read = parseShared(JSON.stringify({ stack: { ...stack, urls: { file: '.env', frontend: 'URL' } }, demo: { howtorun: 'bun dev' } }));
    expect(read.settings).toEqual({});
    expect(read.problems).toEqual([
      '.obeya/settings.json, stack.urls.frontendKey: missing',
      '.obeya/settings.json, stack.urls.frontend: no such field (did you mean frontendKey?)',
      '.obeya/settings.json, demo.howtorun: no such field (did you mean howToRun?)',
    ]);
  });

  test("its values come after this machine's and before the defaults, and say they come from the repository", () => {
    const repo = gitRepo(join(dir, 'shop'), { 'README.md': 'hi\n' });
    const shared = { checks: ['bun test'], setup: 'bun install', stack: { start: 'bun dev' }, demo: { howToRun: 'bun dev' } };
    const mine: RepoSettings = { setup: '' };
    const a = withSettings(defaultsFor(repoInfo(repo)), () => layerSettings<RepoSettings>(shared, mine));
    expect([a.checks, a.setup, a.land, a.stack, a.demo?.howToRun]).toEqual([['bun test'], '', 'main', { start: 'bun dev' }, 'bun dev']);
    expect(repoValues(repoInfo(repo), false, shared)).toMatchObject({
      checks: { value: ['bun test'], source: 'repository' },
      setup: { value: 'bun install', source: 'repository' },
      land: { value: 'main', source: 'detected' },
      planDocs: { value: { dir: 'docs/plan' }, source: 'default' },
      stack: { value: { start: 'bun dev' }, source: 'repository' },
      demo: { howToRun: { value: 'bun dev', source: 'repository' }, site: { value: null, source: 'default' } },
    });
  });
});

describe('hasAdapterModule', () => {
  test('finds an adapter module from before on the default branch, not in the checkout', () => {
    const repo = gitRepo(join(dir, 'shop'), { 'README.md': 'hi\n', '.obeya/adapter/index.ts': "export default { name: 'shop' };\n" });
    expect(hasAdapterModule(repo)).toBe(true);
    git(repo, 'checkout', '--quiet', '-b', 'card');
    git(repo, 'rm', '--quiet', '-r', '.obeya');
    git(repo, 'commit', '--quiet', '-m', 'no module on this branch');
    expect(hasAdapterModule(repo)).toBe(true);
    git(repo, 'checkout', '--quiet', 'main');
    git(repo, 'merge', '--quiet', 'card');
    expect(hasAdapterModule(repo)).toBe(false);
    expect(hasAdapterModule(gitRepo(join(dir, 'plain')))).toBe(false);
  });
});
