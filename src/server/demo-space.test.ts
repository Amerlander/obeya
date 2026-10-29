import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_KEEP_DAYS, DemoSpace, keepDays, sweep, usage, workDirs } from './demo-space';

const DAY = 24 * 3600;
let demos: string;
beforeEach(() => (demos = mkdtempSync(join(tmpdir(), 'obeya-demo-space-'))));
afterEach(() => rmSync(demos, { recursive: true, force: true }));

/** A rendered demo: video, a clip and its frames in `.work`, everything last written `days` ago. */
function render(dir: string, days: number) {
  const work = join(dir, '.work');
  mkdirSync(join(work, 'frames'), { recursive: true });
  writeFileSync(join(dir, 'demo.mp4'), 'v'.repeat(1000));
  writeFileSync(join(work, 'abc.wav'), 'w'.repeat(2000));
  writeFileSync(join(work, 'frames.txt'), 'ffconcat version 1.0\n');
  for (let i = 0; i < 3; i++) writeFileSync(join(work, 'frames', `${i}.jpg`), 'f'.repeat(10_000));
  const at = Date.now() / 1000 - days * DAY;
  for (const p of [join(work, 'frames'), join(work, 'abc.wav'), join(work, 'frames.txt'), work]) utimesSync(p, at, at);
  return work;
}

describe('the frames of old demos', () => {
  test('go once a demo was last rendered longer ago than the days kept; video and clips stay', async () => {
    const old = render(join(demos, 'old'), 20);
    const fresh = render(join(demos, 'fresh'), 3);
    const freed = await sweep(demos, 14);
    expect(freed.demos).toBe(1);
    expect(freed.bytes).toBeGreaterThanOrEqual(30_000);
    expect(readdirSync(old).sort()).toEqual(['abc.wav']);
    expect(existsSync(join(demos, 'old', 'demo.mp4'))).toBe(true);
    expect(readdirSync(join(fresh, 'frames'))).toHaveLength(3);
    // nothing left to delete the next time
    expect(await sweep(demos, 14)).toEqual({ demos: 0, bytes: 0 });
  });

  test('of a render in another voice, in its own subdirectory, go too', async () => {
    const other = render(join(demos, 'export', 'qwen'), 30);
    expect(workDirs(demos)).toEqual([other]);
    await sweep(demos, 14);
    expect(existsSync(join(other, 'frames'))).toBe(false);
  });

  test('stay while a render of the demo runs', async () => {
    const work = render(join(demos, 'busy'), 30);
    writeFileSync(join(work, 'render.pid'), String(process.pid));
    utimesSync(join(work, 'render.pid'), Date.now() / 1000 - 30 * DAY, Date.now() / 1000 - 30 * DAY);
    utimesSync(work, Date.now() / 1000 - 30 * DAY, Date.now() / 1000 - 30 * DAY);
    expect(await sweep(demos, 14)).toEqual({ demos: 0, bytes: 0 });
    expect(existsSync(join(work, 'frames'))).toBe(true);
  });

  test('a recent file in the work directory counts as a recent render', async () => {
    const work = render(join(demos, 'revoiced'), 30);
    writeFileSync(join(work, 'state.json'), '{}');
    expect(await sweep(demos, 14)).toEqual({ demos: 0, bytes: 0 });
  });
});

test("what demos take, and their work directories' share of it", async () => {
  render(join(demos, 'a'), 1);
  render(join(demos, 'b', 'qwen'), 1);
  writeFileSync(join(demos, 'notes.txt'), 'n'.repeat(500));
  const used = await usage(demos);
  expect(used.work).toBeGreaterThanOrEqual(2 * 32_000);
  expect(used.bytes).toBeGreaterThanOrEqual(used.work + 2 * 1000 + 500);
  expect(await usage(join(demos, 'none'))).toEqual({ bytes: 0, work: 0 });
});

test("the days kept: the settings', else the default, which only the Obeya in the default home applies", () => {
  const own = join(homedir(), '.obeya');
  expect(keepDays({}, own)).toBe(DEFAULT_KEEP_DAYS);
  expect(keepDays({ keepFrames: 'always' }, own)).toBeNull();
  expect(keepDays({ keepFrames: 3 }, own)).toBe(3);
  expect(keepDays({}, demos)).toBeNull();
  expect(keepDays({ keepFrames: 30 }, demos)).toBe(30);
});

test('the view counts in the background, and a sweep deletes per the settings', async () => {
  const work = render(join(demos, 'old'), 20);
  const home = join(demos, 'home');
  const space = new DemoSpace({ home, settings: () => ({ language: 'en', voice: 'piper', directory: demos, keepFrames: 7 }) });
  expect(space.view()).toMatchObject({ keepDays: 7, defaultDays: null, busy: true });
  await space.sweepSoon();
  expect(existsSync(join(work, 'frames'))).toBe(false);
  const view = space.view();
  expect(view.busy).toBe(false);
  expect(view.freed).toMatchObject({ demos: 1 });
  expect(view.used!.bytes).toBeGreaterThan(0);
});
