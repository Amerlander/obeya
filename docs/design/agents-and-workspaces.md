## Agents and workspaces

A chapter of the [design doc](../design.md), whose header says how it is written.

### Agents

Agents are Claude through the Agent SDK on the machine's Claude Code login (the owner's
subscription, no API key). The checkout runs the Claude Code binary the SDK brings; the compiled app
runs the machine's own (`claude` on the `PATH`, else `~/.local/bin`, or `OBEYA_CLAUDE`). Agents get
Obeya's environment without the marks of a Claude Code session that may have started Obeya
(`CLAUDE_CODE_*`, `CLAUDECODE`, `CLAUDE_PID`) or of its supervisor (`OBEYA_SUPERVISED`,
`BUN_BE_BUN`), but with `CLAUDE_CODE_OAUTH_TOKEN`, the login of a machine without a keychain.

A worker is one session per card with streaming input, permission mode `auto`, and the repository's
Claude Code settings and CLAUDE.md (only once the owner trusted them, see Trusting a repository's
commands); after a restart it resumes by session id. A project agent is one session per project in
the Lesestand, resumed for each of the owner's questions about the project, one at a time. Project agents, ideas'
exploration agents and the Koordinator's look-ups have a worker's tools and mode (see Looked-up
questions); agents that only judge from text (reading commands, estimates, the learner) are
read-only: Read, Grep, Glob, mode `dontAsk`.

Every session refuses long foreground sleeps in Bash (see Waiting without blocking). What changed
since a session's instructions were built reaches the agent once, with its next tool call's result
(not a subagent's), without a message or turn: a preference of the owner learned meanwhile; for a
workstream's worker also its project's new decisions and the owner's notes that came during its turn
(see Reading order). A call the settings want confirmed becomes the question the card waits on (see
Refused and confirmed tool calls); Obeya's own tools are allowed by a `PreToolUse` hook.

### Models and effort

Every agent belongs to one of four groups: the Koordinator (voice commands, estimates and schedules,
look-ups, project agents, learner, Rückschau, proposal rewrites), workers, ideas' exploration agents,
and small jobs (the Arbeitsrückschau's notes and proposals, a shared demo page's text, a card's
title). The Konfiguration dialog sets each group's model (Claude Code's default or an alias: Fable,
Opus, Sonnet, Haiku) and effort (low to max) and marks the presets: Opus throughout, high effort for
workers and exploration agents, medium otherwise. Stored in `settings.json` under `agents`, only
where it differs from the preset. Saving restarts nothing; agents starting afterwards take it, a
running session keeps its own, except the voice commands' session, which reopens when the
Koordinator's setting changes (as for another language).

### Workspaces

A card works in a worktree of its own, unless the repository's settings say clones or its
configuration names some (`clones`, `workspaces` or `hosts`). Worktrees: any number in parallel
unless the repository has `slots`. Clones (for tools that break in a worktree, or an app stack per
clone): a pool, each clone leased by one card. `clones` is how many Obeya makes in its own directory
(`workspaces/<canvas>/<repo>/1..n`), on top of the existing ones `workspaces` lists (on the command
line `--clones <n>`, `--workspace <path>`); the Konfiguration dialog shows the sum. A card keeps its
workspace across stop and restart until its work has landed and its worker finished what remains.

Starting a card does not block the server: the workspace is taken at once (so slots and the queue
see it taken), and git makes it ready in the background: `git worktree add` (a minute in a large
repository on Windows), or a clone's fetch and checkout of the card's branch (over SSH on a host),
the temporary worktree of a finished card's question likewise. Meanwhile the card is at work, its
status line „Bereitet den Workspace vor …“; it holds a slot, a restart waits for it, and the
owner's words wait unread until the worker starts with its task. A card stopped meanwhile gives
the workspace back once git is done. Where git fails, the workspace goes back, the card returns to
where it was (planned, its snooze gone, the words kept for its next start) and its conversation
says why; a clone git failed on is passed over for a while, like a dirty one, so a fetch that keeps
failing does not take it again and again.

The pool is what the configuration names. A clone no longer named leaves it: a free one at once, a
leased one when its card gives it back (no card moves mid-work). A clone Obeya made is then deleted
from disk, after `app.stop` ran in it, if nothing would be lost: no uncommitted or untracked files
(ignored ones aside), no stash, no submodules, no worktree from it in use, and no branch, tag or
detached HEAD with commits on no branch of `origin` (fetched with pruning) unless each file they
change is as on `origin`'s main branch, so a branch squashed or rebased in its pull request counts as
landed (where work lands on the local main, `origin` is the Obeya checkout). The folder is moved
aside first, so a clone named again meanwhile (here or by another canvas) is never removed under a
card. Otherwise it stays: the log says once what lies in it, the pool's tooltip shows „bleibt: nicht
gelandete Arbeit in <Pfad>“, and a later start looks again; raising the number takes it back as it
is. Clones the owner listed, and folders on a host no longer configured, are never touched.

A card gives its workspace back once it will not work there again, checked at every board change and
at start: deleted; a workstream no worker is on once the plan doc on the default branch ticks it off
or no longer has it; or a lease that outlived its card's work (finished and its worker done, or the
card names another workspace). A clone keeps the card's branch and the rest and is free for others
once clean; a worktree goes once nothing in it is uncommitted, its branch kept. A deleted card
brought back with the undo takes its clone back if still free, else another at its next start.

#### Slots

Workers in clones are capped by slots, not clones: a slot is room for one busy worker (in a turn or
waiting for background work), counted per machine and repository (`slots` here, per host for the
others; as many as clones when left out). A new card takes a clean free clone on the first machine
(this one, then the hosts in order) with a slot left; with none, it waits („Wartet auf freien Slot“)
until a turn ends somewhere. A card holds its clone until its work lands, a slot only while its
worker is at work. A message to a waiting card is never held back for a slot, so a machine may go
over its slots for a while. A repository in worktrees can have slots too (in the Konfiguration
dialog under its row), which cap its busy workers the same way; left out, there is no cap.

#### A finished card's question

The owner's question to a finished card waits for neither slot nor clone. It takes a clean free
clone if there is one, else a temporary worktree (hooks off) detached at the head of the card's
branch, from the clone here that holds the branch or else the configured checkout (at `origin`'s
copy of the branch, else the default branch), under
`follow-up/<card>` in the repository's workspaces directory, removed when the follow-up ends. Its
worker is told the app stack may not run there; if it needs it, it calls `need_clone`, tells the
owner with `reply` and ends its turn, and the card waits for the next clean free clone („Wartet auf
Workspace“), ahead of queued cards, where its session resumes by itself; what the owner says
meanwhile waits for it.

#### The pool in the bar

For each repository in clones the top bar shows the pool („Workspaces“): per machine (named once
there is more than one) a dot per clone, solid while its card's worker is at work, pale while merely
held, and how many new cards could start („2 frei“, „alle belegt“). Its tooltip lists each machine's
slots at work and clones taken, the cards holding one, and how many cards wait for a workspace or a
slot. A repository in worktrees shows a dot per slot, and none without slots (no pill if all are so).

### Folders without git

A repository may be a folder that is to stay without git: a family archive in a cloud drive, where a
`.git` would mean sync conflicts and copies of every scan. Its configuration entry says `"git":
false`; the first canvas and „+ Repository“ offer it beside setting up git (see Setting up git in a
folder). It has no branch, landing, pull requests, prototypes, hosts or clones, and the UI offers
none of them (nor „Für alle ins Repository übernehmen“: `.obeya/settings.json` is written into the
folder like any file). The folder is its own Lesestand, its plan docs, settings and Claude Code
configuration read as they are; a plan doc „Als Projekt planen“ writes is named at the start, as in
a plan folder outside the repository, since nothing of it lands.

Every card works in the folder itself, any number at once. Nothing lands: approving makes the card
`done` („Freigegeben. Die Änderungen bleiben im Ordner: erledigt.“). The worker is told others work
in the folder at the same time and that the card lists what it changed; a demo is needed only where
something can be seen (an HTML artifact for a draft).

**Each card's changes.** Obeya keeps a manifest of the folder (path, size, mtime, ctime, inode),
skipping what Finder, Drive and office suites keep for themselves. A tool call that may write (not
Read, Grep, Glob and the like) opens a window from its `PreToolUse` to its `PostToolUse` hook; the
folder is read before and after, and each change goes to the cards whose windows were open at its
ctime, which no tool sets (a deleted file by its directory's). So a change is a card's own even while
others, a scanner or the sync client change the folder; one outside every window is no card's, and
one during two cards' calls is listed by both and undone by neither. The window opens at a time read
off the ctime of a file Obeya writes then, since Linux stamps ctime from a coarse clock up to 10 ms
behind the system clock. An editing tool's call reads only its file; a script's call reads the whole
folder (0.3 s for 4,615 files). Background work keeps a window open; the end of a turn closes any
left open. A file only in the cloud (dataless) is never read, hashed or copied, which would download
it. Per path, a card's change runs from before its first change to after its last (added, changed,
moved, deleted; a moved directory is one move), with a hash of what it wrote, kept after the card is
done. Agents that only read (the Koordinator, project agents) are not followed.

The card shows the list in the place of its branch („Im Ordner geändert: 4 Dateien +12 −1 ·
Rückgängig: vollständig“), whose size shows it over the page with diffs of the text files whose
earlier version Obeya kept, and in full as the change list at the top of its left column (see The
files beside the demo), with what discarding would leave. Where the card shows no files beside its
conversation (before its first handover), the same list stands above the conversation, a click on a
file's name or line counts opening its diff, with „Ganzes Diff ansehen“ beside it.

**Undo.** „Änderungen verwerfen“ on a card waiting for approval puts back what the card changed after
eight seconds in which the button counts down and a hint beside it says a second click calls it
off, since this undo cannot
itself be undone. Before a card's first write, Obeya prepares it under `undo/<canvas>/<repo>/<card>`
in its home: where the file system clones (APFS `clonefile`, reflink on btrfs and XFS; probed with
`COPYFILE_FICLONE_FORCE`), a clone of the whole folder, sharing bytes until a file changes (8.1 GB in
0.86 s, no space taken): full undo. Elsewhere (another volume, NTFS, ext4, Windows' ReFS and Dev
Drive, which Bun reaches no clone call for), copies of the text files: partial undo. An editing
tool's file is also copied just before its first write. Undo deletes added files, puts back changed
and deleted ones from the copy matching their state before the card (size and mtime), then reverses
moves. It leaves alone a file changed after the card (ctime, inode and hash or size and mtime differ
from what the card left), one with no copy, and a change two cards shared: the log names them, the
list keeps them, and the worker hears of them with its next message. Before the owner decides, the
card says which undo it has and what discarding does with each entry. The undo goes when the card is
done or discarded, and is made afresh if its worker goes on.

### Parking

A card waiting for the owner (handed over, asked, pull request open), its worker idle, has the app in
its workspace stopped after five minutes, so a quick reply does not pay for a restart
(`OBEYA_PARK_GRACE`, in seconds, for demos and live checks). Obeya runs the settings' `app.stop`
there (once the owner trusted it, see Trusting a repository's commands), unless `app.keep` exits 0
(the app holds data that must stay; the card says it keeps running). An app the owner opened from the
card runs at least 30 minutes (see Trying the app by hand). The card's log says the app was stopped,
and the next message to the worker tells it to start the app again as the recipe says; a message
arriving during the stop waits for it. A failed stop is an error on the card; the worker hears
nothing of it. After a restart,
waiting cards are parked the same way. Only processes go; the workspace stays the card's.

### Hosts

Other machines a repository's workers run on, over SSH. The configuration lists them per repository
(`hosts`: name, SSH target, directory for the clones, number of clones and of slots); the
Konfiguration dialog edits them as table rows under the clones, as the Koordinator's `configure` does
by voice. Only a repository in clones that lands through its remote can have them; a name means one
machine across the configuration. Obeya clones the repository there in the background (retrying an
unreachable host every two minutes, logging a failure once until it changes) and registers each clone
as `ssh://<host>/<path>`; a new card goes there when the machines before it have no slot (see Slots).

#### Running there

Every git call, stack command and worker session in such a workspace runs there through `ssh`,
unseen by its callers: `ssh <target> exec sh -c '…'` with the installers' directories on the `PATH`;
`exec`, so a shell that forks for a command (dash) does not stay as the session's parent under
another pid. One shared connection where `ControlMaster` exists (not Windows), its sockets in
`/tmp/obeya-ssh-<uid>` for the owner alone, since whoever reaches a socket uses its connection;
`BatchMode`; keep-alives that notice a dropped link within 45 s. Calls the server blocks on (looking
for a free clone, reading changes) fail at once after a host's connection failed, and the host is
asked again in the background 30 s on; when it answers, waiting cards look again.

#### Logins and files

Nothing secret is stored there: the repository's GitHub login (from `git credential fill` here) and
the Claude login (`claude-token` in Obeya's home, from `claude setup-token`) travel as the first line
of stdin of each command and session; the clones' credential helper reads `GH_TOKEN` (after an empty
helper, so macOS's keychain does not keep it). The clones are marked trusted in the host's
`~/.claude.json`, since nobody answers the folder dialog there and the repository's own permission
rules would not apply.

The session runs through the SDK's `spawnClaudeCodeProcess`: Claude Code started over `ssh`, with
Obeya's tools and hooks over its stdin and stdout. Before a host's first session, the plugin and the
`playwright-core` its demo skill needs go to `~/.obeya/remote` there (again when changed), with the
owner's demo settings without a key file (no API key goes to a host), and that is the session's
`OBEYA_HOME`. Its `OBEYA_URL` is a port forwarded
(`-R`) to a server of Obeya's that answers only narration clips, inline as base64, so demos rendered
there get the owner's voice, which only this machine runs.

Screenshots in the owner's message are copied to `~/.obeya/remote/images` there and named by those
paths; a demo named in a handover is copied here (`<home>/hosts/<host>/<path>`) afresh at each
handover and served and shared from that copy (a path with `.` or `..` is refused, since the copy
replaces what lies at its place); the Arbeitsrückschau reads
transcripts from there; gh runs here, on the pull request's URL.

#### A dropped connection

A dropped connection (ssh's exit code 255), or a host unreachable before the session starts, ends the
session as a restart does: the card says so, Obeya asks every 30 s whether the host answers, then
resumes the session by id with the message not yet taken, or word of the drop if it was at work (a
session that never started there starts anew with its first message); a
card waiting for the owner needs no session until their next message. The resumed session first ends
the one the drop may have left running there, by the pid it wrote, never itself (a restarted host,
a container say, reuses pids). A host needs git, Claude Code and what the repository's work needs.

### Decisions

- **The installed app runs the machine's own Claude Code**, not the SDK's binary (2026-10-07): that
  would add 224 MB to every download, put Anthropic's proprietary binary into an MIT app and pin its
  version to Obeya's releases. Their protocols may drift; it held with every version tried, on macOS,
  Windows and Linux, and the setup assistant names the version Obeya was checked with.
- **Exploration agents and look-ups have a worker's tools** (2026-10-12). Rejected: read-only tools,
  with which they answered from the text, or said they could not see, what they could have checked.
- **Obeya's tools are allowed by a hook** (2026-10-10). Rejected: `allowedTools`, which makes the SDK
  log a `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning with a stack trace at every worker start.
- **Workers run on more than one machine, capped by busy workers rather than workspaces**
  (2026-10-10). Measured on the owner's Mac (M4 Pro, 48 GB), 1–8 Oct 2026: workers were in a turn for
  74 of the 963 worker-hours they held a workspace (8 %), at most 8 at once, busy beyond 3 at once for
  17.6 worker-hours in 5 working days; the 5–9 held clones' app stacks filled the 48 GB and 20 GB of
  swap, while Claude Code took 2.3 GB. So waiting cards park, machines count slots for busy workers,
  and a card finding none goes to another machine, where it stays until its work lands. Rejected:
  clones as the only cap; stacks running until stopped by hand.
- **Worktrees by default** (2026-10-14); a canvas whose configuration names clones keeps them.
- **A host's forwarded port reaches a server that answers only narration clips** (2026-10-16).
  Rejected: forwarding to Obeya itself, which let anyone on that machine run commands here.
- **A finished card's question takes a temporary worktree when no clone is free** (2026-10-15).
  Rejected: failing; queuing it (clones are often held for days by cards in review); the Lesestand
  (other agents read there at the same time).
- **A folder may stay without git** (2026-10-20): a cloud-drive archive (8.1 GB, 4,615 files, mostly
  PDFs) cannot take a `.git` without sync conflicts and copies of every scan. Cards work in place, in
  parallel with the Koordinator's overlap check on files; changes are told apart by ctime; undo is
  full where the file system clones. Rejected: a shadow git outside the folder (copies every file
  into git and the folder into each worktree); a copy per card applied on approval (cheap only where
  cloning works).
- **The pool follows the configuration; a clone leaving it is deleted** (2026-10-21), so a lowered
  number gives disk space and app stacks back. Rejected: clones staying once registered; leaving the
  folder; asking when saving (a step more, and a leased clone is freed only later).
- **A lease is given back from the card's state** (2026-10-21), whatever brought it there. Rejected:
  freeing only on a card's normal path, which left stopped, ticked-off workstreams holding clones.
- **An unreachable host fails fast** (2026-10-12): asking it on every look for a free clone (almost a
  minute with five clones there) left Obeya unresponsive while a card waited.
