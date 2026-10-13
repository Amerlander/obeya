import { afterAll, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// gh.ts against a fake gh on PATH that logs each call with the token and repository it got, so
// nothing on GitHub is touched
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-test-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const bin = path.join(dir, 'bin');
fs.mkdirSync(bin);
const log = path.join(dir, 'gh.log');
fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
echo "[$GH_TOKEN] [$GH_REPO] $*" >> "${log}"
case "$1 $2" in
  "auth token") [ -n "$FAKE_NO_LOGIN" ] && { echo "no oauth token found for github.com account $4" >&2; exit 1; }; echo "token-of-$4";;
  "run rerun") cat; echo "rerun on stdout"; echo "rerun on stderr" >&2; exit 3;;
esac
`, { mode: 0o755 });

function gh(args: string[], env: Record<string, string> = {}) {
  fs.rmSync(log, { force: true });
  const r = Bun.spawnSync(['bun', path.join(import.meta.dirname, 'gh.ts'), ...args], {
    env: { ...process.env, GH_TOKEN: 'from-the-shell', GITHUB_TOKEN: 'also-from-the-shell', PATH: `${bin}${path.delimiter}${process.env.PATH}`, ...env },
    stdin: Buffer.from('from stdin\n'),
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString(), calls };
}

test.skipIf(process.platform === 'win32')('runs gh with the token of sadilek, not the one from the shell, on sadilek/obeya', () => {
  expect(gh(['workflow', 'run', 'build.yml', '--ref', 'main', '-f', 'sign=true'])).toEqual({
    code: 0,
    stdout: '',
    stderr: '',
    calls: [
      '[] [] auth token --user sadilek',
      '[token-of-sadilek] [sadilek/obeya] workflow run build.yml --ref main -f sign=true',
    ],
  });
});

test.skipIf(process.platform === 'win32')('passes stdin, stdout, stderr and the exit code through', () => {
  const r = gh(['run', 'rerun', '123', '--failed']);
  expect(r.code).toBe(3);
  expect(r.stdout).toBe('from stdin\nrerun on stdout\n');
  expect(r.stderr).toBe('rerun on stderr\n');
});

test.skipIf(process.platform === 'win32')('leaves a repository named in the args to gh, which prefers it to GH_REPO', () => {
  expect(gh(['run', 'list', '--repo', 'someone/else']).calls[1]).toBe('[token-of-sadilek] [sadilek/obeya] run list --repo someone/else');
});

test.skipIf(process.platform === 'win32')('without a gh login for sadilek it says how to get one and runs nothing', () => {
  const r = gh(['run', 'list'], { FAKE_NO_LOGIN: '1' });
  expect(r.code).toBe(1);
  expect(r.stderr).toStartWith('no gh login for sadilek: gh auth login, then try again\n');
  expect(r.calls).toEqual(['[] [] auth token --user sadilek']);
});
