import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describePageStall, describeStall, pageStall, placeOf, Stalls, STALLS_FILE, type Trace } from './stalls';
import { until } from './testing';

const NONE = 4294967295;
const native = (name: string) => ({ name, line: NONE, column: NONE });
const at = (name: string, file: string, line: number) => ({ name, sourceURL: `/repo/src/server/${file}`, line, column: 3 });
const trace = (...frames: Trace['frames']): Trace => ({ timestamp: 0, frames });
const times = (n: number, t: Trace) => Array.from({ length: n }, () => t);

test('a sample is placed by the runtime function it was in and the code of Obeya that called it, a library’s frames left out', () => {
  expect(placeOf(trace(native('spawnSync'), at('git', 'workspaces.ts', 77), { name: 'x', sourceURL: '/repo/node_modules/lib/a.js', line: 1, column: 1 }, at('approve', 'workers.ts', 1285)))).toBe(
    'spawnSync ← git (workspaces.ts:77) ← approve (workers.ts:1285)',
  );
  expect(placeOf(trace(at('', 'board.ts', 12)))).toBe('(anonymous) (board.ts:12)');
  expect(placeOf(trace())).toBe('(no JavaScript: garbage collection or the runtime itself)');
});

test('a stall names where its samples were, by share, and the processes it waited for', () => {
  const git = trace(native('spawnSync'), at('git', 'workspaces.ts', 77), at('hasWork', 'workspaces.ts', 900));
  const json = trace(native('stringify'), at('snapshot', 'board.ts', 2401));
  expect(describeStall(2400, [...times(900, git), ...times(300, json)], [{ argv: ['/usr/bin/git', '-C', '/repo', 'status', '--porcelain'], ms: 1800 }], 2)).toEqual([
    'Obeya: the server stalled for 2.4 s; meanwhile it answered no page and heard no agent',
    '   75% spawnSync ← git (workspaces.ts:77) ← hasWork (workspaces.ts:900)',
    '   25% stringify ← snapshot (board.ts:2401)',
    '  waited 1.8 s for: git -C /repo status --porcelain',
  ]);
});

test('a pause the thread did not run in is no stall: the machine slept', () => {
  expect(describeStall(30_000, times(5, trace(native('spawnSync'))), [], 2)).toBeNull();
  // without a profiler to ask, the length is all there is
  expect(describeStall(800, null, [])).toEqual(['Obeya: the server stalled for 0.8 s; meanwhile it answered no page and heard no agent']);
});

test('a page’s stall is logged with where its time went and what it took in before; the server takes no more than it logs', () => {
  expect(pageStall({ type: 'stall', ms: 300, scripts: [], before: [] })).toBeNull();
  expect(pageStall({ ms: 'long' })).toBeNull();
  const s = pageStall({ type: 'stall', ms: 1300, scripts: [{ what: 'x'.repeat(500), ms: 900 }, { what: 3, ms: 1 }], before: ['snapshot (412 KB) 0.2 s before', 7], extra: true })!;
  expect(s).toEqual({ ms: 1300, scripts: [{ what: 'x'.repeat(200), ms: 900 }], before: ['snapshot (412 KB) 0.2 s before'] });
  expect(describePageStall({ ms: 1300, scripts: [{ what: 'WebSocket.onmessage: (anonymous) (index.js@1204)', ms: 1100 }], before: ['snapshot (412 KB) 0.2 s before'] }, 'this machine, canvas main')).toEqual([
    'Obeya: a page (this machine, canvas main) stalled for 1.3 s; meanwhile it took no click or key',
    '  1.1 s WebSocket.onmessage: (anonymous) (index.js@1204)',
    '  before it: snapshot (412 KB) 0.2 s before',
  ]);
});

let home: string | undefined;
let stalls: Stalls | undefined;
afterEach(() => {
  stalls?.stop();
  if (home) rmSync(home, { recursive: true, force: true });
});

test('a synchronous process that holds the server up goes into the log and stalls.log, by its command and the code that ran it', async () => {
  home = mkdtempSync(join(tmpdir(), 'obeya-stalls-'));
  const lines: string[] = [];
  stalls = new Stalls({ home, log: (line) => lines.push(line) }).start();
  await Bun.sleep(150);
  function landOnMain() {
    return Bun.spawnSync(['sleep', '0.7']).exitCode;
  }
  expect(landOnMain()).toBe(0);
  await until(() => lines.length > 0);
  expect(lines[0]).toMatch(/^Obeya: the server stalled for 0\.\d s/);
  expect(lines.some((l) => /% spawnSync ← .*stalls\.test\.ts:\d+/.test(l))).toBe(true);
  expect(lines.some((l) => /^  waited 0\.\d s for: sleep 0\.7$/.test(l))).toBe(true);
  const file = readFileSync(join(home, STALLS_FILE), 'utf8');
  expect(file).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z\nObeya: the server stalled/);
  expect(file).toContain('for: sleep 0.7');
  // stopped, it leaves Bun's own spawnSync behind
  stalls.stop();
  expect(Bun.spawnSync.name).toBe('spawnSync');
});
