## Ideas

A chapter of the [design doc](../design.md), whose header says how it is written.

An idea is thought through on its card before anything is planned; no worker runs.

### Starting an idea

"Ich will über Export für Vermieter nachdenken" (voice or typed), or "Als Idee besprechen" on a
planned card of the owner's that nobody has worked on, makes a card in state `idea`, and its
exploration agent opens the discussion right away: with what the owner said, or with what the card
says, which stays at the top of the conversation as its starting point ("Ausgangspunkt").

Such a planned task offers its ways on in one row: "Agent starten", "Als Idee besprechen" and "Als
Projekt planen", each with a tooltip saying what follows the click, and "Löschen" set apart at the
right end, as in every button row with it. "Als Projekt planen" does on the task what it does on an
idea (see Deciding): a worker writes a plan doc from the task's title, text and screenshots on the
task's card („Aufgabe → Projekt“), the decision log says so, and once the doc has landed the project
takes the task's place, the task going to the archive (by voice: `plan_doc`, „plane das als
Projekt“). The mark that a card becomes a project is a column of its own (`becomes_project`), not
part of the idea's JSON. A card that was being cut into packages by the former "Aufteilen" when
Obeya stopped is planned again.

### The discussion

The unfolded idea is a conversation with its exploration agent: a session on the repository's
Lesestand (code, plan docs, the decision log, the preferences) resumed for every message, days later
too. Should that session be gone (Claude prunes old ones, after weeks), a new one starts with where
the idea stands: the brief, the titles of its mocks, the prototypes planned, the latest six of those
built (running or ended, with their summaries), the part marked to split off and the latest twenty
messages of the conversation, in the order the agent read them, so it goes on from there instead of
writing the brief afresh (until 2026-10-20 it heard only the card's title and text). An idea its agent
has not taken up yet (a new one, a Question card just turned into one) starts without it. It has a worker's tools in the workers' permission mode, so what the discussion depends on
beyond the text (the git history, file dates, a release or CI run with gh, the web) it checks
instead of guessing. What it does itself starts no work. It asks back, shows variants with their
trade-offs and says what they would cost.

Its questions come with answer options, shown under its reply as radio buttons, or checkboxes when
several fit together; the owner picks, may add their own words, and both go out as one message that
names each question. The questions stand in the conversation as the agent's messages, like a worker's;
while they wait for the owner they stand at its end, where they are answered, and once answered (or
while the agent works on a reply, which may settle them) they stay where they were asked, the options picked ticked on them, the alternatives beside, and the owner's
message under them holds only their own words; one the owner's words passed over shows how it ended,
settled or asked again (see The conversation) (until 2026-10-20 an answered question stood only as a
bold line of the owner's message, without the alternatives). The owner types in the panel or holds Space with the idea open; both go
straight to the agent, as on every card an agent listens on (see Voice in), spoken words as soon as
the speech recognition has written them down (picked options too, with the words beside them). The
agent passes on with `to_obeya` what asks Obeya for something (build it, plan it, a prototype, park,
drop, anything about another card). The reply stands in the panel. What the agent read and thought
on the way to a reply folds away under that reply ("Verlauf"), for whoever wants to follow it. A turn
that ends while the agent's background work runs (a download, a watcher) does not hand the idea to
the owner: it shows the agent at work, with its words so far (a reply that it waits for the work
among them), until that work wakes it and it goes on, and what the owner says meanwhile goes to it at
once. Should the work never wake it, its last words are the reply after all, with the same limits as
for a worker (three hours while it runs, ten minutes after it ended).

With every reply the agent also says what it would do in the owner's place: the option it would pick
for each of its questions ("Würde ich nehmen", with why), and the next step ("Nächster Schritt, wenn
der Agent entscheiden müsste": answer first, build, split off a task, plan, prototype, park or
drop, with why). The card marks that click (the suggested button instead of "So bauen", the picked
options), and the canvas card says it short ("Tipp: Prototyp"); the owner follows or overrules it,
and the suggestion goes with their next message. Each suggestion is a button on the card: answering
needs questions to answer, splitting off a task a task marked for it, and a suggestion without them
is none. The agent's instructions say what each step does to the rest of the idea (building ends the
conversation and drops its prototypes, planned and running; splitting off a task keeps the idea, its
conversation and its prototypes; planning keeps the prototypes for the workstream that builds on
them), so it does not recommend a click for what the click does not do.
The voice Koordinator reads it too, so "mach, was du vorschlägst" takes that step (said to the
Koordinator, or to the agent, which passes it on).

Once the agent has replied, the open idea needs the owner like a waiting card ("Idee · du bist
dran", badge, counted in "brauchen dich") until they answer, park, drop or decide it.

### The brief

The agent keeps the brief ("Stand der Idee") on top of the card: goal, open and dropped variants,
decisions, open questions, effort. The conversation is the means, the brief the result: whoever
opens the card later reads the brief. The two stand side by side and never say the same: findings,
variants and questions go into the brief, and a reply only carries the turn (what changed in the
brief, which open question is next).

A variant that is something to look at (a layout, a dialog) comes with a mock: a few lines of HTML
the agent passes with the brief (`update_brief`'s `mocks`, one per variant, with its title; left
out, the mocks stay) or, for something the brief has no place for, with its reply. The card shows
each in the frame of a worker's HTML artifact (sandboxed, scripts in an origin of their own, nothing
loaded from the internet; see The demo on the card), sized
to its content, the brief's side by side under it. A worker who builds the idea or a prototype of it
gets the brief's mocks as HTML after the brief.

### Prototypes

A prototype ("Prototyp bauen lassen"), when talking is not enough: a worker builds a throwaway one
in its own workspace, on a card of its own below the idea, and records a demo. Several may run side
by side, one per approach; each carries its approach in its title ("Prototyp: Logo – Wortmarke", the
first words of what the owner asked it to show).

When the brief plans prototypes of several variants, the agent also passes them to Obeya
(`plan_prototypes`: per variant a few words and what its prototype shows); "Prototyp bauen lassen"
then offers them as checkboxes, each chosen unless its prototype runs already, beside a field for an
approach of the owner's own, and starts one worker per variant at once, its title the variant's
words and its task that variant only. Spoken without words, it starts the planned variants that have
none running; without planned variants, an empty field is the idea as it stands.

The idea shows the demos of all its prototypes, each under its title, and its exploration agent
hears what each found. While one is built, the idea no longer needs the owner; the agent's reply to
the result of the last one built makes it their turn again. A reply meanwhile (to something the
owner said, to an earlier prototype's result) gives them the turn only when it asks them something:
otherwise they still wait for the prototypes, and a prototype that has handed over needs them on its
own card. A prototype's worker asks on its own card, and the questions
with the owner's answers also go to the exploration agent, which takes them into the brief without
replying, so the idea does not ask them again. It makes no cards: instead of `propose_card` it has
`propose_build`, a proposal on its card to build the idea on it.

A prototype never lands itself and does not count for collisions. It ends in one of two ways, and
either way its card goes into the archive with log, demo and summary ("Prototyp · verworfen" or
"Prototyp · gebaut"), never to come back: a new attempt is a new prototype. "Verwerfen" (also
approving or deleting it) throws its workspace and branch away, whatever its state; "Diesen Prototyp
bauen" (or accepting its worker's proposal) builds the idea on it, see Deciding.

### Deciding

"So bauen" makes the brief the card's task and starts it at once, through the Koordinator like
"Agent starten" (it waits only if it would likely conflict with running work).

"Diesen Prototyp bauen", on a prototype, does the same on that prototype's branch: its workspace and
branch (renamed for the idea) become the idea's, whose worker hears that the branch holds a
throwaway prototype, to take over what carries and bring it to production quality (tests, checks,
docs, shortcuts removed), with the prototype's handover and the owner's answers on it. The decision
log says "So bauen, auf Prototyp „…“". Either way the idea's other prototypes are discarded, so one
card remains.

"Als Projekt planen" starts a worker on the idea's card the same way, which keeps its title and
shows as "Idee → Projekt": it writes a plan doc with workstreams, which lands like any change (a PR,
say). The project then takes the idea's place on the canvas (cards it would cover move aside, by as
much as it outgrows the idea) and links back to it; the idea goes to the archive once its worker is
done (put back, it stays). The idea's prototypes stay on the canvas, each still naming its idea, and
the plan doc's worker hears what each showed (its handover, or that it is still being built), so the
doc builds on them instead of planning them again; only the workstream that builds on the chosen
prototype mentions prototypes. While the doc is written, "Diesen Prototyp bauen" waits for the
project; once it stands, the button builds that workstream (the one nobody has started that mentions
prototypes; the owner picks another, or picks one where the doc names none or several), and it is
built on the prototype's branch as an idea would be ("Auf Prototyp „…“" in the project's decisions),
its worker told to take the workstream from the plan doc; the idea's other prototypes are discarded.

"Teilaufgabe abtrennen" ("Split off a task"), when part of the idea is settled and part still open
(the game logic of an app settled, its pictures still to be prototyped): the agent marks the settled
part (`plan_split`: its title and a brief that stands on its own as a worker's task, the whole value
each time, empty when there is none any more), and only then does the button show, next to "So
bauen", with that task folded under the brief ("Teilaufgabe zum Abtrennen: „…“"). The click makes
that part a task of its own beside the idea, in its group and linked to it, with the screenshots the
owner showed in the discussion and a line after it saying it is the settled part of the idea and the
open part is not its, and starts it through the Koordinator like "So bauen" (by voice: `split_off`).
The decision log records it on the idea ("Teilaufgabe abtrennen: „…“"). The idea stays open with its
conversation, its agent and its prototypes, planned and running; the split is cleared, and the agent hears that the part is now that task, trims
the brief to what is open and replies. "So bauen", "Diesen Prototyp bauen" and "Als Projekt planen"
work on the idea later as before. It is not a second way to break work up beside the plan doc: it
only separates what is settled from what is open, always into one task and the remaining idea.

"Parken" and "Verwerfen" leave the card with its brief; talking to it opens it again. A parked or
dropped idea can be archived ("Archivieren" in it or its archive button on the canvas, as on a finished card; not
while a prototype of it is on the canvas, and then the button is not shown): in the archive it shows
its brief and conversation read-only and can go back to its place, where talking to it opens it
again. Decisions from the conversation go into the decision log; lasting preferences are learned by
the Koordinator as before.

### While the agent replies

While the agent works on a reply, planning waits (so do "Teilaufgabe abtrennen" and "Diesen
Prototyp bauen"): the buttons are disabled with "Antwort kommt gleich", and the server refuses them
(`ideaThinking`). The reply almost
always rewrites the brief, so a plan taken before it would start from a brief the owner never read.

"So bauen" does not wait: clicked during a reply, the idea is built once the agent has answered all
it was told, with the brief it leaves, unless its reply asks questions; then nothing is built, the
conversation says why, and the owner decides again. The panel stays open while it waits: the button
reads "Baut nach der Antwort …" with "Doch nicht bauen" beside it, and the canvas card says "baut
nach der Antwort". The agent hears of the click with its next step, as the brief it leaves becomes
the task. A turn that ends without a reply (an error, a restart), parking or dropping call the
building off too.

Asked to plan such an idea, or to build its settled part (`split_off`), while its agent works on
a reply (by the agent, which passes the owner's words on, or in the Koordinator's sheet along with
talk to the idea), the Koordinator says that it goes by a click once the reply is there; asked to build it ("nimm noch X auf und bau es
dann"), it builds after the reply, like the click.

Parking and dropping act at once and end the turn, but lose nothing: the messages the agent has not
answered (the one it worked on and those queued behind it) stay with the idea (`unread`, across
restarts) and go to it first, with why its turn ended, when the conversation goes on. The same holds
for a turn that ended with an error, and for messages queued when Obeya stopped.

### Decisions

- **A discussion lives on a card, not in the conversation with the Koordinator**: an exploration
  parked on the canvas is found there again with its brief, and the Koordinator only passes the
  owner's words on. A question to Obeya that asks for an opinion or a way forward („Was meinst du,
  was wir da jetzt machen sollen?“, „Wie sollten wir … angehen?“) becomes an idea card at once, with
  the owner's words and screenshots, and its exploration agent opens the discussion, when no agent
  on the open card takes it (2026-10-09): a wrong guess costs one card, taken back with
  „Rückgängig“. Questions of fact and look-ups stay in the conversation.
- **A big idea becomes a project through a worker writing its plan doc**, not through the
  exploration agent, which discusses and does not build. That worker runs on the idea's own card and
  starts with the decision, and the project replaces the idea on the canvas (2026-10-02): a separate
  planned "Plan-Doc" card in between had to be started by hand and left the idea standing next to
  its project.
- **One way to break work up: the plan doc** (2026-10-12). Until then a planned task's row read
  "Agent starten · Aufteilen · Erst besprechen · Löschen", which said little about what follows, and
  "Aufteilen" had the Koordinator cut the card into 2–6 packages that replaced it. Aufteilen went:
  it was a second way to break work up beside the plan doc, and "Alle starten" on a project already
  plans which workstreams run in parallel.
- **The exploration agent has a worker's tools** (2026-10-12): until then it was read-only (Read,
  Grep, Glob) and answered from the text what it could have checked.
- **Prototypes stay cards of their own, and several may run for one idea** (2026-10-02): parallel
  approaches are to be seen side by side, not hidden inside the idea. The one that convinces is not
  thrown away and rebuilt from `main`: the idea is built on its branch, so its commits go into the
  branch's history, and the worker's brief has to keep prototype quality from landing as it is. A
  discarded prototype keeps its demo, log and summary in the archive but not its code.
- **Planned variants become one prototype each** (2026-10-05): three clicks with an empty field had
  started three prototypes of the same brief, which planned three variants.
- **Planning an idea takes its prototypes along** (2026-10-06): before, planning left the prototypes
  behind unmentioned: the plan doc planned them again as workstreams, and once the idea was
  archived, building on one failed with a 400.
- **"Teilaufgabe abtrennen" builds the settled part and keeps the idea** (2026-10-18). An idea's
  agent had
  recommended "So bauen" with "start the two picture prototypes alongside it", which no button did:
  building turned the idea into a task and dropped the planned prototypes without a word. Two other
  ways were weighed. Restricting the agent to the steps there were gave a correct but clumsy route
  (prototypes first, then a plan doc, the settled part waiting); one button for "build and start the
  prototypes" was dropped because building ends the idea the prototypes belong to. Since then every
  suggested step is a button, and the agent's instructions say what each does to the rest of the idea.
  It was first called "Fertiges bauen", which suggested the part was finished rather than settled.
- **"So bauen" does not wait for the agent's reply** (2026-10-06): the last answer of a session is
  often clear and simple, and the owner knows that building comes next.
- **Mocks in a field of their own** (2026-10-05): an idea's agent shows how a variant looks as a
  mock beside the brief and the reply, not as HTML in their Markdown: the agent writes no artifact
  files, the Markdown renderer stays without HTML, and the owner sees simple options without having
  a prototype built.
- **A project links the idea it came from** by what the idea's landed work added to the plan
  directory, not by title or time, and shows the decisions of both.
