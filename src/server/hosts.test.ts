// Workers on other machines (design: Hosts), against a stand-in for `ssh` that runs the commands
// on this machine (`fakeSsh`): git and files over the connection, a session's process, clones
// there, and a session that resumes once a dropped connection is back.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import { generic } from '../adapters/generic';
import { Board } from './board';
import { Store } from './db';
import { hostName, onHost, RECHECK_DOWN_MS, registerHost, remote, sessionFiles, type SshHost } from './hosts';
import { runAppCommand } from './app-command';
import { FakeRuntime, fakeSsh, gitRepo, identify, until } from './testing';
import { Workers } from './workers';
import { git, gitAsync, HERE, Workspaces } from './workspaces';

let dir: string;
let ssh: string;
let host: SshHost;
let name: string;
const log = () => (existsSync(join(dir, 'net', 'log')) ? readFileSync(join(dir, 'net', 'log'), 'utf8') : '');

beforeEach(() => {
  // as `pwd -P` there names it
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'obeya-hosts-')));
  ssh = fakeSsh(join(dir, 'net'));
  // a host of its own per test: what it prepared once is not prepared again
  name = `box${Math.random().toString(36).slice(2, 8)}`;
  host = registerHost({ name, ssh: 'me@box', home: join(dir, 'home'), program: ssh, claudeToken: () => 'sk-claude' });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('a workspace on a host', () => {
  test('is named by its host, and found again by that name', () => {
    const path = onHost(name, '/srv/clones/1');
    expect(path).toBe(`ssh://${name}/srv/clones/1`);
    expect(remote(path)).toEqual({ host, path: '/srv/clones/1' });
    expect(hostName(path)).toBe(name);
    expect(remote('/Users/me/repo')).toBeNull();
    expect(() => remote('ssh://gone/x')).toThrow('no host gone');
    expect(hostName('ssh://gone/x')).toBe('gone');
  });

  test('runs git there, with the GitHub login on stdin rather than on the command line', async () => {
    const repo = gitRepo(join(dir, 'repo'));
    host.tokenFor(repo, () => 'ghp_secret');
    const path = onHost(name, repo);
    expect(git(path, 'branch', '--show-current')).toBe('main');
    expect(await gitAsync(path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(() => git(path, 'checkout', 'nowhere')).toThrow('git checkout nowhere');
    expect((await host.run('printf %s "$GH_TOKEN"', { cwd: repo })).stdout).toBe('ghp_secret');
    expect((await host.run('printf %s "$GH_TOKEN"', { cwd: dir })).stdout).toBe('');
    expect(log()).toContain('me@box');
    expect(log()).not.toContain('ghp_secret');
  });

  test("runs the stack commands of the settings there", async () => {
    mkdirSync(join(dir, 'ws'));
    const r = await runAppCommand(onHost(name, join(dir, 'ws')), 'pwd -P && echo stopped > stack.log');
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, 'ws', 'stack.log'), 'utf8')).toBe('stopped\n');
    writeFileSync(join(dir, 'net', 'down'), '');
    expect((await runAppCommand(onHost(name, join(dir, 'ws')), 'true')).ok).toBe(false);
  });

  test('copies directories there and back', async () => {
    mkdirSync(join(dir, 'demo', 'sub'), { recursive: true });
    writeFileSync(join(dir, 'demo', 'demo.mp4'), 'video');
    writeFileSync(join(dir, 'demo', 'sub', "it's.txt"), 'quote');
    await host.copyTo(join(dir, 'demo'), join(dir, 'there', 'demo'));
    expect(readFileSync(join(dir, 'there', 'demo', 'sub', "it's.txt"), 'utf8')).toBe('quote');
    const copy = host.localCopy(join(dir, 'there', 'demo'));
    expect(copy.startsWith(join(dir, 'home', 'hosts', name))).toBe(true);
    await host.copyFrom(join(dir, 'there', 'demo'), copy);
    expect(readFileSync(join(copy, 'demo.mp4'), 'utf8')).toBe('video');
    await expect(host.copyFrom(join(dir, 'nothing'), copy)).rejects.toThrow();
  });
});

describe('a session on a host', () => {
  /** A session's process from the SDK's spawn options, with what it printed. */
  const spawnSession = (s: Omit<SpawnOptions, 'signal'>, files = { dirs: { plugin: join(dir, 'plugin') } }) => {
    const p = host.session({ cwd: join(dir, 'ws'), files })({ ...s, signal: new AbortController().signal });
    let out = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    const exited = new Promise<number | null>((r) => p.on('exit', (code) => r(code)));
    return { p, out: () => out, exited };
  };

  beforeEach(() => {
    mkdirSync(join(dir, 'plugin', 'skills'), { recursive: true });
    writeFileSync(join(dir, 'plugin', 'skills', 'SKILL.md'), 'a skill');
    mkdirSync(join(dir, 'ws'));
  });

  test('starts Claude Code there once the host has the plugin, with its environment and the logins from stdin', async () => {
    const s = spawnSession({
      command: 'sh',
      args: ['-c', 'echo "$PWD|$FOO|$OBEYA_HOME|$CLAUDE_CODE_OAUTH_TOKEN|$OBEYA_URL|$1|$OBEYA_HOLDS_VOICE"; cat "$1/skills/SKILL.md"; echo; read line; echo "got $line"', 'x', join(dir, 'plugin')],
      env: { FOO: "it's", OBEYA_URL: 'http://localhost:4417' },
    });
    s.p.stdin.write('ping\n');
    expect(await s.exited).toBe(0);
    // Obeya's directory there is in the host's home
    const remoteDir = join(dir, 'net', 'home', '.obeya', 'remote');
    const [first, skill, got] = s.out().trim().split('\n');
    const [pwd, foo, home, token, url, plugin, held] = first!.split('|');
    expect(pwd).toEndWith('/ws');
    expect(foo).toBe("it's");
    expect(home).toBe(remoteDir);
    expect(token).toBe('sk-claude');
    // a port there forwarded to Obeya's here
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d{5}$/);
    expect(plugin).toBe(`${home}/plugin`);
    // the narration voice Obeya holds needs no installation there
    expect(held).toBe('1');
    expect(skill).toBe('a skill');
    expect(got).toBe('got ping');
    expect(readFileSync(join(remoteDir, 'plugin.stamp'), 'utf8')).toHaveLength(16);
    expect(log()).not.toContain('sk-claude');
  });

  test("ends as a lost connection when the host cannot be made ready", async () => {
    writeFileSync(join(dir, 'net', 'down'), '');
    const s = spawnSession({ command: 'true', args: [], env: {} });
    expect(await s.exited).toBe(255);
  });

  test('copies the plugin once, until it changes', async () => {
    await host.prepare({ dirs: { plugin: join(dir, 'plugin') } });
    const again = registerHost({ name: `${name}-2`, ssh: 'me@box', home: join(dir, 'home'), program: ssh });
    const copies = () => log().split('\n').filter((l) => l.includes('tar -xf')).length;
    const before = copies();
    await again.prepare({ dirs: { plugin: join(dir, 'plugin') } });
    expect(copies()).toBe(before);
  });

  test("the owner's demo settings go there with the voice reference as a path here, without a key file", () => {
    mkdirSync(join(dir, 'home'), { recursive: true });
    writeFileSync(join(dir, 'home', 'demo.json'), JSON.stringify({ language: 'de', voice: 'qwen3', reference: '~/voice/me.wav', keyFile: '~/.voice/key' }));
    const settings = JSON.parse(sessionFiles(join(dir, 'home'), []).files!['demo.json']!()!);
    expect(settings.reference).toBe(join(homedir(), 'voice', 'me.wav'));
    expect(settings.keyFile).toBeUndefined();
  });
});

describe('clones on a host', () => {
  let origin: string;
  let spaces: Workspaces;
  let store: Store;
  let board: Board;

  beforeEach(() => {
    gitRepo(join(dir, 'main'));
    origin = join(dir, 'origin.git');
    git(dir, 'clone', '--quiet', '--bare', join(dir, 'main'), origin);
    store = new Store(':memory:');
    board = new Board(store, { id: 'c', name: 'C', repos: [{ id: 'home', name: 'Home', path: join(dir, 'main'), branch: 'main' }] }, () => ({ docs: [], dirs: [] }));
    spaces = new Workspaces(store, 'c', { mode: 'clones', repoPath: join(dir, 'main'), dir: join(dir, 'ws') });
  });

  test('are made there, leased after those here, and land through the remote', async () => {
    spaces.ensureClones(origin, 1);
    expect(await spaces.ensureHostClones(host, join(dir, 'far'), origin, 2, () => 'ghp_x')).toBeNull();
    // made once: a second call finds them
    expect(await spaces.ensureHostClones(host, join(dir, 'far'), origin, 2, () => 'ghp_x')).toBeNull();
    expect(spaces.list().map((w) => w.path)).toEqual([join(dir, 'ws', '1'), onHost(name, join(dir, 'far', '1')), onHost(name, join(dir, 'far', '2'))]);
    // trusted by Claude Code, whose dialog nobody answers there
    const trusted = JSON.parse(readFileSync(join(dir, 'net', 'home', '.claude.json'), 'utf8')).projects;
    expect(Object.keys(trusted)).toEqual([join(dir, 'far', '1'), join(dir, 'far', '2')]);
    expect(trusted[join(dir, 'far', '1')]).toEqual({ hasTrustDialogAccepted: true });
    // the system's helper (macOS's keychain) reset by an empty one, then the token's
    expect(Bun.spawnSync(['git', '-C', join(dir, 'far', '1'), 'config', '--local', '--get-all', 'credential.helper']).stdout.toString()).toMatch(/^\n!f\(\).*GH_TOKEN/);
    const [a, b] = [board.create({ title: 'A', x: 0, y: 0 }).id, board.create({ title: 'B', x: 0, y: 0 }).id];
    expect(spaces.lease(a, 'obeya/a')).toBe(join(dir, 'ws', '1'));
    const far = spaces.lease(b, 'obeya/b');
    expect(far).toBe(onHost(name, join(dir, 'far', '1')));
    expect(spaces.hasWork(b)).toBe(false);
    const local = join(dir, 'far', '1');
    identify(local);
    writeFileSync(join(local, 'new.txt'), 'x\n');
    expect(spaces.hasWork(b)).toBe(true);
    expect(spaces.changes(b)).toEqual([{ file: 'new.txt', regions: [] }]);
    git(local, 'add', '.');
    git(local, 'commit', '--quiet', '-m', 'far work');
    const landed = await spaces.pushToMain(b);
    expect('to' in landed && git(origin, 'log', '-1', '--format=%s', 'main')).toBe('far work');
    spaces.discard(b, 'obeya/b');
    expect(git(local, 'branch', '--list', 'obeya/b')).toBe('');
    // many git calls, each through the stand-in for ssh
  }, 30_000);

  test('take a new card on the first machine with a free slot, here first', async () => {
    let workers!: Workers;
    spaces = new Workspaces(store, 'c', {
      mode: 'clones',
      repoPath: join(dir, 'main'),
      dir: join(dir, 'ws'),
      machines: [{ host: null, slots: 1 }, { host: name, slots: 1 }],
      busy: (h) => workers.busyOn(h),
    });
    spaces.ensureClones(origin, 2);
    expect(await spaces.ensureHostClones(host, join(dir, 'far'), origin, 2, () => undefined)).toBeNull();
    const runtime = new FakeRuntime();
    workers = new Workers({ board, runtime, workspaces: spaces, adapter: { ...generic, workspaces: 'clones', land: 'pr' } });
    const [a, b, c] = ['A', 'B', 'C'].map((title) => board.create({ title, x: 0, y: 0 }).id) as [string, string, string];
    workers.start(a);
    expect(board.row(a).workspace).toBe(join(dir, 'ws', '1'));
    // the slot here is taken by A at work, though a clone here is free
    workers.start(b);
    expect(board.row(b).workspace).toBe(onHost(name, join(dir, 'far', '1')));
    expect(() => workers.start(c)).toThrow(expect.objectContaining({ code: 'noSlot' }));
    expect(spaces.leasable()).toBe(false);
    expect(spaces.pool(workers.inTurn())).toEqual([
      { name: HERE, here: true, slots: 1, total: 2, cards: [a], busy: [a] },
      { name, slots: 1, total: 2, cards: [b], busy: [b] },
    ]);
    // A asks the owner and holds its clone, but no slot
    const sa = runtime.sessions.find((s) => s.spec.cwd === board.row(a).workspace)!;
    await sa.call('ask', { question: 'Welche Farbe?' });
    sa.emit({ type: 'idle' });
    expect(spaces.leasable()).toBe(true);
    workers.start(c);
    expect(board.row(c).workspace).toBe(join(dir, 'ws', '2'));
    // the owner's question to a card whose work is over does not wait for a slot
    const d = board.create({ title: 'D', x: 0, y: 0 }).id;
    expect(spaces.lease(d, 'obeya/d', { overSlots: true })).toBe(onHost(name, join(dir, 'far', '2')));
    workers.shutdown();
  }, 30_000);

  test('of a host that stops answering hold the server once, not at each look for a free clone', async () => {
    expect(await spaces.ensureHostClones(host, join(dir, 'far'), origin, 2, () => undefined)).toBeNull();
    let back = 0;
    const stop = host.onBack(() => back++);
    const tries = () => (existsSync(join(dir, 'net', 'tries')) ? readFileSync(join(dir, 'net', 'tries'), 'utf8').split('\n').length - 1 : 0);
    writeFileSync(join(dir, 'net', 'down'), '');
    const before = tries();
    // the first look finds the host gone; ssh took seconds for that (a name it cannot resolve)
    expect(spaces.leasable()).toBe(false);
    expect(tries()).toBe(before + 1);
    expect(host.unreachable).toBe(true);
    // the next looks, at every change of the board, do not ask it again
    for (let i = 0; i < 5; i++) expect(spaces.leasable()).toBe(false);
    expect(tries()).toBe(before + 1);
    // a while later a look has it asked again, in the background
    rmSync(join(dir, 'net', 'down'));
    setSystemTime(new Date(Date.now() + RECHECK_DOWN_MS));
    try {
      expect(spaces.leasable()).toBe(false);
    } finally {
      setSystemTime();
    }
    await until(() => !host.unreachable);
    expect(back).toBe(1);
    expect(spaces.leasable()).toBe(true);
    stop();
  });

  test('wait for a host that cannot be reached, and say why', async () => {
    writeFileSync(join(dir, 'net', 'down'), '');
    expect(await spaces.ensureHostClones(host, join(dir, 'far'), origin, 1, () => undefined)).toContain('Connection refused');
    expect(spaces.list()).toEqual([]);
  });
});

describe('a worker on a host', () => {
  test('whose connection drops resumes its session once the host answers, with the message it had not taken', async () => {
    gitRepo(join(dir, 'main'));
    const origin = join(dir, 'origin.git');
    git(dir, 'clone', '--quiet', '--bare', join(dir, 'main'), origin);
    const store = new Store(':memory:');
    const board = new Board(store, { id: 'c', name: 'C', repos: [{ id: 'home', name: 'Home', path: join(dir, 'main'), branch: 'main' }] }, () => ({ docs: [], dirs: [] }));
    const spaces = new Workspaces(store, 'c', { mode: 'clones', repoPath: join(dir, 'main'), dir: join(dir, 'ws') });
    expect(await spaces.ensureHostClones(host, join(dir, 'far'), origin, 1, () => undefined)).toBeNull();
    const runtime = new FakeRuntime();
    const workers = new Workers({ board, runtime, workspaces: spaces, adapter: { ...generic, workspaces: 'clones', land: 'pr' }, reconnectMs: 20 });
    const card = board.create({ title: 'Weit weg', x: 0, y: 0 });
    workers.start(card.id);
    const first = runtime.last;
    expect(first.spec.cwd).toBe(onHost(name, join(dir, 'far', '1')));
    first.emit({ type: 'session', id: 's1' });
    first.emit({ type: 'tool', name: 'Bash', input: { command: 'ls' } });
    first.emit({ type: 'idle' });
    // the owner writes, and the connection drops before the worker takes the message
    workers.message(card.id, 'Bitte auch CSV.');
    writeFileSync(join(dir, 'net', 'down'), '');
    first.emit({ type: 'lost', message: 'the connection was lost' });
    expect(board.events(card.id).some((e) => e.text.includes(`Die Verbindung zu ${name} ist weg`))).toBe(true);
    await Bun.sleep(80);
    expect(runtime.sessions).toHaveLength(1);
    rmSync(join(dir, 'net', 'down'));
    await until(() => runtime.sessions.length === 2);
    expect(runtime.last.spec.resume).toBe('s1');
    expect(runtime.last.inbox[0]).toContain('Bitte auch CSV.');
    // at work when it dropped, it hears what happened
    runtime.last.emit({ type: 'tool', name: 'Bash', input: { command: 'ls' } });
    runtime.last.emit({ type: 'lost', message: 'the connection was lost' });
    await until(() => runtime.sessions.length === 3);
    expect(runtime.last.inbox[0]).toContain('dropped');
    // its turn ended, its background work (a render) running: that went with the session too
    runtime.last.emit({ type: 'tool', name: 'Bash', input: { command: 'bun render.ts' } });
    runtime.last.emit({ type: 'idle', background: 1 });
    runtime.last.emit({ type: 'lost', message: 'the connection was lost' });
    await until(() => runtime.sessions.length === 4);
    expect(runtime.last.inbox[0]).toContain('dropped');
    // its demo is made there, and served from its copy here
    const demo = join(dir, 'far', 'demo');
    mkdirSync(demo);
    writeFileSync(join(demo, 'demo.mp4'), 'video');
    writeFileSync(join(demo, 'captions.vtt'), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nEins.\n');
    expect(await runtime.last.call('ready_for_review', { summary: 'Fertig.', demo: { dir: demo, chapters: ['Eins'] } })).toContain('End your turn');
    const shown = JSON.parse(board.row(card.id).demo!) as { dir: string };
    expect(shown.dir).toBe(host.localCopy(demo));
    expect(readFileSync(join(shown.dir, 'demo.mp4'), 'utf8')).toBe('video');
    expect(await runtime.last.call('ready_for_review', { summary: 'Fertig.', demo: { dir: join(dir, 'far', 'none'), chapters: [] } })).toContain('could not be copied');
    // waiting for the owner, it takes in their words and waits for its background work, when the connection drops
    runtime.last.emit({ type: 'idle' });
    workers.message(card.id, 'Noch ein Satz im Video.');
    runtime.last.emit({ type: 'tool', name: 'Bash', input: { command: 'bun render.ts' } });
    runtime.last.emit({ type: 'idle', background: 1 });
    runtime.last.emit({ type: 'lost', message: 'the connection was lost' });
    await until(() => runtime.sessions.length === 5);
    expect(runtime.last.inbox[0]).toContain('dropped');
    workers.shutdown();
  }, 20_000);
});
