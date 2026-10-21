## Repositories and configuration

A chapter of the [design doc](../design.md), whose header says how it is written.

### Canvases and repositories

Each repository on a canvas has its settings, workspaces, workers, project agents and PR watcher; the
canvas has one board and one Koordinator, whose collision checks stay within a repository. The first
repository is the canvas's home: its plan references and workspace directory are the ones a
single-repository canvas always had, so canvases keep their data. The others' plan docs are
referenced as `<repo>:<path>`; the owner's cards carry their repository, chosen in the panel before
work begins (home by default), and a proposal inherits it. The UI opens `?c=<canvas>`, the pill
after the logo switches, and on a canvas with several repositories every card names its own. Cards
on other canvases that need the owner show as a count at their entry in the switcher and, while it
is closed, as the sum on the pill; the server pushes every canvas's count to all of them when one
changes.

### Main branch

`defaultBranch` in `src/server/workspaces.ts` gives where cards start from, work lands and plan docs
and the repository's settings are read from; one function for all of them, the canvas's label and
the first setup. It is the one the owner set for the repository on this machine (`branch` in its settings, see
Repository settings), read whenever it is asked for; a clone's comes from the same setting. The
repository's `.obeya/settings.json` does not hold it, since it says where that file is read from.

Without one it is detected (`detectedBranch`):

1. `origin`'s HEAD where the checkout knows one;
2. else (a repository only on this machine, or a remote added without `origin/HEAD`) the
   repository's only branch that is not a card's (`obeya/…`);
3. else the one of them named as git's `init.defaultBranch`, `main` or `master`;
4. else the branch the checkout is on, unless that is a card's;
5. else `init.defaultBranch`, else `main`.

The usual names come before the checked-out branch so that a branch the owner checks out for a while
does not become the main branch: landing on the local main still refuses while the checkout is not
on it (`landCheckout`).

### Lesestand

A folder without git is its own Lesestand, read as it is (see Folders without git). Every git
repository of a canvas has a directory on its default branch that its plan docs are read from
(the canvas, „Plandokument lesen“, the last state kept on a project; unless they are in a folder
outside the repository, see Plan docs) and that the agents that answer
or judge rather than work on a card run in (`src/server/read-tree.ts`): project agents, ideas'
exploration agents, the Koordinator (and its look-ups, learner and Rückschau), the Arbeitsrückschau
and the voice commands' session.

Where work lands on the local main (`land: 'main'`, Obeya), it is the configured checkout itself,
which is always on its main branch, uncommitted plan docs included. Otherwise the configured
checkout is often one of the pool's clones and on the branch of the card that leased it last, so the
Lesestand is a detached worktree of it under Obeya's home (`read/<canvas>/<repo>`), on the commit
`.obeya/settings.json` is read at too (`defaultBranchCommit`: the local default branch where it has
everything `origin`'s has, else `origin`'s). Branch switches, `reset` and `clean` in the clone do not reach it,
and the clone's `git status` stays clean, so leasing is not affected; the clone's `.git/worktrees`
has one entry more. A worktree there at the start is used again; one missing, broken or of another
repository is made afresh (`git worktree prune` first), and where none can be made the checkout is
read, as also while its directory cannot be removed (on Windows, while an agent works in it); the
next refresh tries again. Hooks do not run for it.

It refreshes with every round of the PR watcher (2 minutes), so also when the owner comes back to
the page, and right after a merge: `git fetch` of the default branch in the checkout (only
`refs/remotes/origin/<branch>`, no `FETCH_HEAD`, so safe while a card leases the clone), and where
the chosen commit moved, a forced detached checkout and a fresh read of the plan docs. A fetch that
fails (offline, a lock held by a lease) goes to the log and is tried again next round; the Lesestand
keeps its commit. What counts is what is on `origin` (or the local default branch of the checkout,
where it has all of `origin`'s): a doc committed only in another clone, or only edited, does not
show in such a repository. Workers, leasing and landing stay in the checkout and
the clones; `repoInfo` and the configuration are unchanged.

### Plan docs

A doc in the repository's plan directory (`planDocs` in its settings) is a project when its
`## Workstreams` section has a checklist; each top-level item is a workstream
(`**W3:** Title. Details`). Checked means `live`, `(in review)` after the label means `in PR`,
anything else `planned`. The goal is the first paragraph under `## Goal` / `## Ziel`. Obeya reads plan docs and never writes them; workers tick off
their workstream in the doc as part of their change.

A plan card gets a stored row the first time it is seen, so the owner's placement persists; its
title, text and state always come from the doc. Each read also keeps the doc's last state on the
project (title, goal, workstreams with key, label, title, text and state).

#### A plan folder outside the repository

Some keep their plans out of the repository (gitignored, or in a folder of their own). The plan
directory is then an absolute path, or one from `~`, set on this machine in the configuration
(`outsidePlanDir` in `src/server/repo.ts`): Obeya reads and watches the docs there as they are, not
from the Lesestand, and refers to each by its absolute path with forward slashes (so a Windows drive
does not read as a repository's id), which is what the agents are given too. Workers on this machine
have the folder as a directory of their own (`dirs`): one ticks its workstream there, which takes
effect at once and goes into no commit; the card's work in progress still wins over the box until
it lands. A doc that „Als Projekt planen“ writes there cannot land, so Obeya names it at the start
(the card's title as a file name, beside the docs there, with `-2` where that one exists) and keeps
it on the card as the doc it adds (`plan_docs`); the doc shows as a project as soon as it is
written, and the project takes the card's place once the owner has approved it (the card is `done`
without a change). Workers on other machines do not reach the folder.

#### Docs that are no projects

The other `*.md` in the plan directory are not hidden: one quiet note above the projects
(`src/ui/planDirs.tsx`, top left, kept in view by the camera like the cards) names the directory and
lists each with its reason (no `## Workstreams` section, or one without a checklist) and "Als
Projekt aufbereiten". That starts a card, right of everything on the canvas, whose worker adds the
checklist (and `## Goal` if missing) in the doc's own style, turning tasks it keeps under another
heading into it; the change lands like any other and the doc becomes a project. While the card runs,
the doc's row shows "Wird aufbereitet" and opens it. A repository with no plan doc that never had a
project gets a dashed note in the same place: where Obeya looks and that "Als Projekt planen" on an
idea or task card writes the first doc there, with "Ordner ändern", which opens the configuration at
the repositories (the directory is the setting `planDocs`). Its × ("Ausblenden") hides it for that
repository and directory on the canvas, in this browser (localStorage): a canvas without projects is
a normal state, and the note has said what it has to say once read. Another directory in the
settings brings it back; the note on docs that are no projects has no ×, since each of its rows is
something to do.

The owner drags either note like a card (a grab cursor shows it moves): from then on it stays where
they put it, by its top left, whatever the projects do (the canvas's setting `plan_dir_note:<repo>`),
and new projects and the cards it starts go clear of it. Until then it follows the top left of the
projects, so a project placed below everything, or one the owner moves, takes it along.

#### A workstream's state

Work in progress (`working`, `waiting`, `inPr`, `approved`) wins over the doc, so a workstream
ticked off on its branch still waits for its merge; then a ticked-off workstream is `live`;
otherwise the stored state counts (`done`, `planned`), and without one the doc's. Stored `live`
means its work landed, and holds only until the Lesestand has what landed: a card keeps the commit
it landed with (`shipped`: the commit on main after a direct landing, the merge commit GitHub names
for a pull request, else the Lesestand's commit after the first fetch following the merge). When the
plan docs are read again and the Lesestand has that commit while the workstream is still unchecked,
only a part of it is done: the card is stored as `planned` again, with the line „Teil gelandet, im
Plan-Doc weiter offen.“ in its log, and shows „Teil gelandet · PR #821“ (or the commit). Its log and
handover stay; its pull request moves into `shipped`, and its branch goes, so a new run starts on a
fresh branch from main and hears what landed. Unfolded, it lays out as a card an agent worked on, not
as one nobody has touched: what the doc still holds open, what landed (the line with its pull
request, the demo of its last handover) beside the conversation, and „Rest starten“ below. Until 2026-10-21 it showed only the doc's text and „Agent starten“, with the
handover far down, so what was done and what remained could not be told apart. „Teil gelandet“
stays on the card while a new run does the rest, until that lands. Cards that landed before the commit was kept count as
landed in the Lesestand. A worker still finishing after the landing keeps its card live until it is
done. A workstream in its pull request whose box the doc on the default branch ticks off counts as
merged, whether or not the pull request's watcher saw the merge (it may fail on that pull request
for good): its worker hears so as from the watcher and finishes, and its clone goes back to the
pool. `done` (finished without a change) stays: without a commit the doc has nothing to say about
it.

#### Reading a plan doc

The project's sheet lists each workstream with its label, its title and, under it in smaller type,
the rest of its item in the doc (its text and sub-items), then its state: a title alone is often too
short to tell what a workstream is, and the owner should not have to search the doc for it
(2026-10-21). Details a doc keeps elsewhere than in the item (a section of its own) stay in the doc.

A workstream's card shows the same text in every state, and names its doc at the top: under its
state, the line with the doc's path and „Im Plandokument lesen“ (after the branch, once an agent has
worked on it). Planned, the text is what the card shows; queued, it stands beside the conversation;
once an agent works on it, it stands on the left under „Plan-Doc“, above what came of the work
(what landed, the demo, the pull request), with the conversation beside it, even before there is a
result. It stands there in full, the column scrolling where it runs long; above a demo or the files
the work made it shows its first three lines, with „mehr“ for the rest, so they stay in view below. Until 2026-10-21 a started workstream showed its text only
as the conversation's first message, which a long conversation scrolled out of view, and the doc's
line moved from the bottom to the top of the card as it started: a colleague could not tell any more
what a running or delivered workstream was meant to do.

The owner reads a plan doc where the project is: "Plandokument lesen" in the project's sheet widens
it and shows the doc as written, rendered, kept current with the file; a workstream's card opens it
at the workstream's item. Esc goes back to the workstreams. The server hands out only docs it shows
as projects, by project card, never a path.

#### When a project ends

A plan doc with every workstream ticked ends its project as one that disappears does (see Projects
end). The docs as last read decide which projects stand (`openDocs` in `src/server/board.ts`),
checked again whenever a card changes, since a worker finishing after the landing holds its project.
A doc already done when Obeya first reads it gets its rows, placed after the new projects, and goes
straight into the archive; an unticked workstream added later brings the project back to its place.
In Obeya's own repository docs still go once done, usually shortly after their project has gone into
the archive.

A plan doc that disappears ends its project: the project goes into the archive with that last state,
and returns with its placement when the same file comes back. A workstream still at work holds it on
the canvas as the doc last stood (`openDocs` takes the stored doc), and the end of that worker's turn
reads the docs again, which archives it. Known edges: a renamed doc makes a new
project and leaves the old one archived.

#### Watching the plan directory

Obeya watches the plan directory and the nearest directory above it: git removes the plan directory
with its last doc, and the directory's own watch then reports nothing. Bun before 1.3.14 on Linux
delivers nothing to a watch on a directory that was watched before, then removed and created again
(oven-sh/bun#42570): such a directory is polled every half second instead. On macOS Bun has one
FSEvents stream for all watches of the process and starts it afresh, "since now", for each new
watch: until it is live (up to 200 ms on a busy machine, more when many open at once) the events of
every watch are lost. A watch there follows its path, so it stays open while it is wanted instead of
being opened again with each change. A saturated fseventsd (load 40–80) delivers events seconds late
or not at all, even to a live watch: it coalesces what it dropped into an event for a directory
above, and Bun passes on only events under the watched path. So on macOS the plan directory is also
polled every 2 s (names, mtimes, sizes of its docs) and compared with its state at the last read, as
a safety net behind the watches, which stay the primary way. The watch tests check the watches
alone: there a plain recursive watch on the test repository, in the same stream, and a marker
written after each change tell a change the system lost (most of them with fseventsd at full CPU,
2026-10-14; Bun, Node and fswatch alike) from one the watches missed, and a lost one is put back and
made again.

### Repository settings

What Obeya knows about a repository is in its settings: the recipe for running its app (how to
start it, what to do after a change, where it is, login and test data for a demo: `app.run`), how
Obeya stops it while a card waits, where plan docs live, which checks run and how approved work lands, the static site demos are shared on. They
are values, in two layers: `.obeya/settings.json` in the repository (`SharedSettings`), for everyone,
and `settings` of the repository's entry in `canvases.json` (`RepoSettings`), set for this machine
in the configuration dialog without a line of code, which holds the main branch too.

The fields: `land`, `direct`, `autoMerge`, `checks`, `setup`, `planDocs`, `softPaths`, `workspaces`, `prNoise`,
`language` (of what lands in the repository; see Language), `app` and `demo`. `app` has `run`, `stop` and `keep`. Only what Obeya itself acts on is a command:
`stop` and `keep` park a waiting card (see Parking). `run` is prose, for any kind of app (a web app
with or without hot reload, a frontend that needs a reload, a CLI, a desktop or mobile app, a URL
printed to the console): every worker's brief has it word for word, and its demo paragraph points
back to it. Obeya neither starts the app nor looks for its address; the agents do, from the recipe,
and a worker tells Obeya the address once the app runs, for the owner to open it from the card
(see Trying the app by hand).
`demo` has `language`, the language of the repository's demos and of its site's overview (see The
demo settings and voices), and `site` (see Static sites). The fields of `app` and `demo` are each a setting of their
own (`NESTED_SETTINGS`): this machine may set `app.stop` and leave `app.run` to the repository, and
each comes from where it is set. The reference for every
field is `docs/settings.md`, linked from the README.

One thing is this machine's alone and never in `.obeya/settings.json`: the canvas a repository is
on. A canvas
without a name in the configuration is named after its first repository (`repoName` in
`src/adapters/generic.ts`: the name in its `origin` URL, else its directory's), and its id follows.

Precedence, highest first: this machine's values, the repository's `.obeya/settings.json`,
detection (main branch, landing), Obeya's defaults (`src/adapters/generic.ts`, `defaultsFor` in
`src/adapters/index.ts`; they cover any repository with `docs/plan/`). `layerSettings` puts the two
layers of settings together, `withSettings` puts them in front of the defaults; in the code the
result is the type `RepoAdapter`. The dialog shows each value that applies with where it comes from
(„auf diesem Rechner“, „aus dem Repository“, „Klone eingetragen“, „erkannt“, „Standard“), and
„Zurücksetzen“ at one set here takes it back to that source (`RepoValues`, worked out with the
configuration's check). Changing a value sets it here; an empty list or command is a value of its
own (no checks), an empty main branch or plan directory none. A main branch the repository has
neither locally nor on `origin` is a problem (`noBranch`) that keeps the configuration from being
saved.

Read where they are used: what a canvas runs a repository on has the settings in front of the
defaults as getters (`withSettings`) that read the repository's entry from the file as it is now
(`Config.repoSettings`, the file read again once its time or size changed), and `defaultBranch`
asks the running canvas for the main branch it set (`useBranchSetting`). Saving them restarts
nothing (see Live configuration): the canvases follow what they set up by them (`settingsChanged`):
the Lesestand moves to the checkout or a worktree when work now lands elsewhere, the plan directory
is watched afresh, a repository whose work now goes out as pull requests gets its watcher (one that
has one keeps it for the pull requests still open), where demos are shared is worked out again
(`siteOf`: the site once it is complete), and the page shows
the main branch and how work lands. `workspaces` is the exception: clones or worktrees are set up
when a repository's agents start, so changing it restarts that repository's agents, as the dialog
says at the field. That field is not among the folded settings but in the repository's row (see
Leinwände), where the clones are; where the configuration names clones its source is „Klone
eingetragen“. The Koordinator's
`configure` keeps and changes them like the rest of the entry.

#### `.obeya/settings.json`

`.obeya/settings.json` (like `.vscode/settings.json`) is what a fresh clone brings with it: every
value field but the main branch, which says where the file is read from (a fresh clone has it from
`origin`'s HEAD). It is versioned and reviewed with the code it describes. It is read from the
default branch, not from the checkout: the clones a canvas works in are on cards' branches, and one
from before the file changed (or came) would have another one or none. The default branch is the
local one where it has all of `origin`'s, else `origin`'s as last fetched (`readShared`, at
`defaultBranchCommit`). It is read once when a canvas starts and again whenever the Lesestand moves
(a fetch after a merged pull request, a landing on the local main) and when settings are saved
(`CanvasRuntime.moved`); a new version takes effect without a restart, the canvas following as for
a save, but where it changes where the workers work (`workspaces`): then the repository's agents
restart once they paused (reason `repository`, see Live configuration), and a landing that brings
that tells its worker so.

„Für alle ins Repository übernehmen“ below the form (`Config.shareSettings`,
`src/server/shared-settings.ts`) takes this machine's saved values but the main branch into the
file, keeping what else it holds; the dialog first shows the file as it will be and where it goes,
and offers it only while the configuration is as saved. Where work lands on the main branch, Obeya
commits it there with a commit made beside the checkout (a temporary index, `commit-tree`,
`update-ref` against the commit it was made on), so the checkout's other changes, staged or not,
stay as they are; a checkout on that branch gets the file as committed, and one with changes of its
own to the file refuses the takeover (`settingsDirty`). Where it goes through pull requests, the
same commit on top of `origin`'s main branch is pushed to a branch of its own
(`obeya-settings-<time>`) and `Forge.open` opens the pull request, whose link the dialog shows;
where work may also go straight to main (`direct`), the dialog offers beside it to push that commit
onto `origin`'s main branch (`pushShared`, never forced, so a protected branch refuses it). Once the
file holds this machine's values (the commit at once; a pull request when the merge reaches the
Lesestand), those values go from this machine's settings (`Config.takenOver`: a value the file now
holds and did not hold before), so the dialog says they come from the repository. The
Arbeitsrückschau proposes values for some of them, which the owner takes on this machine or into
the file for everyone, one value at a time (see Setting proposals).

#### Problems in the settings

The file's fields are checked against a schema (`checkShared` in `src/adapters/schema.ts`, zod;
this machine's are checked with the rest of the configuration). A field that is unknown (with the
known one it probably meant: `check` → `checks`) or of the wrong type does not count, a mistake
inside one taking the whole field along: Obeya's default stands in its place, and the rest works.
Each is a problem at the repository (`repoSettings`), starting with `.obeya/settings.json`, and
Obeya's log names them at start and whenever a new version is read.

A demo site that cannot be used (no title, no http(s) URL or no deploy command: `siteIncomplete`;
or a deploy program that is not there: `siteProblem`, both in `src/server/share.ts`) is the problem
`demoSite` at the repository; until the site is complete, "Teilen" exports demos.

A repository whose default branch still has `.obeya/adapter/index.ts`, a module that said what its
settings say now, has the problem `adapterGone` (`hasAdapterModule` in `src/adapters/index.ts`):
Obeya does not read the module, and the setup button below offers to move what it says into the
settings.

Commands of the repository the owner has not trusted yet are the problem `untrusted` (see
Trusting a repository's commands).

These problems are fixed in the repository (or, for `untrusted`, trusted), so they keep nothing
from being saved (`blocksSaving` in `src/core/types.ts`). A canvas that does not start at all (a repository gone, its home
repository left out) is left out with the reason in the log and its problem in "Konfiguration"; the
other canvases run (`startCanvases`).

#### Trusting a repository's commands

Some of what a repository brings Obeya runs on this machine itself, outside Claude Code's
permission checks, or contacts without a click: `app.stop` and `app.keep` (run when a card is
parked), `demo.site`'s `deploy` with its `env` file, its `url` and `headers` (read whenever the
owner comes back to the page, `Sharing.checkVersions`), and its `publish` (which deploys with each
approval, without a click on "Teilen"). The agents' sessions read the repository's
own Claude Code configuration (everything under `.claude/` and `.mcp.json`, `CLAUDE_PATHS`: the
hooks, MCP servers and helpers of its settings, and the hooks and MCP servers its skills, commands
and subagents may declare) and run what it names without asking, read-only agents included: tried on
2026-10-16 with the SDK 0.3.285 and no `settingSources`, a `SessionStart` hook of the repository's
ran in a session with only Read, Grep and Glob, and so did an MCP server of its `.mcp.json` that
the repository's own `enableAllProjectMcpServers` approved. Turning off hooks (`disableAllHooks`)
and the repository's MCP servers (`strictMcpConfig`) is not enough: its `apiKeyHelper` still ran,
and an `ANTHROPIC_BASE_URL` in its `env` took the session's requests elsewhere. A repository cloned
from someone else, or a merged change of a collaborator's, changes any of these without the owner
noticing (VS Code puts the same kind of settings behind Workspace Trust).

So these count only as the owner last trusted them. Obeya keeps, per repository (by its path, the
table `trusted_commands`), the commands as the owner last trusted them (`RepoCommands`, in three
groups: `app` for stop and keep together, since a stop without its keep could stop what it keeps;
`site`; `claude`, the text of each file under `.claude/` and of `.mcp.json`). The values themselves, not a hash: the dialog shows what changed. A group that the default
branch has otherwise (`heldGroups` in `src/server/trust.ts`: new, or changed since) is held:
the canvas reads the repository's settings without it (`withoutHeld`), so no stop or keep runs and
no site is deployed to or read (demos are exported); an agent working in the repository (its
checkout, Lesestand or a workspace of it, the most specific of them, since the home repository's
workspace directory holds the other repositories'; `withRepoTrust` in `runtime.ts`, which reads
the configuration afresh from the default branch at each start, since a commit on the checkout's
main from outside Obeya moves nothing the canvas notices) starts with
`settingSources: ['user']`, none of the repository's Claude Code configuration, and since Claude Code
then reads its CLAUDE.md neither, the agent gets the CLAUDE.md of its directory in its
instructions instead (not in a workspace on another machine). What this machine sets needs no
trust: where its values stand in for all of a group (`app.stop` and `app.keep`, or `demo.site`),
the repository's are not held; and values taken over from this machine into the file („Für alle
ins Repository übernehmen“, a setting proposal) are the owner's own (`trustTakenOver`, in
`Config.takenOver`; a trusted `keep` that went beside them is not, since the stop would then stop
what it kept). A repository with commands on the canvas before this came in (2026-10-16)
was trusted with none, so its commands wait once.

Held commands are the problem `untrusted` at the repository in "Konfiguration", counted in the
bar's button like the others: what each group does and that it waits, its lines as last trusted
against those on the default branch now as a diff, and „Diesen Befehlen vertrauen“, which trusts
what the dialog showed, the held groups alone (`POST /api/config/trust` with them; ones that
changed on the default branch meanwhile are refused, `trustChanged`; a group this machine's values
stand in for was not shown and stays untrusted; a repository the dialog's draft adds, a new canvas's
say, can be trusted before it is saved) and has the canvases follow at once (`settingsChanged`). The
values held show „aus dem Repository, noch nicht vertraut“ as their source. Whenever the canvas
reads the settings again (`moved`), it works out what is held again; a change there counts in
`configRev`, so the page reads the problems again.

A worker's own workspace may hold Claude Code configuration the default branch does not (its own
edit, or a branch from before a change): it counts as long as the default branch's is trusted, as
the worker's other edits do; what it changed there waits for trust once it lands. Trust covers the
configuration, not the repository's code it calls: a trusted hook that runs `scripts/x.ts` runs
whatever that script says now, as the checks do.

#### Writing the settings

The plugin's skill `settings` (`plugin/skills/settings/`) is how a worker writes a repository's
`.obeya/settings.json`: read the repository (scripts, CI, README, compose files, a `.obeya/adapter/`
left from before, whose values it takes over before deleting it), ask the owner what it does not
tell (login, test data), write the file, check it with `lib/check.ts` (it reads the checkout's
`.obeya/settings.json` as Obeya would read it from the default branch, prints what Obeya makes of
it, the plan docs among it, and lists the problems: the field problems and the site's, from the
same functions the configuration dialog uses, and a `.obeya/adapter/` still there), run setup and
checks, and prove `app.run` by recording a demo with it. The compiled binary's resources
carry `docs/settings.md` where the skill finds it up the tree, and `check.ts` bundled like
`recipe.ts`.

### The Konfiguration dialog

The canvases with their repositories (path, clones, settings), seen and edited in the
"Konfiguration" dialog. It covers the page but for a margin of the dim (a press there or Esc closes
it; what was open behind it stays as it was, and a draft not saved yet stays, written down per tab
as it changes, so a reload, Obeya's restart included, brings it back) and lists its sections on the
left: Leinwände, Modelle und Effort, Spracheingabe (with the push-to-talk key), Demos (the narration
beside what demos need on this machine), Von anderen Geräten (see Other devices) and Allgemein
(the interface and conversation languages, light or dark, the server); under the list stand „Einrichtung prüfen“ and the link
„Wunsch oder Fehler melden“ (see Wishes for Obeya's makers). One
section shows at a time, the last one chosen per tab, so a save's restart or a new language comes
back to it; Leinwände marks a draft not saved yet and counts its problems in red.

Each section is a heading with what it is about and the file it is saved in, and below it settings
as rows of label and control, parts of a section under a rule: no boxes in boxes. Its fields sit a
shade darker than the sheet with a firmer edge, so its structure reads at a glance; the one being
typed in comes up to the sheet's colour. What to know about a field that is not written beside it
sits behind a small info icon at its label, shown only while the pointer is on the field or its
label (or the field has the focus), so the page stays calm; the text shows on the icon at once, not
as a browser tooltip with a wait on plain text.

#### Leinwände

Each canvas is a heading line (number, name, id, whether it runs) over a table of its repositories:
its path, one row each. Each repository shows its id and, right under its path, where its workers
work („Agenten arbeiten in“: Worktrees or Klonen, with where that comes from), so that clones are
found without opening its settings: Klonen shows the existing clones („Vorhandene Klone, einer pro
Zeile“), below them the clones Obeya makes in addition („Dazu neue Klone anlegen“, its info icon
saying they come on top of the existing ones, in Obeya's directory), the slots, a line with how many
clones that makes on this machine („Zusammen 4 Klone auf diesem Rechner (2 vorhandene, 2 neue)“),
and the other machines; Worktrees only the slots. With none of them, the line warns instead that no
card would start there any more („Kein einziger Klon: …“). Under it, for a canvas that runs, stands
what saving does to the clones registered now (`leaving` of the dialog's check, `leavingClones`):
„Klon 3 und 4 fallen weg; Klon 4 erst, wenn ‚Login‘ fertig ist. Ihre Ordner werden gelöscht, wenn
darin nichts Ungelandetes liegt.“ (an existing clone by its path, whose folder stays as it is), also
when switching to worktrees. Until 2026-10-21 the number came first, labelled
„Klone anlegen“, with no sum: a colleague took it for the number of clones to work in, typed 2
beside their 2 existing ones and got 4. An existing clone is one of the repository when it is the
repository itself or its `origin` is the repository's (or the repository's path): the same
repository over https, `ssh://` or `user@host:path`, user, port, a trailing `.git` and case aside.
One of another repository is a problem of the dialog's check („Ein Klon in der Liste ist ein Klon
eines anderen Repositorys“) that keeps it from being saved. Until 2026-10-21 origins were compared
as written: a colleague's clones, some with an https origin and some with ssh, counted as clones of
another repository, and since the check did not look at origins, the configuration was saved and
its canvas did not start. Switching sets this machine's `workspaces` setting where the repository's says otherwise;
switching to worktrees takes the clones the entry names out of it (they would keep it in clones)
and a switch back while the dialog is open brings them back. A repository added in the dialog that
is in clones gets as many as the first canvas's, two, filled in once its path is checked and
changeable before saving (`withClones` in `core/types.ts`). The two fields add up, so that number
goes again as soon as an existing clone is listed (a line that is not blank), and comes back when
the list is emptied, as long as the owner has not touched it; a number the owner typed, changed or
emptied stays as it is. Until 2026-10-21 the two stayed: a colleague who then listed their 2
existing clones got 4. The command that shares its demos
is a row of its settings, for this machine only, since it often needs credentials, so „Für alle“
does not take it over (empty: the demo site of its settings, shown as „Site: <url>“, or an export;
see Where a demo goes). Each repository folds its settings under „Einstellungen“ below its row (see
Repository settings), with the main branch and how work lands in the folded line; the app's
recipe („So läuft die App“, a large text field), its stop command („Stoppen, solange eine Karte
wartet“) and, once there is one, its keep condition, the language of what lands in it („Sprache des
Repositorys“: Deutsch or Englisch, English by default), the language of its demos („Sprache der
Demos“: Deutsch or Englisch, neither chosen where the demo settings' language applies) and the demo site („Demo-Site“: title, URL, deploy command, env file, headers as `Name: value` lines, the largest
file in MiB) have their fields there like the other settings; „Für alle ins
Repository übernehmen“ below them takes the values saved for this machine into the repository's
`.obeya/settings.json`. What is taken over is what is saved: while the dialog has changes not saved
yet, the takeover saves them first, all of them like „Speichern“ (the confirmation says so), then
writes the file; only where saving restarts Obeya (a configuration from the command line) is the
button off, saying to save first. A setting's label starts level with the first line of its field
rather than centred beside the field and its hint. Renaming a running canvas keeps its id (`id` in
the file), so its cards stay.

Problems (no git repository, a repository the canvas has already under this or another path, two
canvases with one id, a canvas's home repository left out, a path still empty) show at the field while editing and keep it from being saved; where a path without a
repository is a folder, the problem offers to set up git there (see Setting up git in a folder),
after which it goes. An empty path is read nowhere (resolved, it would be the server's own working
directory, its repository and commands shown for the new canvas): it is only the problem `noPath`.
Problems in a repository's settings for everyone (`repoSettings`: a field of
its `.obeya/settings.json` unknown or of the wrong type; `demoSite`: a demo site that cannot be
used; `adapterGone`: a `.obeya/adapter/` left on its default branch; see Problems in the settings)
show at the repository with what is wrong, and keep nothing from being saved, since they are fixed
in the repository. A problem's technical detail (the field, why the site cannot be used) is folded
under "Details"; for the configuration
as saved each problem offers "Aufgabe zum Beheben anlegen", which hands the Koordinator of the
canvas with the problem (else of the page's) the problem with its detail as a typed request to
create a task that fixes it, answered above the microphone. The "Konfiguration" button in the bar
counts the problems of the saved configuration in red; the page reads them when it loads, after
each save in the dialog, and when a repository's `.obeya/settings.json` (a field that does not
count included) or a leftover `.obeya/adapter/` changes on its default branch while the page is
open (`configRev` of the snapshot's repositories counts that).

The dialog shows the configuration at once (`GET /api/config`, the file as saved) and what it
amounts to after it, once the check is done (`/api/config/check`; „Repositories werden geprüft …“
until then): the problems, each repository's id and settings with where they come from, and the
ids of the canvases, which a rename keeps. The check reads each repository with git once, however
often the configuration names it (a canvas's repository, a workspace, a host's remote), all of them
at once and without blocking the server (`gitSteps`, `readingRepo`): three canvases with four
repositories and eight workspaces take 41 git calls in about 60 ms.

A repository with no value from its own `.obeya/settings.json`, or with the problem `adapterGone`,
offers „Von einem Agenten ausfüllen lassen“ under the words that Obeya does not know yet how its app
starts, which checks run and how to run it for a demo, and that the owner can set that under
Einstellungen or have an agent do it, while its canvas runs as saved: it puts the card "Obeya für
<repo> einrichten" at the top right of that canvas (or finds the one still open) and opens it there;
its worker fills in `.obeya/settings.json` with the `obeya:settings` skill (and, where the
repository still has `.obeya/adapter/`, moves what it says into the settings and deletes it), which
settles where plan docs go too:
it looks for plans the repository already keeps (`docs/`, `rfcs/`, `adr/`, `PLAN*.md`, a `TODO.md`),
asks the owner in its one question whether that directory becomes the plan directory (its docs then
prepared on the canvas) or a new `docs/plan/`, and its check script lists which docs there are
projects and why the others are not.

#### Saving

Saving writes the file, and the running canvases take it over without a restart (see Live
configuration); the dialog says it applies at once, and where agents of a repository restart for it,
that they do once they paused. Started with repositories on the command line, Obeya shows those, and
saving ("Speichern und neu starten") makes the file the configuration it restarts with, once no
worker is in the middle of a turn, a tenth of a second after the answer went out; the page reloads.

The server's own settings (port, data directory, the agents' permission mode) come from the command
line and the environment (`OBEYA_PORT`, `OBEYA_HOME`) and show read-only. The Koordinator reads the
configuration (`config` tool) to answer questions about it and changes it on the owner's word
(`configure`, the whole new list, checked like the dialog's), with the usual confirmation and undo
window. The dialog says so under its title, with "Obeya fragen", which closes it and opens Obeya's
conversation ready to type into (Space for voice does not reach Obeya while the dialog is open).

The other sections are saved on their own: the demo settings (see The demo settings and voices) into
`demo.json` in Obeya's home, read by the next render, so saving them restarts nothing; the language
(see Language), light or dark (see Visual identity) and the model and effort of each group of agents
(see Models and effort) the same way into `settings.json`.

### Live configuration

A configuration saved from the file (the dialog, the Koordinator's `configure`, the setup
assistant's first canvas) applies while Obeya runs, and so does a new version of a repository's
`.obeya/settings.json`: Obeya does not restart for them, and the page does not reload.
`Config.save` hands the canvases with their ids to `Canvases.apply` (`src/server/canvas.ts`): a
canvas new in it starts at once (the setup assistant's gets its welcome card then), one that changed
takes the change (`CanvasRuntime.apply`), one no longer in it stops once its agents paused, its
cards kept. Within a canvas, a new name and a repository new on it apply at once, and so do settings
that leave the agents where they work.

What a repository's agents are set up by when they start (its entry but the settings, `repoShape`:
clones, existing workspaces, slots, other machines; and where its workers work,
by its settings: restart reason `config` where the owner saved them, `repository` where its
`.obeya/settings.json` changed) restarts that repository's agents alone, and a repository that left
the canvas stops: its workers hear of it as of a restart (`DueRestart.repo`) and pause at a safe
point, at most 15 minutes, and then the repository's set-up stops and starts again as the
configuration has it now (`restartRepos`), its workers resuming in their sessions; the other
repositories' agents work on, and a worker landing such a change waits for it through
`after_restart`. The bar shows the wait as for a restart ("Konfiguration wartet auf …", with the
repositories and the cards in the hover), and "Jetzt übernehmen" (`POST /api/c/<canvas>/restart`)
has it go ahead. A restart of all of Obeya that comes meanwhile is what the workers hear of. Pages
hear of canvases that start, stop or change their name or repositories (`canvases` over the
WebSocket), so the switcher follows; a page of a canvas that stopped is closed and goes to the first
canvas.

A repository that does not start (a clone its workspaces refuse, a clone that cannot be made, a git
error) never leaves a canvas half stopped. Restarted, it starts again as it was set up before
(`Repo.from`), and the Konfiguration shows the problem `repoBefore` at it; where that fails too, it
leaves the canvas like one the configuration no longer has, its cards kept (`repoDown`). A
repository new on the canvas, or one that does not start with Obeya, is left out the same way while
the canvas runs with the others. Without its home repository a canvas does not run: it is left out
at startup, and stops when a restart cannot bring that repository back (`canvasDown`; `Canvases`
keeps why). These are problems of the running canvases, not of the configuration
(`StartFailure`, from `Canvases.failures` into `Config.check`): they block no save, show in the
problem count on the Konfiguration button of every canvas (`CanvasInfo.configRev` tells the pages
to read the problems again), and „Erneut versuchen“ at the problem (`POST /api/config/retry`) has
the canvases take the saved configuration over again, as a save does, so that what failed tries
again. Where no canvas runs because none started, the page says so with the problems and that
button, instead of the setup assistant's first start.

### Language

Obeya keeps three languages apart, each German or English: the interface's, the conversation's and
the repository's. The interface is the owner's to switch at will (to test both, say) without the
agents switching with it; the conversation follows the language the owner talks in; what lands in
git stays in the repository's language whatever the owner talks in. A card may so show English UI
around a German conversation about an English plan doc: that is intended.

**The interface language** covers Obeya's own words only. The owner chooses it in the Konfiguration
dialog ("Sprache der Oberfläche"); until then the system's applies: on a Mac the language of its
interface (`AppleLanguages`), elsewhere `LC_ALL`, `LC_MESSAGES`, `LANG` in that order, then what the
runtime reports; a language Obeya does not speak gives English. The choice lives in `settings.json`
in Obeya's home (`src/server/settings.ts`; the system's language is worked out in
`plugin/skills/demo/lib/language.ts`, which the demo skill shares), which the server reads whenever
it needs the language (`ownerLanguage`, the Board's `language`) and the UI asks for before its first
render (`/api/language`).

The UI strings are two tables of one shape in `src/ui/strings.ts`, so a missing English text is a
type error; both call the Koordinator „Obeya“; dates and numbers follow the language, in the
browser's own variant of it (`en-GB` writes the day first; a variant `Intl` refuses, such as
`en-US@posix` from a Linux browser with the POSIX locale, gives the usual one). Choosing another
language takes effect at once: the page loads again, keeping what was open, as after a restart.
What the server writes into a card's log itself, the fixed parts it adds to an agent's question
("(Mehrfachauswahl)"), push notifications and its own pages are two tables of one shape in
`src/core/messages.ts` (the Board's `t`, read when a line is written, which then stays in that
language; the UI recognises the few lines it treats specially in either).

**The conversation language** is what agents write the owner in: reports, questions, replies,
handovers, idea briefs and replies, card titles, Question-card answers and their files, proposals
and their revisions, Arbeitsrückschau notes and reasons, the Koordinator's replies and
confirmations. Each agent answers in the language of the owner's most recent words to it, typed or
spoken, also where what it works on is English; words that tell no language (an option's letter,
"ok") change nothing. Before the owner has said anything to it, it uses the owner's setting
"Sprache der Gespräche" (`conversationLanguage` in the same `settings.json`; the Board's
`conversation`), which follows the interface language until chosen. The rule is an instruction in
the prompts (`ownersLanguage` in `src/core/locale.ts`, whose tools then say "in the owner's
language"), not detection code. A task the owner wrote (`taskAuthor`: typed, or put in by the
Koordinator from their words) counts as their first words to its worker; one from a plan doc, a
proposal, an idea's brief or the Arbeitsrückschau tells nothing, and the docs a worker reads neither
(the owner, 2026-10-20: a task written in English and answered in German looked wrong). Agents with no words of the owner to go by (the
Koordinator's conflict reasons, the rules it proposes) write the conversation language; the card
namer writes the language of the task it names. The Koordinator knows the owner's words for its cards
in both languages, takes examples in the conversation language and names Obeya's own cards („CLAUDE.md
ergänzen“) as the interface does; its session starts afresh once either language changed. An
analysis on a card is owner-facing, so it is in the conversation language; one a worker commits is
repository content.

**The repository language** is that of everything that lands in git and lasts: code, comments,
commit messages, design and plan docs, the CLAUDE.md lines the Arbeitsrückschau proposes. It is
`language` in the repository's settings, English where left out (see Repository settings), shown as
„Sprache des Repositorys“ among its settings. Workers and idea agents are told both languages
explicitly (`repositoryLanguage`: "What you commit … is in English, whatever language the owner
talks to you in"), so a German conversation does not make German docs; and that a demo is in the
language the demo skill's settings name.

**Demos** keep their own language per repository (`demo.language`), else the narration language of
the demo settings, else the conversation language; their shared pages follow it (see The demo
settings and voices). Obeya's own repository says English, since its approved demos go public.

Prompts only agents read stay English with German examples of what the owner may say.

### Decisions

- **A canvas may span several repositories, and one Obeya serves several canvases** (at first it was
  one canvas per repository).
- **A canvas belongs to a repository, not a checkout**: without a name in the configuration it is
  named after the repository (`repoName`, the name in its `origin` URL), so the clones share one.
  Until 2026-10-15 the repository's adapter named it (`canvasId`, `canvasName`), and while that
  adapter did not load, the setting `own_adapter_of` kept the canvas's id and name.
- **What Obeya knows about a project lives in the project's own repository**
  (`.obeya/settings.json`, read from the default branch), not in Obeya's, which is open source.
  Until 2026-10-05 adapters for each project lived in Obeya's repository and were picked by the
  `origin` URL; then a repository carried its own in `.obeya/adapter/`, while Obeya's own
  (`src/adapters/obeya.ts`) stayed in `src/adapters/` until 2026-10-15. Until 2026-10-15 too the
  configuration could name an adapter (`adapter`: a built-in one's name, or the path of a module;
  `--adapter` on the command line), a column of the dialog let the owner pick one („automatisch“,
  „generic“ or „obeya“, which only Obeya's own repository could use), and one that did not exist or
  load was a problem that kept the configuration from being saved.
- **Settings replace the adapter module** (2026-10-15). Until then a repository could carry a
  TypeScript module beside its settings, `.obeya/adapter/index.ts`. Obeya loaded it from the default
  branch (a copy per version in `.git/obeya/adapter-<tree>/`), checked its export against a schema
  (problems `adapterField` and `adapterLoad`), ran the repository on the generic adapter while it
  did not load, and took a new version over in the running canvas (`Workers.useAdapter`, restart
  reason `adapter`). Once the settings held the values (2026-10-14), the module was left with
  `stack`, `demo.site` or `demo.share`, and the canvas's id and name: values too, only written as
  code. The setup card's task then read „Schreib den Adapter dieses Repositorys
  (`.obeya/settings.json`, für Code `.obeya/adapter/index.ts`)“, which read as if the settings lived
  in the adapter. The owner asked why the stack could not be a setting; with nothing left in
  adapters that was code, the module went. Now the stack and the demo site are settings with fields
  in the dialog, the share command was this machine's alone (`demo.share` for everyone went), and the
  canvas's name comes from the configuration or the repository: everything a repository says about
  itself is in one place, and the owner sets it without code. A module still on a default branch is
  not read (problem `adapterGone`), with no transition, since Obeya is not released yet and keeps no
  old form working before its release. The skill `obeya:adapter` became `obeya:settings`,
  `docs/adapter.md` became `docs/settings.md`, and Obeya's own repository lost its
  `.obeya/adapter/`, which only named the canvas „Obeya“.
- **„Von einem Agenten ausfüllen lassen“** (2026-10-15): until then the button read „Adapter
  einrichten lassen“, under a sentence that read as if only an adapter could say how the app starts.
  Until then too „Für alle ins Repository übernehmen“ was always off while the dialog had changes
  not saved, with „Erst speichern: übernommen wird, was gespeichert ist.“, which read as if saving
  were the takeover.
- **The main branch is the usual names before the checked-out branch** (2026-10-14). Until then it
  was `origin/HEAD` or `main`, so a repository on `master` without a remote got worktrees and
  landings on a branch that did not exist.
- **Plan docs come from the Lesestand, the default branch, not from the configured checkout**
  (2026-10-06). Until then they came from the checkout's working tree: in a repository whose work
  lands through PRs that checkout is often a pool clone on a card's branch, so a doc pushed to
  `origin` from another clone never showed, a card's branch without a doc sent its project to the
  archive and back at the next lease, and a workstream ticked off in a merged PR went live only by
  chance. The agents that only read moved with the docs, so a project agent finds its doc where it
  works. Rejected: reading only the docs with `git cat-file` (the agents would read another state),
  pulling the configured checkout (it is a pool clone on cards' branches), and merging the docs of
  all clones (which state counts would be chance). The fetch rides on the PR watcher's rounds and
  the merge, without a timer of its own. Until 2026-10-07 a Lesestand directory that could not be
  removed ended the server.
- **Plans outside the repository are a folder set by its path, not detected** (2026-10-19, the
  owner's decision, from GitHub issue #1: a repository whose `docs/plan` is gitignored showed no
  projects, since the Lesestand has only what is committed). An absolute plan directory is read
  where it is, and workers reach it by its path. Rejected: noticing that the plan directory is
  gitignored and linking it from the checkout into the Lesestand and every workspace (too much
  magic), and a line in the repository's CLAUDE.md alone (Obeya itself has to know the folder).
- **Plan docs as projects, by a checklist under `## Workstreams`.** Plan-doc sync stays open (see
  Open questions).
- **The other `*.md` in the plan directory are not hidden** (2026-10-12). Before, such a doc was
  skipped silently and a missing directory said nothing, so a repository with plans of its own
  showed an empty canvas without saying why. Deferred: a more lenient parser (`Tasks`, `Milestones`,
  `Phases` as synonyms), which would turn checklists in design notes into projects while a doc off
  the format is now converted in one click; and letting a repository read its own format
  (`planDocs.read`, several directories), until a repository needs its docs to stay in a format of
  their own. Rejected: an agent mapping any doc into workstreams kept in Obeya's database, against
  "plan docs are read, never written", with no box for workers to tick.
- **The note on a plan directory moves freely** (2026-10-21, a colleague's feedback). Before, it
  always stood above the top left of the projects, so it jumped to each new project placed below
  everything and went along with a project the owner moved. Its place is the canvas's, kept on the
  server like a card's, so it is the same in every browser. Rejected: keeping it in localStorage like
  the hidden empty note (a hidden note is a reading state, a place is part of the layout).
- **A stored `live` holds only until the Lesestand has what landed** (2026-10-06). Until then a
  stored `live` or `done` beat an empty box: that came from the time plan docs were read from a pool
  clone's working tree, where the doc was often behind; it hid a workstream the doc kept open on
  purpose (configuration landed, commissioning waiting for the plant) as `live`. Rejected: the
  worker reporting "only a part" at the handover (a second source beside the doc that can contradict
  it), and a "Wieder öffnen" button (the problem shows only when someone asks).
- **A plan doc with every workstream ticked ends its project** (2026-10-12, the owner's decision): a
  repository that keeps its finished plans would otherwise keep their projects on the canvas
  forever.
- **A plan doc that disappears ends its project** (2026-10-01). Ending is automatic rather than an
  explicit "abschließen", which can later sit on top. Watching the directory above came from M5,
  which stayed on the canvas until a restart; a watch that follows its path from a second change
  lost right after the first (2026-10-08); the macOS poll from fseventsd dropping events
  (2026-10-09). Reading old content from the git history instead was rejected as fragile (PRs and
  clones, renames).
- **One recipe for running the app, and only the commands Obeya runs** (2026-10-15). Until then
  `stack` had `start`, `refresh` ("after a backend change") and `urls` (a file of `KEY=value` lines
  and the key of the frontend's URL) beside `stop` and `keep`, shown as five „App-Stack“ fields,
  and `demo.howToRun` held a recipe in prose for the demo alone. Obeya ran only `stop` and `keep`;
  `start`, `refresh` and `urls` made up one sentence of the brief, so they guessed at categories
  (a backend, a frontend, a URL file) that many kinds of app lack, and the work repository's recipe
  already repeated them in prose. Now `app.run` is that prose for every worker, `stop` and `keep`
  stay commands, and `demo` keeps only `site`. A structured form (a start command, "after a change to
  X, run Y" rules, where the app is) was dropped: it still guesses at categories, and the agent reads
  it as prose anyway. Obeya managing the app (starting it, waiting for it, an „App öffnen“ on the
  card) was dropped by the owner: nothing in Obeya needs the address. No migration, since Obeya is
  not released: `stack` and `demo.howToRun` are unknown fields now.
- **Repository settings without TypeScript, read where they are used** (2026-10-14). Until then
  these values could only be set in `.obeya/adapter/index.ts`, and saving the dialog always
  restarted Obeya.
- **A repository's settings are checked** (2026-10-08, then the adapter's fields): until then a
  misspelt field was ignored without a word, and nothing read `stack`. Until 2026-10-09 `check.ts`
  missed the problems of `demo.site`.
- **A broken canvas leaves the rest running** (2026-10-09, as did a broken adapter while there were
  adapters): until then either took all of Obeya down at its next start. Until 2026-10-09 a merged
  adapter, or a change to it, took effect only when the owner quit and started Obeya again; until
  2026-10-14 it restarted all of Obeya.
- **Obeya's configuration is the file `canvases.json`**, edited in the UI or by the Koordinator
  (2026-10-01). Saving the configuration of a command-line start switches Obeya to the file, so what
  was edited is what runs.
- **Configuration changes apply in the running process, down to the repository whose agents they
  concern** (2026-10-14), rather than through a restart: a restart of all of Obeya waited for every
  worker on every canvas and reloaded the page for a clone added to one repository. A repository's
  set-up is the unit that restarts, since its workspaces and workers are made by what its entry and
  settings say when they start; everything else (names, settings that keep the workspaces) is read
  where it is used. Until then any change but a repository's settings restarted
  all of Obeya, once no worker on any canvas was in the middle of a turn: adding a canvas or a
  repository, a clone more, a renamed canvas, a new version of an adapter landed by a card.
- **The configuration shows before its check** (2026-10-15). Until then reading it checked it
  first, with 109 git calls one after the other on the server's thread (each repository resolved up
  to three times, its main branch and `.obeya/settings.json` read several times, each of eight
  workspaces resolved in full): the dialog said „Konfiguration wird geladen …“ for seconds, and the
  whole server stood still meanwhile, every page load included, which read the configuration for its
  problem count. What Obeya reads of a repository with git is written once as steps
  (`GitSteps`) that the check runs without blocking, its calls at once, and the running canvases
  run waiting, as they did.
- **The configuration is a dialog nearly as large as the window**, its sections listed on the left,
  not a sheet (2026-10-09, the owner's wish): as a sidebar it stacked eight framed blocks, each with
  a heading above its frame and frames inside frames for canvases and repositories, in one narrow
  column to scroll through. It is visited now and then, not worked beside, so it takes the space and
  the canvas stays where it was.
- **A locale `Intl` refuses gives the usual one** (2026-10-07): until then the page stayed blank on
  it.
- **Interface, conversation and repository each have a language** (2026-10-20, the owner's
  decision). Until then one owner setting decided the UI strings, the server's log lines and every
  prompt's language for the owner, and what workers committed followed only the repository's
  CLAUDE.md: switching the UI to English to test it turned every agent English. Now the interface
  language covers Obeya's own words, agents answer in the language of the owner's latest words
  (else the conversation language, which follows the interface until chosen), and git content
  follows the repository's `language`, English by default. Dropped: two machine-wide settings
  (interface, agents), which follow neither the language the owner speaks nor keep git content
  English in a German conversation; and a personal override per canvas, which mirroring the
  owner's words covers.
