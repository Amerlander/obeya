import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitRepo } from '../../../../src/server/testing';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-check-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const CHECK = join(import.meta.dir, 'check.ts');

/** Runs the check in a repository whose adapter has the given demo (and these files), as a worker runs it. */
function check(demo: Record<string, unknown>, files: Record<string, string> = {}): { code: number; out: string } {
  const repo = gitRepo(join(dir, 'shop'), {
    '.obeya/adapter/index.ts': `export default { name: 'shop', demo: ${JSON.stringify({ required: false, howToRun: 'bun dev', ...demo })} };\n`,
    ...files,
  });
  const r = Bun.spawnSync([process.execPath, CHECK], { cwd: repo });
  return { code: r.exitCode, out: r.stdout.toString() };
}

const SITE = { title: 'Demos', url: 'https://demos.example.dev', deploy: ['git', '{dir}'] };

describe('check.ts', () => {
  test('shows the site and finds nothing wrong with it', () => {
    const { code, out } = check({ site: SITE });
    expect(out).toContain('site Demos at https://demos.example.dev, deploy ["git","{dir}"]');
    expect(out).toContain('No problems.');
    expect(code).toBe(0);
  });

  test("reports a site's deploy program that is not there", () => {
    const { code, out } = check({ site: { ...SITE, deploy: ['scripts/no-such-deploy.sh', '{dir}'] } });
    expect(out).toContain(`- demo.site.deploy: the share command's program ${join(realpathSync(dir), 'shop', 'scripts/no-such-deploy.sh')} does not exist`);
    expect(code).toBe(1);
  });

  test('says which docs in the plan directory are projects and why the others are not', () => {
    expect(check({}).out).toContain('plan docs: docs/plan/ does not exist yet');
    rmSync(join(dir, 'shop'), { recursive: true, force: true });
    const { code, out } = check({}, {
      'docs/plan/shop.md': '# Shop\n\n## Workstreams\n\n- [ ] **W1:** Cart.\n',
      'docs/plan/search.md': '# Search\n\n## Workstreams\n\n- [x] **W1:** Index.\n',
      'docs/plan/rollout.md': '# Rollout\n\n## Phases\n\n- [ ] Vienna\n',
    });
    expect(out).toContain('plan docs in docs/plan/: 2 are projects (search.md, done: archived; shop.md), 1 is not\n- rollout.md: no `## Workstreams` section');
    expect(code).toBe(0);
  });

  test('reports an adapter that names both a site and a share command', () => {
    const { code, out } = check({ site: SITE, share: ['git'] });
    expect(out).toContain('- demo: names both site and share; the site is used, so share goes');
    expect(code).toBe(1);
  });
});
