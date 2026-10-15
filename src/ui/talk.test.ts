import { expect, test } from 'bun:test';
import { type CardEvent, formatQuestion, pausable } from '../core/types';
import { agentWorks, demoHandover, koordinatorReads, ownerField, parseQuestion, split, talkAlone, talkTurns, withoutOpen } from './talk';

let id = 0;
const ev = (kind: CardEvent['kind'], author: CardEvent['author'], text: string): CardEvent => ({ id: ++id, cardId: 'c', at: '2026-10-01T10:00:00Z', kind, author, text });

test("an idea's conversation folds the agent's steps under the reply they led to", () => {
  const owner = ev('talk', 'owner', 'Was meinst du?');
  const read = ev('activity', 'explorer', 'Liest server/board.ts');
  const thought = ev('say', 'explorer', 'Das Archiv nimmt keine Projekte auf.');
  const decided = ev('state', 'explorer', 'Entscheidung: Format? → CSV');
  const reply = ev('talk', 'explorer', 'Varianten ergänzt. Zwei offene Fragen, siehe Stand.');
  const err = ev('error', 'obeya', 'kaputt');
  const restart = ev('state', 'obeya', 'Neu gestartet');
  const again = ev('talk', 'owner', 'Und weiter?');
  const reading = ev('activity', 'explorer', 'Liest ui/detail.tsx');
  const { shown, pending } = talkTurns([owner, read, thought, decided, reply, err, restart, again, reading]);
  expect(shown).toEqual([
    { e: owner, steps: [] },
    { e: reply, steps: [read, thought, decided] },
    { e: err, steps: [], line: true },
    { e: again, steps: [] },
  ]);
  expect(pending).toEqual([restart, reading]);
});

test('a turn without reply does not show its last words twice', () => {
  const thought = ev('say', 'explorer', 'Ich lese nach.');
  const last = ev('say', 'explorer', 'Dann ein Plan-Doc.');
  const reply = ev('talk', 'explorer', 'Dann ein Plan-Doc.');
  expect(talkTurns([thought, last, reply]).shown).toEqual([{ e: reply, steps: [thought] }]);
});

test("a task's conversation: the owner's words, the worker's replies and handover; state changes as lines, the rest folded", () => {
  const started = ev('state', 'obeya', 'Agent gestartet auf obeya/export.');
  const read = ev('activity', 'worker', 'Liest server/export.ts');
  const status = ev('report', 'worker', 'Export steht');
  const note = ev('hint', 'owner', 'Bitte auch Excel.');
  const reply = ev('talk', 'worker', 'Mache ich: Excel kommt dazu.');
  const session = ev('state', 'obeya', 'Neue Sitzung. Frühere Sitzung: abc');
  const edit = ev('activity', 'worker', 'Ändert server/export.ts');
  const review = ev('review', 'worker', 'CSV und Excel exportierbar.');
  const approved = ev('state', 'owner', 'Freigegeben und auf main.');
  const { shown, pending } = talkTurns([started, read, status, note, reply, session, edit, review, approved]);
  // the steps before the worker read the note close above it
  expect(shown).toEqual([
    { e: started, steps: [], line: true },
    { e: read, steps: [read, status], quiet: true },
    { e: note, steps: [] },
    { e: reply, steps: [] },
    { e: review, steps: [session, edit] },
    { e: approved, steps: [], line: true },
  ]);
  expect(pending).toEqual([]);
});

test('a note the worker did not reply to is answered by the first words it says after it', () => {
  const read = ev('activity', 'worker', 'Liest server/export.ts');
  const note = ev('hint', 'owner', 'Bitte auch Excel.');
  const edit = ev('activity', 'worker', 'Ändert server/export.ts');
  const ok = ev('say', 'worker', 'Verstanden, ich baue Excel ein.');
  const later = ev('say', 'worker', 'Excel ist drin, die Tests laufen.');
  const review = ev('review', 'worker', 'CSV und Excel.');
  expect(talkTurns([read, note, edit, ok, later], {}).shown).toEqual([
    { e: read, steps: [read], quiet: true },
    { e: note, steps: [] },
    { e: ok, steps: [edit] },
  ]);
  expect(talkTurns([read, note, edit, ok, later, review]).shown.at(-1)).toEqual({ e: review, steps: [later] });
  // words from before anything was said to the worker are no reply
  expect(talkTurns([ev('say', 'worker', 'Ich lese mich ein.'), read]).shown).toEqual([]);
});

test('the owner\'s words stand where the agent read them: its steps before close above them, what it has not read stands apart', () => {
  const read = ev('activity', 'worker', 'Liest server/export.ts');
  const note = ev('hint', 'owner', 'Bitte auch Excel.');
  const edit = ev('activity', 'worker', 'Ändert server/export.ts');
  const test_ = ev('activity', 'worker', 'Führt bun test aus');
  const later = ev('hint', 'owner', 'Und PDF?');
  // read with the result of the edit
  const taken = { ...note, readAfter: edit.id };
  const after = ev('activity', 'worker', 'Ändert server/pdf.ts');
  const talk = talkTurns([read, taken, edit, test_, { ...later, unread: true }, after]);
  expect(talk.shown).toEqual([
    { e: read, steps: [read, edit], quiet: true },
    { e: taken, steps: [] },
  ]);
  expect(talk.pending).toEqual([test_, after]);
  expect(talk.unread).toEqual([{ ...later, unread: true }]);
  // two read at the same step stand in the order said
  const both = talkTurns([read, { ...note, readAfter: edit.id }, edit, { ...later, readAfter: edit.id }]).shown.map((x) => x.e.id);
  expect(both).toEqual([read.id, note.id, later.id]);
  // on an idea, words read when its next turn starts stand after the reply they waited for
  const asked = ev('talk', 'owner', 'Was meinst du?');
  const thinking = ev('activity', 'explorer', 'Liest docs/design.md');
  const more = ev('talk', 'owner', 'Und die Kosten?');
  const reply = ev('talk', 'explorer', 'Zwei Varianten im Stand.');
  expect(talkTurns([asked, thinking, { ...more, readAfter: reply.id }, reply]).shown.map((x) => x.e.id)).toEqual([asked.id, reply.id, more.id]);
});

test("a worker's closing words after its reply or handover fold under it, also once nobody works on the card", () => {
  const review = ev('review', 'worker', 'CSV exportierbar.');
  const after = ev('closing', 'worker', 'Übergeben; die Karte wartet auf die Freigabe.');
  const note = ev('hint', 'owner', 'Welche Spalten?');
  const read = ev('activity', 'worker', 'Liest src/export.ts');
  const reply = ev('talk', 'worker', 'Sorte, Menge, Mindestbestand.');
  const closing = ev('closing', 'worker', 'Ich habe die Frage beantwortet: Sorte, Menge, Mindestbestand.');
  for (const over of [false, true])
    expect(talkTurns([review, after, note, read, reply, closing], { over })).toEqual({
      shown: [
        { e: review, steps: [after] },
        { e: note, steps: [] },
        { e: reply, steps: [read, closing] },
      ],
      pending: [],
      unread: [],
    });
});

test('a spoken note stands once; the Koordinator confirms in the steps and answers what it looked up in the conversation', () => {
  const said = ev('say', 'owner', 'Sag ihm, er soll auch Excel können.');
  const confirm = ev('say', 'koordinator', 'Geht an den Agenten.');
  const note = ev('hint', 'owner', 'Sag ihm, er soll auch Excel können.');
  const asked = ev('say', 'owner', 'Wie weit ist das?');
  const looking = ev('say', 'koordinator', 'Ich schaue nach.');
  const found = ev('say', 'koordinator', 'Der Export steht, Excel fehlt noch.');
  const reply = ev('talk', 'worker', 'Excel kommt dazu.');
  expect(talkTurns([said, confirm, note, asked, looking, found, reply]).shown).toEqual([
    { e: note, steps: [] },
    { e: asked, steps: [] },
    { e: found, steps: [] },
    { e: reply, steps: [confirm, looking] },
  ]);
});

test('a conversation nobody works on ends with its last message or line, the steps without a message where they happened', () => {
  const review = ev('review', 'worker', 'Gesprächsverlauf steht.');
  const approved = ev('state', 'owner', 'Freigegeben und auf main.');
  const landed = ev('state', 'obeya', 'Nach der Freigabe auf main gelandet.');
  const restart = ev('state', 'obeya', 'Neustart von Obeya angekündigt; der Agent pausiert beim nächsten sicheren Punkt.');
  const err = ev('error', 'obeya', 'API Error: 529 Overloaded');
  const events = [review, approved, landed, restart, err];
  // while the agent works, its steps wait for its next message
  expect(talkTurns(events).pending).toEqual([restart]);
  // once it is over, what only Obeya noted goes
  expect(talkTurns(events, { over: true })).toEqual({
    shown: [
      { e: review, steps: [] },
      { e: approved, steps: [], line: true },
      { e: landed, steps: [], line: true },
      { e: err, steps: [], line: true },
    ],
    pending: [],
    unread: [],
  });
  // the agent's last words in a turn without a message are its message, before the line that came later
  const read = ev('activity', 'worker', 'Liest docs/design.md');
  const done = ev('say', 'worker', 'Die Änderung ist auf main. Es ist nichts mehr offen.');
  const retro = ev('state', 'koordinator', 'Arbeitsrückschau, Reibung notiert.');
  expect(talkTurns([review, approved, landed, restart, read, done, retro], { over: true }).shown.slice(3)).toEqual([
    { e: done, steps: [restart, read] },
    { e: retro, steps: [], line: true },
  ]);
  // a turn the agent ended without words stands as its steps
  const edit = ev('activity', 'worker', 'Ändert server/export.ts');
  expect(talkTurns([review, restart, edit, err], { over: true }).shown).toEqual([
    { e: review, steps: [] },
    { e: edit, steps: [restart, edit], quiet: true },
    { e: err, steps: [], line: true },
  ]);
  // the steps that led to the question the card waits on stay with it
  const q = ev('question', 'worker', 'Auch PDF?');
  const asked = talkTurns([read, q, restart], { asking: { text: 'Auch PDF?', options: [] }, over: true });
  expect(asked.asked).toEqual({ e: q, steps: [read] });
  expect(asked.pending).toEqual([restart]);
});

test('questions carry their answer; a note instead of an answer settles one; the open one stands apart', () => {
  const q1 = ev('question', 'worker', formatQuestion({ text: 'CSV oder Excel?', options: ['CSV', 'Excel'] }, 'de'));
  const a1 = ev('answer', 'owner', 'CSV');
  const q2 = ev('question', 'worker', 'Welches Trennzeichen?');
  const note = ev('hint', 'owner', 'Nimm, was Excel öffnet.');
  const work = ev('activity', 'worker', 'Ändert server/export.ts');
  const q3 = ev('question', 'worker', formatQuestion({ text: 'Auch PDF?', options: ['Ja', 'Nein'] }, 'de'));
  const events = [q1, a1, q2, note, work, q3];
  const { shown, asked } = talkTurns(events, { asking: { text: 'Auch PDF?', options: ['Ja', 'Nein'] } });
  expect(shown).toEqual([{ e: q1, steps: [], answer: 'CSV' }, { e: a1, steps: [] }, { e: q2, steps: [], settled: true }, { e: note, steps: [] }]);
  expect(asked).toEqual({ e: q3, steps: [work] });
  // a question answered on the owner's behalf is no longer open, whatever the card says
  expect(talkTurns([...events, ev('answer', 'project', 'Nein')], { asking: { text: 'Auch PDF?', options: [] } }).asked).toBeUndefined();
  // a card from before notes took questions back still waits on its question after a note
  const old = talkTurns([q2, note], { asking: { text: 'Welches Trennzeichen?', options: [] } });
  expect(old.asked).toEqual({ e: q2, steps: [] });
  expect(old.shown).toEqual([{ e: note, steps: [] }]);
});

test('a question reads back from the log with its options', () => {
  expect(parseQuestion(formatQuestion({ text: 'Welche Spalten?', options: ['Datum', 'Stand'], multiple: true }, 'de'))).toEqual({ text: 'Welche Spalten?', options: ['Datum', 'Stand'] });
  expect(parseQuestion(formatQuestion({ text: 'Which columns?', options: ['Date', 'Reading'], multiple: true }, 'en'))).toEqual({ text: 'Which columns?', options: ['Date', 'Reading'] });
  expect(parseQuestion('Weiter so?')).toEqual({ text: 'Weiter so?', options: [] });
});

test("why an idea clicked to build was not built stands after the agent's reply", () => {
  const owner = ev('talk', 'owner', 'Nimm den Ton aus dem Styleguide.');
  const armed = ev('state', 'owner', 'So bauen, sobald die Antwort da ist; fragt der Agent noch etwas, wird nicht gebaut.');
  const reply = ev('talk', 'explorer', 'Wo liegt der Styleguide?');
  const why = ev('state', 'obeya', 'Nicht gebaut: Der Agent hat noch eine Frage.');
  expect(talkTurns([owner, armed, reply, why]).shown).toEqual([
    { e: owner, steps: [] },
    { e: armed, steps: [], line: true },
    { e: reply, steps: [] },
    { e: why, steps: [], line: true },
  ]);
});

test('a card has one field for the owner, and under a demo with a question it takes the answer and feedback together', () => {
  expect(ownerField({ state: 'working' })).toBe('note');
  expect(ownerField({ state: 'live', finishing: true })).toBe('note');
  expect(ownerField({ state: 'waiting', need: 'question', question: { text: 'A oder B?', options: [] } })).toBe('answer');
  expect(ownerField({ state: 'waiting', need: 'review' })).toBe('feedback');
  expect(ownerField({ state: 'waiting', need: 'demo' })).toBe('feedback');
  expect(ownerField({ state: 'waiting', need: 'demo', question: { text: 'Welche Stimme?', options: [] } })).toBe('demo');
  expect(ownerField({ state: 'done' })).toBeNull();
  // a finished card an agent worked on: what the owner asks resumes that agent
  expect(ownerField({ state: 'live', branch: 'obeya/x' })).toBe('note');
  expect(ownerField({ state: 'done', branch: 'obeya/x' })).toBe('note');
  expect(ownerField({ state: 'live', branch: 'obeya/x', archivedAt: '2026-10-08T10:00:00Z' })).toBeNull();
  expect(ownerField({ state: 'live', branch: 'obeya/x', prototypeOf: 'idea' })).toBeNull();
});

test('ideas, proposals and tasks an agent worked on with a result share the layout with the conversation beside', () => {
  const demo = { chapters: [] };
  expect(split({ state: 'idea' })).toBe(true);
  expect(split({ state: 'proposal' })).toBe(true);
  expect(split({ state: 'waiting', branch: 'obeya/x', demo })).toBe(true);
  // the demo stays when the owner sends the agent a message
  expect(split({ state: 'working', branch: 'obeya/x', demo })).toBe(true);
  expect(split({ state: 'inPr', branch: 'obeya/x' })).toBe(true);
  expect(split({ state: 'working', branch: 'obeya/x', brief: 'Kurz' })).toBe(true);
  expect(split({ state: 'planned' })).toBe(false);
  expect(split({ state: 'done' })).toBe(false);
});

test('a task an agent works on shows its conversation alone until there is a result', () => {
  expect(talkAlone({ state: 'working', branch: 'obeya/x' })).toBe(true);
  expect(talkAlone({ state: 'waiting', branch: 'obeya/x' })).toBe(true);
  expect(talkAlone({ state: 'done', branch: 'obeya/x' })).toBe(true);
  expect(talkAlone({ state: 'working', branch: 'obeya/x', demo: { chapters: [] } })).toBe(false);
  expect(talkAlone({ state: 'working', branch: 'obeya/x', brief: '' })).toBe(true);
  expect(talkAlone({ state: 'planned' })).toBe(false);
  expect(talkAlone({ state: 'idea' })).toBe(false);
});

test('the conversation ends with the agent at work exactly while its agent works on something, whatever the card\'s state', () => {
  const task = { kind: 'task' } as const;
  // a worker in a turn: at work, taking in the owner's words on its handover, on its pull request, after the landing
  expect(agentWorks({ ...task, state: 'working', inTurn: true })).toBe(true);
  expect(agentWorks({ ...task, state: 'waiting', inTurn: true })).toBe(true);
  expect(agentWorks({ ...task, state: 'inPr', inTurn: true })).toBe(true);
  expect(agentWorks({ ...task, state: 'live', inTurn: true })).toBe(true);
  // idle: its pull request waits for review, or it waits for a usage limit
  expect(agentWorks({ ...task, state: 'inPr' })).toBe(false);
  expect(agentWorks({ ...task, state: 'working' })).toBe(false);
  // paused: nothing of it runs
  expect(agentWorks({ ...task, state: 'working', inTurn: true, paused: true })).toBe(false);
  const idea = (thinking: boolean) => ({ status: 'open' as const, brief: '', thinking, yourTurn: false, questions: [], variants: [], mocks: [] });
  expect(agentWorks({ ...task, state: 'idea', idea: idea(true) })).toBe(true);
  expect(agentWorks({ ...task, state: 'idea', idea: idea(false) })).toBe(false);
  expect(agentWorks({ kind: 'question', state: 'done', thread: { talk: 1, thinking: true, answers: 0, files: 0 } })).toBe(true);
  expect(agentWorks({ kind: 'question', state: 'done', thread: { talk: 1, answers: 0, files: 0 }, paused: true })).toBe(false);
  // a proposal reworked is at work too, but no agent there can be paused
  const reworked = { ...task, state: 'proposal' as const, proposal: { questions: [], revising: { words: 'kürzer' } } };
  expect(agentWorks(reworked)).toBe(true);
  expect(pausable(reworked)).toBe(false);
});

test('a refused tool call stands as a line between the messages, not folded with the steps', () => {
  const tried = ev('activity', 'worker', '$ rm -rf build');
  const denied = ev('denied', 'worker', 'Nicht erlaubt (Regel in den Einstellungen): $ rm -rf build');
  const reply = ev('talk', 'worker', 'Lösche nichts, baue neu.');
  expect(talkTurns([tried, denied, reply]).shown).toEqual([
    { e: denied, steps: [], line: true },
    { e: reply, steps: [tried] },
  ]);
});

test("a demo report's question stays with the handover it came with when a later handover keeps the demo", () => {
  const first = ev('review', 'worker', 'Fertig, siehe Demo.');
  const answer = ev('answer', 'owner', 'Erst einmal parken.');
  const reply = ev('talk', 'worker', 'Geparkt.');
  const again = ev('review', 'worker', 'Entscheidung im Plan-Doc festgehalten.');
  const { shown } = talkTurns([first, answer, reply, again], { over: true });
  const demo = { chapters: [], question: 'Weiter testen oder parken?', answer: 'Erst einmal parken.' };
  expect(demoHandover({ ...demo, handover: first.id }, shown)?.e).toBe(first);
  // a demo from before it knew its handover: the last one before the answer
  expect(demoHandover(demo, shown)?.e).toBe(first);
  // a new demo with a later handover goes with that one
  expect(demoHandover({ ...demo, handover: again.id }, shown)?.e).toBe(again);
  expect(demoHandover({ chapters: [], question: 'Q?' }, shown)?.e).toBe(again);
});

test("the Koordinator reads the owner's words on a card until its confirmation follows them; a revised proposal's picked options are not read", () => {
  const said = ev('say', 'owner', 'starte ihn');
  expect(koordinatorReads([said])).toBe(true);
  expect(koordinatorReads([said, ev('say', 'koordinator', '„Export“ startet.')])).toBe(false);
  expect(koordinatorReads([said, ev('state', 'koordinator', 'Überarbeitet.')])).toBe(false);
  expect(koordinatorReads([ev('hint', 'owner', 'Und die Tests?')])).toBe(false);
});

test("a proposal's open questions leave where they were asked; settled ones stay there", () => {
  const format = { text: 'Welches Format?', options: ['CSV', 'Excel'] };
  const pdf = { text: 'Auch PDF?', options: ['Ja', 'Nein'] };
  const q1 = ev('question', 'worker', formatQuestion(format, 'de'));
  const q2 = ev('question', 'worker', formatQuestion(pdf, 'de'));
  const owner = ev('say', 'owner', 'Was würdest du nehmen?');
  const reply = ev('talk', 'koordinator', 'CSV, das liest jedes Programm.');
  const events = [q1, q2, owner, reply];
  expect(withoutOpen(events, [])).toEqual(events);
  // the reviser settled the format and kept PDF open: that one is answered at the end
  expect(withoutOpen(events, [pdf])).toEqual([q1, owner, reply]);
});
