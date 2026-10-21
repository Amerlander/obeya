# Obeya — design

How Obeya works and why: what it does for the owner, how it is built, and the decisions behind it.
It describes what is built and is kept current in the same change. Work in progress is planned in
plan docs under `docs/plan/`, which Obeya shows as projects; when one is done, what lasts moves here
or into a chapter under `docs/design/`, and the plan doc goes.

How this document is written:

- Each chapter first says how its part of Obeya works now, in the present tense, then lists its
  **decisions**: what was chosen, why, what was rejected, and what it replaced, with the date. A
  change that replaces behaviour adds the old behaviour and the reason for the change there, not
  into the description.
- UI texts are quoted in German as the owner sees them („Freigeben“); code, files, settings and API
  paths are in backticks, with the file where it helps to find them.
- A chapter refers to another by its heading (see Landing).

Chapters: Goal, Principles and Concepts follow below; every other chapter is a file of its own
under `docs/design/`, with its decisions at its end. Read this index, then the chapters a change
touches, and keep those current in the same change.

- [Ideas](design/ideas.md) — idea cards and their exploration agent: starting an idea, the
  discussion, the brief, prototypes, deciding what becomes of it, while the agent replies.
- [Card lifecycle](design/card-lifecycle.md) — a card's states from proposal to done: proposals
  (later starts, taking back, reworking by words), at work, waiting for approval (the handover
  report, watching the demo, comments in the video, earlier demos), approval and landing, live and
  done, archive, how projects end.
- [Communication](design/communication.md) — how workers and Obeya exchange messages: a worker's
  tools, turns that end without a handover, pausing an agent, snoozing a card, waiting without
  blocking, refused and confirmed tool calls, notes and replies, questions go to the owner.
- [Conversation on the card](design/conversation-on-the-card.md) — what the owner sees and does in
  a card's conversation: messages, reading order, replying to a message, the task as first message,
  card layout (the files beside the demo, trying the app by hand), screenshots and marking them.
- [The canvas](design/the-canvas.md) — the UI around the cards: the bar, creating cards, cards on
  the canvas (a project arranged by its dependencies), moving around, unfolding a card, sheets,
  visual identity, groups on the canvas, refusals.
- [Agents and workspaces](design/agents-and-workspaces.md) — how agents run and where: agents,
  models and effort, workspaces (slots, the pool in the bar), folders without git, parking, hosts
  (running there, logins and files, a dropped connection).
- [Landing](design/landing.md) — how approved work reaches `main`: how work lands, the PR loop
  (watching the PR, ready to merge, the PR on the card), after landing (restarts for landed code,
  finishing, questions after the work).
- [The Koordinator](design/the-koordinator.md) — the per-canvas agent the UI calls Obeya:
  scheduling and the queue, learning the owner's rules (Rückschau, rules for a CLAUDE.md), its
  sheet, Arbeitsrückschau, looked-up questions and threads, Question cards, its memory, wishes for
  Obeya's makers.
- [Voice](design/voice.md) — voice in (dictating or sending, drafts, the microphone), speech
  recognition (Parakeet, Whisper, a cloud service, the settings), who hears the words, commands to
  the Koordinator with confirmation and undo, voice latency, no voice out, push-to-talk anywhere.
- [Demos](design/demos.md) — making and showing demos: the demo skill, the demo settings and
  voices, what a render needs, recording a demo (cutting waits, re-voicing, frames, highlights),
  the demo on the card, UI checks in a headless browser.
- [Sharing demos](design/sharing-demos.md) — demos on a page of their own for colleagues: where a
  demo goes, several versions on one page, publishing (on approval too), outdated pages, the page
  and the pull request, export without a site, static sites, several machines on one site.
- [Repositories and configuration](design/repositories-and-configuration.md) — canvases and
  repositories, main branch, Lesestand, plan docs (and how Obeya reads them), repository settings
  (`.obeya/settings.json`, problems, trusting commands, writing them), the Konfiguration dialog,
  live configuration, language.
- [Running Obeya](design/running-obeya.md) — the server (who may talk to it, other devices, the
  phone view, notifications on the phone), setup assistant, setting up git in a folder,
  self-update (waiting for workers and the owner, pulling from the upstream), stopping.
- [Distribution](design/distribution.md) — how Obeya gets to people: one file, the app, builds
  (signing, making a release), app updates, the site, the hero video.
- [Data](design/data.md) — what Obeya stores in SQLite and under `~/.obeya/`, and what it derives.
- [Open questions](#open-questions) — below.

## Goal

A spatial workspace for directing AI coding agents the way an engineering director directs a team:
every task and every project is a card on one canvas; agents do the work in the background; the
human keeps every essential decision — made by voice, from a narrated demo video, without reading
code or cycling through terminals.

*Obeya* is Japanese for "big room": in lean management, the room where every project hangs visibly
on the walls and decisions are made in front of the wall.

## Principles

- **One surface.** Everything starts on the canvas. Detail unfolds in place, animated, and folds
  back; nothing opens a new window, and the view never jumps.
- **Space is memory.** A card keeps the position its owner gave it and a fixed, readable size. A
  screen too small for everything shows a section of the canvas, never shrunken cards.
- **Decisions, not supervision.** The owner is pulled in only for a decision: a demo to approve, a
  question only they can answer, a proposal. Everything else runs.
- **Every change gets a demo.** Its length follows the size of the change, not its kind: a small one
  30–60 s, a larger one 1½–3 min, never padded; projects one demo per workstream. Backend behaviour
  is shown through the app's own inspection views; "covered by tests" is no reason to leave it out.
  What is to be looked at rather than watched (logo drafts, a layout, variants side by side, an
  analysis, an answer) is shown as an HTML artifact instead of a video; the worker picks which, the
  video where either would do. There is no handover without one.
- **Voice first, mouse welcome.** Push-to-talk anywhere; buttons for the obvious actions. No live
  transcript: what the owner says to an open card's agent shows in its conversation, a command to
  Obeya gets a short written confirmation with undo. What was said and answered stays in the
  conversation of the open card, or in the Koordinator's sheet. Obeya does not speak.
- **Repo-agnostic core.** Project specifics live in the repository's settings: in the repository
  itself (`.obeya/settings.json`), or set for this machine in the configuration.

## Concepts

- **Canvas** — a canvas spans one or more repositories; one Obeya serves several canvases.
- **Cards** — everything on the canvas is a card: a task (`task`; in the UI an *Aufgabe*), an idea,
  a prototype, a Question card (`question`, a thread of looked-up answers, see Looked-up threads),
  or a `project`, a container backed by a plan doc whose workstreams are its child cards. Tasks have
  no further kind: whether one fixes a bug or adds something makes no difference to how it is worked
  on, so the owner does not pick one. A task's card names no kind either (that it is one shows); the
  others say what they are (idea, prototype, workstream number, project). A task is an *Aufgabe* and
  a follow-up a *Folgeaufgabe* in the UI and the Koordinator's words, never a *Karte*; *Karte* stays
  only for a card on the canvas as such (moving, grouping, „Karte oder Projekt schließen“).
- **Groups** — besides by place, the owner sorts the canvas by group: a group has a name and a
  colour, and a card belongs to none or one. A project belongs to one as a whole, with its
  workstreams. A proposal, a follow-up and a prototype come into the group of the card they come
  from, a project written from an idea or a task into that card's; after that the group is the
  card's own. Moving a card never changes its group: a card in another group's territory stands
  there as an island. A group exists while a card belongs to it, on the canvas or in the archive;
  the last card leaving it ends it, and so does deleting it, which takes all its cards out.
- **States** — `idea` → `planned` → `working` → `waiting` (demo ready | question) → `approved` → `in
  PR` → `live`, or `done` when the work changed no code; an agent's `proposal` is started when
  accepted. Every handover brings a demo; where the repository has no recipe for running its app
  (Obeya's defaults have none), the worker finds that out from the repository. `waiting: review`,
  a handover with a written summary alone, is left only on cards from before 2026-10-15 (see the
  decisions under Demos). An idea is `open`, `parked` or `dropped`.
- **Agents**
  - *Worker*, one per card while it is worked on: implementation, local reviews, demo.
  - *Project agent*, one per project, long-lived: knows the plan doc and the history of every
    workstream; the owner asks it in the project's sheet, or asks Obeya, which passes the question on.
  - *Exploration agent*, one per idea, long-lived, with a worker's tools: discusses the idea with
    the owner and keeps its brief.
  - *Chief of Staff* (in the code and these docs: *Koordinator*), one per canvas: takes voice input
    on the open canvas, creates and assigns cards, runs the workspace pool, and keeps the preference
    memory. It also schedules the work: it detects cards whose changes are likely to conflict on
    merge, and does not run those at the same time but queues them. The UI calls it simply *Obeya*
    in both languages: the owner has one counterpart, not a product plus a component in it. Its
    replies, its sheet, the line under the microphone and its log lines on cards say Obeya; the
    top-right button is a speech-bubble icon with its counts, tooltip „Obeya (C)“. Prompts tell the
    agents the owner knows it as Obeya.
- **Preference memory** — rules distilled from every answer and correction the owner gives
  ("questions to me with at most three options", "solve rebase conflicts yourself"), or said
  outright ("Merk dir: …"). Shared by all agents, maintained by the Chief of Staff. A learned rule,
  or a learned change to a rule, is a proposal until the owner accepts it; agents follow active
  rules only. A rule the owner writes or says outright is active at once. Besides each input on its
  own, the Rückschau looks back over the last twenty or so for patterns across cards. It holds only
  rules at the level of Obeya: how the agents work with the owner through Obeya, whatever the
  repository. Whatever is about a repository (its conventions, product requirements, tools, and
  taste in code even when it holds in every repository) belongs in that repository's CLAUDE.md,
  where it is versioned, colleagues see it and Claude Code follows it outside Obeya too. Such a rule
  goes there through a card (see Learning the owner's rules): once accepted when learned, at once
  when the owner writes or says it outright.

### Decisions

- **Name**: Obeya.
- **The Koordinator is called Obeya in the UI** (2026-10-09): the owner has one counterpart, not a
  product plus a component in it.
- **This page describes what is built**; work in progress lives in plan docs, which the canvas shows
  as projects. The milestone list it once kept repeated what the canvas shows and went (2026-10-01).
- **Persistent local store**, not ephemeral.
- **Agents may propose cards.**
- **Open source** under the MIT licence, copyright Daniel Sadilek (`LICENSE`, the README,
  `package.json`), in a public repository on GitHub (2026-10-06). Code, tests and docs name no other
  work projects. The README is written for strangers: the idea, a loop of the canvas at work linked to the hero video, the site's screenshots of
  the canvas and of the phone view (`site/img/canvas.png`, `phone.png`, `phone-demo.png`, taken
  again at every release, so the README shows no picture of its own that could go stale; until
  2026-10-17 it had `docs/images/canvas.png`, taken once), the status, requirements, a quick start,
  how to connect a phone, a link to obeya.si. GitHub plays a video in a README only when it was uploaded through its web page (a
  `user-attachments` link, which no API makes and every re-render would have to replace); a link to
  the release asset shows as a download. So the README plays a GIF of the canvas at work (a wall
  arranged, a task said that appears as a card), cut from the hero video (see Hero video), linked to
  the video on obeya.si (`#film`), which is always the current one; near the end one sentence welcomes
  issues and pull requests, without asking for a star, which read as needy (2026-10-19). Until then it showed the video's first frame with
  the site's play button drawn on it (2026-10-12); a loop above that picture would have shown two
  near-identical canvases in a row, so the loop took its place. `CONTRIBUTING.md` says how Obeya
  is built with Obeya (design doc, plan docs, cards, demos) and what a pull request from outside
  brings.
- **The repository on GitHub is made to be found** (2026-10-19): its homepage is obeya.si, and its
  topics are a dozen that people search for and that have active topic pages (`claude-code`,
  `ai-agents`, `coding-agents`, `agent-orchestration`, `developer-tools`, `git-worktree`,
  `voice-control`, `infinite-canvas` and the like; `spatial-canvas` had 15 repositories and was left
  out). Its social preview, the picture a shared link shows, is the wordmark and the site's
  headline beside the site's screenshot of the canvas, 1280×640, made by
  `bun scripts/social-preview.ts`; GitHub's API cannot set it, so the owner uploads it (Settings →
  General → Social preview) when the canvas has changed enough to need it.
- **Agents run only through the user's own installation of Claude Code and its login**: Obeya starts
  that installation and never uses the subscription's token itself. Tools that used the token
  against the API themselves were blocked; tools that start the official installation appear to be
  tolerated (T3 Code, Conductor).
- **No business and no cloud service for now**: being known comes first (2026-10-06). Considered and
  parked: hosting demos for sharing, remote access from the phone through a relay, voice as a
  service, a team canvas, and a subscription covering the costs. Hosted agents were ruled out.

## Open questions

- Plan-doc sync: Obeya reads plan docs and never writes them; workers tick off their workstream in
  the doc as part of their change. Should the project agent keep the doc's progress instead?
- Cloud hosts, left out for now (2026-10-10): a host type whose slots are cloud instances, one per
  card (an EC2 `m8g.xlarge`, say, in the using repository's cloud account), launched from a prepared
  image when the other machines are full, stopped some minutes after the card's last turn (only the
  disk kept), started again on the owner's next message and terminated once the work has landed,
  with a cap on concurrent instances. Image, network and IAM would be the using repository's
  infrastructure. Estimated from the measurement under Agents and workspaces, Decisions: about $25 a
  month with the Mac alone at that load, nearly nothing with a second machine, $190–290 a month on
  demand at 36 agents. Worth it only if parking and SSH hosts leave the owner short of slots.
  Reaching them, and the second MacBook away from home, would need more than plain SSH on the home
  network (Tailscale, say).
