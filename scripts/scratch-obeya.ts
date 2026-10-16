// A scratch Obeya for a demo or a live check, staged from one file: a fresh repository with plan
// docs, a fresh OBEYA_HOME, the server from this checkout (or from an earlier commit, for a before
// and after), and the cards in the states the demo needs. Running it again stages afresh, so a demo
// calls it before every take.
//
//   bun scripts/scratch-obeya.ts <stage.json> [--port <n>] [--code <commit> | --binary <obeya>] [--real-workers] [--restarts]
//   bun scripts/scratch-obeya.ts --stop <port>
//
// Prints one JSON line, also kept in <dir>/staged.json:
//   { "url", "port", "dir", "canvas", "pid", "log", "cards": { "<key>": "<card id>" } }
//
// The server runs with --dev (it does not restart when the checkout commits; with --restarts it is
// supervised like a real Obeya and restarts once the configuration is saved, PUT /api/config, and
// for commits on this checkout when it runs this checkout's code) and, unless
// --real-workers, with --idle-workers: a started card is in progress without an agent. The
// Koordinator and voice are real. --code <commit> runs that commit's code (`git archive`, with
// this checkout's node_modules) in <dir>/code; that starts cold and on a busy machine takes well
// over half a minute, so the script waits up to 5 minutes for the server while its process lives.
// --binary <obeya> runs a compiled Obeya instead (`bun run build`), with the resources beside it.
// Bun's dev server answers for the page's scripts and styles only under the name it listens on: a
// phone reaching the scratch Obeya through `tailscale serve` gets a blank page from one with --dev,
// so stage with --restarts for that. Stopping a scratch Obeya removes its `tailscale serve` entry.
//
// The stage file (JSON; every field but `cards` optional):
//   {
//     "name": "Shop", "canvases": ["Website"],
//     "port": 4480, "dir": "/tmp/obeya-scratch-4480", "clones": 2, "mainBranch": "master",
//     "poolCheckout": true, "slots": 3,
//     "hosts": [{ "name": "Workhorse", "ssh": "me@workhorse.local", "clones": 2, "slots": 2 }],
//     "files": { "src/cli.ts": "…" },
//     "plans": { "docs/plan/werkzeug.md": "# Werkzeug\n\n## Workstreams\n\n- [ ] **W1:** Konfiguration.\n" },
//     "cards": [
//       { "key": "A", "title": "…", "body": "…", "x": 40, "y": 300,
//         "state": "working", "statusLine": "Tests laufen", "createdAgo": "2h" },
//       { "key": "B", "title": "…", "queue": { "behind": ["A"], "reason": "Beide ändern src/cli.ts." },
//         "scope": ["src/cli.ts"] },
//       { "key": "C", "title": "…", "state": "waiting", "need": "demo", "summary": "…",
//         "demo": { "dir": "/abs/demo", "chapters": [[0, "Ausgangslage"]] } },
//       { "key": "H", "title": "…", "state": "waiting", "need": "demo", "summary": "…",
//         "demo": { "kind": "html", "dir": "/abs/artifact", "chapters": [] } },
//       { "key": "N", "title": "…", "state": "waiting", "need": "review", "summary": "…" },
//       { "key": "D", "title": "…", "state": "waiting", "need": "question", "question": { "text": "…", "options": ["Ja", "Nein"] } },
//       { "key": "E", "title": "…", "from": "C" },
//       { "key": "P", "project": "docs/plan/werkzeug.md", "x": 0, "y": 0 },
//       { "key": "W1", "workstream": "W1", "state": "working", "statusLine": "…" }
//     ],
//     "preferences": [
//       { "key": "R", "text": "Beschriftungen: präzise vor kurz." },
//       { "text": "…", "state": "proposed", "card": "A", "quote": "…", "replaces": "R" },
//       { "text": "…", "state": "proposed", "review": true },
//       { "text": "…", "state": "proposed", "target": "<repo id>" }
//     ],
//     "groups": [{ "name": "Abrechnung", "cards": ["A", "B", "P"] }],
//     "friction": [{ "card": "A", "what": "…", "cost": "…", "fix": "…", "ago": "1h" }],
//     "settingProposals": [{ "field": "run", "value": "bun run dev", "basis": "…", "cards": ["A", "B"] }],
//     "talk": [{ "said": "…", "reply": "…", "ago": "2h", "card": "A", "answer": "…" }]
//   }
// A card is created (x and y default to a free place; `idea`, `repo`, `from` as in
// POST /api/c/<canvas>/cards) unless it names a plan doc's `project` or `workstream` (label; with
// several plan docs "docs/plan/x.md#W1"), which exist already. Then its fields are written straight
// into the database:
// state, need, statusLine, summary, question, demo (`kind` defaults to video), queue (`behind` by key; `since` defaults to
// now), scope (files), branch, createdAgo, archivedAgo, events ([{ kind, author, text, ago?, mocks? }]; an idea's reply with `mocks` needs code that has them),
// workspace (true: the card holds the next free clone, for a repository whose settings say clones; with
// `branch` checked out there, holding a commit; for one that works in worktrees, `branch` is
// required and the card gets a worktree of its own on it), prototypeOf (the key of the idea it is a prototype of),
// and `row` for any other column of `cards` (objects are stored as JSON). Times: "90s", "15m", "2h",
// "3d" ago. `mainBranch` is the branch the repositories are on (default `main`). `"setup": true` serves no canvas (no configuration, no repository given): the first start,
// which shows the setup assistant; the repository is still made, for the assistant to pick, and
// `cards` may be empty. The repository has settings of its own where `files` hold `.obeya/settings.json` (a demo site among them, say). `poolCheckout` makes the repository's checkout a workspace of the pool too
// (`workspaces` in the configuration), as a pool of clones often has it, with a bare origin in
// <dir>; with it, the server
// starts from a configuration file in <dir>. `slots` caps the workers busy at once on this machine
// (an idle worker counts as busy). `hosts` are other machines over SSH (as in the configuration;
// `root` defaults to <dir>/far there): the repository gets a bare origin in <dir>, copied to each
// host at the same path, so that Obeya clones it there as it would a remote; staging afresh
// removes <dir> there first. A host with `"gone": true` held its clones once and does not answer
// now (an `ssh` target nobody resolves, say): nothing goes there, and its clones are registered as if
// Obeya had made them. `name` names the canvas the cards go on; `canvases` adds further ones by
// name, each over a repository of its own (<dir>/repo-2, …) and without cards. Preferences are active unless `state` says otherwise; `card` and `replaces` name keys;
// `target` is the repository whose CLAUDE.md a rule is for (the canvas id names the home one).
// What a learned rule's occasion is (card, quote, review), `replaces` and `target` need code that has them.
// Groups are created through the API with their cards (keys; a workstream stands for its project),
// in their colours by order. `talk` is the conversation with the Koordinator, oldest first (`card` a key;
// `question` and `answer`, `answerBy` for a question it looked up; `follows`: the index of the
// exchange whose answer it continues, in that one's thread; `files`: the answer's files, each with
// its name, caption and either `content` or a file to copy (`from`), written to the thread's output
// directory; needs code that has them). `friction` is what the Arbeitsrückschau noted on a card's
// runs (`card` a key), read by its next retrospective; `settingProposals` are values for a
// repository's settings it proposed (`field`: checks, setup, softPaths or run; `cards` keys;
// `repo` defaults to the canvas's home repository); both need code that has them.

import { Database } from 'bun:sqlite';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { CanvasSnapshot, Item } from '../src/core/types';
import { findTailscale, type ServeEntry, Tailscale } from '../src/server/tailscale';
import { answers, waitUp } from './wait-up';

interface StageCard {
  key?: string;
  title?: string;
  body?: string;
  x?: number;
  y?: number;
  idea?: boolean;
  repo?: string;
  from?: string;
  project?: string;
  workstream?: string;
  state?: string;
  need?: string | null;
  statusLine?: string;
  summary?: string;
  question?: { text: string; options?: string[]; multiple?: boolean };
  demo?: Record<string, unknown>;
  queue?: { behind?: string[]; reason?: string; since?: string; checking?: true };
  scope?: string[];
  branch?: string;
  workspace?: boolean;
  /** A prototype of the idea with this key. */
  prototypeOf?: string;
  createdAgo?: string;
  archivedAgo?: string;
  events?: { kind: string; author: string; text: string; ago?: string; mocks?: { title: string; html: string }[] }[];
  row?: Record<string, unknown>;
}

interface Stage {
  /** No canvas: Obeya's first start, with the setup assistant. */
  setup?: boolean;
  /** Names the canvas the cards go on. */
  name?: string;
  /** Further canvases by name, each over a repository of its own, without cards: to switch between canvases. */
  canvases?: string[];
  port?: number;
  dir?: string;
  /** The branch the repositories are on (default `main`). */
  mainBranch?: string;
  /** Clones for the workers, who then work in clones whatever the settings say: real workers need one each. */
  clones?: number;
  /** The repository's checkout is a workspace of the pool too. */
  poolCheckout?: boolean;
  /** Workers busy at once on this machine. */
  slots?: number;
  /** Other machines over SSH, as in the configuration. */
  hosts?: { name: string; ssh: string; root?: string; clones: number; slots?: number; gone?: boolean }[];
  files?: Record<string, string>;
  plans?: Record<string, string>;
  cards: StageCard[];
  preferences?: { key?: string; text: string; state?: string; card?: string; quote?: string; review?: boolean; replaces?: string; target?: string }[];
  groups?: { name: string; cards: string[] }[];
  friction?: { card: string; what: string; cost: string; fix: string; ago?: string; repo?: string }[];
  settingProposals?: { field: string; value: string | string[]; basis: string; cards: string[]; repo?: string }[];
  talk?: {
    said: string;
    reply: string;
    ago?: string;
    card?: string;
    question?: string;
    answer?: string;
    answerBy?: string;
    follows?: number;
    files?: { name: string; caption: string; content?: string; from?: string }[];
  }[];
}

const ROOT = resolve(import.meta.dir, '..');
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const fail = (msg: string): never => {
  console.error(`scratch-obeya: ${msg}`);
  process.exit(1);
};
const scratchDir = (port: number) => `/tmp/obeya-scratch-${port}`;

const stopPort = opt('stop');
if (stopPort) {
  stop(opt('dir') ?? scratchDir(Number(stopPort)));
  process.exit(0);
}

const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.match(/^--(port|code|dir|binary)$/));
if (!file) fail('usage: bun scripts/scratch-obeya.ts <stage.json> [--port <n>] [--code <commit> | --binary <obeya>] [--real-workers] [--restarts] | --stop <port>');
const stage = JSON.parse(readFileSync(file!, 'utf8')) as Stage;
const port = Number(opt('port') ?? stage.port ?? fail('no port: give "port" in the stage file or --port'));
const dir = resolve(opt('dir') ?? stage.dir ?? scratchDir(port));
const base = `http://127.0.0.1:${port}`;

stop(dir);
if (await answers(`${base}/api/canvases`)) fail(`port ${port} is taken by another process (lsof -i :${port})`);
rmSync(dir, { recursive: true, force: true });
const home = join(dir, 'home');
/** Where a host keeps the repository's clones. */
const rootOn = (h: { root?: string }) => h.root ?? `${dir}/far`;
const repo = join(dir, 'repo');
const mainBranch = stage.mainBranch ?? 'main';
mkdirSync(home, { recursive: true });

// the repository
const files = { ...(stage.files ?? {}), ...(stage.plans ?? {}) };
if (!Object.keys(files).length) files['README.md'] = '# Scratch\n';
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}
run('git', ['init', '-q', '-b', mainBranch], repo);
run('git', ['add', '-A'], repo);
run('git', ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.com', 'commit', '-qm', 'init'], repo);
// a workspace of the pool is a clone of the repository's origin, the checkout included
if (stage.poolCheckout || stage.hosts?.length) {
  run('git', ['clone', '-q', '--bare', repo, join(dir, 'scratch.git')], dir);
  run('git', ['remote', 'add', 'origin', join(dir, 'scratch.git')], repo);
  run('git', ['fetch', '-q', 'origin'], repo);
  run('git', ['branch', '-q', '-u', `origin/${mainBranch}`], repo);
}
// the repositories of the further canvases
const further = (stage.canvases ?? []).map((name, i) => {
  const path = join(dir, `repo-${i + 2}`);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'README.md'), `# ${name}\n`);
  run('git', ['init', '-q', '-b', mainBranch], path);
  run('git', ['add', '-A'], path);
  run('git', ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.com', 'commit', '-qm', 'init'], path);
  return { name, repos: [{ path }] };
});
// the origin at the same path on each host, which clones it from there
for (const h of stage.hosts ?? []) {
  if (h.gone) continue;
  const ssh = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', h.ssh];
  // through ssh rather than scp, which takes no ssh://user@host:port target
  const tar = spawnSync('tar', ['-C', dir, '-cf', '-', 'scratch.git'], { maxBuffer: 1 << 30 });
  const r = spawnSync('ssh', [...ssh, `rm -rf '${dir}' && mkdir -p '${dir}' && tar --no-same-owner -xf - -C '${dir}'`], { input: tar.stdout, encoding: 'utf8' });
  if (tar.status !== 0 || r.status !== 0) fail(`copying the origin to ${h.name}: ${r.stderr || tar.stderr}`);
}

// the code it runs
let code = ROOT;
const commit = opt('code');
if (commit) {
  code = join(dir, 'code');
  mkdirSync(code);
  const archive = spawnSync('git', ['-C', ROOT, 'archive', commit], { maxBuffer: 1 << 30 });
  if (archive.status !== 0) fail(`git archive ${commit}: ${archive.stderr}`);
  const tar = spawnSync('tar', ['-x', '-C', code], { input: archive.stdout });
  if (tar.status !== 0) fail(`tar: ${tar.stderr}`);
  symlinkSync(join(ROOT, 'node_modules'), join(code, 'node_modules'));
}
const binary = opt('binary') && resolve(opt('binary')!);
if (binary && !existsSync(binary)) fail(`${binary} does not exist`);
const idle = !args.includes('--real-workers');
const canIdle = !!binary || readFileSync(join(code, 'src/server/main.ts'), 'utf8').includes("'idle-workers'");
if (idle && !canIdle) console.error(`scratch-obeya: ${commit} has no --idle-workers; a started card gets a real agent`);

// the server, in its own process group so --stop ends it with everything it started
const log = join(dir, 'server.log');
const out = openSync(log, 'a');
// not supervised: a scratch Obeya restarts itself only when asked to
const supervised = args.includes('--restarts');
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'OBEYA_SUPERVISED')), OBEYA_HOME: home };
// a pool's workspaces live in the configuration, which the command line cannot give
const configFile = join(dir, 'canvases.json');
const configured = !!stage.poolCheckout || stage.slots !== undefined || !!stage.hosts?.length || !!stage.name || further.length > 0;
if (configured)
  writeFileSync(
    configFile,
    JSON.stringify(
      [
        {
          ...(stage.name ? { name: stage.name } : {}),
          repos: [
            {
              path: repo,
              ...(stage.clones ? { clones: stage.clones } : {}),
              ...(stage.poolCheckout ? { workspaces: [repo] } : {}),
              ...(stage.slots !== undefined ? { slots: stage.slots } : {}),
              ...(stage.hosts?.length ? { hosts: stage.hosts.map(({ gone: _, ...h }) => ({ ...h, root: rootOn(h) })) } : {}),
            },
          ],
        },
        ...further,
      ],
      null,
      2,
    ),
  );
const canvasArgs = stage.setup ? [] : configured ? ['--config', configFile] : [repo, ...(stage.clones ? ['--clones', String(stage.clones)] : [])];
const serverArgs = [...canvasArgs, '--port', String(port), ...(supervised ? [] : ['--dev']), ...(idle && canIdle ? ['--idle-workers'] : [])];
const server = spawn(binary ?? process.execPath, binary ? serverArgs : ['src/server/main.ts', ...serverArgs], {
  cwd: binary ? dir : code,
  env,
  detached: true,
  stdio: ['ignore', out, out],
});
server.unref();
writeFileSync(join(dir, 'server.pid'), String(server.pid));
let exited: number | null = null;
server.on('exit', (c) => (exited = c ?? -1));
const started = await waitUp(`${base}/api/canvases`, {
  exited: () => exited,
  limit: 5 * 60_000,
  slowAfter: 15_000,
  onSlow: () => console.error(`scratch-obeya: the server takes long to start${commit ? ' (code from git archive starts cold)' : ''}; waiting up to 5 min`),
});
if (!started.up) {
  if (started.exit === null) stop(dir);
  const after = `after ${Math.round(started.waited / 1000)} s`;
  fail(`the server did not come up ${started.exit !== null ? `(exit ${started.exit}) ${after}` : `${after}, so it was stopped`}; ${log}:\n${readFileSync(log, 'utf8').slice(-2000)}`);
}
if (stage.setup) {
  const staged = { url: `${base}/`, port, dir, repo, pid: server.pid, log, cards: {} };
  writeFileSync(join(dir, 'staged.json'), JSON.stringify(staged, null, 2));
  console.log(JSON.stringify(staged));
  process.exit(0);
}
const canvas = ((await (await fetch(`${base}/api/canvases`)).json()) as { id: string }[])[0]!.id;
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}/api/c/${canvas}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  if (!r.ok) fail(`${method} ${path} ${JSON.stringify(body)}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
};

// the cards: created through the API, the plan doc's looked up, then their fields written directly
const snapshot = (await api('GET', '/canvas')) as CanvasSnapshot;
const ids: Record<string, string> = {};
const below = Math.max(0, ...snapshot.items.map((x) => x.y)) + 400;
let placed = 0;
const idOf = (c: StageCard, i: number) => ids[c.key ?? String(i)]!;
for (const [i, c] of stage.cards.entries()) {
  let id: string | undefined;
  if (c.project) id = snapshot.items.find((x) => x.kind === 'project' && x.plan?.file === c.project)?.id;
  else if (c.workstream) {
    const [doc, label] = c.workstream.includes('#') ? c.workstream.split('#') : [undefined, c.workstream];
    const projects = new Set(snapshot.items.filter((x) => x.kind === 'project' && (!doc || x.plan?.file === doc)).map((x) => x.id));
    id = snapshot.items.find((x) => x.label === label && x.parent && projects.has(x.parent))?.id;
  } else {
    if (c.from && !ids[c.from]) fail(`card ${c.key ?? i}: "from" names ${c.from}, which comes later or does not exist`);
    // without a place: in rows of four below the plan docs (a follow-up goes below its card)
    const at = c.from || (c.x !== undefined && c.y !== undefined) ? {} : { x: 40 + 360 * (placed % 4), y: below + 220 * Math.floor(placed++ / 4) };
    const created = await api('POST', '/cards', {
      // code before cards lost their kind (--code) still asks for one; later code ignores it
      kind: 'feature',
      title: c.title ?? '',
      ...(c.body !== undefined ? { body: c.body } : {}),
      ...at,
      ...(c.x !== undefined ? { x: c.x } : {}),
      ...(c.y !== undefined ? { y: c.y } : {}),
      ...(c.idea ? { idea: true } : {}),
      ...(c.repo ? { repo: c.repo } : {}),
      ...(c.from ? { from: ids[c.from] } : {}),
    });
    id = created.id;
  }
  if (!id) fail(`card ${c.key ?? i}: no ${c.project ? `project for ${c.project}` : `workstream ${c.workstream}`} on the canvas`);
  ids[c.key ?? String(i)] = id!;
}

const db = new Database(join(home, 'obeya.db'), { strict: true });
db.run('PRAGMA busy_timeout = 10000');
for (const h of stage.hosts ?? [])
  for (let n = 1; h.gone && n <= h.clones; n++)
    db.query('INSERT INTO workspaces (path, canvas_id, repo) VALUES ($path, $c, NULL) ON CONFLICT(path) DO NOTHING').run({ path: `ssh://${h.name}${rootOn(h)}/${n}`, c: canvas });
const columns = new Set((db.query('PRAGMA table_info(cards)').all() as { name: string }[]).map((c) => c.name));
for (const [i, c] of stage.cards.entries()) {
  const id = idOf(c, i);
  const row: Record<string, unknown> = {};
  if ((c.project || c.workstream) && (c.x !== undefined || c.y !== undefined)) Object.assign(row, { x: c.x, y: c.y });
  if (c.state !== undefined) row.state = c.state;
  if (c.need !== undefined) row.need = c.need;
  if (c.statusLine !== undefined) row.status_line = c.statusLine;
  if (c.summary !== undefined) row.detail = { summary: c.summary };
  if (c.question !== undefined) row.detail = { question: { options: [], ...c.question } };
  if (c.demo !== undefined) row.demo = { kind: 'video', ...c.demo };
  if (c.queue !== undefined)
    row.queue = {
      ...c.queue,
      ...(c.queue.behind ? { behind: c.queue.behind.map((k) => ids[k] ?? fail(`card ${c.key ?? i}: queue names ${k}, which does not exist`)) } : {}),
      since: c.queue.since ?? new Date().toISOString(),
    };
  if (c.scope !== undefined) row.scope = { files: c.scope, reason: '' };
  if (c.branch !== undefined) row.branch = c.branch;
  if (c.workspace) {
    const free = db.query('SELECT path FROM workspaces WHERE card_id IS NULL ORDER BY path').get() as { path: string } | null;
    // no clones: the repository works in worktrees, one per card under Obeya's home
    const tree = !free && !!c.branch && !stage.clones;
    if (!free && !tree) fail(`card ${c.key ?? i}: no free clone for it ("clones" in the stage, settings that say clones), nor a branch for a worktree`);
    const path = tree ? join(home, 'workspaces', canvas, id.slice(0, 8)) : free!.path;
    if (tree) {
      mkdirSync(dirname(path), { recursive: true });
      run('git', ['worktree', 'add', '-q', '-b', c.branch!, path, mainBranch], repo);
      db.query('INSERT INTO workspaces (path, canvas_id, card_id) VALUES ($path, $c, $id)').run({ path, c: canvas, id });
    } else {
      db.query('UPDATE workspaces SET card_id = $id WHERE path = $path').run({ id, path });
      if (c.branch) run('git', ['checkout', '-q', '-b', c.branch], path);
    }
    row.workspace = path;
    if (c.branch) {
      writeFileSync(join(path, 'scratch.txt'), `${c.title ?? c.branch}\n`);
      run('git', ['add', '-A'], path);
      run('git', ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.com', 'commit', '-qm', c.title ?? c.branch], path);
    }
  }
  if (c.prototypeOf !== undefined) row.prototype_of = ids[c.prototypeOf] ?? fail(`card ${c.key ?? i}: prototypeOf names ${c.prototypeOf}, which does not exist`);
  if (c.createdAgo !== undefined) row.created_at = ago(c.createdAgo);
  if (c.archivedAgo !== undefined) row.archived_at = ago(c.archivedAgo);
  Object.assign(row, c.row ?? {});
  const keys = Object.keys(row).filter((k) => row[k] !== undefined);
  const missing = keys.filter((k) => !columns.has(k));
  if (missing.length) fail(`card ${c.key ?? i}: this code's database has no column ${missing.join(', ')}`);
  if (keys.length)
    db.query(`UPDATE cards SET ${keys.map((k) => `${k} = $${k}`).join(', ')} WHERE id = $id`).run({
      id,
      ...Object.fromEntries(keys.map((k) => [k, typeof row[k] === 'object' && row[k] !== null ? JSON.stringify(row[k]) : (row[k] as string | number | null)])),
    } as Record<string, string | number | null>);
  for (const e of c.events ?? [])
    // only code that has mocks has their column
    db.query(`INSERT INTO events (card_id, at, kind, author, text${e.mocks ? ', mocks' : ''}) VALUES ($c, $at, $kind, $author, $text${e.mocks ? ', $mocks' : ''})`).run({
      c: id,
      at: ago(e.ago ?? '0s'),
      kind: e.kind,
      author: e.author,
      text: e.text,
      ...(e.mocks ? { mocks: JSON.stringify(e.mocks) } : {}),
    });
}
const prefIds: Record<string, number> = {};
for (const [i, p] of (stage.preferences ?? []).entries()) {
  const row: Record<string, string | number | null> = {
    canvas_id: canvas,
    text: p.text,
    created_at: new Date().toISOString(),
    card_id: p.card ? (ids[p.card] ?? fail(`preference ${p.key ?? i}: card ${p.card} does not exist`)) : null,
  };
  if (p.state !== undefined) row.state = p.state;
  if (p.quote !== undefined) row.quote = p.quote;
  if (p.review) row.review = 1;
  if (p.target !== undefined) row.target = p.target;
  if (p.replaces !== undefined) row.replaces = prefIds[p.replaces] ?? fail(`preference ${p.key ?? i}: replaces ${p.replaces}, which comes later or does not exist`);
  const keys = Object.keys(row);
  const r = db.query(`INSERT INTO preferences (${keys.join(', ')}) VALUES (${keys.map((k) => `$${k}`).join(', ')}) RETURNING id`).get(row) as { id: number };
  if (p.key) prefIds[p.key] = r.id;
}
const talkIds: number[] = [];
const threadOf = new Map<number, number>();
for (const [i, x] of (stage.talk ?? []).entries()) {
  const row: Record<string, string | number | null> = {
    canvas_id: canvas,
    at: ago(x.ago ?? '0s'),
    said: x.said,
    reply: x.reply,
    card_id: x.card ? (ids[x.card] ?? fail(`talk ${i}: card ${x.card} does not exist`)) : null,
    question: x.question ?? null,
    answer: x.answer ?? null,
    answer_by: x.answerBy ?? null,
  };
  if (x.follows !== undefined) {
    const followed = talkIds[x.follows] ?? fail(`talk ${i}: follows ${x.follows}, which comes later or does not exist`);
    row.follows = followed;
    row.thread = threadOf.get(followed) ?? followed;
  }
  if (x.files?.length) row.files = JSON.stringify(x.files.map((f) => ({ name: f.name, caption: f.caption })));
  const keys = Object.keys(row);
  const { id } = db.query(`INSERT INTO talk (${keys.join(', ')}) VALUES (${keys.map((k) => `$${k}`).join(', ')}) RETURNING id`).get(row) as { id: number };
  talkIds.push(id);
  const thread = typeof row.thread === 'number' ? row.thread : id;
  threadOf.set(id, thread);
  for (const f of x.files ?? []) {
    const to = join(home, 'answers', canvas, String(thread), f.name);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, f.from ? readFileSync(f.from) : (f.content ?? ''));
  }
}
const homeRepo = () => (db.query(`SELECT value FROM settings WHERE canvas_id = $c AND key = 'home_repo'`).get({ c: canvas }) as { value: string } | null)?.value ?? canvas;
for (const [i, f] of (stage.friction ?? []).entries())
  db.query('INSERT INTO friction (canvas_id, repo, card_id, at, what, cost, fix) VALUES ($c, $repo, $card, $at, $what, $cost, $fix)').run({
    c: canvas,
    repo: f.repo ?? homeRepo(),
    card: ids[f.card] ?? fail(`friction ${i}: card ${f.card} does not exist`),
    at: ago(f.ago ?? '0s'),
    what: f.what,
    cost: f.cost,
    fix: f.fix,
  });
for (const [i, p] of (stage.settingProposals ?? []).entries())
  db.query('INSERT INTO setting_proposals (canvas_id, repo, field, value, basis, cards, created_at) VALUES ($c, $repo, $field, $value, $basis, $cards, $at)').run({
    c: canvas,
    repo: p.repo ?? homeRepo(),
    field: p.field,
    value: JSON.stringify(p.value),
    basis: p.basis,
    cards: JSON.stringify(p.cards.map((k) => ids[k] ?? fail(`setting proposal ${i}: card ${k} does not exist`))),
    at: new Date().toISOString(),
  });
db.close();
// the server keeps a snapshot of the canvas: a change through the API makes it read the database anew
const first = stage.cards.find((c) => !c.project && !c.workstream);
if (first) {
  const c = ((await api('GET', '/canvas')) as CanvasSnapshot).items.find((x: Item) => x.id === idOf(first, stage.cards.indexOf(first)))!;
  await api('PATCH', `/cards/${c.id}`, { x: c.x, y: c.y });
}

for (const g of stage.groups ?? [])
  await api('POST', '/groups', { name: g.name, cards: g.cards.map((k) => ids[k] ?? fail(`group ${g.name}: card ${k} does not exist`)) });

const staged = { url: `${base}/?c=${canvas}`, port, dir, canvas, pid: server.pid, log, cards: ids };
writeFileSync(join(dir, 'staged.json'), JSON.stringify(staged, null, 2));
console.log(JSON.stringify(staged));
process.exit(0);

function run(cmd: string, a: string[], cwd: string) {
  const r = spawnSync(cmd, a, { cwd, encoding: 'utf8' });
  if (r.status !== 0) fail(`${cmd} ${a.join(' ')}: ${r.stderr}`);
}

/** Ends the scratch Obeya that `dir` belongs to, and what it started, if it still runs. */
function stop(d: string) {
  stopServer(d);
  // one that was killed left its `tailscale serve` entry, which would serve whatever takes the port next
  const served = join(d, 'home', 'tailscale-serve.json');
  if (existsSync(served)) {
    const tailscale = findTailscale();
    const entry = JSON.parse(readFileSync(served, 'utf8')) as ServeEntry & { name: string };
    if (tailscale) new Tailscale(tailscale).unserveSync(entry.name, entry);
    rmSync(served, { force: true });
  }
}

function stopServer(d: string) {
  const pidFile = join(d, 'server.pid');
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, 'utf8'));
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return;
  }
  for (let i = 0; i < 40; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    // Obeya waits for workers in the middle of a turn (an idle worker always is); a second signal ends it at once
    if (i === 15)
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {}
    Bun.sleepSync(100);
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {}
}

function ago(s: string): string {
  const m = /^(\d+(?:\.\d+)?)([smhd])$/.exec(s) ?? fail(`"${s}" is no time ago (like "15m", "2h", "3d")`);
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return new Date(Date.now() - Number(m[1]) * unit * 1000).toISOString();
}
