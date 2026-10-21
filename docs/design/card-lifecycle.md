## Card lifecycle

A chapter of the [design doc](../design.md), whose header says how it is written.

A card is created by the owner (voice or canvas) or proposed by an agent, worked on by a worker,
handed over with a demo, approved, and lands; finished cards go to the archive.

### Proposals

The owner can edit a proposal, and accepting it starts it (it goes to the Koordinator like a started
`planned` card) unless they only accept it as `planned`. A worker writes a proposal's text for the
agent that will take the card on, as the owner would write a card: no "I" or "my question" of its
own, other cards named by their title. Apart from the text it says why, for the owner only (beside
"Vorgeschlagen vom Agenten der Aufgabe …"), and what the owner has to decide, as questions with
options. The owner may pick options on the proposal before taking it; accepting writes the questions
into the text, those with a pick under "Entschieden:", the others under "Offene Fragen:", so the new
worker reads what is settled and asks the rest.

#### A proposal that starts later

A follow-up that can only be done later (whether a bank has registered a form, two weeks on) is a
proposal with a start time, `propose_card`'s `start_at`, not a sentence in a handover where it goes
under. The worker proposes it while its own card is still open; the owner decides on it now, and
the card starts by itself at the time, so nobody has to remember it. The proposal reads „◷ Startet
Mi 4.11., 08:00 · Ändern“ under its text (on the canvas „startet …“ after its state); „Ändern“
opens the menu of „Später …“ (`SnoozeMenu`), with „Ohne Zeitpunkt“ to take the time away
(`startAt` on the proposal, the action `startAt`). Its one go is „Übernehmen“: the card is planned
and snoozed until then by its agent, the proposal's reason as what it does then (`snoozed` with
`start`), and stands on the canvas like any snoozed card, with „Jetzt zurückholen“ and „Ändern“. At
the time it starts as a started planned card does, through the Koordinator and its queue (see
Snoozing a card); a time that has passed when the owner accepts starts it at once. Its worker hears
with its task when the card was set to start and that it is that time now, so a task that says „in
two weeks“ reads as due; it checks what it can and asks the owner for what only they can see. The
reviser keeps the time as it was; accepting it only as planned, or as an idea, drops it. Only a time:
a card to start once another is done is the plan's order, and a worker's own wait is its `snooze`.

A worker may also propose an idea, for something to think through first: it shows as "✦ Vorschlag ·
Idee", and "Übernehmen und besprechen" makes it an open idea whose exploration agent opens the
discussion with the text and its questions; "Als Aufgabe übernehmen" plans it as a task instead.
The other way round, „Als Idee besprechen“ on a proposed task makes it an open idea the same way,
whose agent hears that it was proposed to be built and the owner wants to think it through first;
said to the Koordinator („erst als Idee besprechen“), it is `accept` with `idea`.

#### A proposal its agent takes back

A worker takes back a proposal of its own that turned out wrong or needless with `withdraw_proposal`
(its title, why, and `replaced_by` when another of its proposals takes its place), or proposes the
better one with `propose_card`'s `replaces` naming the old title. Obeya finds the latest of the
card's proposals by that title (case, quotes and markdown aside) and answers the worker what became
of it; a title that matches none gets the list of its proposals back. A proposal still open goes
from the canvas at once, while it is reworked too; the proposing card's conversation says „Zieht den
Vorschlag „…“ zurück: …“ or „Ersetzt den Vorschlag „…“ durch „…““. It is kept deleted with the
mark, so the Rückschau does not read it as one the owner dismissed. One the owner has accepted
already (as a task or an idea, planned or at work) carries the mark (`Item.superseded`) until it is
finished: its canvas card reads „Ersetzt durch „…““ or „Vom Agenten zurückgezogen“, it needs the
owner (a push says so), and its panel says who replaced it by what and why, with „Entfernen“ (as
„Löschen“: its worker stops, with an undo) and „Behalten“ (the mark goes). Said to the Koordinator,
they are `dismiss` and `keep`. A finished card stays as it is.

#### Reworking a proposal by words

Instead of editing a proposal by hand, the owner may say (or type into its field „Was soll anders
werden?“) what should change. With the proposal open, the words go straight to a read-only agent
(`revisions.ts`, in the card's repository), as on a card with an agent, without the Koordinator or
an undo window („Agent · Vorschlag: …“ under the mic). It rewrites title, text, reason and questions
by those words, keeping what they did not touch; a question the words settle goes, and its decision
into the text. What the words ask of Obeya (accept or dismiss the proposal, a rule, another card) it
passes on with `to_obeya`; accepting passed on that way waits for the rework as the button does, and
words that only did that leave the proposal as it was. Said of a proposal that is not open, the
Koordinator reads the words as `revise`. What the words only ask („Was würdest du nehmen?“) the
reviser answers and leaves the proposal as it was there.

The words may carry screenshots, as on any card (see Screenshots), typed or spoken, also when they
wait for the next rework; they stand with the words in the conversation. The reviser sees them,
those that go with the proposal's task already, and those the owner showed earlier in its
conversation (at most twelve, newest first), each by its file name, and names in `revise_proposal`
those that go with the task (`images`; left out, they stay as they were). It may drop one it kept
before, once the owner's words make it obsolete. Those it names are the proposal's own screenshots
(`Item.images`): they show with its text, in the field when it is editable, with „Die Screenshots
beim Text gehen mit der Aufgabe mit.“ under it, and accepted, the task (or idea) has them like a
typed task's. The others stay only in the conversation. A change of them alone reads as revised.

As with an idea, the conversation about it stands beside the proposal, its open questions at the end
of it and the field under it; a question stands where it was asked once it is settled (or while the
proposal is reworked), so the owner still sees what they answered, and how it ended when they picked
nothing for it (see The conversation); the proposal's text and reason
are on the left, its buttons below both. The text box is as tall as the text and the panel grows
with it up to the screen's height; only beyond that does the box scroll. Options picked there and
sent („Antworten“, with words or without) go to the reviser at once, without the Koordinator or an
undo window, and stand in the conversation as the owner's words; accepting instead takes the picks
into the text as above.

Meanwhile the proposal shows „wird überarbeitet“ (in the conversation, above the field), cannot be
edited or only accepted („Übernehmen“), and is not among the cards that need the owner. Words said
meanwhile wait, unread, for the rework after it, which takes them in together
(`Proposal.revising.next`). The owner's words stand in its conversation, then the reviser's reply
(its answer to what they asked, and what it changed), „Vorschlag überarbeitet.“ when the proposal
reads otherwise now, and the questions it asks anew. An agent that ends without a text leaves the
proposal as it was, with the error. A revision still running at a restart starts again.

„Übernehmen und starten“ (on a proposed idea „Übernehmen und besprechen“, on a proposed task also
„Als Idee besprechen“) does not wait, as "So bauen" on an idea does not: clicked during a revision, the proposal is accepted and started once the
new text is there, unless it still has questions; then it stays a proposal, and the conversation
says why, as it does when the reviser ends without a text. The panel stays open while it waits: the
button reads „Startet nach der Überarbeitung …“ with „Doch nicht übernehmen“ beside it, and the
canvas card says „danach übernommen“. The waiting button and its take-back are one component with an
idea's. Said by voice to the Koordinator while the proposal is reworked, accepting is still refused
(see Commands to the Koordinator).

### At work

`working`: the worker leases a workspace, implements, runs the checks the repository's settings name,
and records the demo.

### Waiting for approval

`waiting: demo`: the card carries the demo. The owner approves or gives feedback. Feedback, like
anything the owner writes or says on the card then, goes to the worker at once, and the work still
waits for approval: while the worker takes the words in, the card is at work („Agent arbeitet an
deiner Nachricht“, no badge, not counted as needing the owner), „Freigeben“ stays, and a change the
words call for comes as a new handover. A worker whose words asked Obeya for something instead (gib
frei, a follow-up) passes them on (`to_obeya`), and once its turn ends the card is the owner's
again. A turn that ends without a new demo (a reply, a handover that keeps the demo) leaves the card
reading „Agent hat geantwortet, wartet auf dich“ (`answered`) instead of „Demo bereit“, whether or
not the owner had watched the demo; a new demo reads „Demo bereit“ again. Only words for the owner
answer them: a reply, what the worker says, or Obeya's result of `to_obeya`; an answer to earlier
words does not count. A turn that ends without any (it broke off with an error, its session ended)
leaves the card at „Demo bereit“, and the conversation says the agent stopped without answering, so
the owner writes again. A worker that a background
command wakes after such a turn (a test run it said a new handover waits for) works on towards what
it told the owner: from its first step the card is at work again, as while it took the words in,
until its turn ends.

A card has one field for the owner's words with one Send (`ownerField` in `src/ui/talk.ts`): under
such a demo it takes the answer and feedback together. The words go to the worker as the answer (in
the decision log as such), and a change they also ask for comes as a new handover.

#### The handover report

The worker's summary is its handover in the card's conversation below, not repeated under the demo:
what changed for the user and what the owner needs to know, in a few short paragraphs at most. A
later handover says only what the one before and the worker's replies since have not said yet, often
a sentence: the owner has the rest in the conversation above it. Until 2026-10-15 the tool and the
worker's instructions called the summary the whole report, the one thing the owner reads at the end,
so a handover after feedback repeated the reply just before it nearly word for word. Until
2026-10-16 the reply told the worker its turn goes on („carry on with your work“) and the handover
tool asked for „what is new since your last handover and your replies after it“, so a worker that
answered a note on handed-over work and had nothing to change handed over again with the reply's
facts; now the reply alone ends such a turn. Whoever reads the card's report beyond its conversation (a follow-up's worker, the Koordinator, a
prototype's idea, a shared page's text) gets the whole of it, as the card's summary: the first
handover since the worker started, then „Danach im Gespräch:“ with its replies and later handovers
in order (`report` in `src/server/workers.ts`). A problem the worker noticed beyond the task is a proposal (`propose_card`), not
a line in the report. A follow-up's worker hears which card it comes from and that card's summary.

A question in the demo report is an open question like a worker's: the owner answers it on the card
or by voice, the worker hears the answer, and the demo keeps waiting for approval. While the worker
takes in the answer (it may rework the demo and hand over anew), the card is at work as after
feedback. Once its turn ends, a demo still waiting is the owner's again; a restart resumes that turn
like a working card's, also when the worker ended it to pause for the restart.

#### Watching the demo

The demo plays on its own the first time the card is opened (per browser; a new render counts as
new) in a page in sight, later it waits to be played, with a big play button over it like a shared
page's (also when the browser blocks the first play).

Z or the magnifier on the video zooms it out of the card to as large as the window allows above the
microphone, over the greyed page (`useZoom` in `src/ui/detail.tsx`): the same video element, so it
keeps playing, growing out of its place and back; Z again, Esc or a click beside it ends it, and the
card stays open. Hovering the magnifier shows the key beside it until the owner first zoomed with Z
(per browser).

Space tapped plays and pauses the video, so a demo that waits is started with it. The recording
starts with the press, so no word is cut off, but with a demo video open the microphone lights up
only once Space stays down for 200 ms (`SPACE_SHOWS_MS`), so a tap does not flicker it; without a
video Space has nothing to play, so the microphone lights up at once. ← and → jump 5 seconds back
and forward (`useSeekKeys`). The browser's controls keep every key to themselves once clicked, so
the video hands the focus back to the page at once. Not when the controls take it again within a
second (`MENU_FOCUS_MS`): their overflow menu (⋮) takes the focus as it opens, right after the
press on its button gave it to them, and closes when it loses it, so handing it back left the menu
dead. Without a mouse (a phone, a tablet: `pointer: fine` does not match) there are no keys, and the
video keeps the focus. A press or click on the controls never reaches the page, only the focus
does, which is why the menu is told apart by time. A click on the controls shows the arrow keys over them for a moment,
until the owner first jumped with them (per browser).

#### Comments at a place in the video

What the owner types or says while the video stands somewhere in the middle is about that place
(`src/ui/spot.ts`): Space (or the microphone) held while it plays pauses it, so the speech
recognition does not hear the narration, and the recording goes out with the place; letting go plays
it on, while a video the owner had paused stays where it is, as it does after words dictated into
the field. Typing in the field pauses it too; above the field stands the place like a quote (its
frame, „1:23 · chapter“, × to take it out), the placeholder says „Etwas zu 1:23 schreiben oder
Leertaste halten“, and Enter sends and plays on. „Hier kommentieren“ (its speech bubble drawn like
the magnifier) on the video beside the magnifier pauses it and puts the cursor into the field; both
show only while the mouse is over the video, so they do not cover the picture; the controls (`?`)
have a section for the video. At the start or the end, the words are about the work as a whole and
go out as before.

The browser draws the frame from the video (same origin) and uploads it as a screenshot; the server
adds the chapter and the sentence of the narration at that time (`placeIn` in `src/server/demo.ts`,
by its share of the scene's caption) and keeps the place on the event (`CardEvent.spot`). The
conversation shows the words with the frame and „▶ 1:23 · chapter“, a click plays the video from
there; it stays at its newest comment also once the frames have loaded (`useStickToEnd`, which the
Koordinator's sheet shares).

On a card waiting for approval, such comments do not go to the worker one by one: the conversation
shows each at once, with „N Kommentare gehen an den Agenten, sobald du fertig geschaut hast“ and
„Jetzt senden“ under the last, and Obeya holds them back (`held` on the card) until the owner has
finished watching: the owner sends them („Jetzt senden“, for an owner who watched the video already
and went back to one place, so need not sit through the rest), the video ends, the card closes, the
video stands for three minutes, the owner writes or says something without a place (it goes in the
same message, after them), or approves (the worker hears them with the approval, to propose as a
card what still matters). Ten minutes after the last one without such a sign (a browser gone away, a
restart) they go anyway. The release waits 1.5 s, so an approval clicked as the card folds takes
them; „Jetzt senden“ does not wait.

Until they go, each stands dashed with a bin in its corner: taking one back takes it out of the log
(`eventGone` to the pages), and the worker never hears it; its words go back into the card's field
if that is empty, as with a note not read yet (see Reading order); once sent, it can no longer go.
Held, they are unread (`CardEvent.unread`): they stand at the end, below whatever the worker does
meanwhile (it may still be taking in earlier words on the handover), and once sent they move to
where they went (`readAfter`).

The worker gets them in one message, each as `[Demo video at 1:23, chapter „…“, narration: „…“]`
above the words, with its frame as an image, and reworks the demo once instead of for each comment;
a comment is no answer to the demo report's question. On a card at work or finished, a comment with
a place goes at once, with its place and frame.

#### Earlier demos

A new demo replaces the one on the card, but the card keeps the one before (`CardRow.demos`, served
under `/api/cards/:id/demos/:n/`): a demo after feedback often shows only what changed. Once there
is one, plain text above the video, left of „Teilen“ in the same line, says which is shown
(„Neueste Demo 2 von 2 · 13:37“), with ‹ and › to step back and forth, and „Zur neuesten“ two or
more steps back; an earlier one's text is in colour („Frühere Demo 1 von 2“), so it is not taken
for the latest. Sharing is about the demo shown, an earlier one too (see Sharing a demo), and the
text of a demo on the shared page carries a small share icon. Until the owner's feedback on 2026-10-16 the line
was a bar of its own below sharing, coloured for an earlier demo. Stepping is no sign the owner has
finished watching (see above), and a new handover leaves them on the demo they look at. An earlier
demo whose directory a later one was rendered into, or whose files are gone (demos are deleted to
free space), is not offered.

A comment on a place keeps the demo it is in (`Spot.demo`, the handover it came with): a click on
it shows that demo and plays it from there, and words on a place in an earlier demo reach the
worker as about the earlier demo video, one a later handover of its replaced.

### Approval and landing

Where work lands through pull requests, the approve button reads "Freigeben (PR)", and approval
puts the card `in PR`: its worker opens the PR (until it reports one, the card reads „Freigegeben ·
Agent öffnet den PR“ with the worker's status line, not "in PR" without a link) and Obeya carries it through the merge, which it does itself (see
PR loop), unless the repository's settings leave the merge to the people on the forge (`autoMerge`
off). Review comments, failed checks and conflicts go to the worker; only what needs judgement —
a review comment that questions a decision, a conflict with product meaning — comes back to the
owner as a question on the card, and the answer returns it to the PR. A PR closed without a merge
asks the owner whether to open it again or drop the work.

Where the repository's settings allow it (`direct`), the owner may instead approve with "Direkt auf main" beside
"Freigeben (PR)", or by voice ("gib frei ohne PR"): Obeya pushes the work onto the default branch
itself, without a pull request, review or the PR's CI, and the card is `live`. Where work lands on
`main` (Obeya), approval lands it at once.

A click on an approve button folds the card at once, without waiting for the server (a push onto
main takes seconds): until the answer, the card on the canvas says what is under way („wird direkt
auf main gepusht …“) and a message with a spinner stands above the microphone. The answer turns the
message into the confirmation, or, when the landing is refused, into the card's title and why, with
the card waiting for review again.

### Live and done

Merged (or landed on `main`) → `live`. The demo stays on the card. The worker hears that its work is
on main and may finish what was waiting for that (a data migration, say) before its session ends
(see After landing).

Work that changed nothing in the repository (the task wanted a demo, an analysis, an answer) has
nothing to land: approving it makes the card `done` ("Erledigt") without a pull request or a
landing, and its worker finishes the same way. The owner sees that before approving: when the
handover finds nothing on the branch (no commits, nothing uncommitted), the button reads "Beenden"
instead of "Freigeben", with a line that no pull request follows: there is nothing to release, only
the card to close. A worker whose approved work turns out to change nothing (its branch emptied
after the approval) closes the card itself with `close_unchanged`, which Obeya refuses while the
workspace holds commits or uncommitted changes.

A finished card (`live` or `done`) an agent worked on keeps its field for the owner's words once
that agent's session has ended: a question there („Nachfrage an den Agenten“) resumes the agent that
did the work (see After landing), which answers on the card and ends again.

### Archive

A card is archived when the owner takes the finished card off the canvas ("Archivieren" on the card
or its archive button on the canvas, shown while the pointer is on it, or all finished ones at once
in the archive), or when a prototype ends (discarded or built; see Prototypes). A task the owner
stopped („Gestoppt“: planned again, its branch still the card's) goes the same way, one at a time,
with its conversation, for the owner to come back to (a question an agent answered, say); „Neu
starten“ and „Löschen“ stand beside it. Not while it waits to start, and not while its workspace
holds work that has not landed (the button is greyed and says so): archiving would leave that work
unseen in a clone. A stopped card opens as a card an agent worked on, the task as its conversation's
first message.

The archive (button or `A`) lists archived cards under its button in the bar, as the queue does, by
day, the most recently archived first, as small cards on a timeline with the time they were
archived, each labelled with its kind or state („Idee → Projekt“, „Projekt“) unless it is a plain
task, nearly every entry, which goes without one; one unfolds from its card as on the canvas and can
go back to the place it had. An ended prototype cannot: it shows, read-only, how it ended, its demo
and conversation.

A search field over the list, with the cursor in it as the list opens, filters it as the owner
types: a card stays when it holds every word typed (case and accents aside) in its title, text,
summary, last status or label, a project also in its goal and workstreams; the words are marked in
the titles. The search stays while the list is closed, selected when it opens again, so typing
starts a new one and a card folds back into the list it was opened from. The list stays under the
dim while that card is open, so the card folds back into it; a click beside it or Esc closes it.

### Projects end

A project ends when every workstream in its plan doc is ticked on the default branch, or when the
doc goes (deleted): it moves into the archive with its workstreams, which are not listed on their
own. A workstream card still at work then (in progress, or its worker finishing after the landing)
keeps the project on the canvas, as its doc last stood if the doc is gone, until it is done: the
project goes into the archive once that worker is done, not at the landing. Opened from the archive, its sheet shows,
read-only, the goal and the workstreams as the doc last stood; each workstream unfolds with its
conversation and demo. When the same file comes back, or an open workstream is added to it, the
project returns to its place.

Every project's sheet, live or archived, holds its conversation with its project agent (see Asking
in a project's sheet), lists its decisions and links the idea its plan doc was
written from: when an idea decided as a project („Idee → Projekt“) lands and its diff adds a doc in
the plan directory, the project from that doc remembers the idea, whose card keeps its brief and
conversation, and the idea's decisions join the project's. The project takes the idea's place, and
the idea, once its worker is done, goes to the archive. A task planned as a project („Aufgabe →
Projekt“) is linked the same way.

### Decisions

- **A proposal is written for the next worker, with its reason and questions apart.** Before, a
  proposal was the worker's reason and suggestion as one text, in the first person, with open
  questions buried in it; taken as it was, it went to the next worker as if the owner had written
  it.
- **A proposal the owner talks about is rewritten by an agent of its own**, not by its proposing
  worker or in the Koordinator's quick turn (2026-10-06): the worker may be gone or busy with its
  own card, and writing a whole card text would slow every confirmation down. Before, the owner
  could only type the changes into the proposal's text themselves.
- **On an open proposal, the owner's words go straight to its reviser**, which passes on what asks
  Obeya for something, as on any card with an agent (2026-10-14). Before, the Koordinator read them
  first, since they might accept or dismiss the proposal rather than change it: the reviser started
  only after the undo window, meanwhile the owner's words stood above the question they asked about,
  and on a task the same words would have gone straight to its agent.
- **The reviser replies, and a settled question stays where it was asked** (2026-10-14). Before, the
  reviser could not reply, and a question lived only at the end of the conversation: the owner who
  asked about it saw neither the question nor an answer once it was settled, only their own words.
  Before 2026-10-14 the field was gone during a rework, too.
- **Accepting a proposal does not wait for its rework** (2026-10-06: the owner who answered the last
  question knows that starting comes next). Before, the button was disabled until the new text was
  there.
- **A proposed task can be taken as an idea** (2026-10-16). Before, a proposal could become an idea
  only when its worker had proposed one: the owner who wanted to discuss and prototype a proposed
  task first had to ask the Koordinator to make an idea of it.
- **An agent takes back its own proposal** (2026-10-17): an open one goes at once, an accepted one
  only marked, for the owner to remove, since the owner chose it and work on it may be under way.
  Before, a worker could only say in a new proposal's text that it replaced an older one: both stood
  on the canvas, and the owner started both.
- **Feedback keeps the approval** (2026-10-08). Before, feedback sent the card back to `working` and
  took the approval away until the next handover, so it waited for "Rückgängig" like a command.
- **Earlier demos stay on the card** (2026-10-16). Until then a new demo replaced the one before for
  good: a demo after feedback that showed only the corrected part left the owner without the
  original, and a comment on a place in it played the new video from that time.
- **A turn without a new demo reads „Agent hat geantwortet“** (2026-10-15). Until then the card read
  „Demo bereit“ after any answer.
- **Only words for the owner count as an answer** (2026-10-19). Until then any end of a turn on
  their words counted, and a session that ended without one left the answer to the words before
  standing: the card read „Agent hat geantwortet, wartet auf dich“ under a question no agent had
  seen.
- **The demo zooms within the window** (2026-10-12): full screen was too much on a large monitor and
  hid where the owner was; before, the owner zoomed in with the operating system.
- **Space and the arrows reach the video** (2026-10-14). Before, the microphone flickered at every
  tap of Space on a demo, and then the 200 ms delay held everywhere, also without a video. A click
  on the progress bar took Space away (no pause, no recording), and the arrows worked only after
  that click.
- **Comments are tied to a place in the video** (2026-10-12). Before, nothing tied the owner's words
  to a place in the video: they named the time themselves or took a screenshot, and the video ran on
  while they spoke. The comment button stood on the video always until then. Until 2026-10-14 the
  frames loading after the jump to the end pushed the newest comments below the edge after a few of
  them.
- **Comments are held until the owner has watched** (2026-10-12): before, a comment once said
  stayed, and only the end of the video sent them early. Until 2026-10-15 each held comment stood
  where it was said, so the worker's steps after it showed below comments it had not heard yet.
- **A demo that a worker reworks after an answer is at work, not the owner's** (2026-10-07). Before,
  the card kept its badge while the worker reworked the demo the answer asked for, and a worker that
  paused for a restart there was never resumed: the card waited with a demo its worker had not
  finished.
- **Approval covers the PR, its monitoring and the merge** (2026-10-05): the owner approves the
  demo, not the code, so a second click on GitHub once checks and review are through added nothing
  but waiting. At first Obeya left the merge to the owner.
- **A repository may leave the merge to its team** (`autoMerge`, 2026-10-21): a colleague asked
  for it, where pull requests are reviewed and merged by people on GitHub. A ready PR then waits for
  the owner like one Obeya could not merge, rather than a mode where Obeya stops watching: review
  comments and failed checks still go to the worker, and the merge still makes the card live.
- **An approve click folds the card at once.** Before, the card stayed open with nothing to show the
  click had registered until the push was through.
- **Work without a change to the code ends in a state of its own**, `done` ("Erledigt"), not `live`
  (2026-10-02): nothing went live. Whether there is anything to land Obeya reads from the workspace
  on approval, rather than from the worker's word; the worker's `close_unchanged` only covers work
  whose branch emptied after the approval. The owner still approves such work: its demo or summary
  is the result. Before, such a card waited in `in PR` for a pull request that could never come (a
  demo card on 2026-10-02).
- **A finished card keeps a field for questions to its agent** (2026-10-08). Until then a live card
  had no field, and asking its agent was no longer possible.
- **What the owner archives**: only their own cards, and only once `live` or `done`, or an idea once
  parked or dropped; "all finished ones at once" leaves ideas alone. A workstream stays with its project, where a delivered one is already
  a chip, and goes into the archive with it. Archiving keeps the card's position, demo and log.
- **A parked idea can be archived too** (2026-10-15). Until then only a dropped one could: a parked
  idea was meant to come back, so it stayed in sight. But an idea whose result the owner used outside
  Obeya (a post written with its agent) is done, neither dropped nor to come back, and stayed on the
  canvas for good.
- **A stopped task can be archived and opens like a card an agent worked on** (2026-10-15). Until
  then a stopped card could only be started again or deleted, and it opened as a planned card nobody
  had worked on: the task in its edit field, the conversation squeezed below it.
- **The archive drops down from the bar** (2026-10-09): until then it was a sheet on the right.
- **No card goes into the archive while its worker finishes after the landing** (2026-10-16). Until
  then a project whose doc went with its last workstream's landing (as docs go in Obeya's own
  repository) went into the archive at once, its workstreams with it. Its worker, looked up only
  among the cards on the canvas, never ended its turn: the clone stayed taken, by "a card that is
  not on the canvas" in the Workspaces popover, and the owner could neither see nor answer it. Such
  projects come back on the next start, their workers finish, and they go into the archive again.
