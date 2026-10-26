## Landing

A chapter of the [design doc](../design.md), whose header says how it is written.

### How work lands

In a folder without git nothing lands (see Folders without git). Elsewhere the setting `land`
decides (see Repository settings), read at each approval: `pr` sends the worker into the PR loop;
`main` rebases the branch onto `main` and fast-forwards the local checkout, and the card is `live`.
Unset, it is `pr` where `origin` is on GitHub (github.com, a subdomain, or a host gh is logged into:
one in gh's `hosts.yml`, or `GH_HOST` with a token for it in the environment; not `gh auth
status`, which checks each login over the network), else `main`: on another forge the
agents can open a PR only with the repository's own tooling. A card whose own branch changes `land`
or `direct` (the settings card, say) lands as its branch says unless the machine's settings
override it; the handover records how, so the approve button says so before the click. Where such
a branch sends the work out as a PR from a repository that lands on main, the watcher follows it
once the worker reports it.

Commits that conflict one by one but not as a whole land squashed. The last commit landed for a card
with a shared demo carries the trailer `Demo-Video: <url>` (see Publishing on approval). Uncommitted
work or a real conflict sends the card back to its worker with the approval kept: its next handover
lands by itself, without a new demo.

Where a `pr` repository's settings allow `direct`, the owner may approve „Direkt auf main“: in the
card's clone or worktree Obeya fetches, rebases onto `origin/<default>` and runs `git push origin
HEAD:<default>`, never forced. A push refused because the branch moved is rebased and pushed once
more; any other refusal (protection, rights) goes to the owner, the card back in review. Conflicts
go back to the worker as above, and its next handover is pushed directly too. A card already in its
PR does not switch. The local checkout is left alone; the Lesestand is refreshed at once, so plan docs
the card adds show as projects, and the worker hears its work is on main. Obeya does not watch the CI
on the default branch.

Landing runs git without blocking the server. Landings of one repository run one after the other;
a card whose work is landing refuses another approval, and a restart of Obeya waits for it. The
click ends the owner's turn at once (see Approval and landing).

### PR loop

On approval the worker opens the pull request the repository's way (its skills and conventions, a
description for readers who have not seen Obeya) and reports it with `pr_opened(url)`: GitHub on
github.com or an Enterprise server (`https://<host>/<owner>/<repo>/pull/<n>`), or Forgejo and Gitea
(`…/pulls/<n>`, also below a path). From then on it may push its
branch, never merges, and ends its turn after each round instead of handing over.

#### Watching the PR

A watcher polls each open PR every two minutes (state, mergeability, checks, all comments), and at
once when the owner comes back to an Obeya page (at most every 15 s), since the owner merges on the
forge and returns.

Every call to the forge (reading, merging, opening a PR, editing its description) runs without
blocking the server. A round asks for all open PRs side by side and handles each card as its answer
comes in, as the card is by then (one approved, stopped or closed meanwhile is left alone). A gh
call gets a minute: a PR GitHub does not answer for counts as unreadable for that round and holds up
no other card.

- GitHub through `gh`, on the PR's host (`GH_HOST`; for a PR being opened, the host of `origin`) and
  as the account that owns the repository where gh has a login for it there (its token as
  `GH_TOKEN`, on an Enterprise server `GH_ENTERPRISE_TOKEN`, the variable gh reads for such a host):
  the active account may not see the owner's private repository. Thread
  resolution and comment edit times only GraphQL gives.
- Forgejo and Gitea through `<server>/api/v1` with curl and git's login for `origin`'s URL (`git
  credential fill`, never prompting; else an access token stored as git's password for the host,
  which a push over https with it stores). Quirks: no review threads, so the inline comments on one line
  form one, resolved when any of them is; mergeability is false while a new push is checked, so a
  conflict counts only if it holds at the next look; times are compared in UTC; checks are the head
  commit's statuses, all pages.

A PR unreadable for ten minutes says why on its card, once.

New comments, failed checks (once per check and commit) and a conflict (once per commit) go to the
worker as a message saying what happened, leaving the how to the repository. Each review comment
gets a reply in its own thread and the thread is resolved, unless the worker still wants the
reviewer's answer; one summary comment is not enough. The owner's log gets a line per event.
Comments by the PR's author (the worker) and by accounts in `prNoise` are skipped; `<name>[bot]`
counts as `<name>`. Only what needs judgement (a review comment that questions a decision, a
conflict with product meaning) comes to the owner, as a question on the card; a PR closed without a
merge asks the owner whether to open it again or drop the work. While the owner is asked, news
waits.

#### Ready to merge

„Bereit zum Mergen“ when the forge sees nothing in the way (on Forgejo: mergeable and no draft),
every check passed, every thread is resolved, the worker is not in a turn, every reviewer who wrote
has written since the PR's newest non-merge commit (merging the base in brings changes reviewed
there), and whoever the author last asked for another look has answered (a rewritten summary
counts, as bots often answer that way). A review older than the changes makes the worker ask for a
new one the repository's way (its skill, or a comment mentioning the bot), once per commit; a PR no
reviewer wrote on waits for nobody.

Obeya then merges it itself (the repository's allowed method, squash first, pinned to the checked
head so a later push is never merged unchecked) and the card is `live`. It does not when the
reviewer's latest confidence is below 4/5 (Greptile's „Confidence Score“): the card needs the owner
(„Review nur 3/5“). A refused merge (branch protection) shows why and needs the owner; Obeya retries
each round. With `autoMerge: false` („Automatisch mergen“) the team merges on the forge: the card
needs the owner and says Obeya does not merge here, the worker hears so on approval, and the merge
makes it `live`; the setting is read each round, so a change applies to open PRs too. Anything new
for the worker takes readiness back.

#### The PR on the card

The card shows the PR link, its checks (each linked to its run), a conflict or a failed merge;
folded, „PR #42 · 1 Check rot · Konflikt“. Below, the review as last polled, oldest first: per round
a reviewer commented in („Runde 2 · greptile-apps · 3 Anmerkungen, 1 offen“), each comment folded to
its first line with its thread's state and reply count, unfolded with file, comment and replies; the
conversation between the rounds. Bots' HTML is stripped except badge names (Greptile's „P1“).

### After landing

The worker is told its work is on main (or its PR merged) and may finish what remains in its
workspace (the card is `live`, „Live · Agent arbeitet“; notes, pause and „Stoppen“ work as usual).
Ending a turn with nothing to wait for ends its session and frees the workspace. That message (and
the one for work closed without a change) also names the demo's page, which the worker links where it
points people at the work, such as an issue it closes (see The page and the landing). Work approved while
a reply's turn ends lands, and the landing notice starts a turn of its own: each message Obeya sends
carries a uuid, checked against those the turn's result names as taken (the CLI also lists those
taken mid-turn), and the session stays until the turn that took the last one ends.

#### Restarts for landed code

When the landing changed Obeya's own code, or `workspaces` in a repository's settings (see Live
configuration), the worker is told Obeya, or that repository's agents, restart with it; other
settings changes apply at once. What needs the new code waits through `after_restart`: the worker
ends its turn, the restart happens, and the resumed worker hears its change now runs. Work pushed
straight to the remote's main applies once the Lesestand fetches it. A worker that ends its turn
while a restart is due pauses for it and is resumed after it.

#### Failed turns while finishing

A turn there that an error cut off is retried once, then becomes a question to the owner
(„Nochmal versuchen“ or „Stoppen“); while a restart is due it pauses for that instead. A turn the
usage limit stopped waits for the reset (see Turns that end without a handover).

#### How a finishing card looks

A finishing card looks awake: live stock and „Live“, not faded, its state line in working ink with
the moving line („Live · Agent arbeitet“, „Erledigt · Agent arbeitet“, „Live · Agent antwortet“ for
a follow-up), its status line shown, and a workstream keeps task size instead of becoming a chip.

#### Questions after the work

What the owner says on a finished card whose worker has ended (typed, or spoken with the card open)
resumes that session in a fresh workspace on the card's branch (see A finished card's question).
The card stays `live` or `done`, „Agent antwortet“; the worker answers with `reply`, and its turn's
end frees the workspace. One that needs a full clone (`need_clone`) reads „Wartet auf Workspace“
until one is free; „Stoppen“ ends the wait. Commits there do not land: a change becomes a card of its own (`propose_card`).
A card no agent worked on, a prototype or an archived card has no field.

### Decisions

- **Obeya itself lands directly on `main`**, without branches or PRs.
- **The worker tends its PR the repository's way** (2026-10-01). Rejected: Obeya scripting rebase
  and `--force-with-lease`, which clashed with a repository that merges `main` in and never
  force-pushes.
- **A card that changes how work lands lands the new way; gh runs as the repository's owner**
  (2026-10-16). Rejected: reading `land` only from the default branch (the settings card went out
  as a PR against the owner's answer); gh as the active account (it could not see the merge).
- **Landing is detected from the remote** (2026-10-14). Rejected: `pr` by default, which asked for
  PRs where no remote existed.
- **Direct push is chosen per card at approval** (2026-10-06), allowed by `direct`, off by default;
  Obeya pushes, fast-forward only. Rejected: rules by path.
- **Landing problems are classified**: uncommitted work, conflicts and emptied branches go to the
  worker; a blocked checkout or refused push to the owner.
- **An approval holds through fixes to land it**; a stop or a problem for the owner takes it back.
- **Landing does not block the server** (2026-10-10). Rejected: landing inside the request, which
  froze the server and kept the card needing the owner.
- **The forge is asked without blocking the server, each call with a time limit** (2026-10-26,
  GitHub issue #6, from a contributor's pull request). Rejected: gh run synchronously, one call after
  the other: each is a round trip to GitHub (a second idle, several under load, ten and more when
  GitHub is slow), so with two open PRs the server answered nothing for up to 40 s every two minutes
  (canvas switches, conversations and demo videos hung).
- **A PR's forge is told by its URL's path; GitHub Enterprise is GitHub on another host**
  (2026-10-26, GitHub issue #16). `/pull/<n>` is GitHub's path on github.com and every Enterprise
  server, Forgejo and Gitea use `/pulls/<n>`, so the URL alone tells them apart, with no project
  setting and nothing asked over the network. A PR on a host gh is not logged into is watched all
  the same and fails with gh's reason on the card, which says what to do (`gh auth login
  --hostname`). Where no URL exists yet (the landing default, opening a PR), the host of `origin`
  counts as GitHub where gh is logged into it, read from gh's own files. Rejected: a list of
  Enterprise hosts in the settings (one more setting for what gh already knows); asking `gh auth
  status` (checks each login over the network) or probing the host's API (a round trip, and a
  server behind a VPN that is down would turn a PR into an unknown one).
- **Forgejo and Gitea through curl and git's login** (2026-10-17). Rejected: `tea`/`fj`, which
  hardly any machine has.
- **The watcher polls when the owner comes back**: otherwise a merged card stood „in PR“ for up to
  two minutes.
- **A rewritten summary is an answer, an old review no review** (2026-10-02). Rejected: waiting for
  new comments only (cards stuck) and counting any review (a PR merged on a stale 3/5).
- **Approval covers the PR, its monitoring and the merge; Obeya merges ready PRs itself**
  (2026-10-05): the owner approves the demo, not the code. Rejected: leaving the merge to the owner,
  which added only waiting (PRs sat for days).
- **A repository may leave the merge to its team** (`autoMerge`, 2026-10-21): a ready PR then waits
  for the owner; review comments and failed checks still go to the worker. Rejected: Obeya stopping
  to watch such PRs.
- **The worker keeps workspace and session until done**, so the agent that knows the change does
  what it needs once on main, at the cost of one short worker turn per landing.
- **The landing notice is a turn of its own** (2026-10-13). Rejected: counting the reply's turn,
  which ended the session before the worker heard.
- **A direct push restarts like a landing; workers pause for restarts** (2026-10-09). Rejected:
  ending the card, which dropped post-restart work.
- **Failed turns after landing are retried** (2026-10). Rejected: ending the card silently.
- **A finishing card looks awake** (2026-10-13). Rejected: fading it like a finished card (it
  suggested a small remainder where a release still has tag, build and uploads to do); an at-work
  stock with an "on main" stamp (it sorted with cards at work); several landings per card (a second
  change would have no demo or approval of its own).
