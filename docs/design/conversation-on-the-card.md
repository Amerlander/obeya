## Conversation on the card

A chapter of the [design doc](../design.md), whose header says how it is written.

### The conversation

Every card shows its exchanges as a conversation („Gespräch“), the way an idea does (`talkTurns` in
`src/ui/talk.ts`). Messages are:

- what the owner says (notes, answers, feedback, spoken or typed, with screenshots, standing once as
  the agent got them);
- the agent's questions (a worker's, an idea's, a proposal's) with their options and the pick
  (marked on the question only: the owner's message under it holds just their own words, and a pick
  alone is no message of its own; an idea's and a proposal's answer names its questions in its
  text, `answerText`, which the conversation reads back, `readAnswer`);
- its replies;
- its handovers (the one a demo came with carries its report's question, muted once answered; a
  later handover that keeps the demo leaves it there). A later handover that follows the worker's
  reply in the same turn stands under that reply, after a dashed line, as „Übergabe“ with its time
  and what changed, not as a message of its own; its steps and closing words fold with the reply's;
- what the Koordinator looked up for the owner.

Small lines between them are the state changes (started, pull request opened, approved, landed,
stopped, errors, the usage limit that stopped the agent). Everything else folds away under the agent's next message as „Verlauf“ (a worker's
closing words after a reply under that message, as its last step): tool calls, thoughts,
status lines, the Koordinator's confirmations, Obeya's notes (restarts, sessions, what happens on
the pull request).

A note the worker answered without `reply` (a card from before it, a worker that forgot) is answered
by the first words the worker said after it, unless a reply follows them before the owner says more:
then they were a step on the way to it. Once no agent works on the card and no question is open, no
message is coming for the steps after the last one: they go where they happened, before the lines
that came later. The agent's last words among them stand as its message (the closing words after a
landing, say), a turn it ended without words as its steps, and what only Obeya or the Koordinator
noted there goes.

The agent's words are kept whole up to 12 000 characters, as an idea agent's replies are (a worker's
`reply` is cut at 2000). While the worker works, also while it takes in the owner's words on its
handover, the conversation ends with it at work and its latest step, cut to its first line and 140
characters, whole while the mouse is over it; the question the card waits on (its own, or the one in
its demo report) stands at the end with its options, and the card's one field under it. A worker
that asks while its background work runs (a test suite, a review it started) is still in its turn:
its question stands with its options, and the bubble at work below it. A question answered or asked
anew has no orange edge either: only its label „Agent · Frage“ stays orange, a turn where the owner
had something to do. Until 2026-10-17 an answered question kept its
orange edge, which also marks the messages new to the owner, so it looked as if it still waited. A card that was an idea
continues the idea's conversation in the same list.

How a question ended is one rule for every kind of card too, whoever asked it (a worker, an idea's
agent, a proposal's reviser), read from what came after it (`ended` in `src/ui/talk.ts`). Options
the owner picked for it stand ticked on it (a worker's question answered in the owner's own words
ticks the options they name). Asked again later in the same words, it reads „Weiter unten erneut
gefragt. ↓“, a link to the later asking, its options greyed but there. With the owner's words after
it that picked nothing for it (a note, words on an idea or a proposal, an answer in their own words)
and the agent's reply there without asking it again, it reads „Durch deine Nachricht erledigt.“
without its options; while the agent still works on that reply it shows nothing yet, since it may
still ask again. Without a word to it before the card went on (an idea built, a proposal taken on,
a card parked or archived), it reads „Offen geblieben.“, its options greyed. An answer that picks for
one of two questions thus ticks the one and marks the other by the same rule. A question the agent
rephrases counts as settled. Until 2026-10-21 only a worker's question a note took back showed how
it ended („Durch deinen Hinweis erledigt“): an idea's or a proposal's question the owner's words
passed over stood with all its options, like one never answered, and one asked again stood twice,
the earlier asking unmarked.

Which questions are open is one rule for every kind of card (`openQuestions` in `src/core/types.ts`):
an open idea's while its agent is not at work on a reply, a proposal's while it is not reworked, a
worker's while the card waits for its answer, the one in a demo report while it is not answered. A
reply being worked on may settle them, so meanwhile nothing is answered; a parked or dropped idea
waits for nobody. Whatever shows a question as open reads that rule: the conversation takes each out
of where it was last asked and puts it at its end under „Frage an dich“ („Fragen an dich“ for
several) with its options, the field under it reads „Eigene Antwort oder Anmerkung – optional“ and
„Antworten“ only while they stand there, and the canvas card's line, the phone's count and the
Koordinator's view of the cards name the same questions. Until 2026-10-21 each kind of card decided
this on its own, in up to six places: the field under an idea or a proposal being reworked offered
to answer questions it did not show, a parked idea's questions stood to be answered at its end while
the phone counted none, a proposal's face named no question, the Koordinator saw an idea's questions
only where its agent had picked an option, and the heading read „Frage an dich“, „Offene Fragen“,
„Frage des Agenten“ or „Offene Frage“ depending on the card.

The messages new to the owner keep an orange edge until the conversation goes (the card closes, on
the phone its panel), as the answers that waited do in Obeya's sheet: those after the last event
they had in view and after their own last words (`unseenTurns` in `src/ui/talk.ts`, the messages the
phone's button counts). A message that comes while the conversation is in view (the page not hidden)
is seen as it comes and gets no edge; one that came while the page was hidden keeps it. What it holds
counts as seen while it is in view, in this browser (`useSeen` in `src/ui/seen.ts`, localStorage);
the conversation itself keeps that, in the code every card kind shares, on the desktop as on the
phone. Until 2026-10-17 only the phone kept what was seen, for its button's count, and no message
was marked; that day the marks came, at first also on messages that came while the conversation was
open, which the owner had watched arrive.

A conversation that stands at its end stays there as it grows: the agent's next step, a message, a
question, a frame loading. Scrolled up to read further back, the owner stays where they are, however
much comes meanwhile; only their own words (a note, an answer, a comment, an action like a pause)
take it to its end (`useStickToEnd` in `src/ui/stickToEnd.ts`, which Obeya's sheet shares). Until
2026-10-20 every step of a working agent took a card's conversation back to its end, so the owner
could not read up while it worked.

### Reading order

A conversation shows things in the order the agent saw them, on every card the same way. The owner's
words stand where the agent read them, not where they were sent: Obeya holds them while the agent is
in a turn and marks the moment it takes them in on their line of the log (`CardEvent.readAfter`: the
last line read before them; `talkTurns` sorts them in after it). The agent's steps from before then
close above them, as its last words among them or, without words, as a block of its steps („Agent ·
Verlauf“); its steps after them and its reply stand below.

Until it has read them, they stand below its work, muted and dashed, marked „Noch nicht gelesen ·
beim nächsten Schritt“ on a task and „… · nach der laufenden Antwort“ on an idea, a proposal or a
Question card, several in the order sent (`CardEvent.unread`). Each has a bin: taking it back takes
it out of the log, and no agent hears it; its text and screenshots go back into the card's field
when that is empty, else they are gone, since newer words stand there (`giveBack` in
`src/ui/draft.ts`, shared with the demo comments Obeya holds back). It takes effect at once, without
undo: the words are back in the field, or were meant to go.

That a line was read reaches an open card as the line again, over the canvas's WebSocket, like a new
line. A page whose connection was lost meanwhile (a phone locked, a network switched) never got it:
each open card's log (`useEvents`) loads anew once the connection is back, else the words would stay
„Noch nicht gelesen“ below the reply that answered them.

When an agent reads them:

- A worker: with the result of its next tool step, through the hook that passes it preferences and
  decisions (`AgentSpec.contextUpdate`, `unheard` on the card), screenshots as their files, which it
  opens itself, since a tool result carries no images. A turn that ends before another step starts
  the next with them. A session that ends first (paused, a restart, a machine cut off) gets them
  with the message it goes on with; after a stop they wait for the next start.
- An idea's agent, a proposal's reviser, a Question card's agent: when their next turn starts, after
  the reply they waited for.

Words said while the agent is between turns start its next one and are read at once.

### Replying to a message

The owner can reply to one message of a conversation, as in chat apps, on a card and in Obeya's
sheet alike: a button in the corner of each message (shown while the pointer is on it; `Msg` and
`Quote` in `src/ui/message.tsx`) puts the message as a quote above the field, with × (or Escape,
before it closes the card or the sidebar) to take it out; what the owner then types or says with
push-to-talk goes out with it. Until the owner has replied once, the latest message they did not
write shows its button without the pointer, so they find it. The quote is part of the field's draft
(`src/ui/reply.ts`), so it outlives closing the card and a page load like the words beside it. Their
message shows the quote above their words, in the colour of who said it, its first lines only; a
click on it scrolls to the message and lights it up.

On a card the reply names the message's event id (`replyTo`), and the agent reads `[In reply to your
message: „…“]` above the words (`replyNote` in `src/server/board.ts`): the first 160 characters or
so of what it has whole in its session anyway (its own words, the owner's words to it), else the
whole message (Obeya's words in the card's conversation, which the worker never got; the
Koordinator, which reads the field where no agent listens, gets it whole too). A reply works on
every card with a conversation and a field, the same way. Only messages can be replied to, not
steps or state lines; a `replyTo` that is not a message of the card is dropped and the words go
alone.

In the sheet a message is one part of an exchange (`TalkRef`: what the owner said, the Koordinator's
reply, the answer it looked up), kept with the owner's words (`Talk.replyTo`, column `reply_to`).
The Koordinator reads the message whole (`talkReplyNote` in `src/server/commands.ts`), a looked-up
answer by its tag (`A12`), so a reply to an answer follows up on it. Only the sheet's own exchanges
can be replied to there; anything else is dropped.

### The task as first message

A task's conversation starts with the task: once the agent starts, the card's text and screenshots
stand as its first message, above the line that the agent started, the way an idea's starting point
does (`Seed` in `src/ui/detail.tsx`), so the conversation reads from the start: what was asked, what
the agent did, what the owner added. Its label says where the text comes from: „Du“ on the owner's
own card (typed or spoken), „Idee“ for a prototype, „Vorschlag“ for an
agent's proposal the owner accepted (the card keeps that it was one, `proposed`), „Obeya“ for one
from the Arbeitsrückschau. A long text shows its first eight lines or so, with „mehr“ for the rest
(an idea's starting point too), and „Voraussichtlich betroffen“ folds under it. A card that was an
idea has no such message: its brief stands on the left, and its conversation goes on from the
idea's. Nor has a workstream: its text in the plan doc stands on the left under „Plan-Doc“, folded
the same way, in every state (see Plan docs).

### Card layout

Every card with a conversation is laid out the same way (`Split` and `Talk` in `src/ui/detail.tsx`):
idea, proposal, and a task an agent worked on. What the card is about stands on the left (an idea's
brief, a proposal's text, a task's demo with its chapters and sharing, the files its work made or changed, its pull request, what
landed, a decided idea's brief), the conversation on the right with the questions it waits on at its
end and the owner's one field with one Send under it, and the decisions (build, accept, approve,
stop, archive) in a row below both. A task that has nothing for the left yet (the agent at work, a
question before the first demo) is its conversation alone, the card only as wide as it (`talkAlone`
in `src/ui/talk.ts`), and widens to the split once there is a result. A task waiting in the queue
for its first start (Obeya checking it, behind other cards, waiting for a workspace) is a split as
well, as wide as a proposal's: its text in full on the left under what it waits for, its conversation on the
right (`waitsFirstStart`). What the owner types into its field waits there unread, and goes to the
worker with the task once it starts (`unheard`, as for words in the middle of a turn); spoken words
go to the Koordinator as on any card without an agent, which passes a note on the same way.

A task's branch (and its plan doc) stands under its title, with the size of its change beside it
(„+120 −30 in 5 Dateien“, `Branch` in `src/ui/diff.tsx`): before landing, the branch in its
workspace against where it left the branch it is built on (`base` in `workspaces.ts`, below),
committed or not, new files included; once landed, what the
landing put on the default branch (`Shipped.base..commit`: the default branch before a landing on
main, a merge commit's first parent; a card whose merge commit GitHub did not name has none; an archived card keeps its size and diff). A click shows the whole diff over the page, file by file, with
large files folded; while the card has a workspace, „Pfad kopieren“ copies its directory
(`host:/dir` on another machine). The owner rarely reads the code, so it stays a quiet line, read
when the card opens and again as the work moves on (`GET …/cards/:id/diff`, `?full` for the diff
itself, cut off past 2 MB).

#### The files beside the demo

What a card's work made or changed is its result, and the left column shows it so (`ResultFiles` in
`src/ui/files.tsx`, for folder and git cards alike): a row of tabs above the view, the demo the
first, then the files its worker named as the result at its handover (`ready_for_review`'s `files`,
each with its path and a one-line caption, marked ★, the caption on hover), then the other files it
made or changed that can be shown, documents before text and code (`shownFiles` in
`src/core/files.ts`). Six get a tab beside the named ones; the rest are under „N weitere ▾“. A
deleted file, a directory, a file that is neither a document nor text (a `__pycache__/*.pyc`) and,
in a folder, one that is no longer where the card left it (deleted or moved since, `gone`) get none
and stay in the change list. Each file shows by its kind:

- Markdown formatted (`Doc`), with the images it shows from beside it (`![…](bild.png)`)
- a PDF in the browser's own viewer
- an image as it is
- an HTML page in the sandboxed frame of an HTML artifact, as high as it reports
- text and code as text (its first 400 KB)
- anything else (a spreadsheet, a Word file) as a tile with „Auf dem Rechner öffnen“

A new file shows as it is; a changed one with lines to compare first shows its changes, with
„Formatiert“ (or „Ganze Datei“) beside „Änderungen“ to see it whole. Above each view stand „Auf dem
Rechner öffnen“, „Im Ordner zeigen“ and ↓: the first two open the file with the system's app, or
show it selected in its folder, on the machine Obeya runs on (`openWithSystem`, as for an answer's
files; a file that is no document is shown in its folder instead, as opening it would run it). Only
a request from that machine may do so (`POST …/cards/:id/open`); from another device, a phone over
Tailscale say, it would open the file on the Mac, so there the browser downloads it instead, and
„Im Ordner zeigen“ says it works only at that machine. The column keeps the height of its tallest
tab so far, so the card does not shrink and move under the tabs; a PDF's viewer is as high as the
column shows, so that scrolled to it, its own scrollbar is the only one. A video demo left under
another tab stops playing.

A card whose worker named files, or a folder's card handed over without a demo whose change has
files to show, has a result for the left column even without a demo (`Item.files`, an empty list
for the latter), so it is laid out as a split. The server decides that at the handover, as it reads
the change then, so the card is laid out at once and not only once the page has read its change
(a folder card whose change shows nothing, only deleted files say, stays its conversation alone,
with the change list above it). Folder cards handed over before Obeya kept this (on the canvas or
archived, waiting, done) get their list at Obeya's start, while files of their change are still
there to show (`listFiles`). A git card has no such case: its handovers bring a demo.

Obeya serves a file of the card's work (`GET …/cards/:id/files/<path>`, `Workers.file`) only when
it is one the card made or changed (`changedFiles`: its change list in a folder; on a branch git's
list of names separated by NUL, not the diff's headers, where a file named `x b/notes.md` reads as
`notes.md`), or an image a Markdown file of those shows from beside it: nothing else of the folder,
the workspace or the disk comes out this way, nor through a link the card made, which counts as no
file. It reads the file from the card's workspace (or the
folder) while it has one, else from the commit it landed with or its branch in the repository; to
open a landed card's file, the checkout's copy. Files are served as an HTML artifact's are (the
same CSP, sandbox, key in the address, height report for a page; see The demo on the card), but for
a PDF: the browser shows none in a sandboxed frame or under a CSP sandbox, so it comes as
`application/pdf` with `nosniff`, into a frame without `sandbox`, with a policy that allows it
nothing beyond (`default-src 'none'`, `form-action 'none'`, `Connection-Allowlist`), which leaves
Chrome's viewer working. The viewer runs a PDF's scripts; tried in Chrome on 2026-10-21, a PDF that
submits a form, opens a link or calls `getURL` or `launchURL` as it opens sent nothing, even to
Obeya itself. A worker names files only of its change: another path is refused and it is asked
again, as are more than twelve. Without `files` at a later handover, those named before stand; an
empty list takes them back. A view open while a new handover arrives, or while the work changes
the file, reads it afresh.

#### Trying the app by hand

While the app runs in the card's workspace, „App öffnen ↗“ at the end of that line opens it in a new
tab, for the owner to try the work by hand. Rarely wanted, so it is a link among the line's others,
nothing more. Obeya neither starts the app nor finds its address: the worker gives it with
`app_running(url)` once the app runs (its brief asks for that beside the recipe; an empty url when
it stops it), and the card holds it (`app` on the card's row, `Item.app`) until the worker clears
it, Obeya parks the card, or the workspace goes. The link shows only while the app answers there:
the open card asks every ten seconds (`GET …/cards/:id/app`, a `HEAD` request with a 1.5 s limit;
any HTTP answer counts, an error page too), so an app the worker stopped without saying so, or one
that died with a restart, shows none. The link goes through Obeya (`GET …/cards/:id/app/open`,
redirecting to the address): opening it keeps the app running for at least 30 minutes after
(`TRY_GRACE`), so parking does not stop it under the owner; an app no longer recorded gets a line
saying so instead.

A workspace on another machine (see Hosts) reports an address that only that machine reaches. There
the probe and the link go through a forward of that address's port to a free port here (`ssh -L`
on a connection of its own, `SshHost.forward`), and the link redirects to `localhost` at that port,
with the address's path. Obeya makes the forward when the card first asks whether the app answers,
and ends it once the card no longer offers the app (the worker cleared or changed it, Obeya parked
the card, its workspace went) or Obeya stops; its command there waits for stdin, so it ends with
Obeya even when Obeya dies. A forward gone with a dropped connection is made again at the next
probe, on the same port while that is free, so an open tab goes on working. Only that one port is
forwarded: a page that talks to an API on another port of that machine finds nothing here (the
worker's brief says so). The port here is one the system picks, never the address's own number,
which a stack in a clone here may need when it starts again.

### Screenshots

What the owner writes on a card (a note, feedback, an answer, talk to an idea, words on a proposal) may carry
screenshots: pasted (⌘V), dropped or picked in the text field, scaled down in the browser to at most
2000 px, and uploaded at once. They show as thumbnails in the field and in the card's log or
conversation, and reach the agent as images in the message, with their file paths. A click on a
thumbnail grows the screenshot out of it to as large as the window allows, over the greyed page,
like the demo video's zoom (`Lightbox` in `src/ui/shots.tsx`); Esc or a click puts it back into its
thumbnail, and the card stays open.

Picking a file is the way a newcomer finds first (the field's image button), pasting the quicker
one. So once the first screenshot picked with the file dialog has arrived, the field says under its
thumbnails that screenshots paste from the clipboard too (⌘V on a Mac, Ctrl+V elsewhere), with the
system's keys that take one onto the clipboard where it has them (⌃⇧⌘4 on a Mac, Win+Shift+S on
Windows), and „Verstanden“ (`src/ui/pasteHint.ts`). It stays, also after sending, closing the card
or a reload, until the owner confirms it; while its field is gone, the field that appeared last
shows it. It never shows again after that, nor once the owner has pasted a screenshot anywhere, and
never on a device without a mouse or trackpad (a phone), which has no keys to paste with.

A card's task takes screenshots the same way: in its description field, while the card is planned.
They show under the task, and its worker gets them with the task when it starts (an idea's
exploration agent, when a planned card becomes an idea; building an idea adds the screenshots the
owner showed in its discussion).

A command typed in the Koordinator's sheet may carry screenshots too: the Koordinator sees them, and
they go with every action of the command that creates or concerns a card (new card or idea, start,
note, answer, feedback, talk to an idea, words a proposal is reworked by); said with a start, they join the card's task. A spoken
command carries screenshots the same way: those in the field of the open card, or of Obeya's sidebar
when no card is open, go with the next recording (see Voice in: one draft per field). Dropped on the
microphone or pasted (⌘V) anywhere outside a text field, they land in that field. Only where no
field is spoken to (the canvas with no card open and the sidebar closed) the microphone keeps
screenshots of its own: picked with the small button to its right, dropped on it or pasted, they
show beside it. They are for Obeya, as the sidebar's field is: opening the sidebar moves them into
its field, and closing it moves the screenshots in that field back beside the microphone (its words
stay in it); an open card leaves them beside the microphone, out of sight until it closes. A recording in which nothing was heard or understood leaves them where they were,
and so does one Obeya refused. When the connection breaks before the answer (the browser cuts it
off as the page goes to another canvas or reloads, or the network drops), the page cannot tell
whether Obeya has the command: it names each recording (`?sent=<id>`), asks Obeya whether that one
arrived (`GET …/voice/arrived/<id>`, asked again until Obeya answers), and gives the field its words
and screenshots back only when it has not. Until Obeya answers, the command's line above the
microphone still shows it being read; when Obeya has it, the line says so („Obeya hat es; nur die
Antwort kam nicht an.“) instead of „Das hat nicht geklappt“. A page that goes away never hears, and
gives nothing back.

### Marking screenshots

A screenshot still in a field (any `ShotStrip`: a card's field, the sidebar's, the microphone's, a
planned card's task) opens ready to be marked, to point the agent at a spot: a drag on it frames a
region in signal red with a thin white edge (so it reads on light and dark screenshots), a click (a
drag shorter than 5 px) sets a red pin. Frames and pins are numbered together, 1, 2, 3 … in the
order set, for the text to refer to: a pin shows its white number in a red circle, a frame in a red
square on its top left corner, above it like a tab (inside, where the image ends above the frame),
so a small frame does not read as a pin. Square and frame are one shape: the white edge runs around
both, and the red of the square runs into the frame's line. No tool to pick: the gesture decides.
Line and pin take the same share of the image at any size (`src/ui/marks.ts`).

A bar under the image has Undo (also ⌘Z / Ctrl+Z), which takes back the last mark, again and again
down to the unmarked screenshot (an undone mark's number goes to the next one; there is no "clear
all"), and Done; a hint in it says how to mark until the owner has marked once. A click on the image
marks instead of closing; Esc, Done or a click beside the image closes it.

On closing, the browser draws the marks into the original (through the same size limits as a pasted
screenshot), uploads the result, and that takes the original's place in the field: the agent gets
only the marked image, and the field waits to send until it is uploaded. The marks stay apart as
shapes in image pixels beside the original (`Markup` in `src/ui/draft.ts`, by the id of the marked
image, kept per tab and canvas like the drafts, the newest 100), so reopened, even after a reload,
the original shows with its marks and Undo goes on working; with every mark undone the field holds
the original again. A sent screenshot stays as it was sent: in the log its enlarged view only shows
it. The server and the agents see nothing of this; a marked screenshot is one more uploaded image.

### Decisions

- **A card shows a conversation instead of its log** (2026-10-05): the owner reads what was said and
  decided, not every tool call, which stays a click away under each message. Rejected: the
  conversation beside the log (every message twice). A worker answers notes with a tool of its own
  (`reply`); its last words before the owner's next message would often be "Ich committe jetzt", and
  a small model summing up each turn costs on every turn for nothing `reply` does not do. A note
  withdraws an open question rather than counting as its answer, which would put a remark into the
  decision log as a decision.
- **The last demo stays in view while the worker works again** (2026-10-08). Before, feedback or a
  note hid it until the next handover.
- **A demo report's question stays on its handover** (2026-10-09). Until then the question moved to
  the newest handover and stood there orange, as if open.
- **Agent words are kept long** (2026-10-09): until then a worker's were cut at 600 characters, so a
  last message ended in „…“. Until then too only the card's state said that the worker was at work.
- **The conversation shows things in the order the agent saw them** (2026-10-14). Before, a note
  went straight into the worker's session, which the CLI folded in at its next step, but Obeya
  learned only at the turn's end which messages a turn had taken (and the SDK cannot take one back
  but by a control request); the conversation showed every step of the turn in one bubble at its
  end, below the note, so the steps from before it stood after it.
- **Replies to a single message, as in chat apps** (2026-10-09), in Obeya's sheet too (2026-10-15):
  until then only a card's conversation had them. Since then the quote is part of the field's draft,
  and survives a reload; before, it lived in the page alone, one for all cards.
- **The task is the conversation's first message** (2026-10-08). Before, the task stood on the left
  as a section of its own („Auftrag“), open until there was a demo, and tasks were the only cards
  whose starting point was not in their conversation.
- **One layout for every card with a conversation** (2026-10-07). Before, a task stacked demo,
  buttons, feedback field and conversation in one column, and a demo with a question had a field and
  a Send of its own inside the question, with „Freigeben“ between it and the feedback field.
- **Screenshots reach agents as images in the message**, not as files for them to read: the agent
  sees the image without a step of its own. Until 2026-10-12 the thumbnails in the field did not
  open.
- **A spoken command takes the screenshots of the field it speaks to** (2026-10-12). Until then the
  microphone always had a store of its own, also beside an open card's field: a screenshot pasted
  into the field and then spoken about went out without it. Until 2026-10-15 a recording the page
  cut off by going away counted as failed, and the screenshots came back on the next load, to go out
  a second time with the next command. The fix then told a page that was leaving by its `pagehide`;
  in the owner's Chrome the screenshots still came back after a quick switch to another canvas and
  back (2026-10-16), so since then Obeya, not the browser's timing, says whether the command arrived.
  Until 2026-10-17 the microphone's screenshots hid when the sidebar opened, and those in the
  sidebar's field when it closed: to the owner they looked lost.
- **Marking without tools: the gesture decides** (owner, 2026-10-14): a free pen came out rough with
  mouse or trackpad, and a switch between pen, frame and number was one more choice each time.
  Frames got numbers like pins on 2026-10-15 (owner); until then only pins had them.
- **The worker gives the app's address; the link shows only while the app answers** (2026-10-16).
  Before, a card offered no way into its running app, and the owner who wanted to try the work by
  hand had to find the port. Rejected: Obeya finding the address itself from the ports the
  workspace's processes listen on (a stack in Docker listens elsewhere, and only the worker knows
  which port is the page); a mark on the card on the canvas (it is wanted rarely); starting a parked
  app from the link (that is the worker's, from the recipe, and the owner can ask it to). For a
  workspace on another machine only the reported address's port is forwarded (2026-10-16, owner):
  forwarding more ports would need the worker to name them, and would only help a page that names
  them if each kept its number here, where the stacks of clones here need them. Until 2026-10-16
  those workspaces had no `app_running` and no link.
- **A card's files are its result, in tabs beside the demo** (2026-10-21, owner): until then a
  folder's card showed only the list „Im Ordner geändert“, its diffs as raw text, and its left
  column stayed empty without a demo; a Markdown file could only be read as a diff, and a git card
  had its branch and diff alone. Now the files show formatted on the left, with tabs, and open on
  the computer with a click. Rejected: only „Auf dem Rechner öffnen“ at each entry of the change
  list (no place for the result, Markdown still unread in the browser), and Markdown formatted only
  in the diff overlay (the result stays behind „Ansehen“). The files the worker names come first,
  the others it changed behind them (owner). Only the card's own files are served, so this way
  reads no other file of the folder or the disk. A PDF is served unsandboxed, as Chrome shows no
  PDF in a sandboxed frame; a bundled pdf.js was the alternative. Opening a file from another device
  downloads it instead of opening it on the Mac, and since then an answer's files do the same.
