## Data

A chapter of the [design doc](../design.md), whose header says how it is written.

Persistent (SQLite):

- canvases;
- cards: kind, state, position, parent; agent session, workspace, branch, status line, open question
  or review summary (with the reason when there is no demo), the card it came from (a proposal's
  source, a follow-up's card), estimated scope, queue, when archived, the pull request (link,
  checks, the comments, failed checks and conflict already passed on), an idea's status, brief and
  open questions with its agent's picks and suggested next step, a prototype's idea, how it ended
  and its worker's proposal to build on it, the prototype an idea is built on, landed work whose
  worker still finishes; an approval held until the work can land; what landed work shipped with; a
  waiting card's stopped app; until when a card is snoozed, by whom and why; a worker's proposal waiting for the owner (why, its open
  questions); a project's plan doc as last read, the idea or task it came from, and whether the owner collapsed it; that a card
  becomes a project, and the plan docs its landed work added;
- the shared demo page: slug, link, the demo directory it shows, what the page shows (title, text,
  chapters, kind) and the pull request it links, the newest page change it was published after, and
  whether it is publishing or withdrawing; sharing many outdated pages again: the cards still to go,
  how many are out and which failed, and the newest change when the owner put the notice away;
- what each card changed in a folder without git, and the undo it has there (`folder_cards`);
- card events (the log, with an error code where the UI words it, the owner's screenshots, an idea
  agent's mocks, and on Obeya's reply what a draft for its makers starts from), a card's own screenshots, workspaces and their leases;
- decision log, preferences;
- the Koordinator's conversation with the owner (what was said, its reply, the screenshots that came
  with it, the open card, whether it was taken back; a looked-up question, the card it is about, its
  answer and who gave it, the session of the agent that looked it up, the thread it belongs to and
  the answer it follows up on, the files the answer came with, and the Question card the thread
  moved onto, and what a draft for Obeya's makers starts from when its reply says Obeya cannot do it
or the owner asked to tell them something), a Question card's thread (the exchange it started with, whether its agent reads, what
  the owner asked that it has not answered yet, its counts of answers and files), the answer a
  message of a card's log is (its thread, files, the question it continues);
- confirmed commands waiting for their undo window (`commands`);
- groups (name, colour) and the group of each card;
- per-canvas settings (the home repository; per repository the card collecting its CLAUDE.md rules; the Rückschau's count and when its history
  begins; per repository the Arbeitsrückschau's count and when it last ran);
- the devices paired to reach Obeya from elsewhere (`devices`: the hash of the cookie, name, when
  paired and last seen, its push subscription);
- the friction noted on each card's runs (per repository), and on a card the Arbeitsrückschau
  proposed what it rests on, and the settings' values it proposed (`setting_proposals`: repository,
  setting, value, basis, cards, and where the owner took it).

Files under `~/.obeya/` (the same for the app and a checkout): the database (`obeya.db`), the
owner's screenshots (`images/<canvas>/`), the configuration (`canvases.json`), the settings
(`settings.json`, `demo.json`, `voice.json`), where the running Obeya answers (`server.json`), the
`tailscale serve` entry Obeya made (`tailscale-serve.json`), the key it signs pushes with
(`vapid.json`), the app's server log (`app.log`), voices and models (`voices/`), the workers' clones and worktrees
(`workspaces/`), the Lesestand's worktrees (`read/`), the cards' undo in folders without git (`undo/`), the files of looked-up answers
(`answers/<canvas>/<thread>/`), the static sites Obeya keeps (`sites/<key>/`), the env files their
repositories' settings name (relative to the home, `sites/demos/deploy.env`, say), and `share/`,
the directory deploys run in.

Derived, not stored: git, PR and CI state (read from git and GitHub), plan-doc content (read from
the repository; the copy on the project is only for the archive).
