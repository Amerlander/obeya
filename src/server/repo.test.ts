import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmdirSync, rmSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generic } from '../adapters/generic';
import { oldLinuxBun, readPlanDocs, watchPlanDocs } from './repo';

const DOC = '# P\n\n## Workstreams\n\n- [ ] **W1:** One.\n';

describe('readPlanDocs', () => {
  test('reads the docs that are projects, and the others with their reason; the excluded ones not at all', () => {
    const repo = mkdtempSync(join(tmpdir(), 'obeya-read-'));
    try {
      expect(readPlanDocs(repo, generic)).toEqual({ docs: [], others: [] });
      mkdirSync(join(repo, 'docs/plan'), { recursive: true });
      writeFileSync(join(repo, 'docs/plan/p.md'), DOC);
      writeFileSync(join(repo, 'docs/plan/rollout.md'), '# Rollout\n\n## Phases\n\n- [ ] One\n');
      writeFileSync(join(repo, 'docs/plan/rfc.md'), '# RFC\n\n## Workstreams\n\nTo be cut.\n');
      writeFileSync(join(repo, 'docs/plan/TEMPLATE.md'), '# Template\n');
      writeFileSync(join(repo, 'docs/plan/notes.txt'), 'not markdown');
      const { docs, others } = readPlanDocs(repo, generic);
      expect(docs.map((d) => d.file)).toEqual(['docs/plan/p.md']);
      expect(others).toEqual([
        { file: 'docs/plan/rfc.md', reason: 'noChecklist' },
        { file: 'docs/plan/rollout.md', reason: 'noWorkstreams' },
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('oldLinuxBun', () => {
  test('is Bun before 1.3.14 on Linux, and nothing elsewhere', () => {
    expect(oldLinuxBun('linux', '1.3.12')).toBe(true);
    expect(oldLinuxBun('linux', '1.3.14-canary.1')).toBe(true);
    expect(oldLinuxBun('linux', '1.3.14')).toBe(false);
    expect(oldLinuxBun('linux', '1.4.0')).toBe(false);
    expect(oldLinuxBun('darwin', '1.3.12')).toBe(false);
    expect(oldLinuxBun('win32', '1.3.12')).toBe(false);
  });
});

describe('watchPlanDocs', () => {
  /**
   * How far behind fseventsd may fall. A busy one delivers events seconds late, a swamped one a
   * minute late (both measured here on 2026-10-12); the running Obeya has its safety-net poll for
   * that, these tests check the watches alone.
   */
  const swamped = 120_000;
  const cleanup: (() => void)[] = [];
  afterEach(() => cleanup.splice(0).forEach((f) => f()));

  /** A repository directory with these files, watched from here on (by the watches alone, or as `options` say). */
  function watched(files: string[], options: Parameters<typeof watchPlanDocs>[3] = { poll: 0 }) {
    const repo = mkdtempSync(join(tmpdir(), 'obeya-watch-'));
    for (const f of files) {
      mkdirSync(join(repo, f, '..'), { recursive: true });
      writeFileSync(join(repo, f), DOC);
    }
    let fired = () => {};
    let calls = 0;
    const stop = watchPlanDocs(repo, generic, () => {
      calls++;
      fired();
    }, options);
    // a plain watch on the whole repository tells a late event from one the watches missed
    let delivered = (_path: string) => {};
    const control = watch(repo, { recursive: true }, (_, file) => delivered(String(file).replaceAll('\\', '/')));
    cleanup.push(stop, () => control.close(), () => rmSync(repo, { recursive: true, force: true }));
    /**
     * Whether the watches fire for a change of `path` (in the repository) made from now on: as soon
     * as they do, and no later than a moment after the plain watch has seen it.
     */
    const next = (path: string) =>
      new Promise<boolean>((resolve) => {
        let missed: ReturnType<typeof setTimeout> | undefined;
        const done = (fires: boolean) => {
          clearTimeout(late);
          clearTimeout(missed);
          fired = () => {};
          delivered = () => {};
          resolve(fires);
        };
        const late = setTimeout(() => done(false), swamped);
        fired = () => done(true);
        delivered = (file) => {
          if (file === path) missed ??= setTimeout(() => done(false), 2000);
        };
      });
    return { repo, next, calls: () => calls };
  }

  /**
   * Waits until the watches opened so far are live. On macOS a new watch takes a moment (more on a
   * busy machine), and Bun has one FSEvents stream for all watches of the process, started afresh
   * for each new one: they are live once a watch opened after them sees a change. A change made
   * before that is lost for good. On Linux a watch is live at once.
   */
  async function live() {
    const dir = mkdtempSync(join(tmpdir(), 'obeya-probe-'));
    let seen = false;
    const probe = watch(dir, () => (seen = true));
    cleanup.push(() => probe.close(), () => rmSync(dir, { recursive: true, force: true }));
    for (const end = Date.now() + swamped; !seen; await Bun.sleep(50)) {
      if (Date.now() > end) throw new Error(`a new watch saw nothing for ${swamped / 1000} s`);
      writeFileSync(join(dir, 'probe'), String(Date.now()));
    }
  }

  test('sees a doc change', async () => {
    const { repo, next } = watched(['docs/plan/a.md']);
    await live();
    const seen = next('docs/plan/a.md');
    writeFileSync(join(repo, 'docs/plan/a.md'), `${DOC}- [ ] **W2:** Two.\n`);
    expect(await seen).toBe(true);
  }, 6 * swamped);

  test('sees the last doc go with its directory, as git removes it, and a first one come back', async () => {
    const { repo, next } = watched(['docs/design.md', 'docs/plan/a.md']);
    await live();
    const gone = next('docs/plan');
    unlinkSync(join(repo, 'docs/plan/a.md'));
    rmdirSync(join(repo, 'docs/plan'));
    expect(await gone).toBe(true);

    // right after the watches were re-armed
    const back = next('docs/plan');
    mkdirSync(join(repo, 'docs/plan'));
    writeFileSync(join(repo, 'docs/plan/b.md'), DOC);
    expect(await back).toBe(true);

    // the plan directory is watched again once it is back
    await live();
    const changed = next('docs/plan/b.md');
    writeFileSync(join(repo, 'docs/plan/b.md'), `${DOC}- [ ] **W2:** Two.\n`);
    expect(await changed).toBe(true);
  }, 6 * swamped);

  test('sees a first doc in a repository without a plan directory', async () => {
    const { repo, next } = watched(['README.md']);
    await live();
    const seen = next('docs');
    mkdirSync(join(repo, 'docs/plan'), { recursive: true });
    writeFileSync(join(repo, 'docs/plan/a.md'), DOC);
    expect(await seen).toBe(true);
  }, 6 * swamped);

  test('the safety-net poll alone sees docs change, come and go, and stays quiet otherwise', async () => {
    const { repo, next, calls } = watched(['README.md'], { watches: false, poll: 50 });
    const first = next('docs/plan/a.md');
    mkdirSync(join(repo, 'docs/plan'), { recursive: true });
    writeFileSync(join(repo, 'docs/plan/a.md'), DOC);
    expect(await first).toBe(true);

    const changed = next('docs/plan/a.md');
    writeFileSync(join(repo, 'docs/plan/a.md'), `${DOC}- [ ] **W2:** Two.\n`);
    expect(await changed).toBe(true);

    // what it has reported once, it does not report again; nor anything that is not a plan doc
    const before = calls();
    writeFileSync(join(repo, 'docs/plan/notes.txt'), 'x');
    await Bun.sleep(400);
    expect(calls()).toBe(before);

    const gone = next('docs/plan');
    rmSync(join(repo, 'docs/plan'), { recursive: true });
    expect(await gone).toBe(true);
  }, 6 * swamped);
});
