## Agents and workspaces

A chapter of the [design doc](../design.md), whose header says how it is written.

### Agents

Claude on the owner's subscription, no API billing, through the Agent SDK: it runs on the Claude
Code login of the machine (tested without an API key: `apiKeySource: none`). From the checkout it
runs the Claude Code binary the SDK brings for the platform (its optional package, 224 MB); the
compiled binary carries none and runs the machine's own installation (`claude` on the `PATH`, else
`~/.local/bin`, where the official installer puts it); `OBEYA_CLAUDE` names another. Both ran
workers and the Koordinator in the binary on macOS, Windows and Linux on 2026-10-07 (the SDK 0.3.285
with its Claude Code 2.1.285, and the installed 2.1.292). Agents get Obeya's environment without the
marks of a Claude Code session that may have started it (`CLAUDE_CODE_*`, `CLAUDECODE`,
`CLAUDE_PID`) and of Obeya's own supervisor (`OBEYA_SUPERVISED`, `BUN_BE_BUN`), but with
`CLAUDE_CODE_OAUTH_TOKEN`, the login of a machine without a keychain.

A worker is one SDK session per card with streaming input, the repo's own settings and CLAUDE.md
(Claude Code's settings sources left as they are; a repository whose own Claude Code configuration the
owner has not trusted yet gets none of it, see Trusting a repository's commands),
and permission mode `auto` (`--permission-mode`); after a restart it resumes by session id. A
project agent is one session per project on the repository's Lesestand, resumed for each question,
answering the owner's questions about the project and its workstreams one at a time. It, ideas'
exploration agents and the Koordinator's look-ups have a worker's tools in the workers' permission
mode (see Looked-up questions); the other agents that only judge or answer from the text (the quick
reading of commands, estimates, the learner and the like) are read-only: Read, Grep and Glob, mode
`dontAsk`. The SDK sits behind a small runtime interface, so the orchestration is tested against a
fake.

Two SDK hooks ride on every session: before a Bash call, the refusal of long foreground sleeps;
after every tool call, what changed since the session's instructions were built
(`AgentSpec.contextUpdate`) goes to the agent with that call's result; not with a subagent's calls,
whose results the agent never sees. Workers and idea agents use it for the owner's preferences: a
preference learned or changed while one runs reaches it once, at its next tool call, without a
message or a new turn. A workstream's worker hears its project's new decisions the same way (those
on its own card it heard as answers), and the owner's notes that came during its turn (see Reading
order). A worker's session also has `canUseTool`: a call the settings want confirmed becomes the
question its card waits on (see Refused and confirmed tool calls). Its own Obeya tools run without
asking through a `PreToolUse` hook that allows them.

### Models and effort

Every agent belongs to one of four groups, each with its model and effort: the Koordinator (voice
commands, estimates and schedules, look-ups, project agents, learner, Rückschau, proposal rewrites),
the workers on cards, the exploration agents of ideas, and small jobs (the Arbeitsrückschau's notes
and proposals, the text of a shared demo's page, a card's title). The owner chooses both in the
Konfiguration dialog: the model is Claude Code's default or one of its aliases (Fable, Opus, Sonnet,
Haiku, each the newest of its family), the effort always a fixed level (low to max). Preset
(`AGENT_DEFAULTS`) is Opus for every group, with high effort for workers and exploration agents,
medium for the Koordinator and small jobs; the sheet marks the presets.

The choices live in `settings.json` under `agents`, only where they differ from the presets
(`src/server/settings.ts`); every session names its group (`AgentSpec.role`), and `withAgentSetting`
(`runtime.ts`), which wraps the canvas's runtimes, asks for the group's setting at each start.
Saving restarts nothing and takes effect for every agent that starts afterwards; a session at work
keeps what it started with, except the voice commands' session, which is opened anew once the
Koordinator's setting changed, as it is for another language.

### Workspaces

Per the repository's settings, worktrees unless they say clones. A pool of full clones leased by a card while it is
worked on (for a repository whose tools break inside a worktree, or that runs its own app stack per
clone), or a worktree per card (Obeya itself: any number in parallel unless the repository has
`slots`), kept across stop and restart until the card's work has landed and its worker has finished
what remains after it. Clones come from the
repository's `clones` or `workspaces` in the configuration, or on the command line from `--workspace
<path>` or `--clones <n>`; a repository whose configuration names clones (these, or `hosts`) works
in clones whatever its settings say. The two add up: `clones` is how many Obeya makes in its own
directory (`workspaces/<canvas>/<repo>/1..n`, `ensureClones`), on top of the existing ones
`workspaces` lists; the Konfiguration dialog shows the sum (see The Konfiguration dialog).

The pool is what the configuration names (`keepOnly` in `workspaces.ts`, when a repository's agents
start, and for a host once its clones are in place): a clone it no longer names (fewer to make, the
number emptied or 0, an existing one taken out of the list, a host removed or given fewer, the
repository gone over to worktrees) leaves the pool, a free one at once, one a card holds once the
card gives it back (landed, deleted, its workstream ticked off); no card moves in the middle of its
work, and a deleted card brought back with the undo does not take it back. Until 2026-10-21 a clone,
once registered, stayed in the pool for good: lowering the number to make, or emptying it, changed
nothing, and a colleague who lowered it kept 4 clones.

A clone Obeya made (`workspaces/…/<n>`, on a host `<root>/<n>`, a clone of the repository by its
`origin`) goes from disk as it leaves (`retire`), where nothing in it would be lost (`unlanded`): no
changes not committed, no files git does not track (those it ignores aside), no stash, no
submodules (their work is not looked into), no worktree made from it in use (a follow-up's), and no
branch, tag or detached HEAD with commits that are on no branch of `origin` (fetched with pruning)
unless each file it changes is on `origin`'s main branch as it has it, which is how a branch
squashed or rebased onto it in its pull request, then deleted, counts as landed. Where work lands on the local
main, `origin` is the Obeya checkout. The repository's `app.stop` runs in it first, so no app stack
is left without its folder, and what it leaves behind is looked at again. The folder is moved aside
before it goes, so a clone named again meanwhile (here, or as another canvas's) is never removed
under a card; on a host, making a clone and removing it wait for each other. Otherwise the folder stays: the log says once which folder
and what lies in it, and the pool's tooltip shows it („bleibt: nicht gelandete Arbeit in <Pfad>“)
until a later start finds it can go (`sweep` here, on a host when its clones are made sure of); a
host that does not answer is asked at the next start. Raising the number again takes a folder that
stayed back into the pool as it is. A clone the owner listed is never touched on disk, nor are the
folders on a host no longer configured, which Obeya cannot reach. Deleting was chosen over leaving
the folder (disk space and app stacks would stay, and who lowers the number mostly wants the space
back) and over asking when saving (a step more, and a clone a card holds is freed only later).

A card that will not work in its workspace again gives it back, which nothing else would do, a
restart included (`settleLeases` in `workers.ts`, on every change of the board and when Obeya
starts; `leaseEnded` in `board.ts` says why; only the workers a repository runs now, not those it
ran before its agents restarted, which until 2026-10-21 went on settling with the pool as it was and
gave a clone that had left it back): a deleted card; a workstream no worker is on (stopped with
work on its branch, say, and that work merged by hand) once the plan doc on the default branch
ticks it off or no longer has it (the doc gone, the workstream taken out); and a lease that outlived
its card's work, held by a finished card whose worker is done or by a card that names another
workspace or none, however it came about. Nothing is
lost: a clone keeps the card's branch and whatever else it holds and is free for other cards (one
with uncommitted changes takes none until it is clean, as any dirty clone); a worktree goes once it
holds nothing uncommitted, its branch kept, and stays as it is otherwise (it takes no slot). A
deleted card brought back with the undo takes its clone back while that is still free, else its
next start takes another (a worktree is made again on its branch). Until 2026-10-21 such cards held
their clone for good, with no button to free it: a stopped workstream ticked off showed as done
while the pool counted its clone taken; until a later change that day, a stopped workstream whose
doc went from the default branch (as plan docs go once done) held it for good too, and so did any
lease its card no longer named.

#### Slots

A repository's workers in clones are capped by slots, not by clones: a slot is room for one busy
worker (in a turn, or waiting for its background work), and a machine has a number of them (`slots`
for this one, per host for the others; as many as it has clones when left out). A new card takes a
clean free clone on the first machine, this one first and then the hosts in the configuration's
order, whose busy workers leave it a slot; with none, it waits in the queue for a slot (`workspace:
'slots'`, "Wartet auf freien Slot") and starts once a turn ends somewhere. A card holds its clone
until its work lands, but a slot only while its worker is at work: waiting for the owner it holds
none. A message to a waiting card is never held back for a slot, so a machine may go over its slots
for a while when the owner answers several cards in a row; the owner's question to a finished card
takes a clone on a busy machine when no machine has a slot. Slots count per repository: two
repositories on one machine each have their own.

A repository in worktrees can have slots too (`slots`, in the Konfiguration dialog under its row): a
new card makes its worktree only while fewer of its workers are busy, else it waits for a slot the
same way; left out, any number work at once.

#### A finished card's question

The owner's question to a finished card does not wait for a slot, nor for a clone. A clean free
clone is its first choice (full tooling); with every clone leased or the free ones dirty, it runs in
a temporary worktree (`followUpTree`): detached at the head of the card's branch, made the way the
Lesestand is (hooks off) from the clone on this machine that holds the branch, else from the
configured checkout at `origin`'s copy of the branch or at the default branch; under
`follow-up/<card>` in the repository's workspaces directory, in no pool and taking no clone, and
removed (with `git worktree prune` in its clone) once the follow-up ends.

Its worker is told the repository's app stack and tooling may not run there; if answering needs
them, it calls `need_clone`, tells the owner with `reply` and ends its turn: session and worktree
end, and the card waits without a workspace for the next clean free clone, its status line „Wartet
auf Workspace“ (it counts in the pill with the cards waiting for a workspace). The Koordinator's
drain gives it the next one, before the queued cards (`leasable(true)`, then `takeClone`), and its
session resumes there by itself; what the owner says meanwhile waits for that message.

#### The pool in the bar

For each repository that uses clones, the top bar shows the pool ("Workspaces"): per machine, named
once there is more than one, a dot per clone, solid while its card's worker is at work and pale
while the card holds it otherwise, and how many new cards could start now ("2 frei" or "alle
belegt"); over it, each machine's slots at work and clones taken, the cards that hold one (those at
work first), and how many cards wait for a workspace or a slot. The snapshot carries the pools
(`workspaces`, by machine): leases change only with a card, and a worker's turn starting or ending
changes the board, so they ride on its updates. Worktrees are never short: a repository in worktrees
shows a dot per slot, solid while a worker is at work, and none without slots, so a canvas of only
those without slots shows no pill.

### Folders without git

A repository on a canvas may be a folder that is not a git repository and is to stay one: a
family's document archive in a cloud drive, say, where a `.git` would mean sync conflicts and
thousands of small files, and git would copy every scan into its object store and every card's
worktree. Its entry in the configuration says so (`"git": false`, `RepoConfig.git`); the first
canvas and „+ Repository“ offer it beside setting up git (see Setting up git in a folder). Such a
repository has no branch, no landing, no pull requests, no prototypes, no hosts and no clones; the
UI offers none of them there (the configuration dialog shows neither main branch nor landing,
workspaces, clones, slots or hosts, and „Für alle ins Repository übernehmen“ is left out: the
folder's `.obeya/settings.json` is written there like any other file).

**Workspaces.** `FolderWorkspaces` (`src/server/folder.ts`) gives every card the folder itself, any
number at once; nothing lands, and approving makes the card `done` („Freigegeben. Die Änderungen
bleiben im Ordner: erledigt.“), as for a card with nothing to land. A finished card's question runs
in the folder too. The worker's instructions say it works directly in a folder others work in at the
same time, and that the card lists what it changed; a handover needs a demo only where something
can be seen (an HTML artifact for a draft or an overview), since the change list shows the rest.

**Each card's changes.** Obeya keeps a manifest of the folder (each file's and directory's path,
size, mtime, ctime and inode; skipped: what Finder, Drive and office suites keep for themselves,
`.DS_Store`, `.tmp.drive*`, `~$…` lock files and the like). Every tool call of a card's agent that
may write (not Read, Grep, Glob and the like) opens a window from its `PreToolUse` hook to its
`PostToolUse` hook (`AgentSpec.watch`, waited for: the agent goes on once its change is recorded);
then Obeya reads the folder again and gives each change to the cards whose windows were open when it
happened, by its ctime, which no tool sets (a deleted file by its directory's). So a change is a
card's own even while other cards, the owner, a scanner or the sync client change the folder at the
same time; a change outside every window is no card's. A window opens at the time as the file
system stamps a ctime, read off a file of Obeya's own written then: Linux stamps it from a coarse
clock up to a tick (1 to 10 ms) behind the system's, and by the system's time a change right after
the window opened would have come before it. Before the window opens, the folder is read
too, so what the owner changed just before is not the call's. An editing tool (Edit, Write,
NotebookEdit) takes only its own file (through a link, the file it points to), and the folder is
read only there; a script's call reads all of it, before and after (on the owner's document folder,
4,615 files: 0.3 s; 45,717 entries: 0.5 s). A change that happened while calls of two cards ran
cannot be told apart: both cards list it, and neither undo touches it. Background work keeps a window open while it runs;
the end of a turn closes any window whose end the hooks never told. A file only in the cloud (a
dataless file of a file provider: no blocks on disk) is never read, hashed or copied, which would
download it. What a card changed is one entry per path, from before its first change to after its
last (added, changed, moved, deleted; a moved directory is one move), with a hash of what it wrote;
kept in `folder_cards`, and after the card is done too. Agents that only read (the Koordinator,
project agents) are not followed.

The card shows the list in the place of its branch („Im Ordner geändert: 4 Dateien +12 −1 ·
Rückgängig: vollständig“) and below it beside the handover (↪ moved, ＋ added, ✎ changed, ✕ deleted;
the lines added and removed in columns of their own, never broken off the path; all of them, a list
longer than about ten lines scrolling in that height, its scrollbar always shown), and „Ansehen“ shows
it over the page with the diffs of text files whose earlier version Obeya kept (`git diff --no-index`;
a file counts as text up to 1 MB without a NUL byte in its first 8,000). Beside the conversation, the files it changed show as
its result, Markdown formatted, a PDF as a PDF (see The files beside the demo); its worker names
those that are the result for the owner when it hands over. A click on a file's name in the list
beside the handover opens its tab there, a click on its lines (+N −M) its diff alone, with „Ganzes
Diff ansehen“ beside it for the rest, as the lines in the line under the title open the whole diff.
Where the card shows no files beside its conversation (before its first handover, or with nothing of its change to show), the name opens the diff too,
as it does in the list over the page.

**Undo.** „Änderungen verwerfen“ on a card waiting for approval puts back what it changed, after
eight seconds in which the button counts down in itself („Änderungen verwerfen 7 s ×“, the × in red,
„Noch einmal klicken bricht ab“ beside it) and a second click calls it off: putting files back cannot itself be taken
back. Before a card's first call that may write, Obeya makes its undo ready under its home
(`undo/<canvas>/<repo>/<card>`):

- where the file system clones (APFS `clonefile` on a Mac, reflink on btrfs and XFS; probed by
  cloning one file with `COPYFILE_FICLONE_FORCE`), a clone of the whole folder: it shares the bytes
  until a file changes (measured on the 8.1 GB folder: 0.86 s, no space taken, 0.39 s to remove), so
  it grows only by the old versions of what changed meanwhile. The card's undo is full.
- where it does not (Obeya's home on another volume, NTFS, ext4, and so far Windows' ReFS and Dev
  Drive, which Bun reaches no clone call for), copies of the folder's text files. The card's undo is
  partial.

Either way, an editing tool's file is copied just before it writes it the first time. Undo puts back
only what the card changed, from the copy that matches the file as it was before the card's first
change (size and mtime): added files are deleted, changed and deleted ones put back (written beside
and renamed over), then moves moved back, so a directory the card moved takes back what the card
changed in it. Left alone are a file someone changed after the card (its ctime and inode are no
longer what the card left, and its hash where Obeya read it, else its size and mtime, differ), one
no copy was kept of (a script overwrote or deleted it under a partial undo), and a change two cards'
calls shared; the card's log names them, its list keeps them, and its worker hears what happened
with its next message. The card says which undo it has, and each entry of its list what discarding
would do with it, before the owner decides. The undo goes when the card is done or its changes are
discarded (and is made afresh if its worker goes on).

**Lesestand and settings.** The folder is its own Lesestand; its plan docs and `.obeya/settings.json`
(and its Claude Code configuration, for the trust check) are read from it as they are
(`isFolder`, `readSharedFiles`). A plan doc „Als Projekt planen“ writes is named at the start, as
for a plan folder outside the repository: nothing of it lands.

### Parking

A card that waits for the owner (handed over, asked, its pull request open), its worker without a
turn or background work, has the app in its workspace stopped after a grace of five minutes
(`OBEYA_PARK_GRACE` in seconds for a demo or a live check; a quick reply should not pay for a
restart): Obeya runs the settings' `app.stop` there through the platform's shell
(`src/server/app-command.ts`; one from the repository only once the owner trusted it, see Trusting
a repository's commands), unless `app.keep` exits 0 (the app holds data that must stay; the
card says it keeps running, and the owner who wants it stopped anyway tells the worker). An app the
owner opened from the card is stopped no sooner than 30 minutes after (see Trying the app by hand).
The card's log says the app was stopped (`parked` on the card's row); the next message to the worker carries a
line that it was, telling it to start it again as the recipe says, and clears it. A message that
arrives while the stop runs waits for it, so the worker cannot start the app only to have it
stopped. A stop that fails is an
error on the card, and the worker hears nothing. After a restart, waiting cards are parked the same
way. The workspace stays the card's; only its processes go.

### Hosts

Other machines a repository's workers run on, reached over SSH (`src/server/hosts.ts`). The
configuration lists them per repository (`hosts`: name, SSH target, the directory there that holds
the clones, how many, how many slots), and the Konfiguration dialog edits them under the clones, one
table row per machine, as the Koordinator's `configure` does by voice; only a repository that works
in clones and lands through its remote can have them (`hostRepo`), and a name stands for one machine
across the configuration (`hostName`). Obeya clones the repository there itself in the background
(an unreachable host is tried again every two minutes; the log says what went wrong once, and again
only when that changes or the clones are in place) and registers each clone as the workspace
`ssh://<host>/<path>`; a new card goes there when the machines before it have no slot (see Slots).

#### Running there

A workspace's name says where it is, so every git call in it (`git`, `gitAsync`, `exists`), the
stack commands and the worker's session run there through `ssh` without the callers
knowing: `ssh <target> exec sh -c '…'` with the installers' directories on its `PATH` (the host's own
`~/.zshenv` adds the rest; `exec`, so a login shell that forks for a command, as dash does, does not
stay as the session's parent with another pid), one shared connection where the platform has `ControlMaster` (not
Windows; its sockets in `/tmp/obeya-ssh-<uid>`, the owner's alone, since whoever reaches a socket
uses its connection), `BatchMode` so nothing prompts, and keep-alives that notice a dropped link within 45 s.

The calls the server waits for (`git`, `exists`: looking for a clean free clone, a card's changes)
block it, and ssh gives up on a host that does not answer only after seconds (5 s for a `.local`
name it cannot resolve): once a connection to a host has failed, these fail at once instead, the
host counting as unreachable, and a call 30 s later or after has it asked again in the background;
when it answers, the board counts as changed, so cards waiting for a clone look again. The calls
that do not block go out as ever, and their answers say whether the host is back.

#### Logins and files

Nothing secret is stored there: the repository's GitHub login (what `git credential fill` gives in
its checkout here, so the account its own configuration picks) and the Claude login (`claude-token`
in Obeya's home, from `claude setup-token`) travel as the first line of stdin of each command and
session, and the clones' credential helper reads `GH_TOKEN` (with an empty helper before it, so
macOS's keychain does not keep it). The clones are marked trusted in the host's `~/.claude.json`,
since nobody answers the folder dialog there and the repository's own permission rules would not
apply.

The session is the Agent SDK's `spawnClaudeCodeProcess`: Claude Code started through `ssh` in the
workspace, with Obeya's tools and hooks over its stdin and stdout as here (checked on the owner's
second MacBook, macOS x86_64, 2026-10-09). Before a host's first session in a run of Obeya, the
plugin and the `playwright-core` its demo skill imports go to `~/.obeya/remote` there (again only
when they changed), with the owner's demo settings (the voice reference as a path here, without a
key file), and the session gets that directory as `OBEYA_HOME`. `OBEYA_URL` is a port there
forwarded (`-R`, one per session) to a server of Obeya's that answers narration clips and nothing
else (`serveNarration`, its address the workers' `OBEYA_NARRATION_URL`), since everyone on that
machine reaches the port: forwarded to Obeya itself, the port let anyone there run commands here
through its settings until 2026-10-16. A narration clip comes back in the reply (`inline`, base64,
the only kind that server takes) instead of a file on Obeya's machine: the owner's own voice, which
only this Mac can run, narrates demos rendered there.

Files cross at fixed points: the owner's screenshots are copied to `~/.obeya/remote/images` there
with the message that carries them, and the message names them by their paths there; a demo named in
a handover is copied here (`<home>/hosts/<host>/<path>`), afresh at each handover, and served and
shared from that copy (a path with `.` or `..` in it is refused: the copy replaces what is at its
place, and `/../../..` was the owner's home); the Arbeitsrückschau reads a session's transcript from there. gh on a pull
request runs here, on its URL.

#### A dropped connection

A dropped connection (ssh's exit code 255), or a host that cannot be reached to get the plugin
before the session starts, ends the session as a restart does (`lost`): the card says so, Obeya
asks every 30 s whether the host answers, then resumes the session by its id with the message it
had not yet taken, or with word of the drop if it was at work (a session that never started there
has no id: a new one starts with the message it was to begin with); a card waiting for the owner
needs no session until their next message. The session that resumes ends the one the drop may
have left running there first (by the pid it wrote; never itself, as a host that restarted since,
a container say, gives out the same pids again).

What a host needs installed: git, Claude Code and what the repository's own work needs (for the
owner's work repository: .NET, Bun, Node, uv, Docker, Chrome, ffmpeg); Homebrew no longer serves
Intel Macs, so those went into the user's home there by their own installers.

### Decisions

- **The installed app runs the machine's own Claude Code**, not the binary the Agent SDK brings
  (2026-10-07): that one would add 224 MB to every download, put Anthropic's proprietary binary into
  an MIT app and keep its version until the next release of Obeya. The two may drift apart in their
  protocol; it held with every version tried, and the setup assistant names the version Obeya was
  checked with.
- **Obeya's tools are allowed by a hook** (2026-10-10): as bare `allowedTools` they had the SDK
  print a `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning with a stack trace into Obeya's log at every
  worker start.
- **Workers run on more than one machine, capped by busy workers rather than by workspaces**
  (2026-10-10). Measured on the owner's Mac (M4 Pro, 48 GB), 1–8 Oct 2026, on the canvas of their
  work repository: workers were in a turn for 74 of the 963 worker-hours they held a workspace (8
  %), at most 8 at once, and busy work beyond 3 at once came to 17.6 worker-hours in 5 working days.
  The 5–9 held clones each kept their app stack running, which filled the 48 GB and a 20 GB swap;
  the Claude Code processes took 2.3 GB in all. So a waiting card stops its stack (parking), a
  machine counts slots for busy workers, and a card that finds none here goes to another machine
  over SSH (the owner's second MacBook first), where it stays until its work lands, since its
  workspace and its session live there. Nothing secret is stored on such a host; the logins travel
  with each command. Until 2026-10-10 the clones were the only cap, and a card went to another
  machine only once every clone here was leased; until 2026-10-09 a waiting card's stack ran until
  someone stopped it by hand.
- **Worktrees by default** (2026-10-14). Until then Obeya's defaults (then the generic adapter),
  and so every new canvas of a repository that did not say otherwise, used clones; a canvas set up then has `clones` in its
  configuration and keeps them. Until 2026-10-14 nothing capped the workers of a repository in
  worktrees. Until 2026-10-21 the choice sat only among the folded settings and the clone fields
  showed only once a repository was in clones, so a new canvas in worktrees offered no way to name
  existing clones that could be seen.
- **A finished card's question takes a temporary worktree when no clone is free** (2026-10-15).
  Before, the question failed with an error when no clean clone was free, and nothing waited.
  Rejected: queuing every such question at once (clones are often held for days by cards in review
  or in a pull request), and answering in the Lesestand (other agents read there at the same time).
- **A folder may stay without git** (2026-10-20): a document archive in a cloud drive (8.1 GB, 4,615
  files, 2,289 of them PDFs, 327 plain text) cannot take a `.git` without sync conflicts and copies of
  every scan, so the only offer, setting up git, ruled it out. Cards work in the folder itself, several
  at once with the Koordinator's overlap check on files and directories; each card's changes are told
  apart by the ctime of what changed during its tool calls; undo is full from a clone of the folder
  where the file system clones, partial elsewhere. Rejected: a shadow git outside the folder (it copies
  every file into git and the whole folder into each card's worktree), and a copy per card applied on
  approval (cheap only where cloning works; working in place in parallel was chosen).
- **An unreachable host fails fast** (2026-10-12). Until then each look for a free clone asked an
  unreachable host twice per clone there, with five clones there almost a minute in which Obeya
  answered nothing, at every change of the board while a card waited.
