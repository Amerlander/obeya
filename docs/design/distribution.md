## Distribution

A chapter of the [design doc](../design.md), whose header says how it is written.

### One file

`bun run build` (`scripts/build.ts`) compiles the server with Bun (`bun build --compile`) into one
binary for this machine, or with `--all` (or named targets) one per platform (macOS arm64 and x64,
Linux x64 and arm64, Windows x64; Bun cross-compiles, about 15 s for all five), 66–120 MB with the
UI and SQLite in it, that needs neither Bun nor a checkout.

Its modules live in Bun's embedded file system, which no other process can read, so what other
processes run or import goes beside it as real files, in `resources/` (13 MB): the plugin with its
skills and the `playwright-core` the demo skill records with, the voice sidecars, the skills' scripts that read a repository's
settings (`recipe.ts`, `check.ts`) bundled with what they import, and `docs/settings.md` for the
settings skill. The server finds them
through one function (`resource()` in `src/server/resources.ts`): `OBEYA_RESOURCES` when set, else
`resources` beside the binary (or `Resources` of a macOS app bundle), else the checkout. The demo
skill's modules the server carries (the setup check, the voices) are told where their files are
(`useLib` in the skill's `lib/here.ts`). Nothing is written beside the code: the resources may be
read-only, what Obeya writes is in its home.

The binary is its own Bun for scripts: a site's deploy script runs as `obeya <script>` with
`BUN_BE_BUN=1`. It supervises itself as `bun start` does (restarting when canvases given on its
command line are saved) but has no checkout to follow, so it never restarts for new code. A macOS
binary is signed ad hoc after its build: as Bun writes it, macOS kills it at start. Bun 1.3.12
leaves a copy of its runtime in the working directory of every compile (`.<hex>.bun-build`); the
build compiles in the output directory and removes it. The UI the binary carries is bundled at build
time, with `NODE_ENV` defined as production, so it is React's production build, as `bun start`
serves it (without the define it was the development one).

`package.json` holds Obeya's version, which the settings show, with the checkout's commit beside it
when Obeya runs from one. `bun scripts/check-binary.ts <obeya> [--voice] [--demo] [--worker]` checks
a binary on the machine it runs on: a scratch repository with its own `.obeya/settings.json` and demo site,
then the voice installed and a spoken command heard, a demo rendered with the director from the
resources, and a real worker that commits and hands over an artifact, which is shared, once on the
machine's Claude Code and once on the SDK's. All of it passed on macOS arm64 and on GitHub's Windows
x64, Ubuntu x64 and Ubuntu arm64 runners (2026-10-07).

### App

A Tauri 2 shell (`app/`, Rust) around the compiled server, which is its sidecar (`obeya-server`
beside the shell's program; on Linux among the resources). `bun run build:app`
(`scripts/build-app.ts`) builds it for this machine: a DMG on macOS (signed ad hoc, or with a
Developer ID and notarised, see Builds; with the hardened runtime and the entitlements Bun's JIT
needs: without them the server fails at start for lack of `SharedArrayBuffer`), an NSIS installer on
Windows (per user, no admin rights), an AppImage and a .deb on Linux (`app/linux.Dockerfile` builds
and checks them in a container on a Mac).

The shell opens a window on the Obeya that runs on the home, or starts the server (on 4417, else a
free port) and shows "Obeya startet …" until it answers; one it started (or an earlier run of the
app did) it stops when the app quits, through `POST /api/stop` like Ctrl-C, and the window shows
what the stop waits for; quitting again goes ahead at once. The app ends when its server does; a
server that ends unasked shows its log's last lines in a dialog. One started from a terminal it
leaves running. A second start of the app brings the window to the front. On a Mac closing the
window keeps the app in the Dock, and the window has no title bar: the canvas's bar takes the
traffic lights and moves the window (`data-tauri-drag-region`; the page may call only that and the
zoom, `app/capabilities/window.json`). Links to anything but the canvas and new windows open in the
default browser, which is also how "Im Browser öffnen" in the settings (and the Mac's File menu)
works; the page finds `window.obeyaApp`. Downloads go into the Downloads folder.

The page gets the microphone without a prompt of the webview's (the system asks once for the app;
WebKitGTK has media streams turned on by the shell). WebKitGTK's MediaRecorder records nothing (2.50
and 2.52, 2026-10-08), so in the Linux window the page takes Web Audio's samples and sends a WAV
(`src/ui/recorder.ts`). With a PulseAudio sine source as microphone, the AppImage on Ubuntu 24.04
(in a container) recorded the tone that way; the other headless runs got silent samples, so a Linux
desktop with a real microphone is still to be tried.

The server's output goes to `app.log` in the home. linuxdeploy sets the library path of every
program in an AppDir, which breaks Bun's binary (its code sits after the ELF's end), so the AppImage
gets the server after linuxdeploy and is packed again. `bun scripts/check-app.ts <program>` checks
an installed app in its webview: the canvas in the window, a microphone recording as
`src/ui/recorder.ts` makes it (`MediaRecorder`; Web Audio's samples on Linux), an H.264/AAC video
playing, the browser button, a second start, the stop over HTTP, and the app beside an Obeya started
from a terminal.

### Builds

`.github/workflows/build.yml` builds the app on GitHub's runners, each platform on its own (macOS
arm64 and x64, Windows x64, Linux x64 and arm64, the AppImage on Ubuntu 22.04 for its glibc), with
`scripts/build-app.ts`, and checks the compiled server there with `scripts/check-binary.ts`; `bun
run typecheck` and `bun test` run beside it on Linux (with uv and ffmpeg, which the demo voice's
tests use).

Builds and tests use Bun 1.4.3 (since 2026-10-15, for tests a file per process, `bun test
--parallel`); Obeya needs 1.3.14 or later: in 1.3.12 on Linux, an `fs.watch` closed while Bun still
listed its directory deadlocked a thread of Bun's work pool, and every later bundle of a page (the
canvas, the panel), which waits for that whole pool, hung for good (found 2026-10-13 from the
panel's test, which hung on GitHub's runner after the plan-doc watch tests). `bun start` from a
checkout runs on whatever Bun the machine has: on Linux with a Bun before 1.3.14 Obeya still starts,
but warns at startup in the log (which stays readable once the deadlock keeps the canvas from
loading) and, for as long as it runs on that Bun, with a pill in the bar („Bun 1.3.12 ist zu alt“,
on hover what may happen and `bun upgrade`), which the server's `hello` brings to the page
(`oldLinuxBun` in `repo.ts`).

#### When the build runs

The build runs on a push to `main` that changes code (docs, design, the site, Markdown files and the
Pages workflow left out, as in `src/core/inert.ts`, which the self-update follows too, except that a change to the build
workflow itself builds), the installers kept a week as the run's artifacts, and on a tag
`v<version>`, which must be `package.json`'s: then a draft GitHub Release gets every installer, the
updater's archives with their signatures, `SHA256SUMS` and `latest.json` (`scripts/release.ts`), its
notes the subjects of the commits since the version tag before that change what runs (the first
twelve lines also in `latest.json`, for the bar; other tags such as `site-media` do not count, and
the first release says that it is one rather than listing the whole history), and the owner
publishes it. The installers carry fixed names without the version (`Obeya-macOS-arm64.dmg`,
`Obeya-Windows-x64-setup.exe`, `obeya_amd64.deb` …), which the README and the site link through
`releases/latest/download/`, so the release is made the latest (`site-media`, the site's video, is a
pre-release and never is). A run takes about ten minutes (2026-10-08).

The updater's archives are signed by `build-app.ts` itself when `TAURI_SIGNING_PRIVATE_KEY` is set
(a repository secret, read on tags only): `Obeya.app.tar.gz` packed from the app on macOS, the NSIS
installer, the AppImage after the server is in it. Tauri's own `createUpdaterArtifacts` needs the
updater plugin's configuration and would sign the AppImage without the server.

#### Signing and notarisation

On a tag (or run by hand with "sign") the Macs' app is signed with the Developer ID and notarised:
`build-app.ts` has Tauri sign shell, server and DMG with the certificate (from the repository secret
`APPLE_CERTIFICATE`, which Tauri imports into a keychain of its own; on a Mac the keychain's, named
by `APPLE_SIGNING_IDENTITY`), then submits the DMG to Apple's notary service with an App Store
Connect API key (`APPLE_NOTARY_KEY`, `APPLE_NOTARY_KEY_ID`, and `APPLE_NOTARY_ISSUER` for a team
key), staples the ticket to the DMG and to the app beside it (the updater's archive packs that one;
stapler fetches the ticket from Apple's CloudKit, which now and then drops the connection for
minutes, so each staple and validation is tried six times over about thirteen minutes) and fails
unless Gatekeeper calls both "Notarized Developer ID". One submission covers the app and the server
inside the DMG; Tauri's own notarisation is not used, since it notarises the app but not the DMG and
takes no individual key. A tag without the Apple secrets fails rather than releasing an app macOS
would not open. Notarised on the owner's Mac and on GitHub's runners for both Macs (2026-10-09):
Apple accepted Bun's binary with the JIT entitlements; Apple answered within 35–40 s.

Windows and Linux are not signed: the release notes say how to check a download against
`SHA256SUMS`, and the site and the README what SmartScreen shows. For Windows, Obeya has applied to
the SignPath Foundation (2026-10-19); its conditions bring a code signing policy, a page of the site
(`site/code-signing/`) that the site's download section and footer, the README and every release's
notes link (`docs/release.md` § The SignPath Foundation). The maintainer's steps (agreement,
certificate, API key, the updater's key, a release) are in `docs/release.md`.

#### Making a release

"Mach ein Release" is the project skill `.claude/skills/release/`, which every Claude session in
this repository has, on a card or in a terminal: it goes through the steps of `docs/release.md` § "A
release" in their order and holds only what to judge and where the owner comes in.
`scripts/release-status.ts` prints what that is decided from (the last version tag and the commits
since, the version to propose, how far GitHub's main is behind, the latest release and `site-media`,
the site's video against the last UI commit, the build's secrets) and, with `draft <tag>`, whether
the build's draft holds everything. `scripts/gh.ts` runs any other gh call on the checkout's origin
as the account that owns it (the repository as GH_REPO, the token of the owner's gh login as
GH_TOKEN), since the machine's active gh account may lack the admin rights a workflow run or a rerun
needs; the status script and the video's upload take their environment from it. Nothing names
sadilek/obeya: in a fork they act on the fork as its owner, and without a gh login for the owner (an
organisation) gh runs as it would anyway.

Every release renders the hero video again and takes the site's screenshots again from that render;
the card's demo is the new video, so the owner watches it and approves the release in one step.
After the landing the worker pushes `main`, tags, watches the build, checks the draft and uploads
the video; the owner publishes.

### App updates

The app updates itself from GitHub Releases through Tauri's updater (`app/src/update.rs`), with
Obeya's own key pair: the public key and the endpoint (`releases/latest/download/latest.json`, so
only a published release counts) are in `app/tauri.conf.json`, the private key signs in CI (see
Builds). At start and every six hours the shell asks; a newer version is downloaded and its
signature checked at once, so installing takes seconds. Every three seconds the shell reports it to
the server it started in this run (`POST /api/app-update`, gone 10 s after the shell stops
reporting), and the bar shows "Update 0.4.0" with the release's notes on hover and "Installieren".

The app never installs by itself: the owner's click (`POST /api/app-update/install`) asks the
restarter for an `update`, which waits as a restart for new code does (workers told and paused at a
safe point, at most 15 minutes; the owner's video or dictation holds it; "Jetzt aktualisieren" goes
ahead), covers a restart already waiting, and gives way to a stop. Then the server ends with exit
code 77 (`UPDATE`), which its supervisor passes on, and the shell, seeing its server end so, shows
"Obeya wird aktualisiert …", installs the update (the app bundle swapped on macOS, asking for an
administrator only where the app's folder is not writable; the NSIS installer in its passive mode on
Windows, which starts the app again itself, as the desktop's user and so without an environment set
for the app's process alone; the AppImage file replaced) and starts the app again, whose server
resumes the workers. An update that fails to install says why in a dialog, and the app starts again
in its old version.

A .deb is not replaced by the app (dpkg needs root): its bar offers the release to download instead.
No update is offered for an Obeya the app did not start in this run (it would not see it end), nor
from a checkout, which follows its git (its bar offers the upstream's new commits instead, see
Pulling from the upstream). `bun scripts/check-update.ts` checks it on the machine it
runs on: it builds the app as 0.0.1 and 0.0.2 with a key pair and a local release made for the
check, installs the first, and has it find, download and install the second and start again. It
passed on macOS arm64 and on GitHub's Windows x64 and Ubuntu x64 runners (2026-10-09).

### Site

The page on obeya.si (`site/`), in English whatever the interface speaks: plain HTML and CSS, no
framework and no build, and JavaScript only for the video's play button and its chapter list, so it
opens straight from the file too.

From the top:

- one sentence ("Direct coding agents like an engineering director": the picture of the one who
  decides and directs spoke to a test reader more than "like a team") and the hero video;
- five pillars with screenshots (the canvas, with a canvas per product that one Obeya runs side by
  side, which the phone's "across all your canvases" builds on; voice, the demo the owner watches instead of testing
  the change themselves, as in a launch review: the audience reads no code anyway, so the contrast
  is with testing, not with code review, with a line in small print below it pointing to
  `demos.obeya.si`, the demos of Obeya's own development; the order in which cards run: parallel where they can, one
  after the other where they must; the phone, two screens of the phone view side by side, what
  waits and the demo opened from there, with how the phone reaches Obeya: over the owner's own
  private network, through no service of Obeya's);
- "From idea to main" with a switch between the standard case, shown first, and the extended cases
  (two radios and CSS, no JavaScript): the standard case is the three steps most cards take, say the
  task, watch the demo, approve, each a card in its state, so that the page reads simple at first
  sight; the extended cases are a card's way along a wall as cards in their states, drawn as the
  canvas draws them: the detours of an idea and its prototypes, a task's work, its demo with the
  round back for changes, the merge and an agent's proposal hanging off it, dashed with ✦ (one
  column below 900 px). Only the demo carries the "!" pin of a card waiting for the owner: idea and
  prototype show states that need nothing of them (the agent thinking, a prototype being built), so
  that the way reads as task, demo, done;
- "The big room", what the name means, with 大部屋 set vertically, and the one wall as the way out of
  many parallel chats (no Toyota, which the README left out on purpose too);
- the dark band "Obeya is built with Obeya.";
- getting started with the downloads, `bun start` from the checkout and GitHub (not the design doc,
  which is written for the agents working on Obeya).

A second page, `site/code-signing/` ("Code signing policy"), linked under the downloads and in the
footer, is what the SignPath Foundation asks of a project it signs for: who signs what, the team's
roles and what Obeya sends where. It shares the stylesheet.

A third, `site/watch-the-demo/` ("Why demos" in the navigation and the footer), is an essay in the
owner's first person with the thesis "Stop testing your agents' work. Watch the demo.": the agents
outpace whoever tests their work by hand; a director has the work shown in a launch review; what a
demo is (the video and the worker's handover note, no report) and the rules that make it evidence
(the code under review, every behaviour in the video, backend through a view, a page where there is
something to look at); recording it is an end-to-end test the agent runs on its own work; what is
left for the owner; the demos as a record. It is what a launch post links when it argues rather than shows, and carries its
own Open Graph tags, with the demo screenshot as its picture (2026-10-19).

It has Obeya's palette and type (see Visual identity): Newsreader, IBM Plex Sans Condensed and the
three characters of 大部屋 (Noto Serif JP) are served from `site/fonts/` with their OFL licences, not
from Google Fonts; logo and wordmark are copies from `src/ui/logo/`. The screenshots show the
English interface on the Tipjar app of the hero video, the demo one a demo of a Tipjar change (so
that the picture is of a demo, not of Obeya), the phone's the same wall in the phone view at an
iPhone's size; `bun scripts/site-shots.ts` takes them all again from a scratch Obeya, the demo's
chapters from its `chapters.vtt`. Paths are relative, so the site works under sadilek.github.io/obeya as well.

`.github/workflows/pages.yml` publishes `site/` to GitHub Pages on every push to `main` on GitHub
that touches `site/` or the workflow, and on demand from the Actions tab; Pages serves a branch only
from `/` or `/docs`, hence the workflow. The domain obeya.si is verified for the GitHub account and
set in the repository's Pages settings, with HTTPS enforced (a `CNAME` file would be ignored by a
workflow deployment); at the registrar the apex points at GitHub Pages' four A and four AAAA
addresses and `www` is a CNAME to `sadilek.github.io`, which Pages redirects to obeya.si.

### Hero video

The site's film is a real run (`scripts/hero-video/`), recorded with Obeya's own demo pipeline on a
scratch canvas over a small tip calculator (Tipjar, in `tipjar/` there with its own `.obeya/settings.json`
and plan doc): the wall arranged (a lasso into a group, a card dragged beside another group so their
territories meet), an idea by voice, a message typed, pasted and spoken in Obeya's sidebar (with a
preference Obeya proposes), a real worker building the idea and recording its demo, comments said
into the demo video at two places and sent together at its end, the worker's new demo, the approval
landing it on main, proposals from an agent and from Obeya's work retrospective, an idea discussed
with its agent; about four minutes, sharp as the app on a Retina screen, narrated in English in the
owner's ElevenLabs voice clone (see CLAUDE.md), tried out first in the Qwen3 clone (`render.ts --qwen`).
The directory holds the narration, the scenes, the stage and the render; its README says how to
change, re-render and publish it.

The video is not in git: it, its captions, its chapters and the README's loop are the assets
`hero.mp4`, `hero.vtt`, `hero.chapters.vtt` and `hero.loop.gif` of the GitHub release `site-media` (a pre-release, so that it never becomes the
latest release, whose installers the README and the site link), which the Pages workflow fetches
into `site/media/` before it publishes, so obeya.si serves them itself (no third party, no
tracking). `publish.ts` replaces them and runs the workflow again; the chapters come from the render
(the demo pipeline writes the scenes as `chapters.vtt` beside the captions), so they always match
the video that is out. The loop is cut from the video at each publish, by the titles of its scenes
("Your wall" to "The agent starts"), so a release's new render brings a new loop too: 1.5 times as
fast, its last frame held a moment, 1280 px wide at 12 frames a second, about 18 s and 3 MB.

On the page it is a `<video>` with English captions and a poster (`site/img/hero-poster.jpg`, the
first frame without a play button, in git, made by `poster.py`), loading nothing before a click (`preload="none"`); opened from the file, the site shows
the poster alone. A few lines of script put a big play button (a real `<button>`) over the poster
and show the browser's controls once it plays; without JavaScript the controls are there from the
start and the button stays hidden. Under the video its scenes are listed as on a card's demo (time
and title, four to a row, two on a phone): the list is built from the video's chapters track, a
click plays from that scene, and the scene that plays is lifted as a card. The mark follows the
time, not the track's active cues, which Chrome leaves stale after a seek. Without JavaScript or
without the chapters file there is no list.

### Decisions

- **Runtime: Bun; browser UI served locally. Installed, Obeya is an app**: a Tauri shell around the
  server compiled into one file, so that someone without Bun or a checkout can download and start
  it, and the shell can hear a key held anywhere on the machine (global push-to-talk). Tauri because
  it brings the installers, the updater and global keys, and its window is the system's webview, so
  the shell adds a few MB and the UI stays what the browser shows; the browser stays a way in, and
  the checkout (`bun start`, updating itself) stays how Obeya is developed. At first the decision
  was a shell only if global push-to-talk needed one; a download for people who do not develop Obeya
  made it needed anyway.
- **The app's formats** (2026-10-06): DMG, NSIS installer, AppImage and .deb, no Flatpak or Snap,
  whose sandboxes are in the way of git, agents and the repositories. Windows on ARM once there is a
  machine to try it on.
- **Signing** (2026-10-06): the Mac app signed with a Developer ID and notarised from the first
  release, since macOS will not open an unnotarised download without a detour through the system
  settings; Windows and Linux unsigned, with checksums. SmartScreen warns about a new installer
  signed or not until it has a reputation, so a Windows certificate comes after the first release
  (SignPath Foundation, free for open-source projects). Applied for after v0.5.0 (2026-10-19),
  disclosing that the server has Anthropic's proprietary Agent SDK compiled in, which SignPath's
  terms exclude: dropping the SDK would leave Obeya tracking Claude Code's undocumented control
  protocol itself, for no gain to users, so SignPath decides first; a certificate in the owner's
  name is the fallback.
- **A release is a project skill with a status script**, not a script alone and not left to each
  session (2026-10-13): the steps were spread over three documents, and v0.1.0 ran into three
  problems nobody had written down (GitHub's main 35 commits behind, `site-media` the latest
  release, the tag pushed by hand). Checking the narration against the UI, looking at the stills and
  judging the draft need an agent; what it decides from is the script's. Every release renders the
  video again, stale or not: almost every release changes the UI. Publishing stays the owner's
  click, since it reaches every installed app.
- **Obeya is made known through a static English site on obeya.si that starts with the film**
  (2026-10-06). Of three prototypes, B (film first, calm and editorial) became the page; C gave it
  the principles as cards on a wall, the four steps as one card moving along the wall and "The big
  room". A's canvas that the camera flew through while scrolling was built in and dropped again: the
  owner found the scrolling odd. The hero video is a release asset rather than in git or on a video
  host (2026-10-07): git holds no video, and the site loads nothing from a third party.
