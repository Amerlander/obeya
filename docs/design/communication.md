## Communication

A chapter of the [design doc](../design.md), whose header says how it is written.

Agents never talk to each other directly; the Obeya server is the mailbox, so every exchange is
visible on a card.

### A worker's tools

- `report(status)`: a status line on the card, belonging to the stretch of work it reports on: a
  handover or an approval clears it, and a line reported while pausing for a restart gives way to
  the one from before.
- `reply(text)`: its answer to a note or feedback. It does not end the turn; with no work left, the
  turn ends with it and the card goes on waiting for approval.
- `ask(question, options, multiple, pick, pick_why)`: returns at once; the worker ends its turn and
  the answer is its next message. The owner picks one option (several when `multiple`), writes their
  own answer, or both. `pick`/`pick_why` are what the worker would choose and why, marked „Würde ich
  nehmen“ on the card. Picks travel apart from the owner's words: the worker reads `They picked „…“.`
  and below it what they `added in their own words`; the log keeps both as one text, picks first.
  An answer stands in the conversation at once and leaves the card open.
- `propose_card(title, task, reason, idea?, questions?, replaces?, start_at?, repo?)` and
  `withdraw_proposal(title, why, replaced_by?)` (see Proposals): something it noticed outside its
  task, instead of doing it, or a follow-up due later (`start_at`). `repo` exists only on a canvas
  with several repositories, whose ids and paths its description lists.
- `ready_for_review(summary, demo)`, whose summary is the report the owner reads.
- `app_running(url)`: where the app in its workspace opens, for the owner to try by hand (see Trying
  the app by hand); for a workspace on another machine Obeya forwards the port.
- `snooze(until, why, card, state)` (see Snoozing a card).
- `to_obeya(request)`: what the owner's words ask of Obeya rather than of the worker (see Passing a
  request on to Obeya).

A call that ends the turn (`ask`, `ready_for_review`, `pr_opened`, `snooze`, `after_restart`)
returns „end your turn now“. When the owner's words waited for that very step (see Reading order in
Conversation on the card), its result carries them instead, says what stands meanwhile (the question
waits for the owner, the handover for approval) and leaves the turn to the worker: it answers them
with `reply`, does what they ask, asks anew if they change its question, then ends the turn.

Obeya's messages to a worker say what happened (feedback, an answer, a note, a failed landing, the
landing), not what to do next: whether to record a demo again after feedback is the worker's call
(see The demo on the card).

### Turns that end without a handover

A turn that ends without `ask` or `ready_for_review` gets one nudge, then its last words become a
question to the owner; a turn that failed (an SDK error result, e.g. Claude not logged in) becomes
the error in words instead. A worker that then works on by itself takes that question back.

A turn that ends while the worker's own background work runs (a render, a test suite, a watcher) is
not such a turn: the work wakes the worker, so Obeya waits, also after the landing, where an ended
turn would otherwise finish the card and remove its workspace. The SDK reports each change in how
much background work runs; Obeya waits as long as some does, bounded by the work's own limits (two
hours for a background command, half an hour for a watcher; three hours for a session that never
says the work ended). It nudges only ten minutes after the work ended without a sign of life. A turn
in which the worker said and did nothing does not count: a session resumed after a restart first
ends a turn over what the previous one left, which would otherwise use up the nudge.

#### Usage limit

A turn the account's usage limit stopped (five-hour or weekly) is neither nudged nor a question. The
SDK's `rate_limit_event` says `rejected` and when the limit resets (API error `rate_limit`); without
the event, the message's „resets 7:20pm (Europe/Berlin)“ says when. The card's status line reads
„Nutzungslimit · weiter um 14:40“, and ten seconds after the reset Obeya tells the worker to go on
where it stopped (a limit that still holds is retried after a minute; one without a reset time
every 15 minutes). Meanwhile the worker is not busy: a restart need not wait for it, and a note
reaches it at once. Then its earlier status line is back. The conversation shows the limit as a line
where it happened, not folded into the next message. A worker stopped while taking in the owner's
words on its handover is still at them: the card does not wait for the owner. One whose background
work runs on stays busy and goes on at the reset without waiting for that work.

Every other agent waits the same way: look-ups, project agents, Question cards' and ideas' agents,
the reviser of a proposal, and the Koordinator's small jobs (naming and checking cards, the learner,
the Rückschau, the Arbeitsrückschau). The stopped turn is neither an error nor over; the owner's
words meanwhile wait for its next turn. Where the agent waits says until when: under a looked-up
question „Nutzungslimit · schlägt das um 19:20 von selbst nach“, on a card's face and in its bubble
„Nutzungslimit · weiter um 19:20“. After a restart they resume their work and wait anew; ending the
session (pausing the agent, parking the idea) ends the wait. Two do not wait: a demo page shared
without the worker's text (it takes the card's title and the summary's start) and the draft of a
wish, whose owner waits in the dialog (see Wishes for Obeya's makers). Obeya's chat: see
Confirmation and undo.

### Pausing an agent

A note reaches the worker at any time without stopping it. To stop it mid-work, the conversation's
bubble that shows the agent at work („Agent arbeitet …“) has a pause mark, faint until pointed at but
always visible (hover-only would hide it from newcomers and touch screens); by voice „halt mal an“.
The bubble and the pause exist exactly while an agent runs a turn (background work included): a
Question card's agent reading, an idea's agent replying, a worker in any card state (at work, taking
in the owner's words on its handover, in its PR, finishing after the landing). An idle agent (a PR
card waiting for review) has neither. The reviser of a proposal has no pause: its rework is short.

A worker's bubble also lists its background work under „Im Hintergrund“, each task as the agent
described it, with how long it has run, counting from when Obeya first saw it (the SDK gives no
start time); the SDK's own housekeeping does not show.

Pausing ends the session at once, mid-step if need be, with whatever it ran, and keeps the card's
state and the session. A worker keeps workspace and branch, frees its slot, and its app is parked
after the grace; one paused on its handover leaves the card waiting for approval („Demo bereit ·
Agent pausiert“), Freigeben included. An idea's or Question card's agent keeps what it had not
answered. The bubble stays where the agent stopped, in pencil grey, „Agent pausiert · ▶
Weitermachen“, over the line „Pausiert.“; a restart of Obeya leaves paused agents paused.

„Weitermachen“ (by voice „mach weiter“) or anything the owner writes resumes the same session; the
agent hears that it was paused and what ran was stopped (exit code 137), plus the owner's words and
what it had not answered. What Obeya had for a paused worker meanwhile (a review, a landing) goes
along then. „Stoppen“ stays in the card's action row: it ends the agent and plans the card again.

### Snoozing a card

A card can be set aside until a point in time, by its worker or by the owner. A worker can also
wait until another card is done (on main, or closed without a change) or waits for the owner (asks,
hands over, or is a proposal or an idea with questions), as a release waits for another card's fix.
Obeya holds the time and the card, not the agent's session. No other condition: waiting for CI
stays background work.

The worker calls `snooze` with `until`, or `card` (exact title, else a part only one open card's
title holds) with `state` `done` (default) or `waits_for_owner`, or both, waking at whichever comes
first, and ends its turn. A card already there or a time already past is refused. It takes effect
without asking the owner; the session ends, background work with it; workspace and branch stay, the
slot frees, the app is parked, and no nudge follows. It is allowed only while the card is at work
(started, in its PR, finishing after the landing); a question or handover in the same turn takes it
back. Its instructions send waits longer than a background command's two hours, and waits for
another card, to `snooze`; checkpoints are one snooze after another. Idea and Question cards' agents
have no such tool.

The owner snoozes with „Später …“ (a visible button with a clock in the action row; by voice „stell
das bis morgen früh zurück“): this evening 18:00 (while more than half an hour off), tomorrow 08:00,
next Monday 08:00, or a date and time. One menu serves every kind of card. It is offered on cards at
work, cards waiting for the owner, and planned tasks not yet with the Koordinator:

- A card at work stops as on a pause and goes on where it stopped at the time.
- A card waiting for the owner leaves „brauchen dich“, Tab and the phone's „Für dich“ and comes back
  at the time like a snoozed mail, with a push to the phone. Nothing goes to its agent; background
  work runs on. Answering it anyway (or parking the idea, reworking the proposal) ends the
  snooze.
- A planned card starts at the time as if the owner had started it, through the Koordinator's queue;
  its worker hears that the card was set to start then. „Starten“, „Jetzt zurückholen“ or „Alle
  starten“ on its project start it at once. An accepted proposal with a start time is such a card
  (see A proposal that starts later). A card no longer planned to start (made an idea or project,
  archived, started otherwise, its plan doc gone) is snoozed no longer, so it never starts unasked;
  a change to its plan doc leaves the snooze.

Waking is checked every 15 s, on every board change (so a card that only passes through the awaited
state counts) and at every start of Obeya; a time missed while Obeya was down or the machine slept is
caught up then, and a restart touches no snoozed card. A card wakes when its time comes, or its
awaited card got there or no longer will by itself (stopped, archived, removed, idea dropped). The
worker hears why and what for (and that the owner moved the time, if so); one the owner snoozed
hears that and that what ran was stopped. The owner's words or „Jetzt zurückholen“ wake it earlier,
as does, for a worker that snoozed itself, whatever Obeya has for it (a review, the landing, a failed
check); it hears what woke it (no words: the owner wants to know where things stand) and may snooze
again. For a worker the owner snoozed, such news waits. A question for the owner that arises
meanwhile (its PR closed, a tool call to allow) ends the snooze.

On the canvas a snoozed card is pushed back on greyed stock with a clock: „◷ Zurückgestellt bis
morgen, 00:05“ (or „bis „…“ erledigt ist“, with „spätestens …“ when it has a time too), with who
snoozed it and why. One waiting on another card shows that wait while the pointer is on either, as
a queued card does (see The queue's order). It counts neither as at work nor as needing the owner; on the phone it stands at
the end of its list. Its conversation shows a line where it was snoozed, carrying „Jetzt
zurückholen“ and „Ändern“ (the same menu, whoever snoozed it) while it lasts, and on waking a line
that says why it is back („Wieder da: Zeitpunkt erreicht“, „… von dir zurückgeholt“, …).

### Waiting without blocking

The SDK hands a waiting message to the agent only after its running tool call, so a note never cuts
a command off; workers therefore keep tool calls short, wait for anything external (a deploy, a CI
run) in the background (`run_in_background`, Monitor) and end their turn, which a note restarts at
once. Longer waits are a snooze.

A foreground Bash command that sleeps longer than 30 seconds (`sleep N`, an unbounded polling loop,
judged from the command line) is refused with that reason. `timeout N` (or `gtimeout`) bounds the
command it starts wherever it stands in the line. Heredoc text counts only when a shell runs it
(`bash <<EOF`, `ssh host <<EOF`). The refusal names two bounded waits that pass, one without
`timeout`, which macOS lacks.

### Refused and confirmed tool calls

A tool call refused without asking anyone (a deny rule, auto mode's classifier, the permission mode,
a hook, the foreground-wait refusal) stands in the card's conversation as a line („Nicht erlaubt
(Regel in den Einstellungen): $ …“), with the SDK's reason when it gives one.

A tool call the settings want confirmed (an `ask` rule, say for database writes) becomes, through the
SDK's `canUseTool`, the question the card waits on: the whole command, Claude Code's reason, options
„Erlauben“ and „Ablehnen“. The call waits within the worker's turn; meanwhile the worker counts as
waiting for the owner, so a restart need not wait for it. „Erlauben“ runs it (words with it reach the
worker next); „Ablehnen“, words alone or a note refuse it with the owner's words in the result.
Concurrent calls are asked one after another. A card that moves on without the answer (its PR merged,
a review card's PR closed) refuses the call with what happened, so the worker goes on instead of
waiting for a question no longer on the card. After a restart the question stays; answered then, an
allowed call runs once without asking when the resumed worker makes it again. It is no decision for
the project's log. Claude Code's `AskUserQuestion` is refused with a pointer to `ask`.

### Notes and replies

A worker answers a note or feedback with `reply`, saying what it changes or why nothing, and asks if
the note is unclear. The closing words of a turn in which it replied mostly repeat the reply (often
in English on a German canvas), so they fold under it as its last step, together with any steps in
between; closing words after a handover are left out. Words followed by a further step stay its
words.

A note while the card waits on the worker's question takes the question back: the card returns to
work (in its PR or after the landing, where it was), and the worker hears that its question is
withdrawn and asks anew if the note did not settle it. The note is no answer and goes into no
decision log. Words on a demo whose report asks a question answer it (see Waiting for approval).

### Questions go to the owner

A worker's question goes straight to the owner, with the worker's own pick; no other agent answers
for the owner. The worker asks only what it should not decide itself (product behaviour, trade-offs,
anything irreversible or external). What a project has decided reaches its workstreams' workers
instead: a worker's task holds its project's decision log ("Decisions taken in this project so far")
beside the plan doc pointer, and a decision recorded while it runs reaches it at its next tool call,
as a learned preference does. Older answers agents gave in the owner's name stay in the logs, marked
"(an agent)". Owner-facing text from agents is in the owner's language (see Language).

### Decisions

- **An agent's question is a first-class thing with answer options**, not prose: the owner answers
  with a click, own words always possible. The answer travels as text, so the conversation reads the
  same later and a spoken answer takes the same path.
- **Picks travel apart from the owner's words** (2026-10-15), so the worker can tell them apart.
  Rejected: the pick as the first line of the owner's words.
- **A worker's question goes straight to the owner, with the worker's own pick** (2026-10-07).
  Rejected: a project agent or the Koordinator answering and escalating only what it could not
  settle; the Koordinator then decided against building a feature, the owner's call, and an advisor
  knew barely more than the worker. Also rejected: narrower advisor rules, or an advisor that only
  suggests; the worker's pick gives the owner what a suggestion would.
- **Workers are told what happened, not what to do next**: they are full agents. Protocol stays where
  Obeya depends on it: `ready_for_review`, `ask`, `pr_opened`.
- **Words that reach a worker with the result of its turn-ending call leave it the turn**
  (2026-10-22). „End your turn now without further work“ beside the owner's note had the worker end
  it in silence; the note looked unheard until the answer to its question came. Rejected: holding
  the words back until the owner answers (the worker could take them in at once), and a rule to
  answer every note beside the instruction to stop, which contradicted it.
- **A status line belongs to the stretch of work it reports on** (2026-10-09), so a line from before
  a handover does not stand over later work.
- **Background work keeps a turn open** (2026-10-12). Rejected: ending a turn a fixed ten minutes
  after it ended, which cut off a worker watching a deploy after the landing.
- **A turn on the owner's words that the usage limit stopped is still at them** (2026-10-16).
  Rejected: counting it as answered, which made the card wait for the owner, stopped its app and
  never went on by itself; and folding the limit's note into the next message, which put it under
  the reply to words the owner wrote after the reset.
- **Look-ups, ideas and the other agents wait for the usage limit too** (2026-10-17), in one shared
  wrapper an agent joins, so an agent added later waits by joining it. Rejected: only workers and
  Obeya's chat waiting, which answered look-ups with the limit error, ended idea turns in it, failed
  proposal reworks and named cards after their text's start.
- **The pause sits on the bubble of the running turn** (2026-10-15), not in the action row: the row
  holds decisions about the card, pausing is about the turn now running, and the pause exists
  exactly when a turn runs (also while a worker takes in the owner's words on a waiting card, before
  a paid render, say). „Stoppen“ is named so it does not read like a pause. Rejected: pausing at the
  next safe point, as for a restart: the owner pauses an agent going the wrong way.
- **Waits of hours or days are a snooze Obeya holds** (2026-10-17). Rejected: workers keeping a turn
  open with chained background sleeps (the card looked busy for days and held a slot, every restart
  cut in, some 35 times a day, Obeya knew nothing of the reminders, and a night without network
  turned the midnight check into a stuck question); the agent only proposing a snooze for the owner
  to click (a click per checkpoint, while a snooze is undone with one); hiding only the restart
  noise; conditions besides a time or a card's state. German wording follows Gmail's
  „Zurückstellen“, which owners know.
- **A worker can snooze until another card gets somewhere** (2026-10-17): Obeya knows when that card
  lands, a guessed time means polling. The states are those another card's result shows in: done, or
  waiting for the owner. Rejected: any state change (each start, handover and approval would wake the
  worker); a wait the owner wires up (the worker knows what it waits for).
- **A question stands while background work keeps the turn open** (2026-10-16), with its options,
  since the card's header already says „Frage an dich“.
- **Refused and confirmed tool calls reach the card** (2026-10-09). Rejected: dropping the SDK's
  denials, and refusing `ask`-rule calls silently for lack of someone to ask.
- **Closing words fold under the message they repeat** (2026-10-09). Rejected: dropping them, or
  showing them as a second message after the reply.
