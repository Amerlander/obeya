## Voice

A chapter of the [design doc](../design.md), whose header says how it is written.

### Voice in

Push-to-talk: hold Space or the mic button; in the app also a key held in another app (see
Push-to-talk anywhere). The browser records and posts the audio with the focus (open card, project
in view).

#### Dictating or sending

Where the cursor is decides what becomes of the words. With the cursor in a text field under a
conversation (a card's, Obeya's sidebar's) they are dictated into it, at the cursor, and nothing is
sent: the owner adds to them, pastes a screenshot, and sends with Enter. Otherwise they go out at
once with what stands in the field of the card in view (or of the sidebar with no card open): its
words before the spoken ones, its screenshots, the message it quotes; the field empties as they go,
and gets them back when nothing was heard. The focus decides rather than whether a field is in view,
because on a card one almost always is, also when the owner just wants to say something at once; a
click into the field or beside it switches. The app's push-to-talk key in another app always sends
at once: no field has the cursor there.

A dictation starts three ways: the microphone in the field beside its screenshot button, the
microphone at the bottom (pressing it keeps the cursor where it is), or Space held in the field.
Space pressed in the field is held back: let go within 250 ms, or another key pressed meanwhile
(fast typing overlaps keys), and it is typed as a keystroke (⌘Z takes it back); held longer, the
recording starts, and let go before a recording would count (600 ms in all) it is typed after all.
While Space is down the field is read-only: Chrome on the Mac
hides the pointer at every key pressed into an editable field, and the key repeating while held made
the pointer flicker wildly as the mouse moved.
While the owner speaks into a field it is framed in blue, and the line under it and under the
microphone says „→ ins Feld · abschicken mit Enter“; while the recognition writes, „Wird
aufgeschrieben …“; nothing heard leaves the field as it was and says so under it. Otherwise the line
under the microphone names who hears it and what goes with it („→ Agent · Aufgabe: … mit Text und 1
Screenshot“). `POST /voice?listen` only transcribes and returns the words; a form with `audio` and
`text` puts the field's words before the spoken ones.

#### Drafts

Each field keeps its draft (text, screenshots, the options picked for the questions above it; the
quote in `src/ui/reply.ts`) in one store per field (`src/ui/draft.ts`) rather than in the field, so
the microphone reads and writes it, and a draft outlives closing the card. Picks count only while
the same questions stand. The drafts of the cards, the sidebar and the microphone are also written
down per tab and canvas (`sessionStorage`) as they change, so they outlive a page load: switching to
another canvas and back (a page load of its own) or a restart.

#### The microphone

The log has each recording's length and level next to the transcript. While the owner holds the key,
a level that stays flat for 1.5 s shows „Das Mikrofon liefert keinen Ton.“ under the mic. The first
press after a page load opens the microphone (about 0.2–0.3 s); let go before it is open, nothing is
recorded (rather than a recording that runs on unheld) and the owner hears „Das Mikrofon war noch
nicht bereit“. The microphone is not opened on page load: in the log of 1–5 Oct 2026 (22 page loads
with a recording after them) the first recording after a load failed no more often than later ones,
and opening it early would keep the browser's microphone indicator on all the time.

A recording without audible speech gives „Ich habe nichts gehört.“, one Whisper cannot make sense of
„Das habe ich nicht verstanden.“; the Koordinator gets neither to guess from. How Whisper fails on
such recordings (the titles talk it into loops, guesses or its words for silence) and how they are
told apart is in `voice/transcribe_sidecar.py` and `src/server/voice.ts`.

### Speech recognition

A sidecar on this machine keeps the speech recognition's model loaded
(`voice/transcribe_sidecar.py`, `src/server/voice.ts`): Parakeet TDT 0.6B v3 by default, on every
platform, the Mac included (NVIDIA's model as int8 ONNX through `onnx-asr` and ONNX Runtime on the
CPU, fetched through uv without PyTorch or MLX; about 640 MB of model, 4 threads at most). Measured
on an M4 Pro with 8 s of the owner's German speech (2026-10-14; all three wrote the same text):
faster-whisper large-v3-turbo int8 on 4 CPU threads 4.4 s, mlx-whisper on the Mac's GPU 0.93 s (0.40
s of it telling the language), Parakeet on 4 CPU threads 0.23 s (0.71 s with 12, so the threads are
capped).

Parakeet hears 25 European languages by itself, so there is no language pass; it takes no prompt, so
the card titles no longer steer what it writes (the Koordinator still reads with them in mind); and
it neither loops nor writes subtitle phrases on silence, so the second pass stays with Whisper. A
recording longer than a minute is heard in parts of at most 60 s, each cut at the quietest moment of
its last 20 s: Parakeet attends to the whole recording at once and its memory grows with it (1.8 GB
of process for 57 s). Without the card titles it writes some compounds and verb forms differently
(Piper's „Starte die Karte Export“ became „Startet die Karteexport“), which the Koordinator reads
through.

#### Whisper

Whisper stays as the backend `OBEYA_WHISPER_BACKEND` picks (`mlx`, `faster`, or `whisper` for this
platform's), unchanged: it transcribes with the canvas's titles as vocabulary, in the language it
hears spoken in the first 30 seconds of the ones Obeya speaks (German or English), not the
interface's: the owner may run the interface in English and speak German. With MLX hearing the
language is one more encoder pass, about 0.4 s on an M-series Mac. With faster-whisper the first
30-second window is encoded once, its encoder output tells German from English and is handed to the
decode of that window (`generate_segments` takes it, `transcribe` passes none), so a short command
costs one encoder pass (measured 2026-10-08; faster-whisper's own `multilingual` would pick from all
languages and may hear a short German command as Dutch).

mlx-whisper on Apple Silicon, faster-whisper elsewhere (CUDA when there is a GPU, falling back to
the CPU when its libraries are missing; int8 on the CPU), large-v3-turbo on both. Every backend gets
the recording decoded by ffmpeg, and its Python from `OBEYA_WHISPER_PYTHON` (a Python with the
package), else from `uv` with the backend's package (`listenKit` in `src/server/voice.ts`). On a CPU large-v3-turbo in int8 takes about 4 s for a spoken command on
GitHub's 4-core Ubuntu runner and 12 s on its 4-core Windows Server runner (float32 took twice as
long; `small` 1–2.5 s, but on Windows it heard „rechnen“ for „Rechnungen“; measured 2026-10-06), and
`OBEYA_WHISPER_MODEL` picks another Whisper model.

Checked on macOS, Ubuntu on ARM in Docker, and GitHub's Ubuntu x64 and Windows Server 2025 runners
with Whisper (2026-10-06), on macOS with Parakeet (2026-10-14): the settings check, installing from
it, and a command spoken by Piper heard word for word through `POST /voice`
(`src/server/voice.live.test.ts` with `OBEYA_LIVE_VOICE=<home>`).

#### A cloud service

Where the machine's own recognition is too slow even so, the recordings go to a cloud service
instead (see The Spracheingabe settings): Obeya then sends each one to it as it came from the
browser, with the card titles as a prompt where the service takes one, and a request it fails,
refuses or does not answer within 30 s says so under the mic („Groq hat die Aufnahme nicht erkannt
(401: Invalid API Key).“), the words staying in the field, instead of hanging.

#### The Spracheingabe settings

The configuration dialog's section "Spracheingabe" ("Voice") checks what voice in needs on this
machine (`src/server/voice-setup.ts`): the speech recognition (the package in uv's cache or the
given Python, the model in the Hugging Face cache), ffmpeg and uv, each missing piece with how to
install it here, as for demos. "Installieren" loads the recognition, which fetches it the first time
(about 710 MB for Parakeet: the model and its package; Whisper about 1.8 GB), so the first command
does not wait for the download, and then measures it: it transcribes a short German sentence Obeya
ships with (`voice/check-de.ogg`, 4.1 s, spoken by Piper as in the live voice test) and times it,
loaded and warm (twice, the faster one counting: the first recording after loading takes longer).
Its line then says „Parakeet · 0,3 s für einen kurzen Satz“, or, over one second per second of
speech, „zu langsam“ with the time, and opens the cloud offer below it; „Erneut messen“ measures
again. The measurement is kept in `voice.json` in Obeya's home for the backend it was made with. The
setup assistant's „Sprachbefehle“ shows the same line, built once (`RecognitionDetail` in
`src/ui/setup.tsx`). With Parakeet it should seldom be slow; it is the safety net.

The cloud offer („Über einen Cloud-Dienst erkennen“, a link under the line until it is needed) is
one client for the OpenAI-style `/audio/transcriptions` endpoint (`src/server/voice-cloud.ts`) with
three presets: Groq (whisper-large-v3-turbo, offered first: free with an e-mail sign-up and no card,
2,000 requests and 8 h of audio a day, then $0.04 an hour; it takes the card titles as a prompt),
Mistral (Voxtral Mini Transcribe, $0.003/min, hosted in the EU; no prompt), and any
OpenAI-compatible endpoint (OpenAI itself with gpt-4o-mini-transcribe at $0.003/min, or a server of
one's own, with its address and model). Each says that the recordings leave the machine and links to
where its key is had; "Testen" sends the check's sentence and, once the service wrote it down, uses
it from the next recording on, with the time it took. Base URL, model and key are kept per machine
in `voice.json` (readable by the owner alone), never in a repository; the page only learns that
there is a key. With a service in use nothing of the above is needed on the machine, and the line
names it, with „Wieder auf diesem Rechner erkennen“. The server lets a request run 120 s idle
instead of Bun's 10 s: a command answers once it is transcribed and read, which on a busy CPU took
longer.

### Who hears the words

Who hears it depends on what is open, and the line under the mic says so; under a card's text field
only when Obeya reads it rather than the card's agent, which the open card makes plain enough
("Agent · Aufgabe: …", "Agent · Idee: …", "Obeya · Aufgabe: …", "Obeya · Projekt: …"); the words go
exactly where it says (`agentListens` in `src/core/types.ts`, the same for the label and the route).

On a card an agent listens on (its worker at work, waiting, in a pull request or finishing after the
landing, the one a question resumes on a finished card, a prototype's worker, an idea's exploration
agent, the agent that reworks a proposal unless it is at it already) what the owner types or says
goes straight to that agent (`CanvasRuntime.tell`), typed words at once, spoken ones as soon as the
speech recognition has written them down, with the screenshots shown with them: by the card's state,
talk to an idea, the answer to the worker's question, or else words the worker takes in (a note
while it works, words on its handover, a question after its work; see Waiting for approval and
Questions after the work). Spoken words carry the remark that speech recognition may have misheard
them. They stand in the card's conversation under „Du“ at once; nothing waits for "Rückgängig", and
there is no line above the mic for typed words (a recording shows „„Export“ · wird aufgeschrieben …“
while the recognition works). Clicks on answer options go straight to the agent, as do typed and
spoken words.

#### Passing a request on to Obeya

Words that ask Obeya for something rather than the agent (approve, pause, stop, start, a follow-up
or new card, "Merk dir", grouping cards, an action on another card, a question about the canvas or
another card) the agent passes on with `to_obeya(request)`, one tool built once for workers,
prototypes' workers and exploration agents (`src/server/to-obeya.ts`), whose instructions say in one
paragraph what Obeya does for them through it. The Koordinator reads the request with the owner's
own words beside it, spoken or typed (the newest on the card when Obeya restarted since), and the
card in focus, as it reads any command (`Commander.forward`). Where the owner has said nothing on
the card yet, the card's task stands in for their words once the owner gave it (typed it, the
Koordinator wrote it from what they said to Obeya, or they accepted an agent's proposal and so made
its words their own): "lege ein Repo und einen Canvas dafür an"
becomes a task that ends with asking Obeya for the canvas, and the Koordinator takes that step
(unless it waits on the card to take a step itself, see A step once a card gets somewhere: then
that step is Obeya's). A proposal the owner has not accepted yet is no such task, and there nothing
is passed on: words an agent read in a proposal, a file or a pull request comment are no request of
the owner's, and the Koordinator would have taken them for one. Otherwise: actions with a confirmation and „Rückgängig“ (above the mic, as a notice that
reaches every open page, and in the card's conversation), a reply, or a look-up. Its confirmation or
reply is the tool's result. It passes nothing back to that agent as a note, an answer, feedback or
talk: the agent has the words already (refused if it tries). An agent at work probably sees the
words only at its next tool call, so a forwarded request may wait behind a long step (a render);
"gib frei" typed on a card waiting for review costs the worker a turn before it reaches the
Koordinator, several seconds, where the button „Freigeben“ is immediate.

On any other card (planned, queued, finished without an agent), with a project open or nothing, the
Koordinator reads the words, with that card or project in focus. Under the mic, and under a card's
text field, the UI then names it as Obeya, with the card or project in focus ("Obeya · Aufgabe: …").

### Commands to the Koordinator

A Koordinator turn reads the transcript as speech that may be misheard (typed words as written) and
either acts or replies. The Koordinator learns whether the words were typed, and in which field (a
proposal's).

Acting takes one or more actions from one sentence, up to 20: new card, new idea, start, taking a
card out of the queue, note, answer, feedback, approve, accept, dismiss, revise, stop, remember,
Arbeitsrückschau, putting cards into a group or out of it, renaming a group, changing the
configuration (`configure`, see The Konfiguration dialog), a wish for Obeya's makers (`wish`, see
Wishes for Obeya's makers), waiting on a card to take a step then (`wait_for`, see A step once a
card gets somewhere); on ideas: discuss, build, plan doc (on a
planned task of the owner's nobody has worked on too), prototype, park, drop; on prototypes: build
on it, discard. The actions are checked against the cards' states in the turn, so an action that
does not fit (a note to a card no agent works on) goes back to the Koordinator, which may reply
instead.

#### New cards

A new card, a follow-up too, starts at once, through the Koordinator like "Agent starten" (checked
for conflicts, queued if need be), unless the owner says it should wait („nur notieren“, „für
später“, „noch nicht starten“): then it stays planned. Left to its own judgement, the Koordinator
kept about one in five plainly asked-for tasks planned („Tipjar should split the bill …“), so the
`start` field of `new_card` says this outright, and left out it counts as starting.

Work on the machine that is no change to code (creating a repository, installing a tool, converting
files) is a new card too: its agent has the shell and does it with the owner's permission, in its
repository or outside it. The Koordinator's prompt says what a card's agent can do; without that, it
read „leg mir ein Repo in ~/dev/… an und eine Leinwand dafür“ against the `config` tool, found that
a canvas needs a repository that exists, and told the owner to run `git init` themselves, flagged as
something Obeya cannot do (2026-10-18). What only Obeya does after the work (the canvas on the new
repository) still needs the owner to ask again once the card is done. `commands.live.test.ts`
checks such requests with the configuration in reach, as Obeya runs.

A new card or idea (not a follow-up, which goes below the card it follows) lands in view: centred on
where the pointer was on the canvas when the owner stopped speaking (or sent the typed words), else
in the middle of the view, moved to the nearest free spot wholly in view (`freeSpotNear` with the
view); with a card or project open, in the view closing it goes back to. The page sends that place
with the command (`?place=`) and reports its view with its focus, which places what comes without
one (the app's key in another app, a request an agent passes on). The camera flies to the new card
only when it landed out of view.

Asking for an opinion or a way forward, with no agent on the open card to take it, is a new idea
with the owner's words (see the decisions under Ideas). With a card open, the Koordinator gets its
worker's whole summary, so "lege eine Folgeaufgabe für den ambient-Ton an" makes a follow-up of that
card with what the summary says about it.

#### Other commands

Start on a card queued behind others starts it now despite the likely conflict, like "Trotzdem
starten"; it sees which cards a queued one waits for, so "starte alle wartenden Aufgaben" works;
"nimm sie aus der Warteschlange" takes a queued card back to planned, like "Aus der Warteschlange
nehmen". A reply answers questions too ("Was ist seit gestern passiert?"), as far as the cards and
their history answer them.

"Merk dir: …" ("ab jetzt immer …") is remember, with the open card as its occasion, once the undo
window has passed. A rule on how agents work with the owner through Obeya becomes one of the
owner's, active at once; one about a repository („Merk dir: im Shop immer …“) goes, like a learned
one, into the card „CLAUDE.md ergänzen“ of the repositories it names (`repos`), without a proposal,
since the owner said it. The confirmation says which of the two it went to. It may name the rule it
changes, which then takes the new text, or, moved into a CLAUDE.md, goes. The Koordinator always
sees the canvas's repositories, one included.

What the owner says to the Koordinator about a proposal is, in doubt, a revision (`revise`, with
their words and the undo window); accepting in the same breath, or while it is reworked, is refused,
since the owner should see what they take. A note, an answer or feedback the Koordinator passes to a
card's agent (said in its sheet: „sag dem Export, …“) waits for undo like every command to Obeya,
and spoken words reach the agent with the remark that speech recognition may have misheard them.

#### A step once a card gets somewhere

What can only follow once a card gets somewhere (a canvas for the repository a new task creates,
starting „Login“ once „Export“ has landed, passing words on once a card waits for the owner) the
Koordinator waits for, as a worker snoozes on another card: `wait_for` in the same act, `on` a card
by its tag or on a new card of the same act by its title, until it is done (the default) or waits
for the owner (`awaited` in `src/core/types.ts`), with the step written out so it stands on its own
(`then`, its card tags written as titles, since another session tags cards anew). A card already
there is refused (the step is due now), as is a step without text. The agent of the card waited on
may read the step in its task and ask Obeya for it (`to_obeya`); without words of the owner's on
the card nothing is passed on (the task does not stand in for them here), and the answer tells it that Obeya takes that step itself. The
wait stands on the exchange whose reply announced it (`talk.waits`), so it outlives a restart; the
Koordinator sees its waits with every command and drops one on the owner's word (`stop_waiting`).

Every change of the board, the 15 s timer and every start look for waits whose card got there or no
longer gets there by itself (stopped, archived, removed, dropped), beside the snoozed cards
(`Commander.due`, called from `wakeDue`). A new exchange without words of the owner's takes such a
wait up: the Koordinator hears what it said it would do, what became of the card (its state and
its worker's summary; a card that got done counts as done, also for a wait until it waits for the
owner), and takes the step, or replies what became of the card instead. The wait goes only once
that is decided, so a restart meanwhile takes it up again, and dropping it meanwhile takes back what
was decided. Several steps on one card each stand.
Its reply reaches the owner as a notice, with „Rückgängig“ where it has actions, as for words the
usage limit held (which also holds this turn, the same way); its actions run after the undo window.
The exchange stands where the waiting one was: in the sheet, or on the card that was open then.

In the sheet, the reply that announced the step carries a line under it while the wait lasts, „◷
Wartet, bis „Repository anlegen“ erledigt ist“ (or „… auf dich wartet“), with „Nicht mehr warten“,
which drops the step at once (the Koordinator hears that with the next command). The exchange that
took it up starts with a line in place of the owner's words, „„Repository anlegen“ ist erledigt“
(or what else became of the card), and Obeya's reply under it.

#### Confirmation and undo

One confirmation covers all actions; they run in order a few seconds after it reached the owner, so
"Rückgängig" takes back anything, even an approval. A page that opens in that window (a reload)
shows the confirmation with „Rückgängig“ again for the rest of it. Only talking to an idea goes on
at once: it changes nothing.

What the owner said to the Koordinator goes into the conversation of the card that was open, or with
none open into the sheet, at once (spoken words once the recognition has written them down), with
„Obeya liest …“ under it until its confirmation follows (on a card folded away), and
"Zurückgenommen." when taken back. A reply that answers the words without acting on them (a question
of the owner's, why Obeya could not read them) is no confirmation: on the card it stands in the
conversation (`CardEvent.reply`), also for words the card's agent passed on (a proposal's included).
Until 2026-10-21 it folded away like a confirmation, and the owner's question on a proposal stood
there without an answer. Words the Koordinator was reading when Obeya stopped get a reply
that says so (`Board.interruptTalk`).

Words the usage limit keeps the Koordinator from reading wait for it, as a worker does: the reply
says when they are read („Das Nutzungslimit ist erreicht. Ich lese das um 19:20 von selbst.“), in the
sheet as „Nutzungslimit · liest das um 19:20 von selbst“ under them, and ten seconds after the reset
the Koordinator reads them by itself (the same retries as a worker's when the time is unknown or
passes), knowing when they were said; the reply reaches the owner as a notice, with „Rückgängig“
where it has actions. Words said meanwhile try the held ones first, in order, and wait behind them
while the limit holds. Held words survive a restart (`talk.held`).

`commands.live.test.ts` checks against the real model (`OBEYA_LIVE=1`) that requests passed on from
each state an agent is on become Obeya's actions, that commands on cards without an agent are read
right, that a new task starts unless the owner says it should wait, and that with no card open a
question for an opinion becomes an idea and one of fact stays a reply.

#### Commands on their way

After letting go of Space the microphone is free at once, and the owner may navigate or speak again:
the target is fixed when the key goes down. Each recording has its own small line above the
microphone („„Export“ · wird verstanden …“, for a card's agent „… · wird aufgeschrieben …“), which
becomes its confirmation with „Rückgängig“, or disappears when the words went to the open card's
agent. A command typed to the Koordinator gets no such line while it is read (its conversation shows
the words and „Obeya liest …“), only its confirmation with „Rückgängig“; a request typed in the
configuration dialog, whose conversation is out of view, keeps the line. Several stack, oldest
first, and the server reads them one after the other. A confirmation that arrives while another card
is open starts with the card it is about; so does one for a request an agent passed on, and an
answer looked up. A reply that stands in Obeya's sheet while the sheet is open (on the phone, its
conversation) gets no line: the owner reads it there already (2026-10-17). Only one with
„Rückgängig“ keeps it, since the sheet offers no undo. The server marks the exchange of the sheet a
reply or a notice answers (`talk`); the page checks that its sheet shows that exchange, so a
spoken command with a card open, a reply for another canvas and a failure keep their line.

### Voice latency

Pressing Space (or focusing a field the Koordinator reads) gets everything ready while the owner
speaks: the recognition's sidecar starts and loads its model (not with a cloud service), and the
Koordinator's session starts up if it is not running (one that fails is replaced once, for the same
command). On a card with an agent the words reach it as soon as the recognition has written them
down (typed ones at once). Elsewhere the written confirmation comes back as soon as the Koordinator
has decided, and the undo window starts with it. Measured on a small scratch canvas, letting go to
the written confirmation takes about 2.8 s, the first command after a start included. Most of it is
the Koordinator's model turn (about 2 s); Sonnet or Haiku, or a shorter system prompt, saved nothing
reliable in measurements, so it stays as it is.

### No voice out

Obeya does not speak. Confirmations and answers are written: in the card's conversation, in the
Koordinator's sheet, and in the line above the mic. Demo narration is a pipeline of its own (see
Demos).

### Push-to-talk anywhere

In the app, a key held while another app is in front records a command (`app/src/keys.rs`, `mic.rs`,
`ptt.rs`). Space cannot be that key (it would be taken from every other app), so by default it is
the right Option key on a Mac and the right Ctrl key elsewhere (right Alt is AltGr on many European
layouts); the configuration dialog takes another by pressing it ("Sprachtaste überall"): a key
nobody types with held alone (a modifier, an F key, Pause …), or modifiers and a key such as
Ctrl+Shift+Space (`src/core/push-key.ts`, saved as `pushKey` in `settings.json`). A key alone is
only listened to, so it still reaches the app in front: a tap of it does nothing, only holding it
past 0.3 s records, and another key going down while it is held makes it a shortcut, not a recording
(modifiers with it do not count).

On a Mac a listen-only event tap hears it, which needs "Input Monitoring": the system asks once, and
until it is allowed the settings and the setup assistant (a line under voice while the app runs) say
so and open the system settings' page; on Windows a low-level keyboard hook, on X11 XInput2's raw
key events. A combination goes through Tauri's global-shortcut plugin, which takes it for itself (no
permission on a Mac). Wayland gives an app no keys of others: there the desktop's Global Shortcuts
portal binds the key as a shortcut the owner confirms in the desktop's dialog (the settings then
show what it is bound to), and without the portal there is only the window's Space.

The shell records itself (a webview in the background cannot be relied on to): the default
microphone opens when the key goes down, so the first words are not lost, and the recording goes as
a WAV to the canvas's `/voice` with where the owner was last: every page tells the server what it
has in view (`focus` over its WebSocket, on every change and when it gets the focus back), and `GET
/api/focus` gives the newest of the open pages, else the first canvas with nothing in focus.

A floating panel at the bottom of the screen the pointer is on (`/panel`, served by the server, so
its strings are the UI's) never takes the keyboard: it shows that Obeya listens and to whom (with
the level, and „Das Mikrofon liefert keinen Ton.“), then the command being read, then what the
recognition heard (`text` in `/voice`'s answer) with the confirmation and „Rückgängig“ for the undo
window, or, said to the open card's agent, „An den Agenten gegangen.“; it fits its window to its
lines through the app's one command (`panel_fit`, allowed to that page in
`app/capabilities/panel.json`) and hides it when none are left.

Every two seconds the shell tells the server what it hears (`POST /api/push-to-talk/shell`: on,
permission, bind, none, unsupported, error) and gets the key that applies, so a key chosen in the
settings applies at once. `bun run app` (`scripts/app.ts`) builds the shell and starts it from the
checkout: it opens a window on the Obeya of the home, or starts `bun src/server/main.ts` (which
updates itself as `bun start` does), so the checkout has the key too. `bun scripts/check-ptt.ts`
checks it with the shell's check mode (the key from stdin, a WAV as the microphone; or, under X11,
the real keyboard pressed by xdotool): the report, a tap, a shortcut, and a command that reaches
Obeya and comes back to the panel. A restart is not held off while the shell records or reads a
command (the page holds it for its own); a command cut off by one shows „Das hat nicht geklappt“ in
the panel.

### Decisions

- **The focus decides between dictating and sending** (2026-10-12): always dictating into the field
  would have made every spoken message two steps. Until then spoken words always went out at once,
  without what was typed in the field; and the drafts lived in the page alone, so a canvas switch
  lost them; the picks lived in the card's view, and a restart lost them while the words came back.
- **Voice in hears with Parakeet everywhere, the Mac included** (2026-10-14): on a CPU it is about 19× faster than Whisper, and 4× faster than Whisper on the
  Mac's GPU, and the owner found its recognition good enough in daily use elsewhere. Whisper on a
  CPU had been the reason a small fanless Windows box took about a minute for a short sentence: the
  language pass, the transcription and often a second pass without the card titles. Whisper stays as
  an optional backend. A smaller Whisper was dropped for Parakeet (it misheard German words),
  Moonshine (English only) and the browser's own recognition (not in the app's webview on Windows,
  and it sends the audio to Google without saying so) too. Where the machine is too slow even for
  Parakeet, a cloud service: Groq first (free), Mistral (EU), or any OpenAI-compatible endpoint.
- **Whisper hears the spoken language, not the interface's** (2026-10-08): Whisper told to expect
  English then translated German into broken English, unsure of its words, so long dictations (more
  windows that can fail) ended in „not understood“ (6–8 Oct 2026). With faster-whisper telling the
  language had been one more encoder pass, on a CPU as long as a short command's whole transcription
  (4.2 s on the owner's Mac's CPU).
- **Voice and demos fetch their Python sidecars through uv on first use**, in the app as in the
  checkout (2026-10-06): bundling Python with the speech recognition would add hundreds of MB per
  platform for everyone, differ by GPU (MLX, CUDA, CPU) and need every native library signed and
  notarised, and the models, the large part, are downloaded on first use anyway.
- **Commands to Obeya are read by the Koordinator, not matched by rules, and always wait a few
  seconds for undo**; no command takes effect without a confirmation the owner could take back.
  Talking to an idea is the exception: it only adds to a conversation. So is whatever the owner says
  to the agent of the open card (2026-10-05 for notes and answers, 2026-10-08 for feedback too): it
  only adds to what the agent knows, the card's conversation shows it, and pressing Send or letting
  go of Space is the deliberate act. Feedback no longer takes the approval away, so it needs no undo
  either (see Waiting for approval).
- **A confirmed command outlives the server that confirmed it** (2026-10-12): it waits for undo in
  the database (`commands`), and a restart waits for it. A stop or "Jetzt neu starten" in the window
  leaves it to the next start, which runs it once the window is over, at once when it is over
  already: the owner has the confirmation and expects the card. A command that has begun to run is
  out of the database, so a restart in the middle runs nothing twice.
- **On a card with an agent, what the owner types or says goes straight to that agent**, which
  passes on to the Koordinator what asks Obeya for something (`to_obeya`, 2026-10-08). Typed and
  spoken words still take one way: the label under the mic names who listens, and both follow it.
  Before (from 2026-10-05), every word went through the Koordinator first, so that "gib frei" or
  "Merk dir" worked typed as well as spoken; but the owner waited for a Koordinator turn (about 2 s,
  longer for long text) before every word reached the agent or showed in the conversation. That
  reason holds either way now, since both paths are the same and the agent passes Obeya's commands
  on. The cost: "gib frei" typed to a worker wakes its session first, several seconds and tokens
  (the button „Freigeben“ stays the quick way), and a request can wait behind a long step of a
  working agent. Rejected: the Koordinator reading along in the background (two readers of the same
  words could both act, and every message would still cost a Koordinator turn), and keeping the
  Koordinator in front while showing the words at once (the agent would still get them late).
  Rejected in 2026-10-05 and still: two keys (the owner would choose who listens before every
  sentence), and dictating into the field for the owner to send (a step more). Until 2026-10-08
  every word to an agent also waited for the Koordinator's turn in the latency measured above; until
  2026-10-09 the line under a card's text field always named who listens.
- **The owner's words to the Koordinator show at once** (2026-10-12). Until then the words appeared
  only together with the confirmation, so typed words waited seconds as „„…“ · wird verstanden …“
  above the mic, which looked like speech recognition.
- **A new card lands where the owner looks** (2026-10-14). Until then every such card went into a
  column right of everything and the camera flew there.
- **Obeya does not speak** (2026-10-08): confirmations and answers are written. Spoken replies
  distracted the owner, who reads the line above the mic and the card's conversation anyway. Until
  then a voice on the server spoke the confirmations, the short form of looked-up answers and a
  summary of an idea's reply (a JXA sidecar with the macOS synthesizer, `say` as fallback, or
  Piper).
