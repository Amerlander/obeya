import { expect, test } from 'bun:test';
import { spawnOutput } from './spawn';

test('dozens of processes asked for at once start a few at a time, with turns of the event loop between', async () => {
  const spawn = Bun.spawn;
  let started = 0;
  Bun.spawn = ((...args: Parameters<typeof Bun.spawn>) => {
    started++;
    return spawn(...args);
  }) as typeof Bun.spawn;
  try {
    const all = Array.from({ length: 20 }, () => spawnOutput([process.execPath, '--version']));
    // the first ones at once, as a caller expects of a process it started
    expect(started).toBe(4);
    await new Promise((go) => setImmediate(go));
    expect(started).toBeLessThanOrEqual(8);
    const done = await Promise.all(all);
    expect(started).toBe(20);
    expect(done.every((r) => r.code === 0 && r.stdout.trim() === Bun.version)).toBe(true);
  } finally {
    Bun.spawn = spawn;
  }
});
