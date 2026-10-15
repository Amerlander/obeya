import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blocksSaving, type CanvasConfig, type ConfigView, type DemoSettingsView, type LanguageView } from '../core/types';
import { CanvasRuntime } from './canvas';
import { Config, demoSettingsProblems, readConfigFile } from './config';
import { Store } from './db';
import { serve } from './server';
import { ownerLanguage } from './settings';
import { FakeRuntime, noForge, gitRepo } from './testing';
import { git } from './workspaces';

let dir: string;
let store: Store;
let web: string;
let api: string;
let file: string;
let restarts: number;
let applied: number;
/** The ids of the configurations the running canvases took over. */
let taken: (string | null)[][];

function repo(name: string) {
  return gitRepo(join(dir, name));
}

const config = (source: 'file' | 'args', started: CanvasConfig[], running: string[] = []) =>
  new Config({
    file,
    source,
    started,
    store,
    running: () => running,
    server: { port: 4417, home: dir, permissionMode: 'auto' },
    // not the machine's lock: a demo another agent renders meanwhile would hold up the sample
    ttsLock: join(dir, 'tts.lock'),
    restart: () => void restarts++,
    apply: (_, ids) => void taken.push(ids),
    onSettings: () => void applied++,
  });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-config-'));
  store = new Store(':memory:');
  web = repo('web');
  api = repo('api');
  file = join(dir, 'home', 'canvases.json');
  restarts = 0;
  applied = 0;
  taken = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Obeya's configuration", () => {
  test('says what each canvas amounts to: its id, name, repositories and their adapters', () => {
    const c = config('args', [{ name: 'Produkt', repos: [{ path: web }, { path: api, adapter: 'obeya' }] }], ['produkt']);
    const v = c.view();
    expect(v).toMatchObject({ file, source: 'args', running: ['produkt'], problems: [], restarting: false, server: { port: 4417, restarts: true } });
    expect(v.adapters).toContain('obeya');
    expect(v.resolved).toMatchObject([
      {
        id: 'produkt',
        name: 'Produkt',
        repos: [
          { id: 'web', adapter: 'generic', workspaces: 'worktrees' },
          { id: 'api', adapter: 'obeya', workspaces: 'worktrees' },
        ],
      },
    ]);
  });

  test('a repository whose configuration names clones works in clones, whatever its adapter says', () => {
    const c = config('file', []);
    const mode = (r: object) => c.check([{ repos: [{ path: web, ...r }] }]).resolved[0]!.repos[0]!.workspaces;
    expect(mode({})).toBe('worktrees');
    expect(mode({ clones: 2 })).toBe('clones');
    expect(mode({ workspaces: [api] })).toBe('clones');
    expect(mode({ adapter: 'obeya', clones: 1 })).toBe('clones');
  });

  test('finds what keeps a configuration from working, by canvas and repository', () => {
    const c = config('file', []);
    const { problems } = c.check([
      { name: 'A', repos: [{ path: web }, { path: join(dir, 'nowhere') }] },
      { name: 'B', repos: [{ path: api, adapter: 'nope', workspaces: [join(dir, 'nowhere')] }] },
      { name: 'Leer', repos: [] },
    ]);
    expect(problems.map(({ code, canvas, repo }) => ({ code, canvas, repo }))).toEqual([
      { code: 'notRepo', canvas: 0, repo: 1 },
      { code: 'notClone', canvas: 1, repo: 0 },
      { code: 'unknownAdapter', canvas: 1, repo: 0 },
      { code: 'noRepo', canvas: 2, repo: undefined },
    ]);
    // the id follows the name, unless it is kept
    expect(c.check([{ name: 'Neuer Name', id: 'web', repos: [{ path: web }] }]).resolved[0]).toMatchObject({ id: 'web', name: 'Neuer Name' });
    expect(c.check([{ name: 'Web', repos: [{ path: web }] }, { name: 'web', repos: [{ path: api }] }]).problems).toMatchObject([{ code: 'sameId', canvas: 1 }]);
    // a repository once per canvas, by whatever path it is named
    expect(c.check([{ name: 'Web', repos: [{ path: web }, { path: api }, { path: `${web}/` }] }]).problems).toMatchObject([{ code: 'sameRepo', canvas: 0, repo: 2 }]);
    expect(c.check([]).problems.map((p) => p.code)).toEqual(['noCanvas']);
    expect(c.check([{ repos: [{ path: web, color: 'red' }] }]).problems.map((p) => p.code)).toEqual(['invalid']);
    expect(c.check({}).problems.map((p) => p.code)).toEqual(['invalid']);
  });

  test("a repository's share command is checked: its program must be there, a script is found in the repository", () => {
    const c = config('file', []);
    writeFileSync(join(web, 'share.ts'), '');
    const problems = (share: string) => c.check([{ repos: [{ path: web, share }] }]).problems.map((p) => p.code);
    expect(problems('share.ts --site demos')).toEqual([]);
    expect(problems('./share.ts')).toEqual([]);
    expect(problems('git')).toEqual([]);
    expect(problems('scripts/nowhere.sh')).toEqual(['shareCommand']);
    expect(problems('no-such-program-anywhere publish')).toEqual(['shareCommand']);
    // an empty one is no command: the adapter's counts, or demos are exported
    expect(problems('  ')).toEqual([]);
    expect(c.check([{ repos: [{ path: web, share: ' ' }] }]).canvases).toEqual([{ repos: [{ path: web }] }]);
  });

  test('hosts: tidied, only for a repository with clones whose work goes out through its remote, one machine per name', () => {
    const c = config('file', []);
    Bun.spawnSync(['git', '-C', web, 'remote', 'add', 'origin', 'https://github.com/acme/web.git']);
    const host = { name: 'Box', ssh: 'me@box.local', root: '~/obeya/web', clones: 2 };
    const check = (repos: object[]) => c.check([{ repos }]);
    expect(check([{ path: web, hosts: [host, { name: ' ', ssh: '', root: '', clones: 1 }] }])).toMatchObject({ problems: [], canvases: [{ repos: [{ path: web, hosts: [host] }] }] });
    expect(check([{ path: web, hosts: [{ ...host, root: ' ' }] }]).canvases[0]!.repos[0]!.hosts).toEqual([{ ...host, root: '~/obeya' }]);
    // slots here and there, 0 included (no new cards there); left out, as many as there are clones
    expect(check([{ path: web, slots: 0, hosts: [{ ...host, slots: 1 }] }]).canvases[0]!.repos[0]).toMatchObject({ slots: 0, hosts: [{ ...host, slots: 1 }] });
    expect(check([{ path: web, hosts: [host] }]).canvases[0]!.repos[0]).not.toHaveProperty('slots');
    // landing on the main of this checkout, or no remote: the host could not clone it
    expect(check([{ path: web, adapter: 'obeya', hosts: [host] }]).problems.map((p) => p.code)).toEqual(['hostRepo']);
    expect(check([{ path: api, hosts: [host] }]).problems.map((p) => p.code)).toEqual(['hostRepo']);
    Bun.spawnSync(['git', '-C', api, 'remote', 'add', 'origin', 'https://github.com/acme/api.git']);
    expect(check([{ path: web, hosts: [host] }, { path: api, hosts: [{ ...host, ssh: 'other@box.local' }] }]).problems).toEqual([{ code: 'hostName', canvas: 0, repo: 1, detail: expect.stringContaining('me@box.local') }]);
    expect(check([{ path: web, hosts: [{ ...host, name: 'a/b' }] }]).problems.map((p) => p.code)).toEqual(['invalid']);
  });

  test("a misspelt field in a repository's own adapter is a problem at the repository, which keeps nothing from being saved", () => {
    const own = gitRepo(join(dir, 'shop'), {
      '.obeya/adapter/index.ts': "export default { name: 'shop', check: ['bun test'], demo: { required: false, howToRun: 'bun dev', share: ['no-such-program-anywhere'] } };\n",
    });
    const c = config('args', [{ repos: [{ path: web }] }]);
    const checked = c.check([{ repos: [{ path: web }, { path: own }] }]);
    expect(checked.problems).toEqual([
      { code: 'adapterField', canvas: 0, repo: 1, detail: 'check: no such field (did you mean checks?)' },
      { code: 'adapterField', canvas: 0, repo: 1, detail: "demo.share: the share command's program no-such-program-anywhere is not on the PATH" },
    ]);
    // the configuration's own share command takes the adapter's place, so its program is not asked for
    expect(c.check([{ repos: [{ path: own, share: 'git' }] }]).problems.map((p) => p.detail)).toEqual(['check: no such field (did you mean checks?)']);
    expect(c.save([{ repos: [{ path: web }, { path: own }] }])).toEqual({ restarting: true });
  });

  test("an adapter naming both a site and a share command: the site is used, and the command is a problem", () => {
    const site = { title: 'Demos', url: 'https://demos.example.dev', deploy: ['no-such-deploy-anywhere', '{dir}'] };
    const own = gitRepo(join(dir, 'shop'), {
      '.obeya/adapter/index.ts': `export default { name: 'shop', demo: { required: false, howToRun: 'bun dev', share: ['git'], site: ${JSON.stringify(site)} } };\n`,
    });
    const c = config('args', [{ repos: [{ path: web }] }]);
    const checked = c.check([{ repos: [{ path: own }] }]);
    expect(checked.problems.map((p) => p.detail)).toEqual([
      'demo: names both site and share; the site is used, so share goes',
      "demo.site.deploy: the share command's program no-such-deploy-anywhere is not on the PATH",
    ]);
    expect(checked.resolved[0]!.repos[0]).toMatchObject({ adapterSite: 'https://demos.example.dev' });
    expect(checked.resolved[0]!.repos[0]!.adapterShares).toBeUndefined();
  });

  test("a repository's own adapter that does not load is a problem at the repository, which keeps nothing from being saved", () => {
    const own = gitRepo(join(dir, 'shop'), { '.obeya/adapter/index.ts': "export default () => { throw new Error('kaputt'); };\n" });
    const c = config('args', [{ repos: [{ path: web }] }]);
    const checked = c.check([{ repos: [{ path: web }, { path: own }] }]);
    expect(checked.problems).toEqual([{ code: 'adapterLoad', canvas: 0, repo: 1, detail: expect.stringMatching(/does not load: kaputt$/) }]);
    expect(checked.resolved[0]!.repos[1]).toMatchObject({ id: 'shop', adapter: 'generic' });
    expect(c.save([{ repos: [{ path: web }, { path: own }] }])).toEqual({ restarting: true });
  });

  test("keeps a canvas's home repository: leaving it out is a problem, moving it is not", () => {
    store.ensureCanvas('produkt', 'Produkt');
    store.setSetting('produkt', 'home_repo', 'web');
    const c = config('file', []);
    expect(c.check([{ name: 'Produkt', repos: [{ path: api }] }]).problems.map((p) => p.code)).toEqual(['homeMissing']);
    const moved = c.check([{ name: 'Produkt', repos: [{ path: api }, { path: web }] }]);
    expect(moved.problems).toEqual([]);
    // listed in the order given, though the home one runs first
    expect(moved.resolved[0]!.repos.map((r) => r.id)).toEqual(['api', 'web']);
  });

  test('saves a configuration that works, tidied, and starts Obeya again; one with problems is refused', () => {
    const c = config('args', [{ repos: [{ path: web }] }]);
    expect(() => c.save([{ repos: [{ path: join(dir, 'nowhere') }] }])).toThrow();
    expect(existsSync(file)).toBe(false);
    expect(restarts).toBe(0);

    expect(c.save([{ name: ' ', repos: [{ path: web, adapter: '', workspaces: [' '], clones: 0 }, { path: api, clones: 2 }] }])).toEqual({ restarting: true });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([{ repos: [{ path: web }, { path: api, clones: 2 }] }]);
    expect(readConfigFile(file)).toEqual([{ repos: [{ path: web }, { path: api, clones: 2 }] }]);
    expect(restarts).toBe(1);
    expect(c.view().restarting).toBe(true);
    // saved again before the restart: the file has the latest, and the restart is already on its way
    c.save([{ repos: [{ path: api }] }]);
    expect(restarts).toBe(1);
  });

  test("saved from the file, the running canvases take it over without a restart: settings tidied, canvases and repositories as they come", () => {
    mkdirSync(join(dir, 'home'));
    writeFileSync(file, JSON.stringify([{ repos: [{ path: web }] }]));
    const c = config('file', [{ repos: [{ path: web }] }]);
    expect(c.save([{ repos: [{ path: web, settings: { land: 'main', checks: ['bun test', ' '], branch: ' ', setup: '', planDocs: { dir: '', exclude: [] } } }] }])).toEqual({ restarting: false, applied: true });
    expect(readConfigFile(file)).toEqual([{ repos: [{ path: web, settings: { land: 'main', checks: ['bun test'], setup: '' } }] }]);
    expect(c.repoSettings(web)).toEqual({ land: 'main', checks: ['bun test'], setup: '' });
    expect(c.repoSettings(api)).toBeUndefined();
    // set back to what comes from elsewhere: nothing set
    c.save([{ repos: [{ path: web, settings: {} }] }]);
    expect(readConfigFile(file)).toEqual([{ repos: [{ path: web }] }]);
    expect(c.repoSettings(web)).toBeUndefined();
    expect(c.save([{ repos: [{ path: web, settings: { workspaces: 'clones' } }] }])).toEqual({ restarting: false, applied: true });
    expect(c.save([{ repos: [{ path: web, clones: 2 }] }, { name: 'API', repos: [{ path: api }] }])).toEqual({ restarting: false, applied: true });
    expect(taken).toEqual([['web'], ['web'], ['web'], ['web', 'api']]);
    expect(restarts).toBe(0);
    expect(c.view().restarting).toBe(false);
  });

  test("shows each repository's settings without this machine's, with where each comes from", () => {
    const c = config('file', []);
    const values = (r: object) => c.check([{ repos: [{ path: web, ...r }] }]).resolved[0]!.repos[0]!.values;
    expect(values({})).toMatchObject({
      branch: { value: 'main', source: 'detected' },
      land: { value: 'main', source: 'detected' },
      checks: { value: [], source: 'default' },
      planDocs: { value: { dir: 'docs/plan' }, source: 'default' },
      workspaces: { value: 'worktrees', source: 'default' },
      demo: { required: { value: true, source: 'default' } },
    });
    // this machine's own come on top, in the draft: the values beside them stay what they would be without
    expect(values({ adapter: 'obeya', settings: { land: 'pr' } })).toMatchObject({ land: { value: 'main', source: 'adapter' }, checks: { source: 'adapter' }, planDocs: { source: 'default' }, demo: { required: { value: true, source: 'adapter' } } });
    expect(values({ clones: 1 }).workspaces).toEqual({ value: 'clones', source: 'clones' });
    const problems = (branch: string) => c.check([{ repos: [{ path: web, settings: { branch } }] }]).problems.map((p) => p.code);
    expect(problems('main')).toEqual([]);
    expect(problems('nope')).toEqual(['noBranch']);
  });

  test("a repository's .obeya/settings.json: its values show as from the repository, what is wrong in it as a problem that blocks nothing", () => {
    const shop = gitRepo(join(dir, 'shop'), { 'README.md': 'hi\n', '.obeya/settings.json': '{ "checks": ["bun test"], "check": [] }\n' });
    const c = config('file', []);
    const { resolved, problems } = c.check([{ repos: [{ path: shop }] }]);
    expect(resolved[0]!.repos[0]!.values.checks).toEqual({ value: ['bun test'], source: 'repository' });
    expect(problems).toEqual([{ code: 'repoSettings', canvas: 0, repo: 0, detail: '.obeya/settings.json, check: no such field (did you mean checks?)' }]);
    expect(blocksSaving(problems[0]!)).toBe(false);
  });

  test("„Für alle ins Repository übernehmen“ where work lands on main: committed there, and this machine's values then come from the repository", () => {
    mkdirSync(join(dir, 'home'));
    const settings = { branch: 'main', checks: ['bun test'], demo: { howToRun: 'bun dev' } };
    writeFileSync(file, JSON.stringify([{ repos: [{ path: web, settings }] }]));
    const c = config('file', [{ repos: [{ path: web, settings }] }]);
    expect(c.view().resolved[0]!.repos[0]!.shareTo).toBe('main');
    // the checkout's own change to the file is not overwritten
    mkdirSync(join(web, '.obeya'));
    writeFileSync(join(web, '.obeya/settings.json'), '{}\n');
    expect(() => c.shareSettings({ path: web })).toThrow(expect.objectContaining({ code: 'settingsDirty' }));
    rmSync(join(web, '.obeya'), { recursive: true });
    // a change staged for something else stays staged, and out of the commit
    writeFileSync(join(web, 'README.md'), 'staged\n');
    git(web, 'add', 'README.md');

    const done = c.shareSettings({ path: web });
    expect(done).toMatchObject({ branch: 'main', committed: git(web, 'rev-parse', 'main').trim() });
    expect(JSON.parse(git(web, 'show', 'main:.obeya/settings.json'))).toEqual({ checks: ['bun test'], demo: { howToRun: 'bun dev' } });
    expect(git(web, 'show', '--name-only', '--format=%s', 'main').trim()).toBe('Obeya settings for everyone: checks, demo\n\n.obeya/settings.json');
    expect(git(web, 'status', '--porcelain').trim()).toBe('M  README.md');
    // the main branch stays this machine's; the rest come from the repository now
    expect(readConfigFile(file)).toEqual([{ repos: [{ path: web, settings: { branch: 'main' } }] }]);
    expect(c.view().resolved[0]!.repos[0]!.values).toMatchObject({ checks: { value: ['bun test'], source: 'repository' }, demo: { howToRun: { source: 'repository' } } });
    expect([applied, restarts]).toEqual([1, 0]);
    expect(() => c.shareSettings({ path: web })).toThrow(expect.objectContaining({ code: 'noSettings' }));
  });

  test("„Für alle ins Repository übernehmen“ where work goes out as pull requests: one is opened, this machine keeps its values until it is merged", () => {
    mkdirSync(join(dir, 'home'));
    const origin = join(dir, 'origin.git');
    git(dir, 'clone', '--quiet', '--bare', web, origin);
    git(web, 'remote', 'add', 'origin', origin);
    git(web, 'fetch', '--quiet', 'origin');
    const settings = { land: 'pr' as const, checks: ['bun test'] };
    writeFileSync(file, JSON.stringify([{ repos: [{ path: web, settings }] }]));
    const opened: { base: string; head: string; title: string }[] = [];
    const c = new Config({
      file,
      source: 'file',
      started: [{ repos: [{ path: web, settings }] }],
      store,
      running: () => [],
      server: { port: 4417, home: dir, permissionMode: 'auto' },
      forge: { ...noForge, open: (_cwd, pr) => (opened.push(pr), 'https://github.com/acme/web/pull/7') },
      onSettings: () => void applied++,
    });
    const before = git(web, 'rev-parse', 'main').trim();
    expect(c.shareSettings({ path: web })).toEqual({ pr: 'https://github.com/acme/web/pull/7' });
    expect(opened).toEqual([expect.objectContaining({ base: 'main', head: expect.stringMatching(/^obeya-settings-\d{8}-\d{6}$/), title: 'Obeya settings for everyone: land, checks' })]);
    expect(JSON.parse(git(origin, 'show', `${opened[0]!.head}:.obeya/settings.json`))).toEqual(settings);
    expect(git(web, 'rev-parse', 'main').trim()).toBe(before);
    expect(readConfigFile(file)).toEqual([{ repos: [{ path: web, settings }] }]);
    // merged: the values the file now holds go from this machine's
    c.takenOver(web, undefined, { land: 'pr', checks: ['bun test'] });
    expect(readConfigFile(file)).toEqual([{ repos: [{ path: web }] }]);
    expect(applied).toBe(0);
  });

  test("„Für alle ins Repository übernehmen“ straight onto origin's main, where work may go there beside pull requests", () => {
    mkdirSync(join(dir, 'home'));
    const origin = join(dir, 'origin.git');
    git(dir, 'clone', '--quiet', '--bare', web, origin);
    git(web, 'remote', 'add', 'origin', origin);
    git(web, 'fetch', '--quiet', 'origin');
    const without = { land: 'pr' as const, checks: ['bun test'] };
    writeFileSync(file, JSON.stringify([{ repos: [{ path: web, settings: without }] }]));
    const c = config('file', [{ repos: [{ path: web, settings: without }] }]);
    expect(c.view().resolved[0]!.repos[0]!.shareDirect).toBeUndefined();
    expect(() => c.shareSettings({ path: web, direct: true })).toThrow(expect.objectContaining({ code: 'noDirect' }));

    const settings = { ...without, direct: true };
    writeFileSync(file, JSON.stringify([{ repos: [{ path: web, settings }] }]));
    expect(c.view().resolved[0]!.repos[0]!.shareDirect).toBe(true);
    const done = c.shareSettings({ path: web, direct: true });
    expect(done).toEqual({ committed: git(origin, 'rev-parse', 'main').trim(), branch: 'main' });
    expect(JSON.parse(git(origin, 'show', 'main:.obeya/settings.json'))).toEqual(settings);
    expect(readConfigFile(file)).toEqual([{ repos: [{ path: web }] }]);
    // read from origin's main, which has more than the local one
    expect(c.view().resolved[0]!.repos[0]!.values.checks).toEqual({ value: ['bun test'], source: 'repository' });
    expect(applied).toBe(1);
  });

  test('a setting the Arbeitsrückschau proposed, taken on this machine: it joins the values set there', () => {
    mkdirSync(join(dir, 'home'));
    writeFileSync(file, JSON.stringify([{ repos: [{ path: web, settings: { checks: ['bun test'], demo: { required: true } } }] }]));
    const c = config('file', []);
    expect(c.takeSetting(web, 'howToRun', 'bun dev --port 4000', 'machine')).toBeNull();
    expect(readConfigFile(file)).toEqual([{ repos: [{ path: web, settings: { checks: ['bun test'], demo: { required: true, howToRun: 'bun dev --port 4000' } } }] }]);
    expect(c.takeSetting(web, 'checks', ['bun run typecheck'], 'machine')).toBeNull();
    expect(readConfigFile(file)[0]!.repos[0]!.settings!.checks).toEqual(['bun run typecheck']);
    // nothing went into the repository
    expect(existsSync(join(web, '.obeya/settings.json'))).toBe(false);
    expect(taken).toHaveLength(2);
  });

  test('a setting the Arbeitsrückschau proposed, taken for everyone where work lands on main: that value alone is committed, and applies here too', () => {
    mkdirSync(join(dir, 'home'));
    writeFileSync(file, JSON.stringify([{ repos: [{ path: web, settings: { checks: ['bun test'], demo: { howToRun: 'npm start' } } }] }]));
    const c = config('file', []);
    const done = c.takeSetting(web, 'howToRun', 'bun dev --port 4000', 'repository');
    expect(done).toMatchObject({ branch: 'main', committed: git(web, 'rev-parse', 'main').trim() });
    expect(JSON.parse(git(web, 'show', 'main:.obeya/settings.json'))).toEqual({ demo: { howToRun: 'bun dev --port 4000' } });
    expect(git(web, 'log', '-1', '--format=%s', 'main').trim()).toBe('Obeya settings for everyone: demo');
    // this machine's other value for it went, so the repository's applies here; its checks stay its own
    expect(readConfigFile(file)).toEqual([{ repos: [{ path: web, settings: { checks: ['bun test'] } }] }]);
    expect(c.view().resolved[0]!.repos[0]!.values.demo.howToRun).toEqual({ value: 'bun dev --port 4000', source: 'repository' });
    expect(applied).toBe(1);
  });

  test('a setting the Arbeitsrückschau proposed, taken for everyone where work goes out as pull requests: one is opened, and the value applies here meanwhile', () => {
    mkdirSync(join(dir, 'home'));
    const origin = join(dir, 'origin.git');
    git(dir, 'clone', '--quiet', '--bare', web, origin);
    git(web, 'remote', 'add', 'origin', origin);
    git(web, 'fetch', '--quiet', 'origin');
    const settings = { land: 'pr' as const };
    writeFileSync(file, JSON.stringify([{ repos: [{ path: web, settings }] }]));
    const opened: { title: string; head: string }[] = [];
    const c = new Config({
      file,
      source: 'file',
      started: [],
      store,
      running: () => [],
      server: { port: 4417, home: dir, permissionMode: 'auto' },
      forge: { ...noForge, open: (_cwd, pr) => (opened.push(pr), 'https://github.com/acme/web/pull/8') },
      apply: () => {},
    });
    expect(c.takeSetting(web, 'setup', 'bun install', 'repository')).toEqual({ pr: 'https://github.com/acme/web/pull/8' });
    expect(opened).toMatchObject([{ title: 'Obeya settings for everyone: setup' }]);
    expect(JSON.parse(git(origin, 'show', `${opened[0]!.head}:.obeya/settings.json`))).toEqual({ setup: 'bun install' });
    expect(readConfigFile(file)).toEqual([{ repos: [{ path: web, settings: { land: 'pr', setup: 'bun install' } }] }]);
  });

  test("a value the file held already stays this machine's when someone else changes the file", () => {
    mkdirSync(join(dir, 'home'));
    writeFileSync(file, JSON.stringify([{ repos: [{ path: web, settings: { checks: ['a'], setup: 'x' } }] }]));
    const c = config('file', []);
    c.takenOver(web, { checks: ['a'] }, { checks: ['a'], setup: 'x' });
    expect(readConfigFile(file)).toEqual([{ repos: [{ path: web, settings: { checks: ['a'] } }] }]);
  });

  test('shows the file when Obeya runs from it, the command line until something is saved', () => {
    mkdirSync(join(dir, 'home'));
    writeFileSync(file, JSON.stringify([{ name: 'Aus Datei', repos: [{ path: web }] }]));
    expect(config('file', []).view().canvases).toEqual([{ name: 'Aus Datei', repos: [{ path: web }] }]);
    expect(config('args', [{ repos: [{ path: api }] }]).view().canvases).toEqual([{ repos: [{ path: api }] }]);
  });

  test('expands ~ in paths', () => {
    const home = process.env.HOME!;
    if (!web.startsWith(`${home}/`)) return;
    expect(config('file', []).check([{ repos: [{ path: `~${web.slice(home.length)}` }] }]).problems).toEqual([]);
  });
});

describe('the configuration over HTTP', () => {
  let server: ReturnType<typeof serve>;
  let canvas: CanvasRuntime;
  beforeEach(() => {
    const c = config('args', [{ repos: [{ path: web }] }], ['web']);
    canvas = new CanvasRuntime({ repos: [{ path: web }] }, { store, home: dir, runtime: new FakeRuntime(), forge: noForge, config: c });
    server = serve([canvas], { transcriber: { transcribe: async () => ({ text: '', doubtful: false }) } }, 0, false, c);
  });
  afterEach(() => {
    server.stop(true);
    canvas.shutdown();
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(new URL(path, server.url), { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  test('reads, checks and saves it', async () => {
    const view = (await call('GET', '/api/config')).body as unknown as ConfigView;
    expect(view.canvases).toEqual([{ repos: [{ path: web }] }]);
    expect(view.running).toEqual(['web']);

    const checked = await call('POST', '/api/config/check', [{ name: 'Zwei', repos: [{ path: web }, { path: join(dir, 'nowhere') }] }]);
    expect(checked.body.problems).toMatchObject([{ code: 'notRepo', canvas: 0, repo: 1 }]);

    const refused = await call('PUT', '/api/config', [{ repos: [{ path: join(dir, 'nowhere') }] }]);
    expect(refused).toMatchObject({ status: 400, body: { code: 'config' } });

    expect((await call('PUT', '/api/config', [{ repos: [{ path: web }, { path: api }] }])).body).toEqual({ restarting: true });
    expect(readConfigFile(file)).toEqual([{ repos: [{ path: web }, { path: api }] }]);
  });

  test('makes the card that writes the adapter of a repository on the generic one, once while it is open', async () => {
    const made = await call('POST', '/api/c/web/adapter-setup', { repo: 'web' });
    expect(made).toMatchObject({ status: 200, body: { title: 'Obeya für web einrichten', state: 'planned' } });
    expect(made.body.body).toContain('obeya:adapter');
    expect((await call('POST', '/api/c/web/adapter-setup', { repo: 'web' })).body.id).toBe(made.body.id);
    expect((await call('POST', '/api/c/web/adapter-setup', { repo: 'nope' })).status).toBe(400);
  });

  test('reads and saves the language in its home, keeping the file\'s other settings', async () => {
    const before = (await call('GET', '/api/language')).body as unknown as LanguageView;
    expect(before).toMatchObject({ file: join(dir, 'settings.json'), chosen: null });
    expect(before.language).toBe(before.system);
    expect((await call('PUT', '/api/language', { language: 'fr' })).status).toBe(400);
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ later: 1 }));
    expect((await call('PUT', '/api/language', { language: 'en' })).body).toMatchObject({ chosen: 'en', language: 'en' });
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ later: 1, language: 'en' });
    // the server reads it whenever it needs it
    expect(ownerLanguage(dir)).toBe('en');
    expect((await call('PUT', '/api/language', { language: null })).body).toMatchObject({ chosen: null, language: before.system });
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ later: 1 });
  });

  test('reads and saves the demo settings in its home, without a restart', async () => {
    // without a narration language of their own, demos speak the owner's
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ language: 'de' }));
    const before = (await call('GET', '/api/demo-settings')).body as unknown as DemoSettingsView;
    expect(before).toMatchObject({ file: join(dir, 'demo.json'), settings: { language: 'de', voice: 'piper' }, check: { person: 'third', problems: [] } });
    expect(before.check.install).toMatchObject({ installed: false, missing: ['Piper', 'Piper-Stimme de_DE-thorsten-high'] });
    expect((await call('PUT', '/api/demo-settings', { language: 'fr', voice: 'piper' })).status).toBe(400);
    const saved = await call('PUT', '/api/demo-settings', { language: 'en', voice: 'command', command: ' speak ', ownVoice: true });
    expect(saved.body).toMatchObject({ settings: { language: 'en', voice: 'command', command: 'speak', ownVoice: true }, check: { person: 'first', problems: [] } });
    expect(JSON.parse(readFileSync(join(dir, 'demo.json'), 'utf8'))).toEqual({ language: 'en', voice: 'command', ownVoice: true, command: 'speak' });
    // a voice being chosen is checked before it is saved
    const draft = await call('POST', '/api/demo-settings/check', { language: 'en', voice: 'qwen3', reference: join(dir, 'me.wav') });
    expect(draft.body).toMatchObject({ person: 'third', problems: ['referenceMissing'], install: { installed: false } });
    expect(restarts).toBe(0);
  });

  test.skipIf(!Bun.which('uv') || !Bun.which('ffmpeg'))('plays a sentence in the voice being chosen, or says why it cannot', async () => {
    const clip = join(dir, 'clip.wav');
    writeFileSync(clip, wav(0.2));
    const heard = await fetch(new URL('/api/demo-settings/sample', server.url), {
      method: 'POST',
      body: JSON.stringify({ language: 'de', voice: 'command', command: `cat > ${JSON.stringify(join(dir, 'said.txt'))}; cp ${JSON.stringify(clip)} "$DEMO_WAV"` }),
    });
    expect(heard.headers.get('content-type')).toBe('audio/wav');
    expect((await heard.arrayBuffer()).byteLength).toBeGreaterThan(44);
    expect(readFileSync(join(dir, 'said.txt'), 'utf8')).toContain('So klingt diese Stimme');
    const refused = await call('POST', '/api/demo-settings/sample', { language: 'de', voice: 'command', command: 'echo kaputt >&2; exit 3' });
    expect(refused).toMatchObject({ status: 400, body: { code: 'voiceSample' } });
    expect(String(refused.body.error)).toContain('kaputt');

    // an own endpoint gets the text and the language as JSON, the key as a bearer token
    let asked: { auth: string | null; body: unknown } | undefined;
    const endpoint = Bun.serve({
      port: 0,
      fetch: async (req) => {
        asked = { auth: req.headers.get('authorization'), body: await req.json() };
        return new Response(wav(0.3), { headers: { 'content-type': 'audio/wav' } });
      },
    });
    try {
      writeFileSync(join(dir, 'key'), 'geheim\n');
      const served = await fetch(new URL('/api/demo-settings/sample', server.url), {
        method: 'POST',
        body: JSON.stringify({ language: 'en', voice: 'http', url: `http://127.0.0.1:${endpoint.port}/tts`, keyFile: join(dir, 'key') }),
      });
      expect(served.status).toBe(200);
      expect(asked).toEqual({ auth: 'Bearer geheim', body: { text: expect.stringContaining('This is how the voice sounds'), language: 'en' } });
    } finally {
      endpoint.stop(true);
    }
  }, 60_000);

  test('a setting the Arbeitsrückschau proposed waits in the snapshot with its cards and the value now, and is taken where the owner says', async () => {
    mkdirSync(join(dir, 'home'));
    writeFileSync(file, JSON.stringify([{ repos: [{ path: web, settings: { checks: ['bun test'] } }] }]));
    const c = config('file', []);
    const live = new CanvasRuntime({ repos: [{ path: web }] }, { store, home: dir, runtime: new FakeRuntime(), forge: noForge, config: c, settings: (p) => c.repoSettings(p) });
    const at = serve([live], { transcriber: { transcribe: async () => ({ text: '', doubtful: false }) } }, 0, false, c);
    const post = async (path: string, body?: unknown) => {
      const res = await fetch(new URL(path, at.url), { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) });
      return { status: res.status, body: res.status === 204 ? null : ((await res.json()) as Record<string, unknown>) };
    };
    try {
      const b = live.board;
      const [a1, a2] = [b.create({ title: 'Login-Seite', x: 0, y: 0 }), b.create({ title: 'Warenkorb', x: 0, y: 0 })];
      const run = b.proposeSetting({ repo: 'web', field: 'howToRun', value: 'bun dev --port 4000; log in as demo@example.com', basis: 'Beide suchten den Start der App.', cards: [a1.id, a2.id] });
      const checks = b.proposeSetting({ repo: 'web', field: 'checks', value: ['bun test', 'bun run typecheck'], basis: 'Beide vergaßen den Typcheck.', cards: [a1.id, a2.id] });
      const setup = b.proposeSetting({ repo: 'web', field: 'setup', value: 'bun install', basis: '…', cards: [a1.id, a2.id] });
      expect(b.snapshot().settingProposals).toEqual([
        { id: run, repo: 'web', field: 'howToRun', value: 'bun dev --port 4000; log in as demo@example.com', basis: 'Beide suchten den Start der App.', cards: [{ id: a1.id, title: 'Login-Seite' }, { id: a2.id, title: 'Warenkorb' }], now: '' },
        expect.objectContaining({ id: checks, now: ['bun test'] }),
        expect.objectContaining({ id: setup, now: '' }),
      ]);
      const notices: string[] = [];
      b.onNotice((n) => notices.push(n.text));

      expect((await post(`/api/c/web/setting-proposals/${run}/take`, { where: 'nowhere' })).status).toBe(400);
      // on this machine, in the owner's words
      expect((await post(`/api/c/web/setting-proposals/${run}/take`, { where: 'machine', value: ' bun dev --port 4100 ' })).status).toBe(200);
      expect(c.repoSettings(web)).toEqual({ checks: ['bun test'], demo: { howToRun: 'bun dev --port 4100' } });
      expect(notices.at(-1)).toBe('„App für die Demo starten“ für web gilt jetzt auf diesem Rechner.');
      // for everyone: committed on main, that value alone
      expect((await post(`/api/c/web/setting-proposals/${checks}/take`, { where: 'repository' })).body).toMatchObject({ branch: 'main' });
      expect(JSON.parse(git(web, 'show', 'main:.obeya/settings.json'))).toEqual({ checks: ['bun test', 'bun run typecheck'] });
      expect(c.repoSettings(web)).toEqual({ demo: { howToRun: 'bun dev --port 4100' } });
      expect(notices.at(-1)).toBe('„Prüfungen“ für web steht jetzt in .obeya/settings.json auf main und gilt für alle.');
      expect((await post(`/api/c/web/setting-proposals/${setup}/reject`)).status).toBe(204);
      expect(b.snapshot().settingProposals).toBeUndefined();
      expect(b.settingProposals().map((p) => [p.field, p.state, p.value])).toEqual([
        ['howToRun', 'machine', 'bun dev --port 4100'],
        ['checks', 'repository', ['bun test', 'bun run typecheck']],
        ['setup', 'rejected', 'bun install'],
      ]);
      expect(await post(`/api/c/web/setting-proposals/${setup}/take`, { where: 'machine' })).toMatchObject({ status: 400, body: { code: 'unknownSetting' } });
    } finally {
      at.stop(true);
      live.shutdown();
    }
  });

  test('a configuration command of the Koordinator saves it after the undo window', () => {
    canvas.run({ do: 'configure', canvases: [{ name: 'Neu', repos: [{ path: web }] }] });
    expect(readConfigFile(file)).toEqual([{ name: 'Neu', repos: [{ path: web }] }]);
    expect(restarts).toBe(1);
  });
});

describe('the demo settings', () => {
  test('say what keeps a voice from speaking', () => {
    const missing = join(dir, 'nowhere');
    expect(demoSettingsProblems({ language: 'de', voice: 'piper' }, {})).toEqual([]);
    expect(demoSettingsProblems({ language: 'de', voice: 'command' }, {})).toEqual(['noCommand']);
    expect(demoSettingsProblems({ language: 'de', voice: 'http' }, {})).toEqual(['noUrl']);
    expect(demoSettingsProblems({ language: 'de', voice: 'http', url: 'http://localhost:9' }, {})).toEqual([]);
    expect(demoSettingsProblems({ language: 'de', voice: 'say' }, {}, 'linux')).toEqual(['notHere']);
    expect(demoSettingsProblems({ language: 'de', voice: 'say' }, {}, 'darwin')).toEqual([]);
    expect(demoSettingsProblems({ language: 'de', voice: 'gemini' }, {})).toEqual(['noKey']);
    expect(demoSettingsProblems({ language: 'de', voice: 'gemini' }, { GEMINI_API_KEY: 'k' })).toEqual([]);
    expect(demoSettingsProblems({ language: 'de', voice: 'azure', url: 'westeurope' }, {})).toEqual(['noKey']);
    expect(demoSettingsProblems({ language: 'de', voice: 'openai', keyFile: missing }, {})).toEqual(['keyFileMissing']);
    writeFileSync(join(dir, 'key'), 'k');
    expect(demoSettingsProblems({ language: 'en', voice: 'elevenlabs', keyFile: join(dir, 'key') }, {})).toEqual([]);
    writeFileSync(join(dir, 'me.wav'), '');
    expect(demoSettingsProblems({ language: 'de', voice: 'qwen3', reference: join(dir, 'me.wav') }, {})).toEqual(['noTranscript']);
    writeFileSync(join(dir, 'me.txt'), 'Hallo.');
    expect(demoSettingsProblems({ language: 'de', voice: 'qwen3', reference: join(dir, 'me.wav') }, {})).toEqual([]);
  });
});

/** A silent mono 16-bit WAV of `seconds`. */
function wav(seconds: number, rate = 16000) {
  const data = Math.round(seconds * rate) * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(data, 40);
  return b;
}
