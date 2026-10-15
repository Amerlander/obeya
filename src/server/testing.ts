// Test doubles, and git repositories for tests.

import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generic } from '../adapters/generic';
import type { RepoAdapter } from '../adapters/types';
import type { Forge } from './forge';
import type { AgentEvent, AgentRuntime, AgentSession, AgentSpec, PermissionAnswer } from './runtime';
import { git } from './workspaces';

/** A forge for tests that never reach a pull request. */
export const noForge: Forge = { status: () => ({}) as never, body: () => '', setBody: () => {}, merge: () => {}, open: () => '' };

/** A session whose tools and events the test drives. */
export class FakeSession implements AgentSession {
  inbox: string[] = [];
  /** The images sent with each message of `inbox`, by index. */
  images: string[][] = [];
  closed = false;
  done: Promise<void>;
  private finish!: () => void;
  constructor(
    readonly spec: AgentSpec,
    first?: string,
    images: string[] = [],
  ) {
    if (first !== undefined) this.send(first, images);
    this.done = new Promise((r) => (this.finish = r));
  }
  send(text: string, images: string[] = []) {
    this.inbox.push(text);
    this.images.push(images);
  }
  close() {
    this.closed = true;
    this.abort.abort();
    this.finish();
  }
  private abort = new AbortController();
  /** A tool call that needs a person's permission: settles with the answer the session got. */
  permission(name: string, input: Record<string, unknown>, reason?: string): Promise<PermissionAnswer> {
    return this.spec.askOwner!({ name, input, ...(reason ? { reason } : {}) }, this.abort.signal);
  }
  call(name: string, args: Record<string, unknown>) {
    return this.spec.tools.find((t) => t.name === name)!.run(args);
  }
  /** A tool step of the agent: what the session hands it with the step's result. */
  toolStep(): string | undefined {
    return this.spec.contextUpdate?.();
  }
  emit(e: AgentEvent) {
    this.spec.onEvent(e);
  }
}

export class FakeRuntime implements AgentRuntime {
  sessions: FakeSession[] = [];
  start(spec: AgentSpec, first?: string, images?: string[]) {
    const s = new FakeSession(spec, first, images);
    this.sessions.push(s);
    return s;
  }
  get last() {
    return this.sessions.at(-1)!;
  }
}

const templates = new Map<string, string>();
let templateDir: string | undefined;

/**
 * Makes `path` a git repository on `main` with `files` committed as "init", in which tests can
 * commit. Spawning git is what makes the tests slow, so each set of files is committed once into
 * a template, and the repository is a copy of it.
 */
export function gitRepo(path: string, files: Record<string, string> = { 'README.md': 'hello\n' }): string {
  const key = JSON.stringify(files);
  let template = templates.get(key);
  if (!template) {
    templateDir ??= mkdtempSync(join(tmpdir(), 'obeya-template-'));
    template = join(templateDir, String(templates.size));
    git(templateDir, 'init', '--quiet', '--template=', '-b', 'main', template);
    identify(template);
    // a copy keeps mtime and size but not inode and ctime: git is to trust what the copy keeps
    appendFileSync(join(template, '.git/config'), '[core]\n\tcheckStat = minimal\n\ttrustctime = false\n');
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(template, file)), { recursive: true });
      writeFileSync(join(template, file), text);
    }
    git(template, 'add', '.');
    git(template, 'commit', '--quiet', '-m', 'init');
    templates.set(key, template);
  }
  cpSync(template, path, { recursive: true, preserveTimestamps: true });
  return path;
}

let prAdapterFile: string | undefined;

/**
 * An adapter module that lands work through pull requests, for a repository whose `origin` stands
 * in for one on GitHub: a path, which would make it land on its main branch by detection.
 */
export function prAdapter(): string {
  if (prAdapterFile && existsSync(prAdapterFile)) return prAdapterFile;
  templateDir ??= mkdtempSync(join(tmpdir(), 'obeya-template-'));
  prAdapterFile = join(templateDir, 'pr-adapter.ts');
  writeFileSync(prAdapterFile, "export default { name: 'pr', land: 'pr' };\n");
  return prAdapterFile;
}

/** Removes the templates of `gitRepo`; test-setup.ts calls it once all tests have run. */
export function removeTemplates() {
  if (templateDir) rmSync(templateDir, { recursive: true, force: true });
  templateDir = undefined;
  templates.clear();
}

/** Lets tests commit in `repo`, a repository or a clone of one, as T. */
export function identify(repo: string) {
  appendFileSync(join(repo, '.git/config'), '[user]\n\temail = t@example.com\n\tname = T\n');
}

/**
 * Waits until `done` holds. A request reaches the server only after a round trip, which on a
 * loaded machine (other workers' test runs) takes longer than any fixed pause; a test that went
 * on too early failed and left its request open, and stopping the server reset it in the next test.
 */
export const until = async (done: () => unknown, ms = 3000) => {
  for (const end = Date.now() + ms; !(await done()); await Bun.sleep(2)) if (Date.now() > end) throw new Error(`timed out after ${ms} ms: ${done}`);
};

/**
 * A stand-in for `ssh` that runs the command on this machine, as a host's login shell would; the
 * host counts as unreachable (exit 255, as ssh's own) while `<dir>/down` exists. Its home is
 * `<dir>/home`. Each command it ran is appended to `<dir>/log`, with the target first; each
 * connection it tried, reachable or not, adds a line to `<dir>/tries`.
 */
export function fakeSsh(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const program = join(dir, 'ssh');
  writeFileSync(
    program,
    `#!/bin/sh
while [ $# -gt 1 ]; do
  case "$1" in -o|-R) shift 2 ;; -T|-n) shift ;; *) break ;; esac
done
target="$1"; shift
echo x >> ${JSON.stringify(join(dir, 'tries'))}
[ -e ${JSON.stringify(join(dir, 'down'))} ] && { echo "ssh: connect to host $target: Connection refused" >&2; exit 255; }
printf '%s %s\\n' "$target" "$*" >> ${JSON.stringify(join(dir, 'log'))}
HOME=${JSON.stringify(join(dir, 'home'))}; export HOME; mkdir -p "$HOME"
exec sh -c "$*"
`,
    { mode: 0o755 },
  );
  return program;
}

/** The generic adapter of a repository whose settings leave demos to the worker: a handover may be a summary alone. */
export const noDemos: RepoAdapter = { ...generic, demo: { required: false, howToRun: '' } };
