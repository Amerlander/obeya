# CLAUDE.md

Obeya: a spatial canvas for directing AI coding agents. Goal, behaviour, architecture and the
decisions behind them are in `docs/design.md` — read it before changing anything, and keep it
current in the same change. Work in progress is planned in plan docs under `docs/plan/` (Obeya
shows them as projects); when one is done, what lasts moves into `docs/design.md` and the doc goes.

- Bun + TypeScript throughout; tests with `bun test`, types with `bun run typecheck`.
- `src/core/` is shared by server and UI (types, plan-doc parser, layout); `src/server/` is the
  Bun server with SQLite; `src/ui/` the React canvas; `src/adapters/` the repo adapters.
- Code that drives agents is tested against the fake runtime in `src/server/testing.ts` and real
  git repositories in a temp directory (`gitRepo` there; git calls are what makes tests slow).
  Live runs go against a scratch git repository with a plan doc and a scratch `OBEYA_HOME` (never
  `~/.obeya` of a running Obeya): `bun scripts/scratch-obeya.ts <stage.json>` stages one with its
  cards in about a second (its header describes the stage file; `--stop <port>` ends it). Its
  workers are idle; with `--real-workers` they are real agents on the machine's Claude login.
- UI checks run in a headless browser through the `browser` skill of Obeya's plugin
  (`obeya:browser`; a session without the plugin reads `plugin/skills/browser/SKILL.md`): `input`
  for trusted clicks, drags, keys held for push-to-talk; `start --fake-mic <wav>` for voice. A
  claude-in-chrome tab is often hidden, which freezes `requestAnimationFrame`: camera flights and
  the unfold never finish there.
- Voice on this machine: `OBEYA_WHISPER_PYTHON=/Users/sadilek/dev/stimmzwilling/.venv/bin/python`
  (has `mlx_whisper`; the model is cached).
- The Obeya instance for this repo runs on port 4417 with `~/.obeya`. It restarts itself once
  `main` moves to commits that change code, a commit of yours included (workers resume, the page
  reloads); docs-only commits leave it running. Keep tests off it.
- No project-specific logic in the core: it belongs in the repository's own adapter (`.obeya/adapter/`
  in that repository), not in this repo.
- UI strings live in one place, `src/ui/strings.ts`, in German and English (two tables of one shape).
- An interaction that several kinds of card share (answering questions with comments and one Send
  button, the conversation history, "Los geht's" while the agent is still working) is built once in
  shared code and works the same on each of them; no card kind gets its own variant.
- Whatever the owner has entered on a card but not sent yet (text, pasted screenshots, picked answer
  options, comments) survives closing the card, switching canvases and a page reload, for every
  input on the card, not only the text field.
- Dialogs and text fields use the space the screen offers (the owner works on a tall monitor)
  instead of staying small with a scrollbar of their own; never two scrollbars side by side.
- A button that is easy to click by accident and sets a lot in motion gets an undo. What is easy
  to reverse afterwards gets no undo window with a wait: it takes effect at once.
- Every new feature and every shortcut gets a way for first-time users to discover it: a visible
  icon, say, or a hint that shows until it has been used once. A tooltip or a key that is only
  documented is not enough.
- Prompts and skills for agents: fix unwanted behaviour by removing the instruction that causes
  it, not by adding a prohibition. Forbid nothing an agent would not do without being told to.
- The colleagues use Windows or Linux: features must work there; macOS-only tools (e.g. `say`)
  only as an additional option.
- Demo videos and voice recordings never go into git.
- Public videos (the site's hero video, anything for obeya.si) are narrated in the owner's ElevenLabs
  voice clone (voice ID `IErGHDQU4vPqicCi8dwR`), not the voice of the demo settings. Its API key is in
  `.voice/elevenlabs.key` of the main checkout (`/Users/sadilek/dev/obeya`, gitignored); render with
  an `OBEYA_HOME` whose `demo.json` names both (`voice: elevenlabs`, `voiceName`, `keyFile`), as
  `scripts/hero-video/render.ts` sets up for the hero video (its README says how to change and
  re-render it). Credits are limited: only for public videos, never as Obeya's own demo voice, and
  even there only once: a public video is iterated in local renders in the owner's Qwen3 voice, and
  the ElevenLabs render happens after the owner has approved the video. Qwen3-TTS references of the
  owner's voice lie beside the key, each with its transcript (`.txt`):
  `.voice/qwen-reference-de.wav` (a recording) and `qwen-reference-en.wav` (cut from the ElevenLabs
  voice); the demo settings' `reference` names the one of the narration language. Qwen3 is good
  enough for demos, ElevenLabs marginally better for the site, so the site stays with ElevenLabs
  (owner, 2026-10-12); `scripts/hero-video/qwen.py` renders the hero narration in Qwen3 to compare.
- gh calls against this repository's GitHub repository go through `bun scripts/gh.ts <gh args…>`:
  it runs gh on the checkout's origin as the account that owns it (`sadilek` for sadilek/obeya),
  since the machine's active gh account may be another without admin rights.
- A recurring step that needs a longer CLI call (an upload, say) goes into a script in the repo,
  not into the docs as a command to copy.
- Commit directly to `main`; this repo uses no feature branches or pull requests. An Obeya worker
  is the exception: it commits on its card's branch, and Obeya lands that branch on `main`.
