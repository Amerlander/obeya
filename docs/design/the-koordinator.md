## The Koordinator

A chapter of the [design doc](../design.md), whose header says how it is written.

Read-only SDK turns on the Lesestand of the card's repository (the home repository's without a
card), one decision at a time (its look-ups excepted, see Looked-up questions). It schedules the
cards, reads the owner's commands (see Commands to the Koordinator), looks things up, and learns the
owner's rules.

### Scheduling

Before a card starts the Koordinator estimates the files the card will change and judges whether
running it next to the cards in progress likely ends in merge conflicts. In a folder without git
(see Folders without git) it estimates the files and directories the card will touch and judges
whether it would get in the way of a card in progress: the same files changed, moved or deleted, a
directory reorganised that the other works in; working side by side in one directory does not
count. For a card in progress it sees its change list where a branch has its changed lines, and no
paths are soft. A card waits there as anywhere, and „Trotzdem starten“ starts it at the owner's own
risk. Cards queued before it
count too: a card likely to conflict with one of them waits behind it rather than overtaking it, and
once that one has started, until it has landed (fairer, at the cost of some parallelism). A card
judged again sees only the cards queued before it, so no two cards wait for each other.

For each card in progress it sees the estimated files and what the branch has changed so far: each
file with the changed line ranges and git's function context, for the first 200 files a branch
changes. git reads them for all cards in progress at once, without blocking the server. What a
branch has changed is measured from where it left the nearest branch that is not a card's (`obeya/…`,
other than its own): the main branch, or a long-lived branch the card was built on; where the main
branch was merged into the card's branch since, from the main branch. A card's branch that another
card was built on keeps its work, since card branches do not count. Sharing a file does not keep a card
waiting (additions in different places merge cleanly); the same lines or function, or code that one
card moves, renames or reformats while the other edits it, do. In doubt the card runs: a conflict
that happens anyway goes back to its worker on landing. Paths the settings mark as soft (`softPaths`, docs) do
not count.

A card likely to conflict waits, with the reason (one that starts says which files it shares and why
that is fine); once what it waits for has landed or stopped it starts, or, while other work runs
that may have started meanwhile, it is judged again — the owner can start it anyway.

A workstream started on its own also waits for the workstreams of its project it builds on (code,
an API, data or a decision one of them introduces, or the plan says it comes after it), judged from
the plan doc: those in progress, queued, and those the owner has not started (stopped ones too),
since the owner may start workstreams one by one to keep work from going on by itself. Such a wait
(`buildsOn` among `behind`) holds until the workstream it builds on has landed: taking that one out
of the queue or stopping it does not free the card, as it frees one waiting for a conflict. The card
says so ("Wartet auf W2 „…“ (noch nicht gestartet)", in its log, the queue's list and the project's
sheet), so the owner sees which workstream to start first; "Trotzdem starten" starts it anyway.
With nothing in progress and nothing queued it still starts at once only when no workstream of its
project is left unlanded. A card that waits for another, directly or through others, is not among
the cards that one sees as queued ahead or to build on, so no two cards wait for each other.

#### Waiting for a workspace

A card the Koordinator lets start while no workspace is free (all clones leased, or every free one
with uncommitted changes) waits for one in its place in the queue, shown as "Wartet auf Workspace"
with the reason, and starts by itself once one is free; cards queued after it count it as ahead of
them. Its reason on the open card ends in a link ("Anzahl der Klone ändern", "Anzahl der Slots
ändern" when slots are the limit) that opens the configuration at its repository's clone count or
slots (a repository in worktrees has only the slots), scrolled there and focused, since the owner
may not know the pool is the limit nor where it is set. Clones only free up with a change of the
board (stop, landing, a discarded prototype), so the Koordinator looks then; free clones found dirty
are looked at again after a minute at the latest.

A start that fails after the Koordinator took it drops the card back to planned; the unfolded
planned card then shows the last log entry, when it is an error, as the reason. A start that finds
no workspace is no failure but a wait. Cards left that way are picked up as waiting when Obeya
starts.

#### The queue's order

Cards whose turn comes together go in the order they came to the Koordinator, the one waiting
longest first. The owner sets the order where the waits leave it open (`src/core/queue.ts`): a
waiting card moves one place earlier or later ("Früher", "Später" on the card, which says its place,
and on its row in the queue's list) and swaps its place (`since`) with the card it passes. It does
not pass a card it waits for or one waiting for it, nor one the Koordinator is judging, since that
one's waits come from the cards ahead of it; nor does a card being judged move. Such a button stays
grey and says why when clicked; at the head or the end of the queue it is off. The new order counts
like the old one: who goes first once free, who gets a free workspace, and which cards count as
ahead when one is judged again.

While the pointer is on a card, the waits around it show over every step, both ways
(`src/ui/deps.ts`): the cards it waits for ("kommt zuerst"), those waiting for it ("wartet darauf"),
each with a ring and an arrow from the card waited for to the card waiting. A workstream not
delivered yet also waits for the open workstreams it builds on as read for its project's arrangement
(see A project arranged by its dependencies), started or not.

#### Starting a whole project

A project starts all its planned workstreams at once ("Alle N starten" in the project card's head,
"Alle N Workstreams starten" in its sheet, or by voice: start on the project): they queue in the
plan's order, wait 8 seconds in which "Rückgängig" takes the start back (the button is easily hit),
and then one Koordinator turn sees them together with the plan doc, the cards in progress and those
queued ahead. It puts them in an order and says for each what it waits for: a workstream it builds
on (until that one has landed, as above) or one it would likely conflict with; the rest start at once. A
workstream may wait only for what comes before it in that order, so none wait for each other, and
the order is the queue's from then on. The project's sheet names what each waiting workstream waits
for. When the turn fails, each is judged on its own as if started alone, seeing the others queued
after it to build on; after a restart the joint turn runs again.

### Learning the owner's rules

After whatever the owner says, the Koordinator decides whether a lasting preference was stated and
proposes it as a rule (the card's log says „Schlägt vor: …“), for the preference memory or, when it
is about a repository, for that repository's CLAUDE.md (for each repository of the canvas when it
holds in all of them; one proposal each); "Merk dir: …" by voice records a rule outright, sorted the
same way.

What it learns from: answers, notes and feedback to workers; an idea's discussion; the conversation
with it (a reply or look-up at once, with its reply; a command once its undo window has passed,
unless its words reach the learner another way, as a note or an idea's discussion do); and the text
the owner writes in a card, once they pause typing for a minute or act on the card, with the text it
had before (a proposal's, a follow-up's).

The learner reads an input with the card's text, what the owner said in the last three days (notes,
feedback and answers to agents, ideas' discussions, the conversation with the Koordinator; at most
30), the agent's last message before it (taken when the input arrives, not when the learner's turn
comes), the canvas's repositories, the active rules, the rules accepted for a CLAUDE.md, and the
open and rejected proposals. Its prompt names the signals for a proposal: phrased generally
("immer", "nie", "ab jetzt"), a correction of how an agent works, a repetition of something said
before; it makes at most one proposal per input.

#### The Rückschau

The Rückschau counts the owner's inputs: what the learner reads, and clicks without words in a card
(start, approve, accept or dismiss a proposal, park, start anyway, …), a deleted card, a command
taken back, a rule proposal decided on; a spoken command counts once, as what was said. The count
and when the history begins are settings of the canvas, so they survive a restart. At 20, after the
learner has read the input that completed the count, one read-only session in the home repository's
Lesestand reads what happened since the last Rückschau (at most the latest 300 lines): the cards'
milestones (the owner's notes, answers and clicks, the agents' questions and hand-overs, answers
given in the owner's name), the owner's words in ideas and to the Koordinator, taken back or not,
the cards they deleted or dismissed, and the rule proposals they accepted or rejected. It looks for
patterns seen at least twice on different cards and proposes up to three rules, each with a sentence
on what it rests on and, like the learner, for the preferences or a repository's CLAUDE.md; the
sheet shows that as their occasion („Aus der Rückschau: …“).

#### Proposals and rules in the sheet

Open proposals stand in the Koordinator's sheet (see The Koordinator's sheet) with their occasion
(the card and the owner's words, or the Rückschau), for a change the rule it changes, and where it
goes („Gehört in“: the preferences or the CLAUDE.md of a repository; `target` in `preferences`),
which the owner may switch. The owner accepts one, edits it before accepting, or rejects it; an
accepted change takes the place of its rule. Rejected proposals are kept (state `rejected` in
`preferences`), so the learner can see them. Values for a repository's settings the Arbeitsrückschau
proposes stand under the rules in the same section (see Setting proposals). The Koordinator button
counts open proposals (violet); they do not count among the cards that need the owner and do not
show on cards. The Koordinator gets the owner's rules, numbered, with every command, and follows
them itself too.

#### Rules for a CLAUDE.md

A rule accepted for a CLAUDE.md (state `filed`) goes into its repository's open card „CLAUDE.md
ergänzen“ (planned and not yet with the Koordinator; the setting `claude_md_card:<repo>` names it),
or into a new one when there is none; so does one the owner gives outright for a repository, by
voice or in the sheet's field for a new rule, which has the same „Gehört in“; its worker writes the
rules into the CLAUDE.md in the style of what is there. These cards start by themselves, through the
Koordinator like any start, once no proposal waits any more, whatever its place: a waiting one might
yet be switched to theirs, so several rules go in together. The card lands like any other (through a
pull request where work lands that way); until then the rule applies to no agent, and afterwards
through the CLAUDE.md alone.

### The Koordinator's sheet

Its sheet (button or `C`) gives the conversation with the Koordinator the height it has, with the
field to write in under it (the same as a card's, `src/ui/composer.tsx`: one frame as wide as the
conversation, the text growing with what is written up to 30 % of the window, the screenshot button,
the microphone that dictates into it (see Voice in) and Send in its bottom corner beside the text's
scrollbar). Opened with its button or `C`, the sheet puts the cursor in that field, so the owner
writes at once (the owner, 2026-10-19); opened with Tab, going through what needs the owner, it does
not, so the next Tab goes on to the next. Its placeholder shows in full, on two lines where it needs them: it often says what the
agent does with a message (the owner, 2026-10-17, after it had been cut off with „…“). Beside a short text the
three buttons stand side by side; once the text is about as high as the three on top of each other
(three lines on the phone), they stack in a narrow column, screenshot, microphone, Send from top to
bottom, and the text gets the width they free, about 55 px a line. Long dictated messages had kept
the narrow column beside the buttons on every line. Whether they stack is decided by the text's
height at the width it has beside the stack, whichever way they stand, so a text near the threshold
does not switch back and forth as the width changes with them. Below its cap the text box does not
scroll: its height was rounded, and the fraction of a pixel left over showed a scrollbar beside a
text that fit. Send is an arrow in a dark circle, as in chat apps, with what it does, „Senden“ or
„Antworten“, as its tooltip; only a button that starts something rather than sends keeps its words,
„Prototyp starten“.

Below that come sections that open and close, each a head with its count: the open proposals
(„Vorschläge (2)“, shown while there are any, open whenever a proposal came after the owner closed
them) and the preferences (always there, closed by default). Whether a section is open is kept per
canvas in the browser, so a reload keeps it. What runs is not listed there: the canvas shows it.

With no card open, the sheet shows the conversation, newest last, in all the height the sheet has;
an open section below takes from it down to 200px, and below that the sheet scrolls. Its messages
look like a card's (`Msg` and `Body` in `src/ui/message.tsx`, shared by both): the owner's on the
right, who and when above, the text as markdown (each line a paragraph, lists, tables, code, quotes
holding all of these in turn; the same parser as plan docs, `blocks` in `src/ui/markdown.tsx`), a
taken-back reply struck through. A web address in the text is a link, as a markdown link is, shown
without its `https://` and without the punctuation the sentence put after it; links keep the text's
ink with a faint line under it, and the pointer marks one like a highlighter.

### Arbeitsrückschau

Obeya looks back at how the workers worked, to make future runs cheaper (`src/server/work-retro.ts`,
`src/server/transcript.ts`): where a worker went wrong and corrected itself (a command with wrong
flags, a script that failed and was rewritten, a long search for how to start something), above all
the same detour on several cards. A feature of its own beside the Rückschau, with its parts (a
read-only reading session, a count in the canvas's settings, proposals on the usual way), but a
different source (the workers' transcripts, not the owner's words), beat (finished cards, not the
owner's inputs), place (the repository of the friction, not the home repository) and result (feature
cards and values for settings, not only rules). It runs in two stages.

#### Friction notes

When a card's work ends (landed, closed without a change, a prototype discarded or built, or a card
deleted with work not finished), Obeya draws an excerpt from the transcripts of its runs without a
model. The Agent SDK keeps a session's transcript at `<CLAUDE_CONFIG_DIR or
~/.claude>/projects/<cwd, non-alphanumerics as „-“>/<session id>.jsonl`, after the workspace has
gone too; Obeya looks there first and then in every directory, as the naming may change. A card's
runs are its `session_id` and the earlier ones in its log: a start from scratch (and a session that
replaces another) logs the session before as „Der frühere Lauf (Sitzung …) bleibt für die
Arbeitsrückschau erhalten.“

The excerpt holds the failed tool calls with their error (start and end, about 800 characters),
similar calls in a row (a failed one and its correction; a command three times or more), files
written whole more than once, the worker's words before and after each, and how many tool calls the
run took and after how many it first changed a file. Calls cut off by a restart (exit code 137) or
stopped by the owner do not count; subagents' lines are left out. A missing file or a format it
cannot read gives no excerpt and no error.

A short read-only session in the repository's Lesestand (a small job, see Models and effort) makes
0–3 friction notes of a non-empty excerpt (what went wrong, what it cost, what would have prevented
it), stored per repository and card in `friction`; an empty excerpt gets no session. It is told the
repository's settings a retrospective may propose (checks, setup, soft paths, „App für die Demo
starten“) as they apply now, so a worker working out what one would have said (how to start the app,
which checks to run) becomes a note whose fix names the setting and the value the run shows works.

#### The retrospective

Every 10 finished cards of a repository (counted when work ends, whether or not they had friction; a
card that never ran does not count; the setting `work_retro_cards:<repo>`), after the notes of the
card that completed the count, the retrospective runs. A new repository's first ones come sooner
(`WORK_RETRO_RAMP`): after its first finished card, then after 2 more and 4 more, then every 10, so
the owner does not wait long for the first improvements; the retrospectives a repository had are
counted (`work_retro_runs:<repo>`, the owner's own included).

The retrospective is one read-only session in that repository's Lesestand, so it sees its CLAUDE.md,
scripts and skills, reads the notes since the last one (`work_retro_since:<repo>`) card by card,
with the proposals of earlier retrospectives: those the owner dismissed, so it does not repeat them,
and those waiting or taken. It proposes at most three things, each resting on friction on at least
two cards (tags the tool checks):

- a feature card (a script, a skill, a fix to a tool) that waits as a proposal in a free spot, with
  a sentence on the cards it rests on (`retro` on the card, shown under the title as „Aus der
  Arbeitsrückschau: …“ and in its body; its state reads „Vorschlag von Obeya“ where a worker's
  proposal reads „Vorschlag eines Agenten“);
- a line for the repository's CLAUDE.md, which goes the way of the Rückschau's rules (a proposal for
  „CLAUDE.md von <repo>“, then the card „CLAUDE.md ergänzen“);
- a value for one of the repository's settings (`PROPOSED_SETTINGS`: `checks`, `setup`, `softPaths`,
  the app's `run`), for knowledge the workers each worked out themselves; its brief lists
  those settings as they apply now (this machine's and the repository's settings in front of Obeya's
  defaults, `settingsNow` in the canvas). Every handover brings a demo, so an empty „So läuft die App“
  is the usual case: each worker finds out how to run the app, and the retrospective proposes the
  recipe they arrived at.

Nothing is created silently and nothing starts by itself; skills of the user (`~/.claude/skills`)
are out of scope. The owner can ask the Koordinator for it at once („Mach eine Arbeitsrückschau für
den Shop“, the action `work_retro`): it reads the notes since the last one, the count starts again,
and the owner hears what came of it.

#### Setting proposals

A setting proposal (`setting_proposals`, one waiting per setting and repository) waits in Obeya's
sheet under „Vorschläge“ beside the rules, marked as what it is, a change to the configuration: a
cog and „Konfiguration ändern · <repo>“ over the setting's name, then the value now („Bisher“,
„(leer)“ where empty) above the new one („Neu“, a list one entry a line), the sentence it rests on
and the cards, each a link; „Zur Einstellung ↗“ beside the setting's name opens the configuration
dialog at that setting of the repository, folded open and marked (`ConfigFocus` with `settings`).
The Koordinator button counts it.

The new value stands in a field the owner may change right there (the line under it says so, and
once changed offers it „Wie vorgeschlagen“ again; the edit is kept per tab, so it outlives closing
the sheet and a reload). The owner takes what stands in the field with one of two buttons, neither
preselected: „Auf diesem Rechner“ sets it in this machine's settings (`Config.takeSetting` through
`Config.save`, applying at once), „Für alle ins Repository“ puts this value alone into
`.obeya/settings.json` the way „Für alle ins Repository übernehmen“ does (see Repository settings):
committed on the main branch where work lands there, this machine's own value for that setting then
going so the repository's applies here too; as a pull request otherwise, the value set on this
machine meanwhile (it goes once the merge brings the file, `takenOver`). A line under the buttons
says what each does; a notice says where the value went (with the pull request's link). „Verwerfen“
keeps it as rejected, and the next retrospective hears what became of each.

### Looked-up questions

A question that needs reading ("Was würde der Agent hier machen, wenn ich starte?", what the plan
says, how something works) the quick turn does not answer: it acknowledges it ("Ich schaue im Plan
nach.") and passes it on. A question about a project or one of its workstreams goes to the project
agent, in the project's session; any other to a thorough Koordinator turn on the card's repository.
Both have the tools a worker has, in the workers' permission mode (`auto` unless `--permission-mode`
says otherwise): the shell, gh, the web, files outside the repository. So they check what the text
alone does not say (which render in a directory is newest, whether a script ran, what a GitHub
release holds, a CI run) instead of answering that they cannot see it. A call the settings want
confirmed is refused, as there is no card to ask the owner on. The quick reading of a command stays
read-only, so it answers in seconds; what needs checking it passes to the look-up.

A question about the work of an agent on a card (also one waiting for review: „Ist sichergestellt,
dass …?“) is not looked up but goes to that agent, as a note or as feedback: its work is on its
branch, not in the Lesestand the look-up reads, and the card shows the agent at work while it
answers. `look_up` on such a card is refused with that hint (asked with the card open, the words
went to that agent anyway). Both get the question, the card's state and log, and the task its worker
gets at the start (`Workers.startBrief`), from which, the plan doc and the repository's instructions
they derive the worker's steps.

The answer comes 10–30 s later: written above the mic wherever the owner is (its start), in full in
the log of the card that was open, else in the Koordinator's sheet; what the agent reads shows on
the open card meanwhile. An answer in the sheet waits there unread (`unread` in `talk`) until the
owner has the sheet in view (open, the page not hidden): until then Obeya's button counts the unread
answers in orange, the colour of everything that waits for the owner, Obeya counts once in "brauchen
dich" and in the canvas's count in the switcher (`waitingOn`), and Tab goes there too, after the
cards that need the owner. The answers that waited keep an orange edge until the sheet closes; one
that comes while the sheet is in view is read as it comes, without the edge. An answer on a card's
log is read there and does not wait in the sheet. The quick turn's own reply waits the same way when
it only answers (no actions, nothing looked up; also the reply that the words could not be read): a
long answer takes the quick turn 20 s and more, and the owner may close the sheet or go to another
canvas meanwhile. Until 2026-10-19 only looked-up answers waited, and such a reply came unmarked,
with nothing on Obeya's button. A confirmation of actions does not wait: the canvas shows what it
did, and its line above the mic carries „Rückgängig“.

The Koordinator hears the answer with the next command, in full as the owner saw it (a card it
offers at the end is one "ja" away), and it is part of its stored memory. A question still open at a
restart is looked up again.

### Looked-up threads

A look-up starts a thread, and the owner can go on with it (`src/server/answers.ts`). The
Koordinator knows each answer by a tag (`A12`, the exchange's id) in what it hears of it and in its
memory; when the owner's words follow up on one („und im Oktober?“, „mach mir ein Excel daraus“),
`look_up` names it in `follows` (in doubt the newest). The follow-up then resumes the session of the
agent that found that answer (its id stands on the exchange in `talk`), which still has all it read
and computed; a project's questions go on in its project agent as before. Turns of one thread queue,
so two never run in one session at once. A session that cannot be resumed (its transcript gone) is
replaced by a fresh agent that gets the first question's context and the thread so far. The
follow-up stands under the owner's words with „↳ setzt fort: „…““ (and „liest …“ while it is looked
up), so the owner sees which answer Obeya took it for; its answer stands in the sheet or the open
card's log as any.

A turn that ends while the agent's background work runs (a download, a long query) is no answer
(`inform` in `src/server/advisor.ts`): the look-up goes on reading, in the sheet or on its Question
card, until that work wakes the agent and it answers. Should the work never wake it, its last words
are the answer after all, with the same limits as for a worker (three hours while it runs, ten
minutes after it ended). Until 2026-10-19 a look-up's turn took its words so far („still
downloading …“) as the answer and closed the session, which stopped that work. Ideas and look-ups
wait for that work alike (`BackgroundWait` in `src/server/runtime.ts`), and so do the owner's words
meanwhile: on a Question card they go into the waiting session at once (see Question cards).

#### Files with an answer

Every thread has an output directory outside every repository, `~/.obeya/answers/<canvas>/<thread>/`
(never in git, like demos), named in each turn's message and given to the agent as a directory of
its own (`additionalDirectories`): files the owner asks for or that help go there (a spreadsheet of
the numbers, a chart or page, the queries and scripts behind them, a draft as a document; no list of
types), and `answer_owner` passes them with `files` (path and a one-line caption). A path outside
the directory, or no file, is refused and the agent asked again. Under its text the answer shows
them, in the sheet, a card's log and a Question card alike (`AnswerFiles` in `src/ui/message.tsx`):
a page in the sandboxed frame of an HTML artifact (same CSP, key, height report), an image inline, any
other file as a chip that opens it with the system's app (`open`, `explorer.exe`, `xdg-open` on the
machine Obeya runs on, and only from a page there; where that fails, or from another device, the browser downloads it; a file that is no document, a
`.command` or `.bat` the agent wrote, say, is shown selected in its folder instead, as opening it
would run it), with ↓ to download, and „Im
Ordner zeigen“ for the directory. A follow-up writes into the same directory, so it builds on the
files already there.

#### Question cards

Every looked-up answer has „Als Karte“ in its head, always in view: the thread moves onto a
**Question card** (`kind: 'question'`), next to the card whose log held it or where there is room,
its question as the title, its exchanges (the owner's words, the answers with their files and times)
as its conversation, the same session going on. While the card is on the canvas, the sheet keeps a
line „Auf der Karte „…““ in place of each of its answers, which opens the card; once it is archived
(„Erledigt“) or deleted, the answers stand in the sheet again, each with „Als Karte“. A follow-up
asked in the sheet afterwards goes to the card's agent and stands on the card.

On the card the owner's words go straight to that agent (`CanvasRuntime.tell` → `ask`, the shared
conversation, Send and unsent input), words that come while it reads go in with its next turn
(unread until then, and the owner can take them back), and it passes on with `to_obeya` what asks Obeya; a note the Koordinator passes to the card goes there
too. It holds answers, not work: its state is `done`, but it has a look of its own (a white card
with a blue-grey edge, „FRAGE“), shows the number of answers and files and whether its agent reads,
is not taken by „Erledigte archivieren“, and has no brief and no build, plan, prototype or park
buttons. It has two: „Als Idee besprechen“ (not while its agent reads) makes it an idea (`task` in
state `idea`) whose exploration agent starts afresh from the thread and its directory, and
„Erledigt“ archives it. „Als Karte“ on a thread already moved opens its card, back from the archive
if need be. The Koordinator lists Question cards among the cards it sees.

While its agent's turn waits for its background work (a download, a long query, see Looked-up
threads), the owner's words go into that session at once, read, as an idea's do, together with what
waited since the turn began; its answer answers them too, so „stop that, take 2023 instead“ reaches
it while the download runs. Words that come once it works again, or once that work ended and is about
to wake it, wait as before; a session that fails after it heard them hands them to the fresh one. Until 2026-10-19
they waited, unread, until the job finished and the agent had answered the question before.

#### Asking in a project's sheet

A project's sheet has a section „Projekt-Agent“ under its workstreams: the conversation with its
project agent and the shared field under it (text, screenshots, microphone, Send), with a hint of
what the agent knows while nothing has been asked yet. Until 2026-10-21 the project agent was reached
only through Obeya (a question Obeya looked up), which the owner did not find from the project
(a colleague's feedback). Words written there go straight to the project agent as a question
(`consult` on the project, `Answers.askProject`), not through the Koordinator's quick turn: an
exchange of `talk` with `askedIn` set to the project, the words as its question, and no reply of
Obeya's. It is looked up like any question about the project, in the project's session, with the
screenshots, and the agent has `to_obeya` for what the words ask of Obeya („starte W4“), which the
Koordinator reads with the project open, as from a card. A reply to a message there follows up on
that message's thread; other words start a thread of their own, all in the one session of the
project agent, so it still knows what it was asked before.

The sheet shows every thread the project agent answers: asked there, or asked of Obeya about the
project or one of its workstreams (`ProjectHistory.talk`), each answer with „Als Karte“, which moves
its thread onto a Question card beside the project. Obeya's sheet shows the exchanges asked in a
project's sheet too, with a line naming the project („im Projektblatt „…“, an den Projekt-Agenten“),
so an answer that comes once the owner has left the project waits there unread as any. With the
sheet in view (not reading its plan doc) the answers in it are read (`talk/read` with their ids), and
the notice of one gets no line above the microphone (`Notice.project`). The conversation has no
scrollbar of its own: it grows in the sheet, which follows what the owner asks and an answer that
comes while the field is in view.

### Koordinator memory

The owner's commands go to one ongoing Koordinator session per canvas, one after the other, so it
understands "die andere auch" or "nein, die von vorhin". It sees a card's open question, also one in
a demo report, so "ja" to it is an answer, not an approval. Card tags (`K1`, …) stay fixed for the
session. Each command brings the cards as they are now and what happened since the previous one
(state changes, questions, answers, hand-overs, the owner's notes, errors, new cards; not the
workers' steps); a command the owner took back is told with the next. Every exchange is stored
(`talk`), requests agents passed on included, with the owner's words.

A session that fails while reading a command (an error result, which the SDK also reports as a
`success` with `is_error`) is replaced by a fresh one for the same command; should that fail too,
the owner hears the reason („Ich konnte das nicht lesen. Claude ist auf diesem Rechner nicht
angemeldet: …“), not „nicht verstanden“. A session is not resumed: after a restart, and after 30
commands so the context stays short, a fresh one starts from memory: the last 20 exchanges and the
canvas's last 14 days (at most 60 steps), with times. Of the answers it looked up, the newest five
come in full, older ones clipped to 400 characters.

### Wishes for Obeya's makers

The owner tells Obeya's makers what is missing or broken from inside Obeya, as an issue on GitHub
that they submit themselves under their own account (`src/ui/wish.tsx`, `src/server/wish.ts`,
`src/core/wish.ts`). The repository is fixed, sadilek/obeya: the app runs without a checkout whose
`origin` could name another.

Four ways lead to the draft, a dialog over the page: the quiet link „Wunsch oder Fehler melden“ (with
„Entwurf offen“ beside it while a draft waits) under „Einrichtung prüfen“ at the foot of the
Konfiguration dialog's list of sections, the same link under the legend's sections, words to Obeya
(„Obeya, Feedback: …“, „Sag den Entwicklern von Obeya …“: the action `wish`, which opens the draft
at once with what was said, without an undo window, since it sends nothing), and the link under a
reply that says Obeya cannot do what the owner asked. The bar gets no icon of its own: it would
stand there always for something used rarely. Obeya's sheet had the link at its foot until
2026-10-17; it took a line of its own there (the owner).

The dialog's field is the shared composer (text, screenshots, microphone). What the owner writes or
says there a small job (`chores`, read-only, in a temporary directory) writes up as a title and a
body in English, the repository's language, adding nothing they did not say; a body that stands
already is reworked with the new words. The body ends with one line about this Obeya: its version,
the system, and `app`, `checkout <commit>` or `binary`. Nothing from cards, repositories, paths or
the conversation goes in unless the owner wrote it, or it is the request Obeya could not do and its
answer. Without a written issue (not logged in, say) the owner's own words stand in the draft, with
a line that says so. When it was the usage limit, the line says when Obeya writes the draft by itself
(„Das Nutzungslimit ist erreicht: Obeya schreibt den Entwurf um 19:20 von selbst …“), and the page
does that once the limit lifts, after a reload too (the draft keeps the words); a draft the owner
edits meanwhile stays as they made it. Title and body stand editable, exactly as they go out, above the line that the
issue appears publicly on GitHub under the owner's account.

„Auf GitHub öffnen ↗“ opens GitHub's page for a new issue, prefilled (`issues/new?title=…&body=…`),
in a new tab, which the app's shell hands to the system's browser on every platform. Screenshots
cannot travel in the link: the dialog says to paste them there, and the click puts the first on the
clipboard (as PNG). The link stays under 8000 characters: a longer body is cut, with a line at the
cut, and without a screenshot waiting there the whole body goes on the clipboard. Then the draft is
gone, and the dialog says what is on the clipboard. Until then the draft (title, body, screenshots)
is kept per tab and canvas like every input, and so is what stands in its field. A wish that comes
while a draft with something of the owner's in it stands (text in its body, screenshots) does not
replace it: at the top of the dialog, above that draft, stand the words the new one is to be written
from and the offer to discard the draft and write the new one; opening the draft on GitHub writes
the new one too. A draft with nothing more than a title gives way at once (until 2026-10-19 it held
the new wish back too, and the owner, who saw only that draft open with a line below it, took the
wish for lost). The draft remembers the wish it was written from, so the link under that reply opens
it again as it stands rather than offering to replace it with itself.

The Koordinator's `reply` carries the flag `wish` when it says Obeya cannot do what the owner asked
because Obeya has no such feature: not when it is unclear what they mean, when something failed just
now, when a request does not fit a card's state, or for a question of fact (a look-up is never
flagged). A flagged reply, in the sheet or on the card that was open, shows „↗ Als Wunsch melden“
under its text, which opens the draft with what the owner asked and what Obeya answered; on a card
such an answer stands in the conversation rather than folding away with the confirmations. The
exchange keeps what the draft starts from (`talk.wish`, `events.wish`). An agent that passed the
owner's words on through `to_obeya` gets the answer with a note that the owner finds that link under
it; for `wish` the page opens the draft from the notice that reaches it. `commands.test.ts` checks
the flag's way through, `commands.live.test.ts` the judgement against the real model on both sides
of the line.

### Decisions

- **Wishes go out as a prefilled GitHub issue the owner submits** (2026-10-16), under their own
  account, with Obeya holding no token. Rejected: posting through gh (it publishes with only Obeya's
  preview as the check), a hosted endpoint of Obeya's (a service to run, spam, a privacy notice),
  and mail (attachments by hand, and it exposes an address). Obeya offers it itself as a link under
  its reply that it cannot do something, rather than never (nobody would learn where Obeya falls
  short) or by collecting such requests under „Vorschläge“ (late, and without their context). The
  action is called `wish`, since `feedback` is feedback on a card's work.
- **The Koordinator waits on a card for a step it announced** (2026-10-18). Until then it said
  „once the repository is there, I'll add the canvas“ when it started a task that creates a
  repository, and nothing came: no turn of its runs without words of the owner's, who had to say
  „Task done.“ for the canvas to come. Rejected: having it promise nothing it cannot take by itself
  (the owner asked for both in one breath, and would have to come back for the second); a
  follow-up card whose worker adds the canvas (configuration is the Koordinator's, with its check
  and undo, and the worker would have to pass it back to Obeya anyway); waiting for any condition
  other than the two a worker waits for on another card, which cover what a card's result shows in.
- **A card waits rather than risking a collision**; the Koordinator's estimate is taken once, before
  the start, and a waiting card is checked again against what runs when its blockers finish.
- **A new card does not overtake a queued one it likely conflicts with**: it queues behind it, also
  when that one waits for something far from done. Fairness over parallelism; the owner can still
  start it anyway.
- **A card waiting to start stays full size and takes notes** (2026-10-16). Before, an accepted
  proposal shrank to a planned card's panel (900 px wide, scrolling past 480 px) while Obeya checked
  it, with its text alone and no field: what the owner thought of meanwhile waited until the agent
  ran. Spoken words still go to the Koordinator there, since „trotzdem starten“ and „aus der
  Warteschlange“ are what is said to a waiting card, and no agent is there yet to pass them on.
- **A card's change list is its own work, read without blocking** (2026-10-21, GitHub issue #2).
  Until then each card in progress was diffed in full against the main branch, one after the
  other on the server's thread, every time a card started. Eight cards built on a feature branch
  766 commits ahead of `master` each counted that whole branch as theirs (2,566 files, 1.3 million
  lines of `-U0`, 30–70 s per card on Windows), and every canvas showed „Keine Verbindung zum
  Server“ for minutes. The judge reads a few dozen files of a branch anyway.
- **A start that finds no workspace is a wait, not a failure** (2026-10-05): before, such a card
  stood as "Geplant" with "Kein Workspace frei" as its last failure and never started by itself,
  though the owner had started it.
- **The owner reorders the queue with buttons that move a card one place**, not by dragging
  (2026-10-08): the waits fix part of the order, and a button can say at the card where they stop
  it, where a drag would only fail on dropping. Only cards with a decision move, and none passes one
  being judged: its turn reads the cards ahead of it, and a card moved behind it could otherwise end
  up waiting for a card that waits for it.
- **A project's workstreams started together are scheduled in one Koordinator turn** rather than
  started one after the other through the single-card check (2026-10-02): workstreams of a plan
  often build on each other, which a check for merge conflicts alone does not see, and only a turn
  that sees all of them and the plan doc can choose the order. The workstreams that wait then go the
  usual way: they start once what they wait for has landed, judged again against what runs.
- **Learned rules are proposals the owner accepts first**, rather than stored silently as at first
  (2026-10-02): the owner wants to see every learned rule before it applies. Open proposals count on
  Obeya's button only, not among the cards that need the owner nor on the cards. The Rückschau runs
  after about 20 inputs, neither daily nor only on request.
- **Preferences hold only how agents work with the owner through Obeya**; rules about a repository,
  taste in code that holds in every repository included, go into its CLAUDE.md (2026-10-02). At
  first the learner drew no line, and repository facts landed among the preferences, unversioned and
  unseen by colleagues and by Claude Code outside Obeya. Rejected: not learning repository rules
  (what the owner says would be lost), preferences scoped to a repository in the database
  (unversioned, invisible outside Obeya), the Koordinator committing to the CLAUDE.md on accept (it
  only reads, and where work lands through PRs nothing goes to `main` directly). Accepted ones
  collect in one card per repository that starts once no proposal waits, so several go in together
  without the owner starting it. A rule the owner says outright („Merk dir: …“) or writes in the
  sheet is sorted the same way and filed at once, without a proposal (2026-10-02): at first it
  always became a preference, so repository rules said outright still landed there.
- **The Arbeitsrückschau learns from the workers' transcripts, in two stages** (2026-10-05): an
  excerpt drawn without a model when a card's work ends, made into a few friction notes, and a
  retrospective over the notes of about ten cards in the repository's checkout. Rejected: building
  it into the Rückschau (the card log's tool lines have no results, and source, beat, place and
  result all differ), the worker reporting its own detours at the hand-over (patchy, and it makes
  every hand-over longer), and raw transcripts in the retrospective (far too much context). It runs
  on its beat and on the owner's word; its results are proposals in the repository of the friction,
  never cards created or started silently.
- **The Arbeitsrückschau proposes values for a repository's settings too** (2026-10-15), once demos
  were required by default and workers kept working out how to start the app. They wait in Obeya's
  sheet beside the rules rather than as cards on the canvas: taking one is a click, no work for an
  agent. Where the value goes is the owner's choice each time, this machine or the repository for
  everyone, with neither as a default; for everyone it is that one value, not all this machine set.
  Rejected: workers' hand-over summaries saying how they ran the app (longer summaries for the
  owner, for something the friction notes carry with their fix), and proposing the landing, the main
  branch or where workers work, which are the owner's choices rather than knowledge friction shows
  missing. The owner asked for the proposal to show plainly that it changes the configuration
  (2026-10-15), hence its head, the link into the dialog, and the value edited in place (until then
  an „Ändern“ button opened it, and the owner could not tell what it did). The retrospective's ramp
  for a new repository (after 1, 2 more and 4 more cards) came with it: at 10 cards from the start,
  the first improvements came late.
- **The sheet's conversation looks like a card's** (2026-10-09). Until then the sheet showed a log
  of its own (time and name in a column of monospace, the answers' markdown as raw lines), and Send
  stood beside the field as a button with its word, and an icon lay over the scrollbar. Until
  2026-10-10 messages knew only paragraphs and bullet lists, and an agent's table showed as raw
  lines of `|`; until 2026-10-12 a quote, in a message or a plan doc, ran its lines together into
  one paragraph and showed its lists and code as raw text; until 2026-10-15 a bare address was plain
  text.
- **Look-ups have a worker's tools** (2026-10-12): until then they were read-only (Read, Grep, Glob)
  and answered that they could not see what they could have checked. Until 2026-10-09 the
  Koordinator heard only the first 1500 characters of an answer, and asked back when the owner said
  yes to a card offered further on.
- **A look-up is a thread with files** (2026-10-14). Until then the look-up agent was one-shot: a
  follow-up went to a fresh agent that got only the owner's words and the card, and started over;
  and an answer was markdown only, and the agent ran in the Lesestand, where files would have been
  left as uncommitted changes nobody saw.
- **The Koordinator's memory lives in the store, not in the agent session**: a session is never
  resumed, and a new one (restart, or a long session) starts from the stored conversation and the
  cards' history. That keeps the context short over weeks, and restart and renewal are one path. The
  card history is part of it, because the owner asks about progress over time ("was ist seit gestern
  passiert?") and refers to cards by what happened to them.
