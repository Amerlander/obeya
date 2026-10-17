import { expect, test } from 'bun:test';
import { type CardEvent, formatQuestion, type Item, pausable } from '../core/types';
import { agentWorks, demoHandover, koordinatorReads, openQuestions, ownerField, parseQuestion, split, talkAlone, talkTurns, unseen, withoutOpen } from './talk';

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
  // words on the way to its reply are steps of it
  const reply = ev('talk', 'worker', 'Excel kommt.');
  expect(talkTurns([note, edit, ok, reply]).shown).toEqual([
    { e: note, steps: [] },
    { e: reply, steps: [edit, ok] },
  ]);
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

test('what the worker did after its reply in the same turn folds under the reply with its closing words, not as a message without words', () => {
  const note = ev('hint', 'owner', 'Welches Trennzeichen?');
  const read = ev('activity', 'worker', 'Liest src/export.ts');
  const reply = ev('talk', 'worker', 'Semikolon. Für die Maskierung schlage ich eine Karte vor.');
  const proposed = ev('activity', 'worker', 'Aufgabe vorgeschlagen: CSV-Export maskieren');
  const closing = ev('closing', 'worker', 'Semikolon, wie gesagt.');
  for (const over of [false, true])
    expect(talkTurns([note, read, reply, proposed, closing], { over }).shown).toEqual([
      { e: note, steps: [] },
      { e: reply, steps: [read, proposed, closing] },
    ]);
  // until its turn ends, they stand as the agent at work
  expect(talkTurns([note, read, reply, proposed]).pending).toEqual([proposed]);
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

test("Obeya's answer that it cannot do what the owner asked stands in the conversation, for its link to report it", () => {
  const asked = ev('say', 'owner', 'Sortier die Karten nach Datum.');
  const cannot = { ...ev('say', 'koordinator', 'Das gibt es in Obeya nicht.'), wish: { said: 'Sortier die Karten nach Datum.', answer: 'Das gibt es in Obeya nicht.' } };
  expect(talkTurns([asked, cannot]).shown).toEqual([
    { e: asked, steps: [] },
    { e: cannot, steps: [] },
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
});

test('the options an answer picked stand on its question once, not again in the owner’s message', () => {
  const q1 = ev('question', 'worker', formatQuestion({ text: 'CSV oder Excel?', options: ['CSV', 'Excel'] }, 'de'));
  const a1 = { ...ev('answer', 'owner', 'CSV\n\nUnd mit Kopfzeile.'), picks: ['CSV'] };
  const q2 = ev('question', 'worker', formatQuestion({ text: 'Auch PDF?', options: ['Ja', 'Nein'] }, 'de'));
  const a2 = { ...ev('answer', 'owner', 'Nein'), picks: ['Nein'] };
  const q3 = ev('question', 'worker', formatQuestion({ text: 'Welches Trennzeichen?', options: [';', ','] }, 'de'));
  // an answer that picked nothing stands in its own words
  const a3 = ev('answer', 'owner', ';\n\nWie Excel.');
  expect(talkTurns([q1, a1, q2, a2, q3, a3]).shown).toEqual([
    { e: q1, steps: [], answer: a1.text, picks: ['CSV'] },
    { e: a1, steps: [], words: 'Und mit Kopfzeile.' },
    // a pick alone is no message of its own
    { e: q2, steps: [], answer: 'Nein', picks: ['Nein'] },
    { e: q3, steps: [], answer: a3.text },
    { e: a3, steps: [] },
  ]);
  // with a screenshot it stays, without words
  const shot = { ...a2, images: ['x.png'] };
  expect(talkTurns([q2, shot]).shown[1]).toEqual({ e: shot, steps: [], words: '' });
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
  // a card waiting to start holds the note for the agent that takes it on
  expect(ownerField({ state: 'planned', queue: { checking: true, since: '2026-10-16T10:00:00Z' } })).toBe('note');
  expect(ownerField({ state: 'planned' })).toBeNull();
});

test('ideas, proposals and tasks an agent worked on with a result share the layout with the conversation beside', () => {
  const demo = { kind: 'video' as const, chapters: [] };
  expect(split({ state: 'idea' })).toBe(true);
  expect(split({ state: 'proposal' })).toBe(true);
  expect(split({ state: 'waiting', branch: 'obeya/x', demo })).toBe(true);
  // the demo stays when the owner sends the agent a message
  expect(split({ state: 'working', branch: 'obeya/x', demo })).toBe(true);
  expect(split({ state: 'inPr', branch: 'obeya/x' })).toBe(true);
  expect(split({ state: 'working', branch: 'obeya/x', brief: 'Kurz' })).toBe(true);
  expect(split({ state: 'planned' })).toBe(false);
  // waiting for its first start, a task keeps its text beside the conversation
  expect(split({ state: 'planned', queue: { checking: true, since: '2026-10-16T10:00:00Z' } })).toBe(true);
  expect(split({ state: 'planned', branch: 'obeya/x', queue: { checking: true, since: '2026-10-16T10:00:00Z' } })).toBe(false);
  expect(split({ state: 'done' })).toBe(false);
});

test('a task an agent works on shows its conversation alone until there is a result', () => {
  expect(talkAlone({ state: 'working', branch: 'obeya/x' })).toBe(true);
  expect(talkAlone({ state: 'waiting', branch: 'obeya/x' })).toBe(true);
  expect(talkAlone({ state: 'done', branch: 'obeya/x' })).toBe(true);
  expect(talkAlone({ state: 'working', branch: 'obeya/x', demo: { kind: 'video', chapters: [] } })).toBe(false);
  expect(talkAlone({ state: 'working', branch: 'obeya/x', brief: '' })).toBe(true);
  expect(talkAlone({ state: 'planned' })).toBe(false);
  // a stopped task lays out as one an agent worked on: the task opens its conversation
  expect(talkAlone({ state: 'planned', branch: 'obeya/x' })).toBe(true);
  expect(split({ state: 'planned', branch: 'obeya/x', demo: { kind: 'video', chapters: [] } })).toBe(true);
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
  const demo = { kind: 'video' as const, chapters: [], question: 'Weiter testen oder parken?', answer: 'Erst einmal parken.' };
  expect(demoHandover({ ...demo, handover: first.id }, shown)?.e).toBe(first);
  // a new demo with a later handover goes with that one, which stands under the reply before it
  expect(demoHandover({ ...demo, handover: again.id }, shown)?.then?.e).toBe(again);
});

test('a later handover right after the reply stands under it with what changed; the first, or one after the owner spoke, stands alone', () => {
  const first = ev('review', 'worker', 'CSV-Export gebaut.');
  const feedback = ev('hint', 'owner', 'Bitte mit Kopfzeile.');
  const reply = ev('talk', 'worker', 'Mache ich: die Spaltennamen kommen in die erste Zeile.');
  const edit = ev('activity', 'worker', 'Bearbeitet src/export.ts');
  const again = ev('review', 'worker', 'Kopfzeile ergänzt, im Commit.');
  const closing = ev('closing', 'worker', 'Übergeben.');
  for (const over of [false, true])
    expect(talkTurns([first, feedback, reply, edit, again, closing], { over }).shown).toEqual([
      { e: first, steps: [] },
      { e: feedback, steps: [] },
      { e: reply, steps: [], then: { e: again, steps: [edit, closing] } },
    ]);
  // words of the owner's in between: the handover answers them, as a message of its own
  const more = ev('hint', 'owner', 'Und Excel?');
  expect(talkTurns([first, feedback, reply, more, edit, again]).shown.at(-1)).toEqual({ e: again, steps: [edit] });
  // the first handover after the worker started stands alone, also right after a reply
  const note = ev('hint', 'owner', 'Welche Spalten?');
  const answer = ev('talk', 'worker', 'Sorte und Menge.');
  const start = ev('state', 'obeya', 'Agent gestartet auf obeya/export.');
  expect(talkTurns([first, start, note, answer, again]).shown.at(-1)).toEqual({ e: again, steps: [] });
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

test("the usage limit that stopped the agent's turn is a line where it happened; what the agent did until then stays above it once it went on", () => {
  const note = ev('hint', 'owner', 'Und wenn wir früher handeln?');
  const reply = ev('talk', 'worker', 'Ich rechne das nach.');
  const run = ev('activity', 'worker', '$ python3 study.py');
  const limit = ev('state', 'obeya', "You've hit your session limit · resets 7:20pm (Europe/Berlin). The agent goes on by itself at 19:20.");
  // the limit holds: the steps wait for the agent's bubble, above the line
  expect(talkTurns([note, reply, run, limit])).toMatchObject({ shown: [{ e: note }, { e: reply }, { e: limit, line: true }], pending: [run] });
  // the owner wrote after the limit: the line stands above their words, not folded into the reply to them
  const more = ev('hint', 'owner', 'mach weiter');
  const parked = ev('state', 'obeya', 'Stopped the app in the workspace while the card waits.');
  const now = ev('activity', 'worker', '$ python3 report.py');
  const t = talkTurns([note, reply, run, limit, parked, more, now]);
  expect(t.shown.map((x) => x.e)).toEqual([note, reply, run, limit, more]);
  expect(t.shown[2]).toMatchObject({ steps: [run], quiet: true });
  expect(t.pending).toEqual([parked, now]);
  // in German, and when Obeya only tries again
  const retry = ev('state', 'obeya', 'Nutzungslimit erreicht. Obeya versucht es um 19:35 noch einmal.');
  expect(talkTurns([note, retry]).shown).toMatchObject([{ e: note }, { e: retry, line: true }]);
  // the worker's closing words, which Obeya logs after the limit's line, close the turn the limit stopped
  const closing = ev('closing', 'worker', 'Ich warte auf die Vertragsprüfung.');
  const held = talkTurns([note, reply, run, limit, closing]);
  expect(held.shown).toEqual([{ e: note, steps: [] }, { e: reply, steps: [run, closing] }, { e: limit, steps: [], line: true }]);
  expect(held.pending).toEqual([]);
});

test('what an agent did until it was paused stays above the line once it went on; while paused, its bubble shows it', () => {
  const asked = ev('talk', 'owner', 'Was bräuchte ein Export?');
  const read = ev('activity', 'explorer', '$ git ls-files');
  const thought = ev('activity', 'explorer', '$ ls data');
  const paused = ev('state', 'owner', 'Pausiert.');
  // paused now: the steps wait for the paused bubble, above the line
  expect(talkTurns([asked, read, thought, paused], { paused: true })).toMatchObject({ shown: [{ e: asked }, { e: paused, line: true }], pending: [read, thought] });
  // gone on with a message: the steps stand where it stopped, the new work after the message
  const more = ev('talk', 'owner', 'Und Excel?');
  const resumed = ev('state', 'owner', 'Weiter.');
  const now = ev('activity', 'explorer', '$ cat data/strom.csv');
  const t = talkTurns([asked, read, thought, paused, more, resumed, now]);
  expect(t.shown.map((x) => x.e)).toEqual([asked, read, paused, more, resumed]);
  expect(t.shown[1]).toMatchObject({ steps: [read, thought], quiet: true });
  expect(t.pending).toEqual([now]);
});

test("the questions waiting for the owner: an idea's until its agent thinks again, a proposal's until it is reworked, a worker's while it asks", () => {
  const q = { text: 'A oder B?', options: ['A', 'B'] };
  const idea = { state: 'idea', idea: { status: 'open', thinking: false, questions: [q] } } as unknown as Item;
  expect(openQuestions(idea)).toEqual([q]);
  expect(openQuestions({ ...idea, idea: { ...idea.idea!, thinking: true } })).toEqual([]);
  expect(openQuestions({ ...idea, archivedAt: '2026-10-17T10:00:00Z' })).toEqual([]);
  const proposal = { state: 'proposal', proposal: { questions: [q] } } as unknown as Item;
  expect(openQuestions(proposal)).toEqual([q]);
  expect(openQuestions({ ...proposal, proposal: { ...proposal.proposal!, revising: {} as never } })).toEqual([]);
  expect(openQuestions({ state: 'waiting', need: 'question', question: q } as Item)).toEqual([q]);
  expect(openQuestions({ state: 'waiting', need: 'review', question: q } as Item)).toEqual([]);
  expect(openQuestions({ state: 'working' } as Item)).toEqual([]);
});

test("a card's messages count as unseen after the last one seen, and never before the owner's own words", () => {
  const began = ev('say', 'worker', 'Ich fange an.');
  const asked = ev('say', 'owner', 'Wie weit bist du?');
  const step = ev('activity', 'worker', 'Liest src/a.ts');
  const reply = ev('say', 'worker', 'Fast fertig.');
  const handover = ev('report', 'worker', 'Fertig.');
  const all = [began, asked, step, reply, handover];
  expect(unseen(all)).toBe(2);
  expect(unseen(all, reply.id)).toBe(1);
  expect(unseen(all, handover.id)).toBe(0);
  expect(unseen([...all, ev('say', 'owner', 'Danke')])).toBe(0);
});
