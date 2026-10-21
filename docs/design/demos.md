## Demos

A chapter of the [design doc](../design.md), whose header says how it is written.

### The demo skill

The demo skill's pipeline (scripted walkthrough, narrated video, report) is part of the repository:
`plugin/` is a Claude Code plugin named `obeya` whose skill `demo` (`plugin/skills/demo/`) holds the
instructions (`SKILL.md`, paths through `${CLAUDE_SKILL_DIR}`), the director (`lib/director.ts`,
Playwright on the local Chrome, else Edge, else Playwright's own Chromium, as on Linux on ARM where
there is no Chrome, launched by the plugin's `lib/chromium.ts`, which the browser skill shares; cut
with ffmpeg, run with plain `node`; on macOS, Linux and Windows, checked 2026-10-05), the overlay
(`lib/overlay.js`) and the narration (`lib/tts.py`), with Playwright
among Obeya's dependencies. Every page of the demo's browser, as of the browser skill's, gets
`plugin/lib/silent-speech.js` as an init script: Chrome's `--mute-audio` leaves the Web Speech API
alone, and a page's `speechSynthesis` spoke through the system's voice on the machine (an app's
speech fallback said a name every half minute while an agent tested it). The script keeps the API
and speaks nothing: utterances queue, fire `start` and, after about as long as saying them takes
(70 ms a character at rate 1), `end`; `pause`, `resume` and `cancel` fire the spec's events, and a
page without a user activation gets `not-allowed`, as in Chrome. So the page goes on as it would,
which leaving the API out (`--disable-speech-synthesis-api`) would not.

Both browsers show scrollbars as the machine's browser does: Playwright's headless launch adds
`--hide-scrollbars`, and `lib/chromium.ts` leaves it out (`ignoreDefaultArgs`), so a list that
scrolls in a fixed height, or two scrollbars side by side, shows in a video and a screenshot. On
Windows and Linux these are classic scrollbars that take width; on a Mac set to overlay scrollbars
(the default with a trackpad) a bar shows while a box scrolls and fades a second later, as in the
owner's Chrome, so a still shows it only where the scene just scrolled. Permanent ones on such a Mac
were possible only by starting Chrome without Playwright (which refuses `-AppleShowScrollBars
Always`) and were not wanted (owner, 2026-10-21).

The report page (`index.html` beside the video, for the skill's use without Obeya) holds the title,
the summary (what the change does, then what the owner needs to know beyond the video: a behaviour
it leaves out and why, what is open or unverified, a defect found in someone else's change; a few
short paragraphs), the video with its chapters, the open question when there is one, and the
provenance (branch, commits, stack). Under Obeya the card shows the video and the handover summary
instead, and a problem outside the change is a proposal.

Obeya loads the plugin into every worker session (the Agent SDK's `plugins` option, a local plugin),
so the worker has the skill as `obeya:demo`, which its brief names, and `obeya:settings` (see Repository
settings). The skill also runs without Obeya: as the plugin, or as a user skill that points to
`plugin/skills/demo` (the owner's `~/.claude/skills/demo` is a link to it in the Obeya checkout).
Claude Code lists a skill file once: when the plugin Obeya loads is the very directory such a user
skill links to (Obeya run from that checkout), the session has the skill as `demo` and knows no
`obeya:demo` (Claude Code 2.1.299, 2026-10-14). The brief and the demand for a demo at
ready_for_review therefore name the skill as the session lists it (`demoSkillName`: the user skill
whose `SKILL.md` resolves to the plugin's, else `obeya:demo`) and give the path of its `SKILL.md` to
read for a session that does not know it (on a host, the plugin's copy there). At start, Obeya logs
a warning when the plugin's manifest or the demo skill is missing.

### The demo settings and voices

The demo settings (`lib/settings.ts`; `demo.json` in Obeya's home, `OBEYA_HOME` else `~/.obeya`)
give the narration language (German or English: narration, captions, the report page's words;
without one, the owner's conversation language) and the voice, a provider: text in, WAV out
(`lib/voices.ts` turns the settings into what `lib/tts.py` runs). They are the machine's, for every
canvas; a repository whose demos speak another language says so in its settings (`demo.language`,
see Repository settings), which goes before them for its demos: Obeya gives it to the repository's
workers as `DEMO_LANGUAGE`, and the skill (`repositoryLanguage`) reads that, else the
`.obeya/settings.json` of the repository it runs in. Obeya's own demos are in English (its
`.obeya/settings.json`, 2026-10-19). `node lib/settings.ts` names where the language came from; run in
a repository without Obeya, it says to render with `DEMO_LANGUAGE`, since the render runs in the
demo's directory, outside the repository.

Local voices run once per clip as a command with the text on stdin:

- Piper, the default (German `de_DE-thorsten-high`, English `en_US-ryan-high`; about twice real time
  on a laptop CPU, model loading included, and Whisper heard the test clips back word for word,
  measured 2026-10-02);
- Qwen3-TTS (1.7B, a stock speaker from the CustomVoice model or a clone of a clip with its
  transcript beside it from the Base model; MLX through mlx-audio on Apple Silicon, PyTorch through
  qwen-tts elsewhere, `lib/qwen3.py`; a clone continues its clip, so a German clip carries German
  accent and rhythm into English narration: the clip has to be in the narration language, so the
  settings hold one clip per language (`references: { de, en }`), and a demo clones the one of its
  language; a language without a clip is spoken by a stock speaker, which is nobody's own voice, so
  that narration is in the third person. Until 2026-10-19 the settings held one clip, since only
  one language was active at a time (decided 2026-10-12); with a language per repository two are
  (a `reference` of a file from before is read as the clip of its language). No open successor
  model as of 2026-10-07, Qwen-Audio-3.1-TTS of 2026-09 is hosted only);
- macOS `say` (offered on a Mac only);
- the owner's own command (through the shell; it writes the WAV to `$DEMO_WAV`).

Hosted ones are HTTP requests from templates in `tts.py`: Gemini, OpenAI (or another base URL with
the same API), ElevenLabs (`eleven_v4` unless `DEMO_ELEVENLABS_MODEL` names another), Azure, or
the owner's own endpoint (POST `{"text", "language"}` as JSON, audio back), each with its key
from its environment variable or a key file. Whatever comes back becomes a mono 16-bit WAV
through ffmpeg (a voice command gets its text as UTF-8, with `PYTHONUTF8`: on Windows Piper read
it in the code page otherwise).

English terms in German narration ("Pull Request", "Branch", "Feature", "Canvas") are respelt for
the voices that read every word by the narration language's rules, Piper (through espeak-ng, which
made "Feature" *fe-a-tu-re* and "Branch" *branç*) and `say`; their spec says so (`respell`). The
spoken form comes from a lexicon per narration language that ships with the skill
(`lib/lexicon.de.json`: common terms of software work and their inflected forms, "Bräntsch",
"Fietscher", "Kännwes") and from a mark in the script, `{Canvas|Kännwes}`, for a term the lexicon lacks, which wins over the lexicon.
`tts.py` replaces whole words only, in any case, the longest term first, before it keys the clip
cache on the spoken text, so a change to the lexicon re-synthesises only the clips it touches; the
captions (`untagged`, in a render and in a re-voicing) show the written form. Every other voice gets
the written form: Qwen3 said most terms well as written and sounded too German with the respelling,
and the hosted voices read English. Rejected (2026-10-21): English phonemes for Piper (`[[ … ]]`;
Thorsten hardly has *w* and *ɹ*, and Whisper heard "Pull Equest" and "Benz"), and recognising
English words by themselves ("Demo", "Team", "Agent" belong to both languages). There is no English
lexicon yet; the mechanism is per language.

The lexicon holds a term only where Piper got it wrong and the respelling got it right: each
candidate was synthesised in German sentences and heard back through Whisper (large-v3-turbo,
2026-10-21). espeak-ng's German exception list already says Commit, Update, Push, Release,
Screenshot and Prompt in English, and Repository came through as written, so they have no entry.
"Build" is "Bild", the same sound, which Whisper writes as the German word. For "Branches" and
"mergen" no respelling was heard back as the term ("Brennschiffs", "matchen"), so they have none
yet; a script marks them where they matter.

Voices are not labelled as generated, a clone included: the whole demo is generated, and that is
clear from where it is shown. The person follows from "Das ist meine eigene Stimme" in the settings:
the first person only in the owner's own voice, otherwise the narration presents the work without
"I". `node lib/settings.ts` prints what applies, for the agent writing the narration; `DEMO_VOICE`
overrides the voice for one render (another provider, never the owner's own, or a `.wav` that
Qwen3-TTS clones). The owner's clone is Obeya's Qwen3
voice with the reference clip of the owner's voice project (Stimmzwilling,
`data/voice/derived/reference4_A.wav` with its transcript), so Obeya holds it across renders; it
never leaves the machine.

Each clip is synthesised once and kept as it comes: nothing listens back to it (see Decisions).

#### Installing voices

Obeya installs Piper and Qwen3-TTS on request from the configuration dialog, which shows what is
missing and about how large it is first: each in a Python environment of its own made by uv under
`voices/` in Obeya's home, Piper's voice files beside it, Qwen3's models in the Hugging Face cache,
where a model downloaded before counts as installed (`node lib/voices.ts install` does the same
without Obeya). A render refuses a voice that is not installed and says how to install it. The sheet
also plays a sentence in the voice being chosen ("Anhören"), in the narration language. For Qwen3-TTS
it has a field per language for the clip to clone, each with what keeps it from working (no such
file, no transcript beside it); its narration language says that a repository can name another.

#### A voice that stays loaded

A voice that can stay loaded says so in its spec (`serve`, so far only Qwen3-TTS: `qwen3.py
--serve`): `tts.py` starts it once per render (and once per "Anhören"), on the first clip that is
not cached, and asks it clip by clip over its stdin and stdout, one JSON line each way (text, WAV,
language; a ready line once the model is loaded, a line per sentence done, then `ok` or `error`
per clip). Model, reference
and transcript load once instead of per clip: three clips with a clone, no cache, went from 25.8 s
to 15.8 s on an Apple Silicon Mac (a warm start with the model costs about 2 s, a cold one 17 s;
synthesis about 2–4 s per clip either way; measured 2026-10-05, when renders still listened back
with Whisper). The libraries print on stdout too, so the server
moves fd 1 to stderr and keeps a duplicate of it for the protocol alone; a line that is not the
protocol is shown and skipped. A voice that dies stops the render with the tail of its stderr
instead of hanging. One that says nothing for 10 minutes while it loads, or for 5 minutes while it
makes a sentence (a few seconds on a GPU, a minute or two on a slow CPU), is stuck: it is ended and
its clip fails the same way. The sentence lines are there for that: a long clip is never taken for a
stuck one. Piper, `say` and the owner's command still run once per clip.

Under Obeya the Qwen3 voice lives longer than a render: Obeya holds it as a child process of its
server (`src/server/narration.ts`), since the server runs all along and on every platform. The spec
says which voice Obeya may hold (`host`: the reference clip or the stock speaker; the server builds
the command itself from that, never takes one from a request), and Obeya sets `OBEYA_URL` for its
workers and for the configuration dialog's sample: the address of its narration server
(`serveNarration`, `http://127.0.0.1:<port>`), which answers narration clips and nothing else, so a
worker holds no key to the rest of the API (Who may talk to it). `tts.py` then sends each clip to
`POST /api/narration/clip` (`{voice, text, inline: true, language}`, JSON only, so a page elsewhere
cannot send one without asking first) and gets `ok` with the seconds and the WAV, or `error`, back.
Obeya's own server answers the same route with the owner's key, and there may write the WAV to an
absolute `out` instead. The clips of all renders wait in one queue and are served one at a time;
each render asks for its next clip only once the last is done, so parallel renders take turns clip
by clip (throughput stays that of one GPU). The voice starts with the first clip and runs on for 5
minutes after the queue empties (`NARRATION_IDLE_MS`), then its stdin ends; a clip for another voice
(reference, speaker or language) ends it at once, and Obeya's shutdown kills it. Between server and
voice runs the line protocol above, unchanged, with the same limits (`NARRATION_LOAD_MS`,
`NARRATION_SENTENCE_MS`): a voice that stops answering fails its clip with a message, the render
stops with it, and the next clip starts a new voice. On 2026-10-21, before these limits, the held
English voice gave no answer to a clip and sat at 0 % CPU for 40 minutes; every render and the
configuration dialog's German sample waited behind it in the queue until it was killed by hand. The
switch to the sample's voice was not the cause: the queue never got to it. What it saves is a model load per render or "Anhören"
within those 5 minutes: about 2 s warm, 17 s cold, at the cost of 3–4 GB held meanwhile. Without
`OBEYA_URL`, or when Obeya does not answer (not running, restarting, an older Obeya without the
endpoint), `tts.py` loads the voice itself as before.

#### One large model at a time

One large model per render at a time on the machine (Qwen3-TTS, the owner's command; parallel
demos had swapped the machine to a halt): `tts.py --lock ~/.cache/demo-skill/tts.lock` takes the
file's lock before the process loads such a model itself and holds it to its end (`flock`, on
Windows a byte-range lock through `msvcrt`; it works beside an older `lockf -k` on the same file).
A voice Obeya holds takes no lock: parallel renders synthesise turn by turn through Obeya, with one
voice model in memory.

### What a render needs

What a render needs on the machine is checked by `lib/setup.ts`: Node 22.18 or newer (TypeScript
without flags), Playwright and a browser (found where Playwright looks), ffmpeg with libx264, uv
(which brings Python) and the voice. Each missing piece comes
with how to install it on this platform (Homebrew, winget, the Linux family's package manager from
`/etc/os-release`, else a page). The configuration dialog shows the check below the demo settings
("Was Demos auf diesem Rechner brauchen", the voice left out since it has its own lines), again
after an installation and on "Erneut prüfen"; the parts a voice still
lacks are named in the narration language ("Piper voice en_US-ryan-high" for an English one); a
render runs it before anything else and stops with the whole list (`--narration` leaves out the
browser); `node lib/setup.ts` prints it for an agent, which installs a voice itself but asks the
owner for system software. The guide for setting up a machine is `docs/demo-setup.md`. Not tried yet
(2026-10-05): Edge as the fallback, a voice command through `cmd.exe`, Qwen3-TTS through PyTorch (no
machine with a GPU).

### Recording a demo

How to run each project's app, for a demo too, is its settings' `app.run` (say, how to start it,
what to do after a change, where its address is, login, test data, migrations; Obeya: the scratch
instance); without Obeya, `bun lib/recipe.ts` in a repository prints it. The worker records once the change is committed and checked, as the recipe
says how to run the app (Obeya: a scratch instance from the worktree, staged by
`scripts/scratch-obeya.ts` from a stage file before every take, its workers idle unless the change
is about agents (`--real-workers`), on a port the script picks so that workers staging at once never
collide (staging afresh from the same stage file and code replaces the one before, on its port);
elsewhere, say, the clone's own app), and hands over the
directory and chapter titles with `ready_for_review`. A scratch Obeya speaks the stage's `language`,
else the language of the demos where the script runs (`DEMO_LANGUAGE`, else the demo settings'), so
the screen matches the narration; the stage's card titles and conversations are written in it
(Obeya's `app.run` asks for English). What happens while an agent works (a line arriving in an open
conversation, an artifact handed over again) the script makes happen without one: `--say` and
`--artifact` act as a staged card's agent through the server, which runs that agent's own tools
for it (`Workers.standIn`, `POST …/cards/<id>/stand-in`, offered only with `--idle-workers`), so the
page gets the change as from a real agent. A card staged at work has no session; it gets a stand-in
for one, its tools working as a session's would, with no turn begun or ended. A staged HTML artifact
is a copy in the scratch directory, which `--artifact` rewrites, so a take never changes the stage's
own files.

Before the first render it runs `node demo.ts --dry`: `login`, `open` and the scenes against the
app, without narration, setup check, screencast or ffmpeg (`untilSpoken` does not wait), under the
same per-demo lock as a render, so a scene that waits for a state that never comes fails before
synthesis and the scenes before it. A failing step names the page's URL, the screenshot and
Playwright's message on lines of their own. A page that hangs fails the render too, instead of
leaving it waiting: a call into the page (the overlay's, `d.evaluate`) that gets no answer within 20
s fails its step, and so does a screencast that sends no frame for 20 s (the clock strip repaints
every frame, so a live page always sends them). A computer that sleeps mid-take fails the take at
once, named as such: the director's own timer ticking five seconds late means it stood still, and a
Mac's kernel says whether it slept meanwhile (`kern.sleeptime`). A step that fails after the
director stood still names that as its likely cause, a possible sleep where no kernel tells. On a
Mac the director holds `caffeinate -i` while it runs, against idle sleep; a laptop with its lid
closed on battery sleeps regardless. A demo started with `bun demo.ts` runs
again under Node (see the decisions).

#### Cutting waits

Waiting is cut out of the video. The scene wraps such a wait in `d.skip`; the page fades to white,
the cut falls while it is white, and it fades back in with how much later it is ("31 Sekunden
später"), about two seconds in all. The cuts come out of the frames, the narration offsets, the
chapters and the captions alike (`lib/timeline.ts`); a narration clip the cut falls into goes on
across it, so a skip belongs after the scene's narration, and the next scene says the jump ("Kurz
darauf"). A wait under five seconds stays in the video: `skip` fades only once the wait has run five
seconds; those first seconds are cut without a trace (the picture rarely changes in them), the rest
falls into the white. The review table flags a scene with more than 5 s without narration.
A wait that is only the app's latency (a reply that takes a few seconds), not time the viewer would
spend waiting, is cut whole without flash or label (`skip(fn, { quiet: true })`): the hero video's
"5 seconds later" over Obeya reading a command made its replies look slow (2026-10-14).

#### Pauses in every voice

Pause tags in the script (`[short pause]`, `[long pause]`) are silence in every voice: ElevenLabs v3
and v4 read them, any other voice speaks the parts between them one by one and `tts.py` joins them
with 0.5 s or 1.5 s of silence. Before (2026-10-14) other voices got the text without them, so a
render in Qwen3 ran sentences together that the ElevenLabs one kept apart.

#### Sharp for a public page

A demo is recorded at one pixel per point and compressed to CRF 30 (about 2.5 MB a minute), small
enough to share; text stays legible but flat colours go grainy on a large screen. A public video sets
`sharp` in its spec: the page at twice the pixels, as on a Retina screen, screencast frames at JPEG
quality 100 and CRF 18, so it looks as the app does live (the hero video, 2026-10-15).

#### Re-voicing

A demo that kept its frames (`.work/` with `frames/` and `frames.txt`) can be narrated anew in another
language without recording it again (`node demo.ts --revoice en`, or `node lib/revoice.ts <dir> en`
for a demo whose script no longer runs). When Obeya's demos went public in English (2026-10-19),
the latest demos of its 30 most recently approved cards that kept their frames went public too,
re-voiced while their screen stayed German; the older ones stay private, and the hero and release
videos have their own. It reads what the render left in the directory, not the
script, so it works on a demo of any director version: the narration from `.work/jobs.json`, the
chapter titles and scene starts from `chapters.vtt`, where each clip ran from `captions.vtt`, the
report from `index.html`, `sharp` from the encoder settings x264 notes in `demo.mp4` (CRF 18).

1. The first run writes the words (`.work/revoice/source.json`: title, per scene its chapter title
   and narration, the report) and asks the agent running the skill for them in the language
   (`.work/revoice/en.json`, same shape). The agent, not a script, translates: it reads the labels
   from the stills, since the screen keeps its language and the narration quotes each label as it
   appears with its meaning after it: „Teilen“ (Share), in the narration as an aside („Teilen“, share),
   which Qwen3 spoke more reliably than parentheses. A translation that drops a scene, an audio tag
   or a paragraph of the report's summary is refused with what is missing. A report page from before
   2026-10-19 also has lists of what was shown, not shown and noticed; they are left out.
2. The clips are synthesised in the voice for that language (the demo settings' clone of
   `references.en`, say).
3. Each scene's narrated stretch (its caption cue) plays as long as its new clip: the frames in it are
   held longer or shorter by the clip's ratio, so an action timed with `untilSpoken` lands on the same
   word; the lead before the words, the gap after them, what follows them and the cuts' flashes (a
   `skip` belongs after the words) keep their length and move along. A frame across a cue's edge
   takes a share of both. A scene whose words change length by more than a third is flagged for a
   look at its stills.
4. `demo.mp4` (encoded as recorded: CRF 30, or 18 when sharp), `captions.vtt`, `chapters.vtt`, the
   stills, the poster and `index.html` are rebuilt in place by the same code as a render
   (`assemble` in the director). The demo as recorded stays in `.work/revoice/original/`, which every
   later run reads from, so a corrected translation re-voices from the original again.

The card then shows it: `POST …/cards/<id>/demo-rebuilt` (`Sharing.rebuilt`) reads the chapters
again from `chapters.vtt` and drops the page text the worker wrote for the old words, so the share
writes it again in the language the report page names. A demo on a shared page is not changed under
the page: it is withdrawn first. `scripts/revoice-demos.ts list` names the latest demo videos of a
canvas's most recently approved cards that kept their frames and where each stands; `publish` has
Obeya re-read and share them through its queue.

#### Frames on time

Frames go on the video by the time they were painted, not by when the screencast handed them over:
`overlay.js` paints the time into a strip of 24 black and white cells at the page's bottom left, the
director reads it from every frame (one ffmpeg pass, `readClock` in `lib/timeline.ts`) and paints
the strip over in the video. The overlay runs in the top frame only: Playwright runs init scripts in
every frame, and until 2026-10-16 each iframe (an HTML artifact on a card, say) painted a strip of
its own at its bottom left, which stayed in the video.

#### Highlights

A highlight ring goes around what can be seen of its elements: each element's box is cut to every
ancestor that clips its overflow (a scrolling list, a card's conversation) and to the window, an
element out of sight does not count, and this holds while the ring follows scrolling.
One layer dims the rest of the page for all rings together, with a hole for each ring in its CSS
clip path. Until 2026-10-15 the holes were cut by an SVG mask over the whole page: each time the
mask's layer went, Chrome stalled for about 0.27 s, a jerk in the video wherever a ring was cleared
(a card being dragged, a new card appearing), on a quiet machine too.
A highlight on just the elements a ring of the scene has already stops the scene with an error
naming both labels: its locator has mostly matched another element than meant. A demo of
2026-10-20 ringed the interface language's row a second time for the conversation language, whose
locator also matched the first row's hint, and the video showed the label on the wrong row. To
relabel an element, a scene clears its highlights first.

### The demo on the card

Obeya takes the chapter times from the captions and serves the video, poster and captions of the
card's demo (range requests). The card shows it on the left, the conversation with the field for
feedback beside it and approve below both; feedback asks for a new render. A video without a
`poster.jpg` (one the demo skill did not render) shows its first frame instead (`noPoster`), and
the player takes the video's shape from its metadata: until a video first plays, Chrome sizes it by
its poster, and a poster that did not load left a flat strip of 300 × 150 at full width.

When the result is something to look at rather than something that happens, the worker makes an HTML
artifact instead (`kind: 'html'`): a directory with an `index.html` and the files it loads, handed
over the same way. The card shows the page in a frame where the video would be (no chapters); Obeya
serves any file of that directory, none outside it (by its real path: a link to a file elsewhere is
not served, published or exported, `demoFile` in `src/server/demo-page.ts`), with a CSP sandbox and the frame's `sandbox`, so
the page's scripts run in an origin of their own, away from Obeya's API. That origin is `null`, so
what the page loads in CORS mode (a module script, `fetch()` of a file beside it, a font) needs
`Access-Control-Allow-Origin: null`, which would let any sandboxed page on any site read the files
too. So the page's address is sent on to `<directory>/~<key>/index.html` (`keyed` in
`src/server/demo.ts`), the key an HMAC of the directory's address with a secret new at every start,
and only an address with the key gets the header; what the page loads relative to itself carries
it, and nobody learns it without Obeya's API.

Nor does the page send anything to the internet. An agent steered by text it read (a comment on a
pull request, a file) could write a page that sends what it read to another server the moment the
owner opens the card, and writing an HTML file passes the checks a `curl` to that server would not.
So the CSP of each of the worker's files (`pagePolicy` in `src/core/frame.ts`) lets it load the
files beside it, inline styles and scripts (`eval` too), `data:` and `blob:`, and nothing else: no
CDN, no font host, no other server, by `fetch`, an image, a font, a script, a form or a frame alike.
A page has to bring what it needs along. The files are named by `'self'` and by the address the
request was sent to (`ownOrigin` in `src/server/access.ts`, the one behind `tailscale serve` too):
in the sandbox Safari matches `'self'` against the page's own origin, `null`. What a CSP does not
reach, a connection opened ahead (`preconnect`, whose host name alone carries data to a DNS server)
and WebRTC, `Connection-Allowlist: (response-origin)` stops (Chrome 152 on); Firefox and Safari
know no such header, and there those two stay open. DNS prefetching is off as well
(`X-DNS-Prefetch-Control`).

A page could also leave by navigating its own frame elsewhere (`location`, a meta refresh), which
its own CSP cannot stop; Obeya's page allows its frames nothing but its own addresses (`frame-src`,
a meta tag in `src/ui/index.html`, `FRAMES_POLICY`), and that stops it. Opened in a window of its
own (an answer's page from its link), a file that may run scripts (HTML, SVG; an image comes as it
is) comes in a sandboxed frame of a page around it with the same rule (`Sec-Fetch-Dest: document`,
`framed` in `src/server/demo.ts`, which hands the frame the address's `#` part too; a browser that
sends no `Sec-Fetch-Dest`, older than about 2023, gets the file as it is). An idea's mock
has no response of its own to carry these headers, so it is written into one: the card's frame
loads an empty page Obeya serves with them (`/api/mock-frame`, connecting to nothing) and sends it
the mock's page, which it writes into itself; the policies stay with the document. The mock's page
starts with the same CSP as a meta tag, ahead of the mock's own HTML, so no comment or `<head>` of
the mock can push it out of the head (`mockPage`).

Its `index.html` comes with
the height report a shared artifact's page has (see Sharing a demo), so the frame grows to the page
and only the card's left column scrolls. The frame's height is the reported one, rounded up, plus
its border (and the report counts a scrollbar across the page's foot), and once the page has
reported, the frame does not scroll (up to its cap of 30,000 px).

A worker often renders a new handover's demo into the directory of the one before, so the addresses
the card loads its demo from carry the handover (`?v=<handover>`): a card left open while a new one
arrives loads the new video or page; until 2026-10-19 it kept showing the old one until it was
closed and opened again.

A handover without a demo is refused, unless the card has one from an earlier handover, which then
stands. Artifacts stay in `~/demos/`, never in git; a pull
request links a demo only once it is shared (see Sharing a demo).

### UI checks

Workers check web UIs with the plugin's skill `browser` (`plugin/skills/browser/`, `obeya:browser`):
`lib/browser.ts`, run with plain `node`, starts a headless browser and drives it over CDP from the
shell (open, nav, tabs, eval, text, screenshot, pdf, and `input` with trusted clicks, drags, wheel,
keys held across steps, typing, waits and `@selector` targets), with the names and syntax of the
owner's earlier private skill `chrome-headless`, so workers' habits and notes carried over.

Each Claude Code session has its own browser: the state file in the OS temp directory is named by
the session's process (`CLAUDE_PID`, which Claude Code gives every command), and `start` leaves a
detached Node process (`serve`) that launches the browser through Playwright
(`plugin/lib/chromium.ts`, the demo's Chromium) with a CDP port and `--mute-audio`, keeps a CDP
connection that gives every page and out-of-process frame the silent `speechSynthesis` (see The demo
skill; auto-attached with `waitForDebuggerOnStart`, so it is there before a page's first script,
and with `Page.enable`, without which it ran only in the target's first document), and closes it
once the session's process has ended (checked every second), at `stop` (CDP `Browser.close`, which
works on Windows, where killing the holder would leave the browser behind) or on a signal. Without
`CLAUDE_PID` (a terminal) there is one browser per user until `stop`. `--fake-mic` plays a WAV as
the microphone; Chrome launched by Playwright needs no audio service moved in-process for it
(checked 2026-10-14). Its tests run real browsers on macOS and Linux.

What headless Chromium can't reproduce (the on-screen keyboard and `visualViewport`, video
fullscreen, screen rotation) workers check in Obeya's repository with `scripts/android-phone.ts`:
Chrome in the Android emulator, driven from the shell (start, open, eval, tap, type, rotate,
screenshot, record, stop). Workers had built the same helpers in /tmp for each such card, which
took most of a run's tool calls, and their unbounded waits were blocked; so every wait in the
script is bounded and ends with an error naming what it waited for. It finds the SDK through
`ANDROID_HOME`/`ANDROID_SDK_ROOT` or Android Studio's default place. `start` boots the AVD with
`-read-only`, so several checkouts each run their own emulator of the same AVD at once (nothing
persists in it); the device, its DevTools port and the open page are kept in a state file in the
OS temp directory named by the checkout. A tap is a real touch (`adb shell input tap`), so the
keyboard opens (on a text field, `tap` returns once it is open and the page has settled) and
fullscreen counts as a user's gesture: the element's centre comes from the page
over CDP, the page's place on the screen from the WebView node of `uiautomator dump`. `open` turns
off what Chrome and Android lay over a page on their own (first-run screens, the notification
prompt, the offers to translate or install the page, the hint at the first fullscreen; Chrome as the debug app reads
`/data/local/tmp/chrome-command-line`), which would catch taps meant for the page; `rotate` turns the emulator's acceleration sensor, as a hand turns
the phone.

### Decisions

- **A demo is a video or an HTML artifact, chosen by the worker** (2026-10-01): drafts to choose
  from (a logo for Obeya) say more as a page side by side than as a recording of one. The summary,
  the open question and the follow-up cards are the same for both. Without any demo the owner would
  have to read to decide.
- **There is no handover without a demo** (owner, 2026-10-15). Until then a worker could hand over
  with `no_demo` and a reason where there was nothing to show (`waiting: review`), and a
  repository's settings could leave demos to the worker („Ein Agent übergibt nur mit Demo“, the
  demo's `required`, off for every repository without an adapter of its own, which then got no word
  about demos). A file that still has `required` shows it as a problem: `demo.required: no such
  field`.
- **The demo report has no lists of what was shown, what was not shown and what the worker noticed**
  (2026-10-05): the owner never read the first two, read the findings but rarely made a card of one,
  since most were not for them to act on. What the owner needs to know goes into the summary, kept
  to a few paragraphs; a problem worth a card is a proposal. The demo skill and its report page
  followed on 2026-10-19: until then they still asked for the lists and showed them.
- **A demo's scratch Obeya is staged by a script from a stage file** rather than by hand
  (2026-10-01): in the 14 card runs before, the demo took longer than the change itself, and every
  worker wrote its own staging (curl, sqlite, server start) with the same mistakes: the wrong API
  path, a server that restarted on the worker's commit, a staged "working" card that a real agent
  resumed, real agents the Koordinator started mid-take. The script writes the cards' fields
  straight into the database, so any state is a line in the stage file, and the workers are idle
  unless asked.
- **Every worker gets the plugin** (2026-10-08): until then only workers of a repository with demos
  got it, so a repository without an adapter had no way to the skill that writes one.
- **Demos do not listen back to their narration** (2026-10-15): until then each clip was transcribed
  back (Whisper, from 2026-10-14 Parakeet) and synthesised again below a 95 % match, up to three
  takes, with a setting to turn it off, a line in the setup check, a note in the report and a lock
  for Whisper. Of 1,034 clips heard back none had matched below 0.90 and 7 below 0.95, and none of
  the 3 logged retakes came out better; the owner found it overkill. The first take is the clip.
  Until 2026-10-07 the parts a voice lacked were named in German whatever the narration language.
- **A dry run before the first render, and clear failures**: twice a scene waited for a state that
  never came and showed it only in the full render, after synthesis and the scenes before it; a
  worker once took the screenshot's path, the only path in the message, for the page's address.
- **Demos run under Node, not Bun** (2026-10-09): Bun 1.3.12 closed a child's pipe when it
  garbage-collected the process object, after the descriptor had gone to the next child, so the
  recording browser lost its DevTools pipe a few seconds into the take, once the login browser was
  collected, and Playwright under Bun never noticed: every Obeya demo of a worker that ran its demo
  with `bun` hung after its first scene.
- **A render names a sleep of the computer, and keeps no display awake** (2026-10-17). Renders of
  a worker failed mid-take with "no frame for 20 s" while the owner was away, in whatever scene;
  the screencast stopped to the second when the Mac went to sleep (its lid closed, on battery,
  waking only for seconds now and then). A display that sleeps or a locked screen costs a render
  nothing: renders and a page's `requestAnimationFrame` ran through with both. Taken first for a
  hanging page, then for the sleeping display.
- **Waits are cut, but not short ones**: a demo of real agents had half a minute of a canvas where
  nothing happened; the flash for "2 Sekunden später" disturbed more than the wait.
- **Frames are timed by a clock painted into the page** (2026-10-08): on a busy machine (other
  renders, builds) the screencast handed frames over 1 to 5 s after they were painted, with stamps
  of the hand-over, more the longer the take ran: the picture trailed the narration (the hero
  video's microphone lit seconds after the spoken command).
- **A highlight ring takes only what can be seen** (2026-10-14). Until then the ring took the
  elements' whole boxes: around two comments in a card's conversation it took in the task message
  scrolled out above them and covered half the card.
- **An artifact's frame grows to its page** (2026-10-08). Before, the frame scrolled inside the
  card's column, two scrollbars side by side; then the page came out a few pixels higher than the
  frame, or a page whose images grow with its width fitted only beside a scrollbar, and the frame
  kept a bar of its own that scrolled by a few pixels.
- **An artifact's files are read under a key in their address** (2026-10-16). Until then a module
  script or a `fetch()` of a file beside the page was blocked (no `Access-Control-Allow-Origin` for
  the sandboxed frame's origin `null`); the header alone would let any sandboxed page on any site
  read the files of a card whose id it knows, and an answer's files sit under a thread's plain
  number. The frame's requests carry no `Referer` in Chrome, so only their address can tell them
  apart.
- **Each session has its own muted browser.** The private skill `chrome-headless` kept one browser
  per machine in a shared state file, so every session reused whatever instance ran, and a browser
  outlived its check: an unmuted one played demo narration through the speakers. On macOS it also
  moved the audio service in-process for a fake microphone.
