# Obeya's feature demos, public on GitHub

> Plan doc for publishing the demos Obeya's workers record for this repository, in English, on a
> public site linked from the README, obeya.si and each landed commit, and for re-voicing the last
> 30 past demos in English. Deleted when it ships; durable content moves into
> [`docs/design.md`](../design.md).

## Goal

The feature demos Obeya's workers record for this repository are seen only by the owner today.
Anyone who looks at Obeya on GitHub sees them: open-source users and possible contributors see
what each change does without running it. From now on this repository's demos are narrated in
English and go public when the owner approves the card. The last 30 past demos go public too,
with their narration redone in English.

## Where it stands

- *Demos* stay in `~/demos/` and never go into git. There are about 350 demo videos of Obeya
  features, around 2 MB each.
- *Sharing*: when a repository's settings name a `demo.site` (title, URL, deploy command,
  `language` of the overview; `docs/settings.md`, `src/server/site.ts`), „Teilen“ puts the demo
  on a page of that static site, with an overview of all pages. The other canvas's repository does
  this today, to a Cloudflare Pages project behind a login, in German. Obeya's own
  `.obeya/settings.json` has no `demo.site`, so here „Teilen“ only exports a file.
- *Links*: once a card has a pull request, Obeya adds the page's link to its description
  (`linkPr` in `src/server/share.ts`). This repository has no pull requests: Obeya lands each card
  straight on `main` (`pushToMain` in `src/server/workspaces.ts`, which returns the landed range
  `from..to`).
- *obeya.si* is GitHub Pages, built from `site/`. Its DNS is at Hostinger.
- *Language*: the demo settings (`~/.obeya/demo.json`: `language: de`, Qwen3 cloning
  `.voice/qwen-reference-de.wav`; `plugin/skills/demo/lib/settings.ts`) are machine-wide, for
  every canvas. A Qwen3 clone needs a clip in the narration language, which is why the settings
  hold only one reference (decided 2026-10-12, `docs/design.md`). The site's overview takes
  `demo.site.language`, else the demo settings' language. The scratch Obeya a demo records runs
  with a German UI: `scripts/site-shots.ts` switches one to English through `PUT /api/language`,
  while `scripts/scratch-obeya.ts` has no language. The stage files (card titles, conversations)
  are written in German.
- *What a finished demo keeps*: next to the video, `.work/` holds the raw frames with their
  durations (`frames/`, `frames.txt`, an ffconcat list), the narration texts by scene
  (`jobs.json`) and the clips. `captions.vtt` and `chapters.vtt` give where each clip and scene
  starts and ends. Of the last 30 Obeya demo directories, 24 have frames; the rest are artifact or
  docs demos, the hero video and the release video.

## Design

### Decisions

- Every approved demo of this repository goes public automatically.
- Its demos are in English from now on, in the owner's local English voice (Qwen3 cloning
  `.voice/qwen-reference-en.wav`, first person). The language is set per repository; the other
  canvas stays German.
- The last 30 past demos go public with only their narration redone in English. Their screen
  stays German. The older ones stay private.

### Narration language per repository

- `.obeya/settings.json` gets `demo.language`. It overrides the language from `demo.json` for that
  repository's demos and also names the site overview's language. `demo.site.language` goes,
  since two settings would cover the same need; the other repository's settings move to
  `demo.language` directly.
- `demo.json` holds one Qwen3 reference clip per language (`references: { de, en }`), which
  revises the 2026-10-12 decision. The configuration dialog shows both.
- The demo skill's `lib/settings.ts` gives the repository's language to the agent writing the
  narration.
- `scripts/scratch-obeya.ts` takes a stage `language`, else the demo language, so the UI on screen
  matches the narration. The `app.run` text in Obeya's settings tells workers to write stages in
  English.
- Obeya's settings get `demo.language: "en"`.

### Public site, published on approval

- A Cloudflare Pages project at `demos.obeya.si` (a CNAME at Hostinger) is Obeya's `demo.site`:
  deploy `bunx wrangler@4 pages deploy {dir} --project-name obeya-demos --branch main`, no login
  headers, the API token in an `env` file under Obeya's home. The owner does the Cloudflare login
  and the token.
- A generic setting on the site, e.g. `demo.site.publish: "approved"`, with its field in the
  configuration dialog. On approval, before landing, Obeya shares the latest demo, replacing the
  page's version or adding to it as the worker said. A failed publish goes into the card's log and
  does not hold up landing.
- Where a repository lands on `main` directly, the commit landed for a card with a page gets a
  trailer `Demo-Video: <url>` (`Demo-Page:` for an artifact). The slug is fixed before publishing
  finishes, so the trailer can be written before the deploy is done.
- The README and obeya.si link to the overview ("See every feature in action").

### Re-voicing

A re-voice mode in the demo skill (e.g. `node demo.ts --revoice en`), for any demo that kept its
frames:

1. An agent translates the scene texts (pause tags kept), chapter titles, report page and the
   page's title and text. UI labels are quoted as they appear on screen: „Teilen“ (Share).
2. It synthesises the clips in the voice for that language.
3. It scales each scene's frame durations by the ratio of the English clip's length to the German
   one's, so actions timed with `untilSpoken` still land on their words. The cut flashes stay as
   recorded.
4. It rebuilds `demo.mp4` (CRF 30) with the new narration, plus `captions.vtt`, `chapters.vtt` and
   `index.html`. The card then shows the English version.

The run takes the latest demos of the 30 most recently approved Obeya cards whose demo kept its
frames (reaching further back than the last 30 directories; the hero video and the release
videos are not included). Each one is checked like a fresh demo (narration complete, words and
screen in step) and then shared through the queue. Their commits are already on GitHub and get no
trailer: they are reached through the overview.

### Order

W1, W2, W3 in that order, each landing on its own. W1 lands first, so nothing German goes public
automatically. W3 needs both: the English voice from W1 and the site from W2.

## Workstreams

- [ ] **W1:** Narration language per repository. `demo.language` in the repository settings,
  overriding `demo.json`'s language for that repository's demos and naming the site overview's
  language; `demo.site.language` removed, with the other repository's settings moved to
  `demo.language` directly. `demo.json` with `references: { de, en }`
  (one Qwen3 clip per language) and both in the configuration dialog; the 2026-10-12 decision in
  `docs/design.md` revised. The demo skill's `lib/settings.ts` passes the repository's language to
  the narrating agent. `scripts/scratch-obeya.ts` takes a stage `language`, else the demo
  language. Obeya's `.obeya/settings.json` gets `demo.language: "en"`, and its `app.run` text asks
  for stages in English. `docs/settings.md` and `docs/design.md` updated.
- [ ] **W2:** Public demo site with publishing on approval. The Cloudflare Pages project
  `obeya-demos` at `demos.obeya.si` as Obeya's `demo.site` (the owner does the Cloudflare login,
  the token and the CNAME at Hostinger). A generic `demo.site.publish: "approved"` with its field
  in the configuration dialog: on approval, before landing, Obeya shares the latest demo
  (replacing or adding as the worker said); a failed publish goes into the card's log and does
  not hold up landing. For direct landing on `main`, the landed commit of a card with a page gets
  a `Demo-Video: <url>` or `Demo-Page: <url>` trailer. The README and obeya.si link to the
  overview. Tests against a deploy line that copies the directory; `docs/settings.md` and
  `docs/design.md` updated.
- [ ] **W3:** Re-voicing and the 30 past demos. The demo skill's re-voice mode (`--revoice en`):
  translation by an agent, synthesis in that language's voice, frame durations scaled per scene,
  `demo.mp4`, `captions.vtt`, `chapters.vtt` and `index.html` rebuilt. Then the run over the latest
  demos of the 30 most recently approved Obeya cards whose demo kept its frames, each checked like
  a fresh demo and shared through the queue.

## Risks

- **Build quota.** Unchecked guess: the free plan's 500 builds a month may count each direct-upload
  deployment. The other site's account would show it; every approval and the run of 30 each
  deploy once.
- **Timing after re-voicing.** Scaling a scene's frames evenly keeps `untilSpoken` actions near
  their words, but a scene whose English runs much longer than its German stretches the screen
  between actions too; the check of each re-voiced demo catches what drifts.
- **German screen, English words.** The 30 past demos keep their German UI; the narration quotes
  each label as it appears with its English meaning.
- **Publishing before landing.** A publish that succeeds for a landing that then fails leaves a
  public page for work not yet on `main`.

## Open questions

- None.
