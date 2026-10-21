## Landing

A chapter of the [design doc](../design.md), whose header says how it is written.

### How work lands

In a folder without git nothing lands: what a card changed is in the folder already, and approving
makes the card `done` (see Folders without git). Elsewhere:

As the repository's `.obeya/settings.json` or the owner for this machine set it (see Repository
settings), read at each approval:

- `pr`: approval leaves the branch for the PR loop.
- `main` (Obeya): approval rebases the branch onto `main` and fast-forwards the Obeya checkout; the
  card is `live`.

A card whose own branch changes `land` or `direct` in `.obeya/settings.json` (the card that sets up
the settings, say) lands as its branch says, unless the settings for this machine say otherwise
(`landingOf` in `src/server/workers.ts`): the owner approves the change with the work, and answered
in that card how work lands. The handover records it (`lands` on the card), so the approve button
says so before the click. Where the branch has the work go out as a pull request in a repository
that lands on main, the canvas watches the repository's pull requests from the moment the worker
reports one.

Where the settings do not say, it is detected (`detectedLand` in `src/adapters/index.ts`): `pr`
where `origin` is on GitHub, else `main`. On GitHub means github.com (or a subdomain of it) or a host the GitHub CLI is logged into,
read from its `hosts.yml` (`ghHosts` in `src/server/repo.ts`, where gh keeps it on each system)
rather than asked of `gh auth status`, which checks each login over the network. A repository on
another forge (GitLab, Codeberg, a server of its own) lands on its local main and pushes nothing,
unless its settings say `pr`: Obeya follows pull requests on Forgejo and Gitea too (see Watching the
PR), but whether a repository's agents can open one there only its own tooling says.

Commits that conflict one by one but not as a whole land squashed into one commit. The last commit
that lands for a card with a shared demo names its page in a trailer (`Demo-Video: <url>`, see
Publishing on approval). Uncommitted work
or a real conflict sends the card back to its worker with the approval kept: its next handover (no
new demo needed) lands on its own.

`pr` with `direct`: an approval "Direkt auf main" (`approve(card, { direct })`, refused with
`noDirect` where the settings lack `direct`) lands in the card's clone or worktree instead of a PR
(`pushToMain`): fetch, rebase onto `origin/<default>` (squash as above), `git push origin
HEAD:<default>`, never forced. A push turned away because the default branch moved meanwhile is
fetched, rebased and pushed once more; any other refusal (a protected branch, missing rights) stays
with the owner (`landPush`), the card back in review. Conflicts and uncommitted work go back to the
worker with the approval kept as above; since only a direct approval is held where work goes out as
a PR, its next handover is pushed directly too. The Obeya checkout is left alone; the read tree is
refreshed and plan docs the card adds are registered, as after a merge. The worker hears that its
work is on main, as after a landing. The settings' checks run before the handover as always; Obeya
does not watch the CI on the default branch.

Landing runs git without blocking the server (`gitAsync`): fetch, rebase and push take seconds over
the network, in which the page, the workers and the other canvases go on being served. Landings of
one repository run one after the other, so two approvals at once do not race on its main; a card
whose work is landing refuses another approval (`notReady`), and a restart of Obeya waits for it
like for a worker in the middle of a turn. The approval's answer still waits for the landing, and
its refusals (`landPush`, say) come back as before.

Starting a card does not block the server either. `Workspaces.lease` takes the workspace at once,
so no other card gets it and the Koordinator's slots and queue see it taken: a clone is chosen and
leased, a worktree registered under its path. Git then makes it ready in the background
(`Lease.ready`): `git worktree add` for a worktree (a minute in a repository of thousands of files
on Windows), `fetch` and the checkout of the card's branch for a clone (over SSH for one on another
machine), the temporary worktree of a finished card's question likewise. Meanwhile the card is at
work with its workspace and branch in the board, its status line „Bereitet den Workspace vor …“; it
holds a slot on its machine, a restart waits for it as for a landing, and the owner's words wait
unread for the worker, which hears them with its task once git is done (`Workers.whenReady`). A
card stopped meanwhile gives the workspace back once git is done; a temporary worktree removed
meanwhile goes once git has added it; a prototype's branch is not built on while it is prepared.
Where git fails, the workspace is given back, the card goes back to where it was (planned, its
snooze gone, the words for the next start; a question waiting for a clone waits again) and its
conversation says why; a clone git failed on is not taken again within `RECHECK_MS`, as one found
dirty, so that a fetch that keeps failing does not take it over and over. `Workers.start` returns
once the worker has started; refusals (`notPlanned`, no workspace free) still throw at once, so the
Koordinator queues the card as before. A clone's `git status`, which tells a clean one from a
dirty one, still runs on the server's thread.

The click ends the owner's turn at once: Obeya records the approval (`approved_at`) before it lands,
and the card, still `waiting`, is `landing` (“wird freigegeben …” in the approved colour), no longer
counted in "brauchen dich" nor reached by Tab. A refusal, or a restart that cut the landing off,
gives the card back to the owner. Tab goes on from the card it opened last by its place on the
canvas, so the card that dropped out does not make it skip the next one.

### PR loop

On approval (unless "Direkt auf main", see How work lands) the worker hears that its work goes out
as a pull request, opened the way the repository does it (its own skills and conventions, a
description for readers who have not seen Obeya), and reports it with the tool `pr_opened(url)`,
which takes a pull request on GitHub (`…/pull/<n>`) or on Forgejo and Gitea (`…/pulls/<n>`: Codeberg,
a server of one's own, also below a path).
From then on it may push its branch, never merges, and ends its turn after each round instead of
handing over again.

#### Watching the PR

Per repository a watcher polls every open PR every two minutes (state, mergeability, checks,
conversation and review comments, inline comments), and right away when the owner comes back to an
Obeya page (it becomes visible or gets the focus; at most once in 15 seconds): the owner merges on
GitHub and returns. The watcher sits behind a small forge interface (`src/server/forge.ts`), which
picks the forge by the PR's URL, so the loop is tested against a fake:

- GitHub through `gh`, as the account that owns the repository (the PR's, or the `origin` a new PR
  goes to) where gh has a login for it, its token as `GH_TOKEN`, whatever account gh has active:
  another one does not see a private repository of the owner, and the watcher would never learn of
  the merge.
- Forgejo and Gitea (`src/server/forgejo.ts`) through their REST API (`<server>/api/v1`), with
  curl and the login git has for the repository (`git credential fill` with `origin`'s URL where
  that is the repository, so a helper keyed by its path finds it: the keychain, Git Credential
  Manager, libsecret; never asking). Where git has none, an access token stored as git's password
  for the host serves; a push over https with it stores it. Forgejo keeps no review threads: the
  inline comments on one line of one file are a thread, the first opens it, and it is resolved when
  one of them is. It says only whether it can merge now, which it cannot while it still checks a
  new push (seconds to minutes) either: a head it cannot merge is a conflict only when it still
  cannot at the next look. Its times come in the server's zone and the committer's; the watcher
  compares them in UTC. Checks are the head
  commit's statuses, every page of them (Forgejo Actions report there). A pull request on the settings' share goes to
  the forge of `origin`.

A PR that cannot be read for ten minutes (a login missing, say, not the network gone for a moment)
says why on its card, once ("Obeya kann den Pull Request nicht lesen: …"); without it, the card
waited for a merge it never saw.

New comments, failed checks (once per check and commit) and a conflict (once per commit) go to the
worker as a message, which says what happened and leaves the how to the repository's ways (say, a
skill of its own that merges `main` instead of rebasing, replies on and resolves threads, and asks
Greptile for a re-review after each push). Whatever the way, each review comment gets a reply in its
own thread (what changed, or why not) and the thread is resolved unless the worker still wants the
reviewer's answer; one summary comment for all is not enough. The owner's log gets a line for each
event. Comments by the PR's author (the worker replying in the owner's name) and by accounts the
settings name as noise (`prNoise`) (a deploy preview bot, say) are skipped; an app's inline comments come as
`<name>[bot]`, its conversation comments as `<name>`, and the watcher reads both as `<name>`. While
the owner is asked, news waits.

#### Ready to merge

Once nothing is left for the worker, the card needs the owner: "Bereit zum Mergen" (once in the log,
on the card and folded) when

- the forge sees nothing in the way (GitHub's `mergeStateStatus` clean; on Forgejo mergeable and no
  draft),
- every check has passed and every review thread is resolved,
- the worker is not in a turn,
- a reviewer who wrote has written since the PR's own changes last changed (the committer date of
  its newest commit that is not a merge: merging the base in brings changes reviewed there, mostly
  elsewhere in the code),
- and whoever the PR's author last asked for another look has answered since. A review bot often
  answers a re-review only by rewriting its summary (Greptile's new score, with no new comment), so
  a rewrite counts as an answer.

A review older than the changes is about an older state: the worker hears, once per commit and when
it is not in a turn, that its reviewers have not seen its latest push, and asks them the
repository's way (its own skill, or a comment mentioning the bot); the message on new review
comments already says to ask once pushed. A PR no reviewer wrote on waits for nobody.

A ready PR whose reviewer's latest confidence is below 4/5 ("Confidence Score: 3/5" in Greptile's
summary) Obeya does not merge: the card needs the owner ("Bereit zum Mergen · Review nur 3/5"), who
merges on GitHub or tells the worker what is missing; a new review at 4/5 or better lets Obeya merge
again. Once ready, Obeya merges the PR itself (`gh pr merge` with the method the repository allows,
squash first, and `--match-head-commit`, so a push since is never merged unchecked; on Forgejo the
merge API with the first allowed style and `head_commit_id`) and the card is
`live` (see After landing) in the same round. When GitHub refuses the merge (branch protection
wanting a human approval, say), the card says why ("Obeya konnte nicht mergen: …") and needs the
owner, who merges on GitHub; Obeya tries again each round, so it goes through once the reason is
gone. Anything new for the worker takes the readiness back.

A repository whose team merges its pull requests itself (after a colleague's review on GitHub, say)
turns that off in its settings (`autoMerge: false`, „Automatisch mergen“ under „Freigegebene
Arbeit … als Pull Request“): a ready PR is not merged by Obeya, the card needs the owner ("Bereit
zum Mergen", the card saying that Obeya does not merge in this repository), and the merge on the forge
makes it `live` as any merge does. The worker hears on approval that the people on the forge merge it.
The setting is read each round, so a change applies to the pull requests already open.

#### The PR on the card

The card shows the PR with its link, its checks (each linked to its run), a conflict and a ready PR
Obeya could not merge; folded, it reads "PR #42 · 1 Check rot · Konflikt" or "PR #42 · Bereit zum
Mergen". Below the checks it shows the review as last polled, oldest first: each round a reviewer
left comments on the code in ("Runde 2 · greptile-apps · 3 Anmerkungen, 1 offen"), each comment
folded to its first line with whether its thread is resolved and how many replies it has, unfolded
with the file, the comment and the replies (the PR author's as "Agent"); between the rounds the
conversation (a reviewer's summary, the worker's requests for another round; a comment rewritten
since, like Greptile's summary each round, stands where it was last changed). Review bots write HTML
into their Markdown: badges keep their name (Greptile's "P1"), folded parts, code and diagrams go.
Whether a thread is resolved and when a comment was last changed only GraphQL says, so the watcher
asks that too. Checked against real pull requests (2026-10-01): `gh` reads their state, checks and
comments; on 2026-10-02 all five Greptile threads of a PR got their own reply and were resolved
before the re-review ping.

### After landing

The worker is told its work is on main (or that its PR was merged) and may finish what remains, in
its workspace, which stays at what landed until then (the card is `live`, "Live · Agent arbeitet";
notes reach it, the pause on its working bubble halts it, "Stoppen" ends it). Ending a turn with
nothing to wait for ends its session and removes worktree and branch (a clone is free again).

A turn that ends while a message from Obeya is still to come is not that turn: work approved while
its worker ends a reply (the owner said yes to its question and approved at once) lands while the
reply's turn finishes, and the notice of the landing, too late for that turn, starts one of its own.
The runtime gives each message it sends a uuid and checks it against those the turn's result names
as taken (the CLI also lists those it took in the middle of a turn); the session, workspace and busy
state stay until the turn that took the last one ends.

#### Restarts for landed code

When the landing changed Obeya's own running code, the worker is told Obeya restarts with it; where
it changed where the repository's agents work (`workspaces` in its `.obeya/settings.json`, landed on
the local main), that they restart with it (see Live configuration); a new version of the settings
that leaves them where they work applies at once, and the worker hears nothing of a restart
(`restartsFor`: `obeya`, `repo`, or none). What needs the new code waits through `after_restart`:
the worker ends its turn, the restart goes ahead, and the resumed worker hears that Obeya now runs
its change. Work pushed straight onto the remote's main applies once the Lesestand fetches it. A
worker there that was told of a due restart in its turn and ends it pauses for it, as while it
works: session and workspace stay, and the restart resumes it.

#### Failed turns while finishing

A turn there that an error cut off (the API overloaded, say) does not count as done: like a turn
that ends without a handover while the worker works, it is tried once more, and if that fails too
the owner gets the reason as a question ("Nochmal versuchen", or "Stoppen" to end the card without
the rest); the card's conversation shows a question asked while finishing like any other, not the
worker at work. While a restart is due, the failed turn instead pauses for it, which resumes the
worker, so that a second try does not hold up the restart. A turn there that the usage limit stopped
is not done either: it waits for the limit as while the worker works (status line, not busy, told to
go on after the reset), then the worker finishes what remained.

#### How a finishing card looks

On the canvas, a card finishing shows its status line as one at work does. It looks awake: the live
stock and the "Live" label, but not faded, its state line in the working ink with the moving line
("Live · Agent arbeitet", also in the detail view; "Erledigt · Agent arbeitet" for a `done` card,
"Live · Agent antwortet" for a follow-up), and a workstream stays at the size of a task instead of
shrinking to a chip, which hides state and status line; once its agent is done, it fades as live.

#### Questions after the work

A follow-up on a finished card whose worker has ended goes the same way: what the owner says on the
card (typed in its field, or spoken with it open: straight to that agent, as on a card at work)
resumes the worker's session in a fresh workspace on the card's branch (a free clone, else a
temporary worktree; see A finished card's question), where main may have moved on since (resuming
finds the session from any directory). The card stays `live` or `done`, "Agent antwortet"; the
worker answers with `reply` (its closing words after that fold under it, as after any reply), and
its turn's end frees the workspace again (a temporary worktree is removed). One that asked for a
full clone (`need_clone`) stays "Agent antwortet" with the status line „Wartet auf Workspace“ until
a clone is free, and "Stoppen" ends the wait. Commits there do not land: a change the follow-up
calls for becomes a card of its own (`propose_card`). The Arbeitsrückschau read the card's runs when
its work ended and does not count it again. A card no agent worked on (no branch), a prototype or an
archived card has no field.

### Decisions

- **Obeya itself is developed without branches or PRs**: approved work lands directly on `main`.
- **The worker opens and tends its PR the way the repository does it**, rather than Obeya scripting
  the steps (2026-10-01): Obeya's first version told it to rebase and push with
  `--force-with-lease`, while the first repository it opened PRs in merges `main` into a PR branch,
  never force-pushes, and has its own skill for review comments. Obeya says what happened on the PR,
  the repository says how to answer it.
- **The card that changes how work lands lands the new way, and gh runs as the repository's owner**
  (2026-10-16). Before, Obeya read `land` only from the default branch: the card that set up a
  GitHub repository's settings wrote `land: main` as the owner had answered, yet its approval went
  out as a pull request, under a button that said only "Freigeben". The merged PR then left the
  card "in PR": the watcher ran gh as the machine's active account, which could not see the
  owner's private repository.
- **Landing is detected from the remote** (2026-10-14). Until then Obeya's defaults had `pr`
  whatever the remote, so approving work in a repository without one told the worker to open a pull
  request that could not exist.
- **A repository whose work goes out as pull requests may let the owner push a card's work straight
  onto its default branch**, chosen per card at the approval, by button or voice (2026-10-06): an
  approval "mit direktem Commit auf main ohne Pull Request" had opened a PR anyway, since approval
  took no parameter and the spoken "ohne PR" was lost. Whether a repository allows it is its
  settings' `direct`, off by default; there is no rule by path. Obeya pushes, not the worker, and
  only fast-forwards. A card already in its PR does not switch.
- **Landing problems are classified**: uncommitted work, rebase conflicts and branches emptied by
  the rebase (their commits are on main already) go back to the worker; a blocked Obeya checkout or
  a push the remote turns away stays with the owner, and the card stays in review.
- **An approval holds through what the worker fixes to land it**: main moving on is no reason to ask
  the owner again. A stop, a blocked Obeya checkout or a push the remote turns away take it back;
  what the owner writes meanwhile is a note to the worker.
- **Landing does not block the server, and the click ends the owner's turn** (2026-10-10). Before,
  the whole server stood still until the push was through, and the card went on needing the owner
  for the seconds of the push, so Tab right after approving came back to it.
- **Obeya follows pull requests on Forgejo and Gitea** (2026-10-17). Until then only GitHub's: a
  card of a repository on Codeberg whose PR had been merged stood „Agent öffnet den PR“ for good,
  since `pr_opened` refused the Codeberg URL, and nothing could set it live. The API is called with
  curl and git's login rather than a CLI (`tea`, `fj`), which hardly any machine has. The default
  landing stays `main` there: an agent opens a PR on Forgejo only with tooling its repository brings.
- **The watcher polls when the owner comes back.** Before, the card stood "in PR" for up to two
  minutes after the merge (a PR on 2026-10-02: merged 12:12:40, seen 12:14:12).
- **A rewritten summary counts as a reviewer's answer, and an old review as no review**
  (2026-10-02). Before, the watcher waited for new comments only and the card stood "in PR" with
  nothing left to do; and a PR went in on Greptile's 3/5 of its first commit, since the worker
  pushed its fixes, replied in the threads and resolved them, but asked for no new review, and a PR
  nobody asked about counted as reviewed.
- **Obeya merges a ready PR itself** (2026-10-05). Before, Obeya left the merge to the owner on
  GitHub, and a ready PR stood for days with the card saying only "Bereit zum Mergen" (one PR ready
  2026-10-03 was still open 2026-10-05).
- **Landed work's worker keeps its workspace and session until it is done**, instead of ending with
  the approval: what a change needs after it is on main (a migration against the running Obeya) is
  done by the agent that knows the change. A landing costs one short worker turn for it.
- **The landing notice is a turn of its own** (2026-10-13). Before, the reply's turn counted as the
  one after the landing and ended the session, and the worker never heard that its work was on main:
  what it had promised for after the landing (publishing the hero video) stayed undone.
- **A direct push restarts like a landing, and a worker pauses for it** (2026-10-09). Before, a
  direct push never counted as restarting, and a turn ended for the restart ended the card, so what
  the worker had left for after the restart was never done.
- **Failed and limited turns after the landing are retried** (2026-10). Before, such a turn ended
  the card, and what remained after the landing was silently left undone; the same held for a turn
  the usage limit stopped. Before, only the detail view showed the status line of a finishing card.
- **A turn on the owner's words that the usage limit stopped is still at them** (2026-10-16).
  Before, Obeya counted it as answered: the card said „Agent hat geantwortet, wartet auf dich“,
  stopped its app and never went on by itself. A limit hit while background work ran showed only
  once that work ended, and the worker went on only when it woke it. The limit's note folded into
  the next message, which put it under the reply to words the owner wrote after the reset.
- **Look-ups, ideas and the other agents wait for the usage limit too** (2026-10-17). Before, only
  workers and Obeya's chat did: a looked-up question was answered with „Ich konnte die Frage nicht
  beantworten (You've hit your session limit …)“, an idea's turn ended in that error, a proposal's
  rework failed, a card started without a title was named after its text's start, a queued card
  started without its check, and the draft of a wish stood as the owner wrote it for good.
  Each now waits where it shows and goes on by itself; the shared wrapper does the waiting, so an
  agent added later waits by passing `onLimit`.
- **A finishing card looks awake** (2026-10-13). Before, it faded at the landing like a finished
  card, its state line in the pale live ink ("Agent erledigt den Rest", which suggested a small
  remainder, where a release still has tag, build and uploads to do), and a workstream became a
  chip. Rejected: the stock and rule of a card at work with an "on main" stamp (it sorted the card
  with those at work), and several landings per card (a second change would have no demo and no
  approval of its own; a code fix during a release goes through a card of its own).
