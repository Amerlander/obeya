import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanvasRuntime } from './canvas';
import { Store } from './db';
import type { FolderWorkspaces } from './folder';
import { FakeRuntime, noForge } from './testing';

let dir: string;
let docs: string;
let runtime: FakeRuntime;
let canvas: CanvasRuntime;

const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * seed + 3) % 251);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-folder-canvas-'));
  docs = join(dir, 'Documents');
  mkdirSync(join(docs, 'Scans'), { recursive: true });
  mkdirSync(join(docs, 'Estate'), { recursive: true });
  writeFileSync(join(docs, 'Scans', 'scan-1.pdf'), bytes(4000, 7));
  writeFileSync(join(docs, 'Estate', 'Inventory.md'), '# Estate\n\n- Savings book\n');
  writeFileSync(join(docs, '.obeya-note.txt'), 'x\n');
  runtime = new FakeRuntime();
  canvas = new CanvasRuntime({ repos: [{ path: docs, git: false }] }, { store: new Store(':memory:'), home: dir, runtime, forge: noForge });
  await (canvas.repos[0]!.workspaces as FolderWorkspaces).read;
});
afterEach(() => {
  canvas.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const item = (id: string) => canvas.board.item(id)!;

describe('a canvas over a folder without git', () => {
  test('resolves without git: no branch, no pull requests, the folder its own Lesestand', () => {
    expect(canvas.board.canvas.repos[0]).toMatchObject({ id: 'documents', folder: true, branch: '' });
    expect(canvas.repos[0]!.read.path).toBe(docs);
  });

  test('two cards work in the folder at once, each with its own changes; undo puts back one card’s, approval ends the other', async () => {
    const sort = canvas.board.create({ title: 'Sort the scans', x: 0, y: 0 });
    const letter = canvas.board.create({ title: 'Draft the letter', x: 400, y: 0 });
    const workers = canvas.repoOf(sort.id).workers;
    workers.start(sort.id);
    const a = runtime.last;
    workers.start(letter.id);
    const b = runtime.last;
    expect(canvas.board.row(sort.id).workspace).toBe(docs);
    expect(a.spec.cwd).toBe(docs);
    expect(a.spec.system).toContain('directly in a folder that is not a git repository');
    await a.use('Bash', { command: 'mkdir -p Tax/2025 && mv Scans/scan-1.pdf Tax/2025/' }, () => {
      mkdirSync(join(docs, 'Tax', '2025'), { recursive: true });
      renameSync(join(docs, 'Scans', 'scan-1.pdf'), join(docs, 'Tax', '2025', 'scan-1.pdf'));
    });
    await b.use('Write', { file_path: join(docs, 'Estate', 'Reply.md') }, () => writeFileSync(join(docs, 'Estate', 'Reply.md'), 'Dear court,\n'));
    await b.use('Edit', { file_path: 'Estate/Inventory.md' }, () => writeFileSync(join(docs, 'Estate', 'Inventory.md'), '# Estate\n\n- Savings book\n- Car\n'));
    const listOf = async (id: string) => (await canvas.diff(id, false))!.folder!.changes.map((c) => `${c.kind} ${c.from ? `${c.from} → ` : ''}${c.path}`);
    expect(await listOf(sort.id)).toEqual(['moved Scans/scan-1.pdf → Tax/2025/scan-1.pdf', 'added Tax', 'added Tax/2025']);
    expect(await listOf(letter.id)).toEqual(['added Estate/Reply.md', 'modified Estate/Inventory.md']);
    // the Koordinator sees what each changed
    expect(canvas.repos[0]!.workspaces.changes(letter.id).map((c) => c.file)).toEqual(['Estate/Reply.md', 'Estate/Inventory.md']);

    // a handover without a demo: the change list shows what changed
    expect(await a.call('ready_for_review', { summary: 'Sorted.' })).toContain('Recorded');
    expect(await b.call('ready_for_review', { summary: 'Drafted.' })).toContain('Recorded');
    expect(item(sort.id)).toMatchObject({ state: 'waiting', need: 'review' });

    await canvas.act(sort.id, { action: 'undo' });
    expect(existsSync(join(docs, 'Scans', 'scan-1.pdf'))).toBe(true);
    expect(existsSync(join(docs, 'Tax'))).toBe(false);
    expect(await listOf(sort.id)).toEqual([]);
    expect(item(sort.id)).toMatchObject({ state: 'waiting', noChange: true });
    expect(canvas.board.events(sort.id).at(-1)!.text).toBe('Änderungen verworfen: 1 Datei zurückgesetzt.');
    // the other card's changes stay
    expect(readFileSync(join(docs, 'Estate', 'Reply.md'), 'utf8')).toBe('Dear court,\n');

    await canvas.act(letter.id, { action: 'approve' });
    expect(item(letter.id).state).toBe('done');
    expect(canvas.board.events(letter.id).some((e) => e.text === 'Freigegeben. Die Änderungen bleiben im Ordner: erledigt.')).toBe(true);
    expect(b.inbox.at(-1)).toContain('Your changes stay in the folder');
    // done: nothing is undone any more, but the list stays the card's record
    expect((await canvas.diff(letter.id, false))!.folder!.undo).toBeNull();
    expect(() => canvas.act(letter.id, { action: 'undo' })).toThrow();
  });

  test('the Koordinator holds a card that would touch what one in progress changed, until the owner starts it anyway', async () => {
    const settle = () => new Promise((r) => setTimeout(r, 10));
    const estimates = () => runtime.sessions.filter((s) => s.spec.tools.some((t) => t.name === 'scope'));
    const sort = canvas.board.create({ title: 'Sort the scans', x: 0, y: 0 });
    canvas.koordinator.request(sort.id);
    await settle();
    expect(item(sort.id).state).toBe('working');
    // its scope, estimated once it runs
    estimates()[0]!.call('scope', { files: ['Scans/'], conflicts_with: [], reason: '.' });
    estimates()[0]!.emit({ type: 'idle' });
    await settle();
    const worker = runtime.sessions.find((s) => s.spec.cwd === docs && s.spec.role === 'worker')!;
    await worker.use('Bash', { command: 'mv' }, () => renameSync(join(docs, 'Scans', 'scan-1.pdf'), join(docs, 'Scans', '2026-10-02 Bill.pdf')));
    const rename = canvas.board.create({ title: 'Rename the scans', x: 400, y: 0 });
    canvas.koordinator.request(rename.id);
    await settle();
    const judge = estimates().at(-1)!;
    expect(judge.spec.system).toContain('all directly in one folder that is not a git repository');
    expect(judge.inbox[0]).toContain('changed so far: Scans/2026-10-02 Bill.pdf (moved from Scans/scan-1.pdf)');
    judge.call('scope', { files: ['Scans/'], conflicts_with: ['K1'], reason: 'Both rename the scans.' });
    judge.emit({ type: 'idle' });
    await settle();
    expect(item(rename.id)).toMatchObject({ state: 'planned', queue: { behind: [sort.id] } });
    canvas.act(rename.id, { action: 'force' });
    await settle();
    expect(item(rename.id).state).toBe('working');
  });

  test('has no prototypes', () => {
    const idea = canvas.board.create({ idea: true, title: 'Ordnung', x: 0, y: 0 });
    expect(() => canvas.act(idea.id, { action: 'prototype', text: 'so' })).toThrow('no prototypes');
  });
});
