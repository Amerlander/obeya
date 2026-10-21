## Ideas

A chapter of the [design doc](../design.md), whose header says how it is written.

An idea is thought through on its card before anything is planned; no worker runs.

### Starting an idea

"Ich will über Export für Vermieter nachdenken" (voice or typed), or "Als Idee besprechen" on a
planned card of the owner's that nobody has worked on, makes a card in state `idea`. Its exploration
agent opens the discussion at once, with what the owner said or what the card says; that stays at
the top of the conversation as its starting point („Ausgangspunkt“).

A planned task offers its ways on in one row, each with a tooltip saying what follows: „Agent
starten“, „Als Idee besprechen“, „Als Projekt planen“, and „Löschen“ set apart at the right end.
„Als Projekt planen“ does on the task what it does on an idea (see Deciding): a worker on the task's
card („Aufgabe → Projekt“) writes a plan doc from its title, text and screenshots, and once the doc
has landed the project takes the task's place and the task goes to the archive (by voice:
`plan_doc`, „plane das als Projekt“).

### The discussion

The unfolded idea is a conversation with its exploration agent: a session on the repository's
Lesestand (code, plan docs, decision log, preferences), resumed for every message, days later too.
If the session is gone (Claude prunes old ones), a new one starts with where the idea stands
(brief, mocks, prototypes, the part marked to split off, the latest messages) and goes on from there.
It has a worker's tools and permission mode, so it checks what the discussion depends on (git
history, a CI run, the web) instead of guessing; nothing it does starts work. It asks back, shows
variants with their trade-offs and says what they would cost. It passes on with `to_obeya` whatever
asks Obeya for something (build, plan, a prototype, park, drop, anything about another card).

Its questions come with answer options, radio buttons or checkboxes when several fit together; the
owner picks, may add words, and both go out as one message naming each question (how answered and
passed-over questions show: see The conversation). The owner types in the panel or holds Space with
the idea open; both go straight to the agent (see Who hears the words). Its reply stands in the
panel, what it read and thought on the way folded under it („Verlauf“). A turn that ends while its
background work runs does not hand the idea to the owner: it shows the agent at work until the work
wakes it, the owner's words reach it at once, and the limits are a worker's (see Turns that end
without a handover).

With every reply the agent says what it would do in the owner's place: the option it would pick for
each question („Würde ich nehmen“, with why) and the next step (answer first, build, split off a
task, plan, prototype, park or drop, with why). The card marks the suggested button and options, the
canvas card says it short („Tipp: Prototyp“), and the suggestion goes with the owner's next
message. Every suggested step is a button that exists: answering needs open questions, splitting off
a task needs one marked. The agent's instructions say what each step does to the rest of the idea
(building ends the conversation and drops its prototypes, planned and running; splitting off keeps
the idea, conversation and prototypes; planning keeps the prototypes for the workstream that builds
on them), so it never recommends a click for what the click does not do. „Mach, was du
vorschlägst“, to the Koordinator or the agent, takes that step.

Once the agent has replied, the open idea needs the owner like a waiting card („Idee · du bist
dran“, counted in „brauchen dich“) until they answer, park, drop or decide it.

### The brief

The agent keeps the brief („Stand der Idee“) on top of the card: goal, open and dropped variants,
decisions, open questions, effort. The brief is the result whoever opens the card later reads;
the conversation never repeats it: a reply only carries the turn (what changed in the brief, which
question is next).

A variant that is something to look at (a layout, a dialog) comes with a mock: a few lines of HTML
passed with the brief (`update_brief`'s `mocks`, one per variant with its title; left out, the
mocks stay) or, for something the brief has no place for, with the reply. The card shows each
sandboxed like a worker's HTML artifact (see The demo on the card), sized to its content, the
brief's side by side under it. A worker who builds the idea or a prototype of it gets the mocks as
HTML after the brief.

### Prototypes

„Prototyp bauen lassen“, when talking is not enough: a worker builds a throwaway prototype in its own
workspace, on a card of its own below the idea, and records a demo. Several may run side by side,
one per approach, each titled with it („Prototyp: Logo – Wortmarke“).

When the brief plans prototypes of several variants, the agent passes them to Obeya
(`plan_prototypes`: per variant a few words and what its prototype shows). The button then offers
them as checkboxes, each ticked unless its prototype runs already, beside a field for an approach of
the owner's own, and starts one worker per variant, its task that variant only. Spoken without
words, it starts the planned variants that have none running; without planned variants, an empty
field means the idea as it stands.

The idea shows the demos of all its prototypes, and its agent hears what each found. While one is
built the idea does not need the owner; the agent's reply to the last result makes it their turn
again, and a reply meanwhile does so only when it asks them something. A prototype's worker asks on
its own card; the questions with the owner's answers also go to the exploration agent, which takes
them into the brief without replying, so the idea does not ask them again. A prototype's worker
makes no cards: instead of `propose_card` it has `propose_build`, a proposal to build the idea on
it.

A prototype never lands and does not count for collisions. It ends in the archive with log, demo and
summary („Prototyp · verworfen“ or „Prototyp · gebaut“), never to come back; a new attempt is a new
prototype. „Verwerfen“ (also approving or deleting it) throws its workspace and branch away;
„Diesen Prototyp bauen“ (or accepting its worker's proposal) builds the idea on it (see Deciding).

### Deciding

„So bauen“ makes the brief the card's task and starts it through the Koordinator like „Agent
starten“ (see Scheduling).

„Diesen Prototyp bauen“ does the same on that prototype's branch: its workspace and branch become
the idea's, and the worker hears that the branch holds a throwaway prototype, to take over what
carries and bring it to production quality (tests, checks, docs, shortcuts removed), with the
prototype's handover and the owner's answers. The decision log says „So bauen, auf Prototyp „…““.
Either way the idea's other prototypes are discarded, so one card remains.

„Als Projekt planen“ starts a worker on the idea's card, shown as „Idee → Projekt“: it writes a plan
doc with workstreams, which lands like any change. Its project (the doc the landed work added to the
plan directory) then takes the idea's place on the canvas (cards in its way move aside), links back
to it and takes over its decisions, showing those of both; the idea goes to the archive once its
worker is done (put back, it stays). A task planned as a project is linked the same way. The
prototypes stay on the canvas and the plan doc's worker hears what each showed, so the doc builds on
them; only the workstream built on the chosen prototype mentions prototypes. „Diesen Prototyp bauen“
then builds that workstream (the owner may pick another, and picks one when the doc names none or
several) on the prototype's branch and discards the other prototypes; while the doc is written, it
waits.

„Teilaufgabe abtrennen“, when part of the idea is settled and part still open (an app's game logic
settled, its pictures still to be prototyped): the agent marks the settled part (`plan_split`: a
title and a brief that stands alone as a worker's task; the whole value each time, empty when there
is none any more). Only then does the button show, next to „So bauen“, with that task folded under
the brief. The click makes it a task of its own beside the idea, in its group and linked to it, with
the discussion's screenshots and a line saying the open part is not its, and starts it like „So
bauen“ (by voice: `split_off`); the decision log records it. The idea stays open with its
conversation and prototypes; the agent trims the brief to what is open and replies. It is not a
second way to break work up beside the plan doc: always one task and the remaining idea.

„Parken“ and „Verwerfen“ leave the card with its brief; talking to it opens it again. A parked or
dropped idea can be archived (in it, or its archive button on the canvas; not while a prototype of
it is on the canvas, and then the button is not shown): in the archive it shows its brief and
conversation read-only and can go back to its place. Decisions from the conversation go into the
decision log; lasting preferences are learned by the Koordinator (see Learning the owner's rules).

### While the agent replies

While the agent works on a reply, „Als Projekt planen“, „Teilaufgabe abtrennen“ and „Diesen
Prototyp bauen“ wait: the buttons are disabled („Antwort kommt gleich“) and the server refuses them.
The reply almost always rewrites the brief, so a plan taken before it would start from a brief the
owner never read.

„So bauen“ does not wait: clicked during a reply, the idea is built once the agent has answered all
it was told, with the brief it leaves, unless the reply asks questions; then nothing is built, the
conversation says why, and the owner decides again. Meanwhile the panel stays open, the button reads
„Baut nach der Antwort …“ with „Doch nicht bauen“ beside it, and the canvas card says „baut nach
der Antwort“. The agent hears of the click, as its brief becomes the task. A turn that ends without
a reply (an error, a restart), parking or dropping call the building off.

Asked meanwhile to plan or split off, the Koordinator says that goes by a click after the reply;
asked to build („nimm noch X auf und bau es dann“), it builds after the reply, like the click.

Parking and dropping act at once and end the turn but lose nothing: the messages the agent has not
answered stay with the idea, across restarts, and go to it first, with why its turn ended, when the
conversation goes on. The same holds after a turn that ended with an error and for messages queued
when Obeya stopped.

### Decisions

- **A discussion lives on a card, not in the conversation with the Koordinator** (2026-10-09): an
  exploration parked on the canvas is found there again with its brief, and the Koordinator only
  passes the owner's words on. A question to Obeya asking for an opinion or a way forward becomes an
  idea card when no agent on the open card takes it (see Commands to the Koordinator); a wrong
  guess costs one card, undone with „Rückgängig“. Questions of fact stay in the conversation.
- **A big idea becomes a project through a worker writing its plan doc on the idea's own card**
  (2026-10-02), not through the exploration agent, which discusses and does not build. Rejected: a
  separate planned "Plan-Doc" card in between, which had to be started by hand and left the idea
  standing beside its project.
- **One way to break work up: the plan doc** (2026-10-12). Rejected: „Aufteilen“, the Koordinator
  cutting a card into packages that replaced it, a second way beside the plan doc; „Alle starten“ on
  a project already plans which workstreams run in parallel.
- **Prototypes are cards of their own, several per idea** (2026-10-02), so parallel approaches are
  seen side by side. The one that convinces is not rebuilt from `main`: the idea is built on its
  branch, its commits stay in the history, and the worker's brief keeps prototype quality from
  landing as it is. A discarded prototype keeps demo, log and summary in the archive, not its code.
- **Planned variants become one prototype each** (2026-10-05). Rejected: the field alone, where
  three empty clicks started three prototypes of the same brief.
- **Planning an idea takes its prototypes along** (2026-10-06). Rejected: leaving them unmentioned,
  where the plan doc planned them again and building on one failed once the idea was archived.
- **„Teilaufgabe abtrennen“ builds the settled part and keeps the idea** (2026-10-18), and every
  step the agent suggests is a button whose effect on the rest of the idea its instructions spell
  out. An agent had recommended „So bauen“ plus starting two prototypes, which no button did: building
  dropped the planned prototypes. Rejected: restricting the agent to the existing steps (a correct
  but clumsy route, the settled part waiting), and one button to build and start the prototypes
  (building ends the idea they belong to).
- **„So bauen“ does not wait for the agent's reply** (2026-10-06): the last answer of a session is
  often clear and simple, and the owner knows that building comes next.
- **Mocks in a field of their own** (2026-10-05), beside the brief and the reply. Rejected: HTML in
  their Markdown; this way the agent writes no artifact files, the Markdown renderer stays without
  HTML, and the owner sees simple options without a prototype.
- **A project links the idea it came from** by what the idea's landed work added to the plan
  directory, not by title or time.
