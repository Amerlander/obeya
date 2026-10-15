# Setting up a repository: its adapter

Obeya runs on any git repository as it is. What it cannot know by itself is how *this* project
works: how its app starts, which checks a change must pass, how approved work lands, how a worker
records a demo. A repository says that in its adapter, versioned with the code it describes (like
`.vscode/` or `.claude/`): the values in `.obeya/settings.json`, which "Konfiguration" shows and
changes without a line of code, and what is code (how the stack starts, a share script, the
canvas's name) in a small TypeScript module at `.obeya/adapter/index.ts`. A repository that needs
no code has no module.

The quickest way to get one: in "Konfiguration", a repository that runs on the generic adapter has
„Von einem Agenten ausfüllen lassen“ ("Have an agent fill them in"). It puts a card on the repository's
canvas whose worker writes the adapter with the `obeya:adapter` skill: it reads the repository,
starts the app, records a demo with it to prove the recipe, and asks you what it cannot find out
(a login, test data). The values you set for a repository in "Konfiguration" go into
`.obeya/settings.json` with "Für alle ins Repository übernehmen" (see below). This page is the
reference for what they write, and for writing or changing either yourself.

## A complete example

A typical web app: a Node API and a Vite frontend, PostgreSQL in Docker Compose, tests and lint
in `package.json`, work landing through pull requests on GitHub.

`.obeya/settings.json`:

```json
{
  "land": "pr",
  "direct": false,
  "checks": ["pnpm lint", "pnpm typecheck", "pnpm test"],
  "setup": "pnpm install",
  "planDocs": { "dir": "docs/plan", "exclude": ["TEMPLATE.md"] },
  "softPaths": ["docs/"],
  "workspaces": "clones",
  "prNoise": ["vercel[bot]", "codecov[bot]"],
  "demo": {
    "howToRun": "Start the stack in your clone: `docker compose up -d db`, then `pnpm db:migrate && pnpm db:seed`, then `pnpm dev` in the background. The frontend runs on the port in `.dev-urls` (WEB_URL), the API on API_URL. Log in as demo@shop.test with the password `demo` (created by the seed); the seed also makes three orders to show. Stop the stack with `docker compose down` and the dev server by its PID when the demo is rendered."
  }
}
```

`.obeya/adapter/index.ts`:

```ts
export default (kit) => ({
  name: 'shop',
  canvasId: () => 'shop',
  canvasName: () => 'Shop',

  stack: {
    start: 'docker compose up -d db && pnpm dev',
    refresh: 'pnpm --filter api restart',
    urls: { file: '.dev-urls', frontendKey: 'WEB_URL' },
    stop: 'docker compose down && pkill -F .dev.pid',
  },

  demo: {
    share: ['bun', `${import.meta.dir}/share.ts`],
  },
});
```

The module's default export is the adapter, or (as here) a function that gets Obeya's helpers
(`kit`) and returns it. The module imports nothing of Obeya's: it lives in your repository, not in
Obeya's, so Obeya hands it what it may need. Files next to `index.ts` in `.obeya/adapter/` come
along (a share script, say), and `import.meta.dir` finds them.

Everything but the module's `name` is optional. What both leave out comes from the generic
adapter, whose values are given with each field below (`land` is the one Obeya tells from the
repository). The fields that are values (`planDocs`, `setup`, `checks`, `land`, `direct`,
`softPaths`, `workspaces`, `prNoise`, and the demo's `howToRun`) belong in
`.obeya/settings.json`; the module may still give them, but the file goes before it. The others
(`name`, `canvasId`, `canvasName`, `stack`, `demo.site`, `demo.share`) are the module's alone.

## The fields

### `name` (required)

A name for the adapter, shown in "Konfiguration" and Obeya's log. Usually the project's.

### `canvasId`, `canvasName` — functions of the repository

`(repo) => string`, where `repo` is `{ path, remote, branch }` (`remote` is the `origin` URL or
`null`). The id is the canvas's address (`?c=shop`) and the key its cards are stored under; the
name is its title. Clones of one repository share a canvas, so neither may depend on `path`.
Generic: the repository's name from its `origin` URL, else its directory's (`kit.repoName(repo)`).
A canvas named in the configuration keeps that name and id; these only fill in what it leaves out.

### `planDocs` — `{ dir, exclude }`

Where plan docs live (relative to the repository root), and file names in that directory that are
none (a template). Obeya reads the `*.md` directly in that directory (not below it) from the
default branch. One with a checklist under `## Workstreams` (or `## Arbeitspakete`) is a project:
each top-level item is a workstream (`- [ ] **W1:** Title. Details`), a ticked one has landed,
and once every one is ticked the project goes into the archive. Its goal is the first paragraph
under `## Goal` (or `## Ziel`). Any other file there shows on the canvas in a note, with the
reason it is not a project and "Als Projekt aufbereiten", which has an agent add the checklist; a
file that is meant to stay as it is (a template, an index) goes into `exclude`. Generic:
`{ dir: 'docs/plan', exclude: ['TEMPLATE.md'] }`. The skill's check script
(`plugin/skills/adapter/lib/check.ts`) lists which docs in the directory are projects and why the
others are not.

### `setup` — a command

What a worker runs first in a fresh workspace, typically installing dependencies. Generic: none.

### `checks` — commands

What a worker runs before it hands its work over (lint, types, tests). Each must pass; the worker
fixes what fails. Keep them to what runs in minutes on one machine, without services the clone
does not have. Generic: none.

### `land` — `'pr'` or `'main'`

How approved work lands. `pr`: the card's branch is pushed and goes out as a pull request; Obeya
watches it, brings review comments and failing CI back to the worker and marks the card live once
it is merged (this needs the GitHub CLI, `gh`, logged in). `main`: Obeya rebases the branch onto
the local `main` and fast-forwards the checkout Obeya runs on, no pull request, nothing pushed.
Generic: `pr` where `origin` is on GitHub (github.com, or a host the GitHub CLI is logged into),
else `main`, since a pull request needs somewhere to go.

### `direct` — boolean

With `land: 'pr'`: the owner may approve a card "Direkt auf main" instead, without a pull request.
Obeya rebases onto `origin`'s default branch and pushes there (never forced); a protected branch
refuses it and the card stays in review. Generic: `false`.

### `softPaths` — paths

Paths whose edits never count as a conflict between two cards' branches (a trailing `/` covers a
directory): Obeya resolves them itself when it rebases. Use it for docs that many cards touch.
Generic: `['docs/plan/']`.

### `workspaces` — `'clones'` or `'worktrees'`

Where workers work. `clones`: a pool of full clones per canvas, leased by one card at a time; the
number comes from "Konfiguration" (clones to create, or existing ones to use). Use it when every
workspace runs its own app stack (ports, a database, Docker) or the tools break in a git worktree.
`worktrees`: a git worktree of the configured checkout per card, as many in parallel as there are
cards. Generic: `worktrees`. A repository whose configuration names clones (clones to create,
existing ones, or other machines) works in clones whatever the adapter says.

### `prNoise` — account names

Accounts whose pull request comments are not review feedback (deploy previews, coverage bots):
their comments do not go to the worker. Generic: none.

### `stack` — `{ start, refresh, urls: { file, frontendKey }, stop?, keep? }`

How a worker brings the app up in its workspace: `start` starts it all, `refresh` picks up a
backend change without starting everything again, and once it runs, the `KEY=value` file `file`
holds the frontend's URL under `frontendKey`. Every worker's brief says so. Generic: none.

- `stop`: stops the stack in a workspace, and does nothing where none runs. With it, Obeya parks a
  card that waits for the owner (handed over, asked, its pull request open) once its worker has
  nothing running and five minutes have passed: it runs `stop` in the workspace (through `sh -c`,
  `cmd /c` on Windows), so a waiting card costs disk, not memory. The worker's next message tells
  it the stack was stopped; it starts it again with `start` when it needs it. A stop that fails is
  an error on the card.
- `keep`: run before `stop`; exiting 0 means the stack holds what must not be lost (a restored
  database, say), and Obeya leaves it running and says so on the card. The owner who wants it
  stopped anyway tells the worker.

### `demo` — `{ howToRun, site?, share? }`

Demos: every handover brings one, a narrated video recorded with Obeya's demo skill or an HTML
page for something to look at; the worker picks which. Generic: `{ howToRun: '' }`. A `required`
from before 2026-10-15, when a repository could leave demos to the worker, is no longer read.

- `howToRun`: the recipe for running the app for a recording, written for the worker, in a few
  sentences: what to start and how (or "the stack above"), migrations and test data, how to log in
  and as whom, which URL, and what to stop afterwards. Everything a newcomer to the project would
  have to ask about. The worker gets it in its brief word for word; `bun lib/recipe.ts` of the demo
  skill prints it. Without one, each worker finds out from the repository how to run the app.
- `site`: a static site Obeya keeps and deploys itself, for a host that takes a directory
  (Cloudflare Pages, Netlify, an S3 bucket, a directory a web server serves):

  ```ts
  site: {
    title: 'Team demos',                    // the overview's heading, the pages' tab titles
    url: 'https://demos.example.dev',       // a page is at url/<slug>/
    deploy: ['bunx', 'wrangler@4', 'pages', 'deploy', '{dir}', '--project-name', 'demos', '--branch', 'main', '--commit-dirty=true'],
    env: 'sites/demos/deploy.env',          // optional: KEY=value lines, relative to Obeya's home
    headers: { 'CF-Access-Client-Id': '${CF_ID}', 'CF-Access-Client-Secret': '${CF_SECRET}' },
                                            // optional: for reading the live site behind a login, ${KEY} from env
    maxFile: 25 * 1024 * 1024,              // optional: the largest file the host takes (25 MiB without it)
    language: 'en',                         // optional: the overview's words (else the demo settings' language)
  },
  ```

  Obeya keeps the site in `sites/<host and path of url>/site/` under its home, writes each page
  (in its demo's language) and the overview with its own templates, and after each share or
  withdrawal runs `deploy` with `{dir}` replaced by that directory and the `env` file's values in
  its environment. Credentials go into the `env` file on each publishing machine, never into git;
  a machine without it exports demos instead, and "Teilen" names the file it lacks. Without
  `env`, the deploy uses the machine's own login.

  Several machines may publish to one site. Before each change Obeya reads the live site's
  manifest (`obeya-site.json`), takes over the pages other machines published or withdrew, and
  only then deploys; a manifest it cannot read (a login without `headers`, the host down) refuses
  the deploy, since deploying blind could take other machines' pages offline. Pages shared from
  here that a later deploy from elsewhere took offline are deployed again. `site` goes before `share`; an adapter naming
  both is a problem at the repository.
- `share`: the command (argv) that publishes a demo for colleagues on a page outside Obeya. Obeya
  runs it in a directory under its home with `OBEYA_HOME`, `OBEYA_REPO` (the repository's
  checkout) and `OBEYA_KIT` (the module with Obeya's page templates) set: `publish` with the page as
  JSON on stdin (`SharePage` in `src/server/share.ts`) prints the page's URL; `withdraw <slug>`
  takes it down; `version` may print the version of the pages it writes. Its program must exist
  (an absolute path, or one on the PATH). For hosts that need more than deploying a directory;
  where they do not, `site` does it all. A share command in "Konfiguration" takes the place of
  both. Without any, "Teilen" exports a demo as a file.

Generic: none.

### `matches` — a function of the repository

Only for Obeya's built-in adapters, which are picked by it (`(repo) => boolean`). A repository's
own adapter is picked because it is there; this field changes nothing.

## `.obeya/settings.json`: the values, for everyone

A JSON object with the fields that are values, each as described above (`demo` holds `howToRun`
only). Every machine that runs Obeya on the repository reads it, a fresh clone
included. Which value applies, highest first:

1. The one set for this machine in "Konfiguration" (a repository's „Einstellungen“; kept in
   `canvases.json` in Obeya's home, never in the repository).
2. `.obeya/settings.json` **as the default branch has it**.
3. The module's (`.obeya/adapter/index.ts`), or the adapter "Konfiguration" names.
4. What Obeya detects (`land`, the main branch).
5. The generic adapter's.

"Konfiguration" shows each value with where it comes from („aus dem Repository“ for the file).
Like the module, the file is read from the default branch, not from the checkout, so a change
counts once it is on the default branch: then it applies without a restart (Obeya reads it again
whenever it reads the default branch anew: a landing, a merged pull request, a fetch). The one
exception is `workspaces`: clones or worktrees are set up when Obeya starts, so a change to it
restarts Obeya, as a changed module does.

The main branch is not in the file, since it says where the file is read from: a fresh clone has
it from `origin`'s HEAD, and a machine that needs another sets it in "Konfiguration".

**From "Konfiguration".** Below a repository's „Einstellungen“, „Für alle ins Repository
übernehmen“ takes the values set for this machine (all but the main branch) into the file. It
shows the file as it will be and where it goes; where work lands on the main branch, Obeya commits
it there (beside the checkout, which keeps everything else as it is; a change of its own to the
file is refused), and the values then come from the repository on this machine too. Where work
goes out as pull requests, Obeya pushes the commit to a branch of its own (`obeya-settings-…`) and
opens a pull request against the main branch; this machine keeps its values until the pull
request is merged, then they come from the repository. Where work may also go straight to main
(`direct`), it offers to push the commit straight onto `origin`'s main branch instead (never
forced; a protected branch refuses it). What the file holds beside them stays.

A field that is unknown or of the wrong type does not count, the rest does, as in the module (see
Mistakes): each shows as a problem at the repository in "Konfiguration", starting with
`.obeya/settings.json`.

## How Obeya picks a repository's adapter

In this order:

1. The one "Konfiguration" names for the repository (`adapter` in `canvases.json`): a built-in
   one's name (`generic`), or the path of a module, relative to the repository.
2. The repository's own, `.obeya/adapter/index.ts`, **as the default branch has it**.
3. The first built-in one that matches; for any repository but Obeya's own, `generic`.

The values of `.obeya/settings.json` go before whichever of these it is (see above).

Obeya reads the repository's own adapter from the default branch (the local one when it has all
of `origin`'s commits, else `origin`'s as last fetched), not from the checkout: the clones a canvas
works in are on cards' branches most of the time, and one from before the adapter changed would
have another one, or none. So **an adapter committed on a branch does nothing yet**; it counts
once it is merged. Its files are copied per version into the repository's git directory
(`.git/obeya/adapter-<tree>/`), out of reach of checkouts and `git clean`.

**A change takes effect once it is on the default branch:** when a merged pull request or a card's
landing brings a new adapter, or a change to it, to the default branch Obeya reads, Obeya restarts
by itself, as for a configuration saved in "Konfiguration": once no agent is in the middle of a
step, and the page reloads. Commits that leave `.obeya/adapter/` as it is restart nothing (a
change to `.obeya/settings.json` applies without a restart, but for `workspaces`). Where
the configuration names an adapter, the repository's own is not read, and a change to it restarts
nothing either. Obeya started by hand without its supervisor (`--dev`) cannot restart itself: its
log says so, and the change takes effect at the next start.

## Mistakes

When Obeya loads an adapter, it checks every field. A field it does not know (`check:` for
`checks:`), of the wrong type (`checks: 'pnpm test'` instead of a list), or incomplete (a `demo`
without `howToRun`) does not count: the generic adapter's value stands in its place, and the rest
of the adapter works. Each one shows as a problem at the repository in "Konfiguration", with the
field and, for a misspelt one, what it probably meant:

> Ein Feld im Adapter des Repositorys gilt nicht, an seiner Stelle steht das des allgemeinen
> Adapters:

with `check: no such field (did you mean checks?)` under "Details".

A share command whose program is not there shows the same way. These problems keep nothing from
being saved, since they are fixed in the repository. Obeya's log names them when it starts. An
adapter that does not load at all (a syntax error, a failing import, no default export with a
`name`) is worse: the whole adapter does not count, and the repository runs on the generic adapter
until a fixed one reaches the default branch (its canvas keeps its id and name). It shows at the
repository as

> Der Adapter des Repositorys lädt nicht; bis er repariert ist, läuft das Repository mit dem
> allgemeinen Adapter:

with the error (`adapter module … does not load: …`) under "Details", and Obeya's log names it at
start. "Aufgabe zum Beheben anlegen" beside a problem has Obeya create a task that fixes it. Run the check below before merging.

## Testing an adapter

1. **It loads and every field counts.** In the repository, with the module and the settings in the
   checkout (committed or not), run the adapter skill's check from an Obeya checkout:

   ```bash
   bun ~/dev/obeya/plugin/skills/adapter/lib/check.ts
   ```

   It prints what Obeya makes of both (canvas, setup, checks, landing, workspaces, the demo
   recipe, the site demos are shared on) and every problem "Konfiguration" would report for it (a
   field that is unknown or of the wrong type, a share or deploy program that is not there, both
   `demo.site` and `demo.share`), and exits with 1 when there is one. A worker runs it as
   `bun ${CLAUDE_SKILL_DIR}/lib/check.ts`.
2. **The commands work.** Run `setup` and each of `checks` in a fresh clone; start the stack as
   `stack` and `howToRun` say, and open the frontend.
3. **A demo comes out of `howToRun`.** Record one with the demo skill, following the recipe and
   nothing else. This is what the setup skill does before it hands over.
4. **Before it is merged, on a canvas.** Name the module in the checkout as the repository's
   adapter: `"adapter": ".obeya/adapter/index.ts"` (relative to the repository) in
   `canvases.json`, or tell Obeya. Once Obeya restarts with it, a card started gets its
   brief from it. Remove the entry again once the adapter is merged, so the default branch's
   version counts.
