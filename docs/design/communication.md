## Communication

A chapter of the [design doc](../design.md), whose header says how it is written.

Agents never talk to each other directly; the Obeya server is the mailbox, so every exchange is
visible on a card.

### A worker's tools

A worker has its tools served in-process:

- `report(status)`, a status line on the card, which belongs to the stretch of work it reports on: a
  handover and an approval clear it, and a line reported while pausing for a restart gives way to
  the one from before once the worker paused.
- `reply(text)`, its answer to a note or feedback in the card's conversation, which does not end its
  turn: with work left the worker carries on; with none (its work handed over, the note changing
  nothing) its turn ends with the reply, and the card goes on waiting for approval.
- `ask(question, options, multiple, pick, pick_why)`, which returns at once — the worker ends its
  turn and the answer arrives as its next message. The owner picks one option, several when
  `multiple`, or writes their own answer, or both; `pick` and `pick_why` are the options the worker
  would choose if it had to decide, and why, which the card marks "Würde ich nehmen" the way an
  idea's questions show its agent's pick. The options picked go apart from the owner's words
  (`picks` of the answer): the worker reads `They picked „…“.` and, below it, what they `added in
  their own words`; the log keeps both as one text, picks first, for whoever reads it later
  (decision log, Koordinator). An answer leaves the card open, picked or written, and stands in its
  conversation at once.
- `propose_card(title, task, reason, idea?, questions?, replaces?, start_at?)` and
  `withdraw_proposal(title, why, replaced_by?)` (see Proposals): something it noticed outside its
  task, or a follow-up to its own task that can only be done later (`start_at`).
- `ready_for_review(summary, demo)`, whose summary is the report the owner reads.
- `app_running(url)`, where the app in its workspace opens in a browser, for the owner to try it by
  hand (see Trying the app by hand); in a workspace on another machine, Obeya forwards its port.
- `snooze(until, why, card, state)`, when it has nothing to do until a point in time further off
  than a background command can wait, or until another card gets somewhere (see Snoozing a card).
- `to_obeya(request)`, for what the owner's words to it ask of Obeya rather than of the worker (see
  Voice in).

Obeya's messages to a worker say what happened — feedback, an answer, a note, a landing that failed,
the landing — not step by step what to do: workers are full agents. Whether a demo is recorded again
after feedback is the worker's call; a handover without a new demo keeps the one on the card. The
card shows that demo while its worker works again or waits on a question, without playing it on its
own and with the hint that it is the last handover's and the agent is working on the task again;
sharing stays beside it.

### Turns that end without a handover

A turn that ends without `ask` or `ready_for_review` gets one nudge, then its last words become a
question to the owner; when that turn failed in the session (the SDK reports an error result, e.g.
Claude not logged in on the machine), the question is the error in words for the owner instead. A
worker that went to the owner for having stopped and then works on by itself takes that question
back.

A turn the account's usage limit stopped (the five-hour session limit, a weekly one: the SDK's
`rate_limit_event` says `rejected` and when it resets, the API error is `rate_limit`; without the
event, the message's „resets 7:20pm (Europe/Berlin)“ says when, `resetIn`) is neither
nudged nor a question: the card's log says when the worker goes on, its status line reads
„Nutzungslimit · weiter um 14:40“, and ten seconds after the reset Obeya tells the worker to go on
where it stopped (a limit that holds past its reset time is tried again after a minute, one without
a reset time every 15 minutes). Meanwhile the worker is not busy, so a restart need not wait for it
(the resumed session runs into the limit again and waits anew), and a note from the owner reaches it
at once. Once it works again its status line from before is back. The conversation shows the limit
as a line where it happened, with what the worker did until then above it, not folded into the
message that follows the owner's next words. A worker the limit stops while it takes in the owner's
words on its handover is still at them: the card does not wait for the owner meanwhile. One whose background work runs on (a demo render) says so on its
status line too and goes on at the reset without waiting for that work to wake it; it stays busy
while the work runs, which a restart would cut off.

The other agents wait for the limit the same way (`withLimitWait` in `runtime.ts`, which an agent
joins with `onLimit`): a look-up and a project agent, a Question card's agent, an idea's exploration
agent, the reviser of a proposal, and the Koordinator's own small jobs (naming a card, checking a
queued card or a project's workstreams, the learner, the Rückschau, the Arbeitsrückschau). The turn
the limit stopped is neither an error nor over: ten seconds after the reset (with a worker's retries
when the time is unknown or passes) the session is told to go on where it stopped, and the owner's
words meanwhile wait for its next turn as during any other. Where the agent waits says until when:
under a looked-up question in the sheet „Nutzungslimit · schlägt das um 19:20 von selbst nach“ (on
the card it was asked on, a line in its conversation), and on a card, on its face, beside its state
and in the agent's bubble, „Nutzungslimit · weiter um 19:20“ (`Item.limitedUntil`, `Talk.limitedUntil`,
held in memory). After a restart they are resumed with their work (a question looked up, an idea's
reply, a proposal being reworked, a card being named or checked), run into the limit again and wait
anew; ending the session (pausing the agent, parking the idea) ends the wait. Two do not wait: a demo
page shared without the worker's text, which takes the card's title and the summary's start as
before, and the draft of a wish, whose owner is waiting for it in the dialog (see „Wishes for
Obeya's makers“). Workers and Obeya's chat handle the limit themselves, as described above and in
„Confirmation and undo“.

A turn that ends while the worker's own background work runs (a demo render, a test suite, a watcher
it started) is no such turn: the work wakes the worker when it finishes or fires, so Obeya waits,
also after the landing, where an ended turn would otherwise finish the card and take the work's
workspace with it. The session reports each change in how much background work runs, and Obeya waits
as long as some does, bounded only by the work's own limits (a command in the background stops after
two hours at most, a watcher after half an hour; Obeya gives up after three hours for a session that
never says the work ended). A deploy that takes twenty minutes is waited for. Only ten minutes after
the work ended without a sign of life from the worker does Obeya nudge. So does a turn in which the
worker said and did nothing: a session resumed after a restart first ends a turn of its own over
what the previous one left (a background command the restart stopped), and counting that would use
up the nudge before the worker's own turn, whose status line would then reach the owner as a
question.

### Pausing an agent

The owner can send a note at any time; it reaches the worker without stopping it. The owner can also
pause the agent while it works on something: the conversation's bubble that shows it at work („Agent
arbeitet …“) has a pause mark at its right, faint until pointed at but always there (a mark that
shows only on hover would hide it from first-time users and touch screens); by voice „halt mal an“.

The bubble and the pause follow the same condition (`pausable` in `src/core/types.ts`, which the
server checks too): a Question card's agent reading, an idea's agent working on its reply, a worker
in a turn (`Item.inTurn`, which the server sets from the worker's live session, background work
included), whatever the card's state: at work, taking in the owner's words on its handover, in its
PR (on review comments or a note), finishing after the landing. An idle agent shows no bubble and
offers no pause: a PR card whose worker opened the PR and waits for review has nothing running, and
a note or the PR's review starts its next turn (its field then reads „Hinweis an den Agenten – er
macht sich daran“, not that it works on). The agent reworking a proposal has no pause: its rework is
short and starts again from the owner's words.

A worker's bubble also names the background work that runs: under „Im Hintergrund“ each task as the
agent described it (the SDK's `background_tasks_changed` list, `Item.background`), with how long it
has run („Run the test suite seit 2 min“), counting on while the card is open; a task that ends
leaves the list. That is what the bubble shows when only background work keeps the turn open (right
after a question, reply or handover), where it would otherwise show no step and no gist. Obeya
learns no start time from the SDK and counts from when it first saw the task; the SDK's own
housekeeping, which wakes no one, does not show (`backgroundWork` in `src/server/runtime.ts`).

Pausing ends the agent's session at once, in the middle of a step if need be, with whatever it ran,
and keeps the card's state and the session (`paused` on the card's row). A worker keeps its
workspace and branch, its slot is free, and its app is parked after the grace like a waiting
card's; one paused on its handover leaves the card waiting for approval („Demo bereit · Agent
pausiert“), Freigeben included. An idea's agent keeps the messages it had not answered (as when the
idea is parked), a Question card's agent what it was asked (the thread's pending words).

The bubble stays where the agent stopped, standing still in pencil grey: „Agent pausiert · ▶
Weitermachen“, with the line „Pausiert.“ under it (the bubble and the field say how it goes on, so
the line does not, and still reads right once it went on); going on, like a message, brings the
bubble at work to the end again, below that line, the owner's words and „Weiter.“, while the steps
it took until the pause stay above the line, as the agent's message there. The card on the canvas
reads paused too, without the moving line; a restart of Obeya leaves every paused agent paused.

„Weitermachen“ (by voice „mach weiter“) resumes the same session, and the agent hears that it was
paused and that what ran was stopped (exit code 137); what the owner writes to a paused agent
resumes it the same way and goes along (the field says so: „Hinweis an den Agenten – er macht damit
weiter“), for an idea's or a Question card's agent together with what it had not answered. What
Obeya has for a paused worker meanwhile (its pull request's review, the landing of a merged PR) and
a message it had not taken in yet wait and go along then.

„Stoppen“ stays in the card's action row: it ends the agent and plans the card again, a decision
about the card.

### Snoozing a card

A card can be set aside until a point in time: by its worker, which has nothing to do until then (a
test that runs for two weeks, a check at midnight, a report on the 31st), or by the owner. A worker
can also set itself aside until another card of the canvas gets somewhere: until it is done (its work
on main, or closed without a change) or waits for the owner (asks, hands over, or as a proposal or an
idea's questions), as a release waits
for the fix another card makes. Obeya holds the time and the card (`snoozed` on the card's row: until
when, on which card for what, by whom, what the agent does then), not the agent's session. No other
condition: waiting until CI is green stays background work, minutes rather than days.

The worker snoozes itself with `snooze(until, why, card, state)` and ends its turn: `until` a time,
`card` the title of the card to wait on (an exact title, else a part only one open card's title
holds) with `state` `done` (the default) or `waits_for_owner`, or both, and it wakes at whichever
comes first. A card that is there already is refused, as is a time that passed. It takes effect at
once, without asking the owner. Its session ends with that turn, and whatever it still ran in the
background with it; workspace and branch stay, its slot is free, its app is parked after the grace
like a waiting card's, and no nudge or question follows the turn. A worker snoozes only while the
card is at work (started, in its pull request, finishing after the landing); a question or a
handover in the same turn takes the snooze back. Its instructions send a wait for a point in time
that is further off than a background command can wait (two hours), or for another card, to
`snooze`; checkpoints one
after the other are one snooze after another, the worker checking and snoozing to the next each
time it wakes. Idea and Question cards' agents have no such tool: they never wait on the world.

The owner snoozes with „Später …“ in the card's action row (a visible button, with its clock mark):
this evening 18:00 (while that is more than half an hour off), tomorrow 08:00, next Monday 08:00, or
a date and time to pick (`SnoozeMenu` in `src/ui/snooze.tsx`, one component for every kind of card;
by voice „stell das bis morgen früh zurück“, `snooze` with the local time). It is offered on any card
at work, on any card that waits for the owner, and on any planned task not yet with the Koordinator
(`snoozable` in `src/core/types.ts`):

- A card at work stops as on a pause (see Pausing an agent): its session ends at once, mid-step if
  need be, and what Obeya has for it meanwhile waits; at the time it goes on where it stopped.
- A card that waits for the owner (a question, a demo, a proposal, an idea whose agent replied, a
  pull request ready to merge) leaves „brauchen dich“, Tab and the phone's „Für dich“ until then and
  comes back at the time like a snoozed mail, with a push to the phone as when it first waited;
  nothing goes to its agent, and background work its worker still runs (a render it asked beside)
  goes on, with the pause on its bubble. Answering it all the same (or its idea parked, its proposal
  reworked) ends the snooze: it no longer waits for the owner.
- A planned card („erst am Montag starten“) starts at the time instead of now (`Snooze.start`):
  it goes to the Koordinator then as if the owner had started it, queue and all, and its worker hears
  with its task that the card was set to start then. „Starten“ (on the card or by voice) and „Jetzt
  zurückholen“ start it at once, as does „Alle starten“ on its project (so a workstream that builds
  on it can wait for it). So does an agent's
  proposal with a start time once accepted (see A proposal that starts later). A card that is no
  longer planned to start (made an idea or a project, archived, started some other way, a workstream
  whose plan doc went) is snoozed no longer, so it never starts unasked when it comes back; a change
  to its plan doc leaves a workstream's snooze as it is.

Waking: a timer (every 15 s), every change on the board (so a card that only passes through the
state waited for, asked and answered at once, counts) and every start of Obeya look for snoozed
cards whose time has come or whose card they wait on got there (`wakeDue` in `src/server/canvas.ts`, `awaited` in
`src/core/types.ts`), or no longer gets there by itself (stopped, archived, removed, an idea
dropped), so a restart touches no snoozed card and a time missed while
Obeya was not running or the machine slept is caught up at the next start or wake. The worker hears
that it is now the time it snoozed until, or what became of the card it waited on, and what for (and that the owner moved that time, when they
did); snoozed by the owner, that the owner snoozed it until then and what ran was stopped. The owner's words to the card, „Jetzt zurückholen“, and for
a worker that snoozed itself whatever Obeya has for it (a review, the landing, a failed check) wake
it earlier; it hears what woke it (woken by the owner without words, that they want to know where
things stand) and may snooze again once it dealt with that. What Obeya has for a
worker the owner snoozed waits until it wakes, as on a pause. A question for the owner that arises
meanwhile (its pull request closed, a tool call to allow) ends a worker's snooze, so it reaches
them. A restart announced in the turn the worker snoozes in ends its session after the turn the
notice starts; a restart a worker waited for after the landing wakes it once Obeya runs again.

On the canvas a snoozed card is pushed back on greyed stock, its line still in pencil grey with a
clock: „◷ Zurückgestellt bis morgen, 00:05“ (today and tomorrow by name, later days by weekday and
date; „◷ Zurückgestellt bis „…“ erledigt ist“ for one that waits on a card, with „spätestens …“
when it has a time too), and over it who snoozed it and why („vom Agenten · Prüfen, ob der Test den Kellerlüfter
eingeschaltet hat“). It counts neither as at work nor as needing the owner; on the phone it stands at
the end of its list („Läuft“, or „Für dich“ for one that waited for the owner). Its conversation has
a line where it happened, „Zurückgestellt bis Sa 31.10., 08:00 · …“, which while it lasts carries
„Jetzt zurückholen“ and „Ändern“ (the same menu; it changes the time, whoever snoozed it), and on
waking a line that says why it is back: „Wieder da: Zeitpunkt erreicht“, „… von dir zurückgeholt“,
„… Neues für den Agenten“, „… die Karte braucht dich“, or what became of the card it waited on („…
„Tests auf Linux grün machen“ ist erledigt“). Until 2026-10-17 that line said who had snoozed the
card („Wieder da (vom Agenten zurückgestellt)“), which the snooze line says already and which did
not tell why it was back. The field reads
„Hinweis an den Agenten – er wacht damit auf“.

### Waiting without blocking

The SDK hands a waiting message to the agent only after its running tool call, so a note never cuts
a command off (tests and renders included), and workers keep their tool calls short instead: they
wait for anything external (a deploy, a CI run, a process to finish) in the background
(`run_in_background`, Monitor) and end their turn, which a note starts again at once. A point in time
further off than that, they snooze until (see Snoozing a card).

A Bash command in the foreground that sleeps longer than 30 seconds (`sleep N`, a polling loop
without a bound, counted from the command line by `foregroundSleep` in `src/server/runtime.ts`) is
refused with that reason. `timeout N` (or `gtimeout`) bounds the command it starts, wherever that
stands in the line (`cd app && timeout 28 bash -c 'until …; do sleep 2; done'`). The text of a
heredoc is data (a script written with `cat > f <<'EOF'`, a commit message) and counts only when a
shell runs it (`bash <<EOF`, `cat <<EOF | sh`, `ssh host <<EOF`). The refusal names two bounded
waits that pass it, one without `timeout`, which macOS lacks.

### Refused and confirmed tool calls

A tool call refused without anyone being asked (a deny rule of the settings, auto mode's classifier,
the permission mode, a hook, Obeya's own refusal of a foreground wait) stands in the card's
conversation as a line, not folded under a message: „Nicht erlaubt (Regel in den Einstellungen): $
…“, with the deciding component's words when the SDK gives any (its `permission_denied` message; a
deny rule names no rule, only that one decided).

A tool call the settings want a person to confirm (an `ask` rule, say for write access to a
database) reaches the owner instead of being refused: the SDK's `canUseTool` makes it the question
the card waits on, with the command whole and Claude Code's reason, and the options „Erlauben“ and
„Ablehnen“. The call waits for the answer within the worker's turn; meanwhile the worker counts as
waiting for the owner, so a restart need not wait for it. „Erlauben“ runs the call (the owner's
words with it reach the worker as the next message); „Ablehnen“, words alone or a note refuse it,
with the owner's words in the call's result. Two such calls at once are asked one after the other. A
restart while the question is open leaves it on the card; answered then, the resumed worker hears
the answer, and a call the owner allowed runs once without asking again when the worker makes it
anew. It is no decision for the project's log. Claude Code's own question tool (`AskUserQuestion`)
is refused with a pointer to `ask`.

### Notes and replies

A worker answers a note or feedback with `reply`, saying what it changes or why nothing, and asks
when the note is unclear. Its words after a reply are its words when a step of its work follows
them; the closing words of a turn in which it replied mostly repeat that message (often in English
on a German canvas), so they fold under it in the conversation, the last of its steps, whatever the
card's state (event kind `closing`). Those after a handover repeat the handover a third time after
the reply and the summary, and the log leaves them out (until 2026-10-15 they folded under it as
well). The steps it took between that message and
its closing words (a card it proposed after replying, say) fold under the message with them.

A note while the card waits on the worker's question takes that question back: the card goes back to
work (in its pull request, or finishing after the landing, where it was), and the worker hears that
its question („…“) is withdrawn, goes on if the note settled it and asks anew if not. The note is no
answer, so nothing goes into the decision log. Words on a demo whose report asks a question answer
it (see The handover report).

### Questions go to the owner

A worker's question goes straight to the owner, with the worker's own pick: no other agent answers
it on the owner's behalf. The worker asks only what it should not decide itself (product behaviour,
trade-offs, anything irreversible or external) and settles the rest alone. What a project has
decided reaches its workstreams' workers instead: a worker's task holds its project's decision log
("Decisions taken in this project so far") beside the pointer to the plan doc, and a decision
recorded while it runs reaches it once at its next tool call, the way a learned preference does.
Answers given in the owner's name before then stay in the decision logs, marked "(an agent)", and
show on their cards as before. Owner-facing text from agents is in the owner's language: that of
their latest words, else the conversation language (see Language).

### Decisions

- **An agent's question to the owner is a first-class thing with answer options**, not prose: the
  owner answers with a click, and their own words are always possible beside the options. The answer
  travels as text (question and pick), so the conversation reads the same later and a spoken answer
  takes the same path.
- **Picks go apart from the owner's words** (2026-10-15). Until then the pick went out as the first
  line of the owner's words, so the worker could not tell it from them, and the owner's message
  repeated the pick as its first line. An answer with a pick folded the card („Antwort ist beim
  Agenten.“), one without kept it open.
- **A worker's question goes straight to the owner, with the worker's own pick** (2026-10-07).
  Before, a project agent answered a workstream's questions and the Koordinator those of a card
  without a project, escalating only what they could not settle; they were allowed technical
  judgement calls "a senior engineer would make without asking". The Koordinator then decided
  against building a feature, weighing the work against what it would save, which was the owner's
  call. An advisor knew barely more than the worker: the Koordinator saw no other cards, and a
  project agent's only edge was the project's decision log, which now goes to the worker. Narrowing
  the advisor's rules or having it only suggest were dropped: the worker's own pick gives the owner
  what a suggestion would.
- **Workers are told what happened, not what to do next**: they are full agents and judge the next
  step themselves (re-rendering a demo, say). Protocol stays where Obeya depends on it: hand over
  with `ready_for_review`, ask with `ask`, report the PR with `pr_opened`.
- **A status line belongs to the stretch of work it reports on** (2026-10-09). Before, a card the
  owner approved for a PR read „In PR · Paused for restart; next: …“, a line from before the
  handover, while its worker was rebasing for the PR.
- **Background work keeps a turn open** (2026-10-12). Until then a turn counted as ended ten minutes
  after its end whatever still ran, and a worker watching a deploy after the landing lost its
  watcher and its promise to go on.
- **The pause sits on the bubble of the running turn** (2026-10-15). Until then „Pausieren“ and
  „Weitermachen“ stood in the card's action row beside „Stoppen“, for workers only, and pause was
  offered for every card at work, in its PR or finishing after the landing: on a PR card whose
  worker was idle there was nothing to pause, and a worker taking in the owner's words on a waiting
  card, which the owner watches most closely (before a paid render, say), could not be paused. The
  action row holds decisions about the card; pausing is about the turn running now, so it moved to
  where the owner watches that turn. Until 2026-10-14 „Stoppen“ was called „Anhalten“, which reads
  like a pause, and was the only way to halt an agent, losing its session. Rejected: pausing at the
  next safe point, as for a restart: the owner pauses an agent that goes the wrong way, and waiting
  for its step to end lets it go on doing so.
- **Waits of hours or days are a snooze Obeya holds** (2026-10-17). Until then a worker that had to
  wait days (a controlled test running two weeks, a check at midnight) kept its turn open with chained
  background sleeps of at most two hours, each wake a model turn. The card read as at work for days
  and held a slot; every restart of Obeya cut in (notice, stopping the sleep, „Pausiert bis zum
  Neustart“, resuming, a new sleep, a message: about 35 times in one day, nearly all of a card's 239
  events); reminders the worker set in its own session were unknown to Obeya; and a night without
  network turned a failed turn into a stuck question, so the midnight check never ran. Rejected:
  the agent only proposing a snooze for the owner to click (a click per checkpoint moves the noise to
  the owner, and a snooze is undone with one click); keeping the agent's own waits and only hiding
  the restart noise (the card would still look busy, hold a slot, wake every two hours and fail on a
  network gap); conditions besides a time („bis CI grün ist“, which background work covers; another
card's state came later, see below). German
  wording follows Gmail's „Zurückstellen“, which owners know.
- **A follow-up due later is a proposal with a start time** (2026-10-21). Until then a worker whose
  task left a check for two weeks on (whether the bank registered the tax exemption certificates)
  could only write it into its handover, where it went under: its own snooze ends with the handover,
  and `propose_card` described itself as being for problems outside the task. Planned cards could
  not be snoozed, not even by hand. Rejected: the proposal itself coming back at the time (the
  owner decides twice, and deciding now is what spares them remembering); the worker's card staying
  open and snoozed after its handover (the approval would hang for two weeks, the card counted as
  unfinished); a calendar entry (it only reminds, where the card's agent can check part of it
  itself).
- **A worker can snooze until another card gets somewhere** (2026-10-17). Until then a release that
  waited for a fix on another card snoozed until a guessed time (an hour on), to look whether the fix
  was on main, and would have snoozed again if not; Obeya knew all along when that card landed. The
  states to wait for are the two another card's result shows in: done, or waiting for the owner
  (its demo to compare against, its question). Rejected: any change of the card's state (each
  start, handover and approval would wake the worker for nothing); a waiting card the owner sets up
  (the worker knows what it waits for, the owner should not have to wire it).
- **A question stands while background work keeps the turn open** (2026-10-16). Until then a card
  whose worker asked while its background work ran read „Frage an dich“ in its header, but the
  conversation showed only the agent at work: the question and its options stood only once nothing
  ran.
- **Refused and confirmed tool calls reach the card** (2026-10-09). Before, Obeya dropped the SDK's
  denials, and an `ask` rule refused the call silently, as there was nobody to ask.
- **Closing words fold under the message they repeat** (2026-10-09). Until then they were dropped
  after a handover or a finished card's follow-up and showed as a second message after any other
  reply. Until 2026-10-15 the steps between that message and the closing words stood below it as a
  message of their own with nothing but „Verlauf: 1 Schritt“, and a note's first words before a
  reply stood as a message of their own above the reply.
