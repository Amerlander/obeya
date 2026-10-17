import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pagePolicy } from '../core/frame';
import { waitingOn } from '../core/types';
import { answersDir } from './answers';
import { CanvasRuntime } from './canvas';
import { serveAnswerFile } from './demo';
import type { Focus } from './commands';
import { Store } from './db';
import { FakeRuntime, noForge, type FakeSession, gitRepo } from './testing';

let dir: string;
let main: string;
let store: Store;
let runtime: FakeRuntime;
let canvas: CanvasRuntime;
let notices: [string | undefined, string][];

const open = () => {
  const c = new CanvasRuntime({ repos: [{ path: main, clones: 1 }] }, { store, home: dir, runtime, forge: noForge, commandDelayMs: 10, permissionMode: 'acceptEdits', limitMargin: 10 });
  c.board.onNotice((n) => notices.push([n.cardId, n.text]));
  return c;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-answers-'));
  main = join(dir, 'main');
  gitRepo(main, { 'docs/plan/pr-loop.md': '# PR-Loop\n\n## Goal\n\nG.\n\n## Workstreams\n\n- [x] **W1:** PR-Phase.\n- [ ] **W4:** Live im Shop. Mit dem Go des Owners.\n' });
  store = new Store(':memory:');
  runtime = new FakeRuntime();
  notices = [];
  canvas = open();
});
afterEach(() => {
  canvas.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const board = () => canvas.board;
const workstream = () => board().snapshot().items.find((i) => i.label === 'W4')!;
const isKoordinator = (s: FakeSession) => s.spec.tools.some((t) => t.name === 'look_up');
const answerer = () => runtime.sessions.filter((s) => s.spec.tools.some((t) => t.name === 'answer_owner')).at(-1)!;

/** Says `text` with `focus`; the Koordinator reads it with `tool`. */
async function say(text: string, focus: Focus, tool: string, args: Record<string, unknown>) {
  const heard = canvas.commander.hear(text, focus);
  await settle();
  const s = runtime.sessions.filter(isKoordinator).at(-1)!;
  s.call(tool, args);
  s.emit({ type: 'idle' });
  return { heard: await heard, brief: s.inbox.at(-1)! };
}

describe('a question the Koordinator looks up', () => {
  test("about a workstream: its project agent answers from the start task, in the open card's log and aloud", async () => {
    const w4 = workstream();
    const { heard } = await say('Was würde der Agent hier machen, wenn ich starte?', { card: w4.id }, 'look_up', {
      question: 'What would the worker do on W4 if the owner started it now?',
      confirm: 'Ich schaue im Plan nach.',
    });
    // nothing to take back; the acknowledgement is what the owner hears now
    expect(heard).toEqual({ confirm: 'Ich schaue im Plan nach.' });
    const a = answerer();
    // with a worker's tools, in the workers' permission mode, to check what it says
    expect(a.spec.readOnly).toBeUndefined();
    expect(a.spec.permissionMode).toBe('acceptEdits');
    expect(a.spec.system).toContain('project agent of the project "PR-Loop"');
    expect(a.inbox[0]).toContain('What would the worker do on W4');
    expect(a.inbox[0]).toContain('The task its worker would get if the owner started it now');
    expect(a.inbox[0]).toContain('Your card: “Live im Shop”.');
    expect(a.inbox[0]).toContain('Read its plan doc docs/plan/pr-loop.md first');
    expect(board().snapshot().talk).toEqual([]);

    a.emit({ type: 'session', id: 'project-1' });
    a.emit({ type: 'tool', name: 'Read', input: { file_path: `${main}/docs/plan/pr-loop.md` } });
    a.call('answer_owner', { text: '1. Liest das Plan-Doc.\n2. Fragt nach dem Go.' });
    a.emit({ type: 'idle' });
    await settle();

    expect(board().events(w4.id).map((e) => [e.kind, e.author, e.text])).toEqual([
      ['say', 'owner', 'Was würde der Agent hier machen, wenn ich starte?'],
      ['say', 'koordinator', 'Ich schaue im Plan nach.'],
      ['activity', 'project', 'Liest plan/pr-loop.md'],
      ['say', 'project', '1. Liest das Plan-Doc.\n2. Fragt nach dem Go.'],
    ]);
    // above the microphone too, written
    expect(notices).toEqual([[w4.id, '1. Liest das Plan-Doc.\n2. Fragt nach dem Go.']]);
    // the project agent keeps its session: it knows the plan and the history
    expect(board().row(w4.parent!).session_id).toBe('project-1');
    expect(board().talk().at(-1)).toMatchObject({ question: 'What would the worker do on W4 if the owner started it now?', answer: '1. Liest das Plan-Doc.\n2. Fragt nach dem Go.', answerBy: 'project' });
    // it is read on the card, so the sheet does not wait with it
    expect(board().talk().at(-1)!.unread).toBeUndefined();

    // the Koordinator hears the answer with the next command
    const next = await say('und dann?', { card: w4.id }, 'reply', { confirm: 'Dann wartet er.' });
    expect(next.brief).toContain('The answer A1 you looked up for the owner\'s question „What would the worker do on W4');
  });

  test('about a card without a project: a thorough Koordinator turn answers, in the sheet when no card is open', async () => {
    board().create({ title: 'Login', body: 'Login hängt.', x: 0, y: 0 });
    const first = await say('was steht im plan zu login?', {}, 'reply', { confirm: 'Welche Karte?' });
    const tag = /(K\d+) \[planned\] "Login"/.exec(first.brief)![1];
    await say('was würde der agent bei login machen?', {}, 'look_up', { question: 'What would the worker do on Login?', card: tag, confirm: 'Moment, ich lese nach.' });
    const a = answerer();
    expect(a.spec.system).toContain('You are the Koordinator of Obeya, a canvas on which the owner directs coding agents; the owner knows you simply as Obeya.');
    expect(a.spec.role).toBe('koordinator');
    expect(a.spec.readOnly).toBeUndefined();
    expect(a.spec.permissionMode).toBe('acceptEdits');
    expect(a.spec.system).toContain('You have the tools a worker has');
    expect(a.inbox[0]).toContain('Your card: “Login”.');
    expect(board().snapshot().talk.at(-1)).toMatchObject({ said: 'was würde der agent bei login machen?', reply: 'Moment, ich lese nach.', question: 'What would the worker do on Login?' });
    expect(board().snapshot().talk.at(-1)!.answer).toBeUndefined();

    a.call('answer_owner', { text: 'Er sucht den Hänger.' });
    a.emit({ type: 'idle' });
    await settle();
    expect(board().snapshot().talk.at(-1)).toMatchObject({ answer: 'Er sucht den Hänger.', answerBy: 'koordinator', unread: true });
    expect(notices).toEqual([[undefined, 'Er sucht den Hänger.']]);
    // Obeya waits for the owner with it, like a card that needs them, until they see the sheet
    expect(waitingOn(board().snapshot())).toBe(1);
    board().readTalk();
    expect(board().snapshot().talk.at(-1)!.unread).toBeUndefined();
    expect(waitingOn(board().snapshot())).toBe(0);
  });

  test('an unknown card tag goes back to the Koordinator', async () => {
    const heard = canvas.commander.hear('was macht X?', {});
    await settle();
    const s = runtime.sessions.find(isKoordinator)!;
    expect(s.call('look_up', { question: 'X?', card: 'K9', confirm: 'Moment.' })).toContain('Unknown tag K9');
    s.call('reply', { confirm: 'Welche Karte meinst du?' });
    s.emit({ type: 'idle' });
    expect((await heard).confirm).toBe('Welche Karte meinst du?');
  });

  test('the Koordinator hears a long answer to its end, in its running session and in a fresh one', async () => {
    const asked = (said: string, answer: string) => board().answerTalk(board().addTalk(said, 'Moment.', null, { question: `${said}?`, about: null }), answer, 'koordinator');
    asked('alte frage', `${'Alt. '.repeat(200)}ENDE-ALT`);
    const answer = `${'Die Datenbankregel gilt für jeden Zugriff. '.repeat(80)}Soll ich eine Karte für Tool-Verwendungen anlegen?`;
    await say('wie ist die datenbankregel?', {}, 'look_up', { question: 'What is the database rule?', confirm: 'Ich lese nach.' });
    const a = answerer();
    a.call('answer_owner', { text: answer });
    a.emit({ type: 'idle' });
    await settle();
    const running = await say('ja, leg eine an', {}, 'reply', { confirm: 'Mache ich.' });
    expect(running.brief).toContain(answer);

    // a fresh session gets the newest five answers in full, older ones clipped
    for (let n = 1; n <= 4; n++) asked(`frage ${n}`, `Antwort ${n}.`);
    canvas.shutdown();
    canvas = open();
    const fresh = await say('und?', {}, 'reply', { confirm: 'Ja.' });
    expect(fresh.brief).toContain(answer);
    expect(fresh.brief).toContain('Antwort 4.');
    expect(fresh.brief).toContain('Alt. Alt.');
    expect(fresh.brief).not.toContain('ENDE-ALT');
  });

  test('a question still being looked up when Obeya restarts is looked up again', async () => {
    const w4 = workstream();
    await say('was würde der agent tun?', { card: w4.id }, 'look_up', { question: 'What would the worker do?', confirm: 'Ich schaue nach.' });
    canvas.shutdown();
    const before = runtime.sessions.length;
    canvas = open();
    await settle();
    expect(runtime.sessions.length).toBe(before + 1);
    expect(answerer().inbox[0]).toContain('What would the worker do?');
  });

  test('a turn that ends without the tool answers with its last words; one that fails says so', async () => {
    const w4 = workstream();
    await say('was würde der agent tun?', { card: w4.id }, 'look_up', { question: 'Q1', confirm: 'Ich schaue nach.' });
    let a = answerer();
    a.emit({ type: 'text', text: 'Er fragt zuerst nach dem Go.' });
    a.emit({ type: 'idle' });
    await settle();
    expect(board().events(w4.id).at(-1)).toMatchObject({ kind: 'say', author: 'project', text: 'Er fragt zuerst nach dem Go.' });

    await say('und warum?', { card: w4.id }, 'look_up', { question: 'Q2', confirm: 'Ich schaue nach.' });
    await settle();
    a = answerer();
    a.emit({ type: 'error', message: 'boom' });
    await settle();
    expect(board().events(w4.id).at(-1)!.text).toContain('Ich konnte die Frage nicht beantworten (boom)');
  });
});

const HIT = "You've hit your session limit · resets 2:40pm (Europe/Berlin)";

/** The usage limit stops the turn of `s`, until `ms` from now. */
function limit(s: FakeSession, ms: number) {
  s.emit({ type: 'error', message: HIT, limit: { resetsAt: Date.now() + ms } });
  s.emit({ type: 'idle' });
}

describe('a look-up the usage limit stops', () => {
  test('waits under its question in the sheet and answers once the limit lifts, after a restart too', async () => {
    await say('was steht im plan zu login?', {}, 'look_up', { question: 'What does the plan say about login?', confirm: 'Moment.' });
    let a = answerer();
    limit(a, 20);
    await settle();
    // no answer that it failed: the sheet says when it goes on
    const talk = () => board().snapshot().talk.at(-1)!;
    expect(talk().answer).toBeUndefined();
    expect(Date.parse(talk().limitedUntil!)).toBeGreaterThan(Date.now());
    expect(a.closed).toBe(false);
    // Obeya restarts: the question is looked up again, runs into the limit again and waits anew
    canvas.shutdown();
    canvas = open();
    await settle();
    expect(answerer()).not.toBe(a);
    a = answerer();
    expect(talk().limitedUntil).toBeUndefined();
    limit(a, 20);
    expect(talk().limitedUntil).toBeDefined();
    await settle(60);
    expect(a.inbox.at(-1)).toContain('The usage limit that stopped your last turn has reset');
    expect(talk().limitedUntil).toBeUndefined();
    a.call('answer_owner', { text: 'Der Plan sagt nichts dazu.' });
    a.emit({ type: 'idle' });
    await settle();
    expect(talk().answer).toBe('Der Plan sagt nichts dazu.');
    expect(notices).toEqual([[undefined, 'Der Plan sagt nichts dazu.']]);
  });

  test("a workstream's project agent waits the same way", async () => {
    const w4 = workstream();
    await say('was würde der agent tun?', { card: w4.id }, 'look_up', { question: 'What would the worker do?', confirm: 'Ich schaue nach.' });
    const a = answerer();
    expect(a.spec.system).toContain('project agent');
    limit(a, 20);
    await settle();
    // in the card's conversation, without the error
    expect(board().events(w4.id).at(-1)).toMatchObject({ kind: 'state', author: 'obeya' });
    expect(board().events(w4.id).at(-1)!.text).toStartWith('Das Nutzungslimit ist erreicht. Obeya schlägt das um ');
    expect(board().events(w4.id).some((e) => e.text.includes('hit your'))).toBe(false);
    await settle(60);
    a.call('answer_owner', { text: 'Er fragt nach dem Go.' });
    a.emit({ type: 'idle' });
    await settle();
    expect(board().events(w4.id).at(-1)).toMatchObject({ author: 'project', text: 'Er fragt nach dem Go.' });
  });
});

/** A question looked up in the sheet, answered by its agent in session `session`; returns the exchange's id. */
async function lookedUp(said: string, question: string, answer: string, session: string, extra: Record<string, unknown> = {}) {
  await say(said, {}, 'look_up', { question, confirm: 'Moment.', ...extra });
  const a = answerer();
  a.emit({ type: 'session', id: session });
  a.call('answer_owner', { text: answer });
  a.emit({ type: 'idle' });
  await settle();
  return board().talk().at(-1)!.id;
}

describe('a looked-up answer goes on', () => {
  test('a follow-up resumes the agent that found the answer, and stands in the sheet as continuing it', async () => {
    const first = await lookedUp('stimmen die Septembergutschriften?', 'Are the September credits right?', 'Ja, sie stimmen.', 'look-1');
    expect(board().talk().at(-1)).toMatchObject({ thread: first, answer: 'Ja, sie stimmen.' });
    const sessions = runtime.sessions.length;
    await say('und im Oktober?', {}, 'look_up', { question: 'And the October credits so far?', follows: `A${first}`, confirm: 'Ich schaue nach.' });
    // one agent, resumed: it still has everything it read and computed
    const a = answerer();
    expect(runtime.sessions.length).toBe(sessions + 1);
    expect(a.spec.resume).toBe('look-1');
    expect(a.inbox[0]).toContain('The owner follows up on your answer. They said: "und im Oktober?"');
    expect(a.inbox[0]).toContain(answersDir(dir, canvas.id, first));
    expect(a.spec.dirs).toEqual([answersDir(dir, canvas.id, first)]);
    expect(board().talk().at(-1)).toMatchObject({ thread: first, follows: first, continues: 'Are the September credits right?' });
    a.call('answer_owner', { text: 'Oktober bisher auch.' });
    a.emit({ type: 'idle' });
    await settle();
    expect(board().talk().at(-1)).toMatchObject({ answer: 'Oktober bisher auch.', unread: true });
  });

  test('an unknown answer tag goes back to the Koordinator', async () => {
    canvas.commander.hear('und weiter?', {});
    await settle();
    const s = runtime.sessions.filter(isKoordinator).at(-1)!;
    expect(s.call('look_up', { question: 'More?', follows: 'A99', confirm: 'Moment.' })).toContain('Unknown answer A99');
  });

  test('follow-ups to one thread wait for each other', async () => {
    const first = await lookedUp('frage', 'Q?', 'A.', 'look-1');
    await say('und das?', {}, 'look_up', { question: 'Q2?', follows: `A${first}`, confirm: 'Moment.' });
    const second = answerer();
    const before = runtime.sessions.length;
    await say('und jenes?', {}, 'look_up', { question: 'Q3?', follows: `A${first}`, confirm: 'Moment.' });
    // the Koordinator read it, but its agent waits for the turn before
    expect(runtime.sessions.length).toBe(before);
    second.emit({ type: 'session', id: 'look-2' });
    second.call('answer_owner', { text: 'Zwei.' });
    second.emit({ type: 'idle' });
    await settle();
    const third = answerer();
    expect(third).not.toBe(second);
    expect(third.spec.resume).toBe('look-1');
    expect(third.inbox[0]).toContain('und jenes?');
  });

  test('a session that cannot be resumed is replaced by a fresh agent that gets the thread so far', async () => {
    const first = await lookedUp('stimmen die gutschriften?', 'Are the credits right?', 'Ja, 16,6 ct.', 'gone');
    await say('und im oktober?', {}, 'look_up', { question: 'October?', follows: `A${first}`, confirm: 'Moment.' });
    answerer().emit({ type: 'error', message: 'No conversation found with session ID: gone' });
    await settle();
    const fresh = answerer();
    expect(fresh.spec.resume).toBeUndefined();
    expect(fresh.inbox[0]).toContain('The question, as you understood it then: Are the credits right?');
    expect(fresh.inbox[0]).toContain('You: Ja, 16,6 ct.');
    expect(fresh.inbox[0]).toContain('They said: "und im oktober?"');
    fresh.call('answer_owner', { text: 'Oktober: 12 ct.' });
    fresh.emit({ type: 'idle' });
    await settle();
    expect(board().talk().at(-1)!.answer).toBe('Oktober: 12 ct.');
  });

  test("an answer comes with files in its thread's directory; a path outside it is refused", async () => {
    await say('mach mir eine tabelle', {}, 'look_up', { question: 'A table of the credits?', confirm: 'Moment.' });
    const thread = board().talk().at(-1)!.id;
    const out = answersDir(dir, canvas.id, thread);
    const a = answerer();
    writeFileSync(join(out, 'credits.csv'), 'a,b\n');
    mkdirSync(join(out, 'charts'));
    writeFileSync(join(out, 'charts', 'price.html'), '<p>chart</p>');
    writeFileSync(join(dir, 'secret.txt'), 'no');
    expect(a.call('answer_owner', { text: 'Hier.', files: [{ path: join(dir, 'secret.txt'), caption: 'x' }] })).toContain('is not in');
    expect(a.call('answer_owner', { text: 'Hier.', files: [{ path: '../secret.txt', caption: 'x' }] })).toContain('is not in');
    expect(a.call('answer_owner', { text: 'Hier.', files: [{ path: 'missing.xlsx', caption: 'x' }] })).toContain('is no file');
    expect(board().talk().at(-1)!.answer).toBeUndefined();
    a.call('answer_owner', {
      text: 'Hier.',
      files: [
        { path: join(out, 'credits.csv'), caption: 'Die Gutschriften je Monat' },
        { path: 'charts/price.html', caption: 'Preis je Stunde' },
      ],
    });
    a.emit({ type: 'idle' });
    await settle();
    expect(board().talk().at(-1)!.files).toEqual([
      { name: 'credits.csv', caption: 'Die Gutschriften je Monat' },
      { name: 'charts/price.html', caption: 'Preis je Stunde' },
    ]);
    // served from the directory, a page sandboxed and reporting its height and allowed to read the
    // files beside it (under its directory's key, see demo.test.ts); nothing outside it
    const files = 'http://127.0.0.1:4417/api/c/c1/threads/7/files/';
    const sentOn = serveAnswerFile(out, 'credits.csv', false, new Request(`${files}credits.csv`));
    expect(sentOn.status).toBe(302);
    const key = /\/(~[0-9a-f]{32})\//.exec(sentOn.headers.get('location')!)![1];
    const serve = (name: string, download = false) => serveAnswerFile(out, `${key}/${name}`, download, new Request(`${files}${key}/${name}`));
    const page = serve('charts/price.html');
    expect(page.headers.get('content-security-policy')).toBe(`sandbox allow-scripts; ${pagePolicy('http://127.0.0.1:4417')}`);
    expect(page.headers.get('connection-allowlist')).toBe('(response-origin)');
    expect(page.headers.get('access-control-allow-origin')).toBe('null');
    expect(await page.text()).toContain('obeyaHeight');
    expect(serve('credits.csv', true).headers.get('content-disposition')).toContain('credits.csv');
    expect(serve('../secret.txt').status).toBe(404);
    expect(() => canvas.answerDir(thread + 100)).toThrow();
  });

  test("an answer in a card's log carries its thread, and a follow-up there resumes its agent", async () => {
    const login = board().create({ title: 'Login', body: 'Login hängt.', x: 0, y: 0 });
    await say('warum hängt login?', { card: login.id }, 'look_up', { question: 'Why does login hang?', confirm: 'Moment.' });
    const thread = board().talk().at(-1)!.id;
    let a = answerer();
    a.emit({ type: 'session', id: 'login-1' });
    a.call('answer_owner', { text: 'Ein Timeout.' });
    a.emit({ type: 'idle' });
    await settle();
    expect(board().events(login.id).at(-1)).toMatchObject({ kind: 'say', author: 'koordinator', text: 'Ein Timeout.', answer: { thread } });
    await say('welcher?', { card: login.id }, 'look_up', { question: 'Which timeout?', follows: `A${thread}`, confirm: 'Moment.' });
    a = answerer();
    expect(a.spec.resume).toBe('login-1');
    a.call('answer_owner', { text: 'Der der Session.' });
    a.emit({ type: 'idle' });
    await settle();
    expect(board().events(login.id).at(-1)).toMatchObject({ text: 'Der der Session.', answer: { thread, continues: 'Why does login hang?' } });
  });
});

describe('a thread on a Question card', () => {
  /** A thread of two answers in the sheet, moved onto a card. */
  async function moved() {
    const first = await lookedUp('stimmen die septembergutschriften?', 'September feed-in credits: correct?', 'Ja.', 'look-1');
    const out = answersDir(dir, canvas.id, first);
    await say('mach ein excel', {}, 'look_up', { question: 'An Excel of the numbers?', follows: `A${first}`, confirm: 'Moment.' });
    const a = answerer();
    writeFileSync(join(out, 'numbers.xlsx'), 'x');
    a.call('answer_owner', { text: 'Hier die Tabelle.', files: [{ path: 'numbers.xlsx', caption: 'Die Viertelstunden' }] });
    a.emit({ type: 'idle' });
    await settle();
    const card = canvas.answers.toCard(first);
    return { first, card };
  }

  test('"Make it a card" moves the thread with its files onto a card that goes on with the same agent', async () => {
    const { first, card } = await moved();
    expect(card).toMatchObject({ kind: 'question', state: 'done', title: 'September feed-in credits: correct?', thread: { talk: first, answers: 2, files: 1 } });
    expect(board().row(card.id).session_id).toBe('look-1');
    expect(board().events(card.id).map((e) => [e.author, e.text, e.answer?.files?.length ?? 0])).toEqual([
      ['owner', 'stimmen die septembergutschriften?', 0],
      ['koordinator', 'Ja.', 0],
      ['owner', 'mach ein excel', 0],
      ['koordinator', 'Hier die Tabelle.', 1],
    ]);
    // the sheet points to the card instead
    expect(board().talk().filter((x) => x.thread === first).every((x) => x.movedTo === card.id)).toBe(true);
    // moved again, it is the same card
    expect(canvas.answers.toCard(first).id).toBe(card.id);

    // the owner's words on the card go straight to that agent, with to_obeya for what asks Obeya
    canvas.tell(card.id, 'und im Oktober?', [], false);
    expect(board().item(card.id)!.thread!.thinking).toBe(true);
    const a = answerer();
    expect(a.spec.resume).toBe('look-1');
    expect(a.spec.tools.map((t) => t.name)).toContain('to_obeya');
    expect(a.inbox[0]).toContain('und im Oktober?');
    // what comes while it reads waits for its turn, unread until then, and can be taken back
    canvas.tell(card.id, 'und November?', [], true);
    canvas.tell(card.id, 'und Dezember?', [], false);
    const [november, december] = board().events(card.id).slice(-2);
    expect([november!.unread, december!.unread]).toEqual([true, true]);
    canvas.press(card.id, { action: 'unsay', id: december!.id });
    const sessions = runtime.sessions.length;
    a.call('answer_owner', { text: 'Oktober: 12 ct.' });
    a.emit({ type: 'idle' });
    await settle();
    expect(runtime.sessions.length).toBe(sessions + 1);
    const b = answerer();
    expect(b.inbox[0]).toContain('und November?');
    expect(b.inbox[0]).not.toContain('und Dezember?');
    // read once its turn starts: after the answer it waited for
    const answered = board().events(card.id).find((e) => e.text === 'Oktober: 12 ct.')!;
    expect(board().events(card.id).find((e) => e.id === november!.id)).toMatchObject({ readAfter: answered.id });
    b.call('answer_owner', { text: 'November: noch nichts.' });
    b.emit({ type: 'idle' });
    await settle();
    expect(board().item(card.id)!.thread).toEqual({ talk: first, answers: 4, files: 1 });
    expect(board().events(card.id).filter((e) => e.kind === 'talk').map((e) => e.text).slice(-4)).toEqual(['und im Oktober?', 'und November?', 'Oktober: 12 ct.', 'November: noch nichts.']);
  });

  test('a follow-up asked in the sheet after the move goes to the card and stands there', async () => {
    const { first, card } = await moved();
    await say('und dezember?', {}, 'look_up', { question: 'December?', follows: `A${first}`, confirm: 'Moment.' });
    const talk = board().talk().at(-1)!;
    expect(talk.movedTo).toBe(card.id);
    const a = answerer();
    expect(a.spec.resume).toBe('look-1');
    a.call('answer_owner', { text: 'Dezember: offen.' });
    a.emit({ type: 'idle' });
    await settle();
    expect(board().events(card.id).filter((e) => e.kind === 'talk').map((e) => e.text).slice(-2)).toEqual(['und dezember?', 'Dezember: offen.']);
    // the Koordinator hears it, and the sheet does not wait with it
    expect(board().talk().at(-1)).toMatchObject({ answer: 'Dezember: offen.' });
    expect(board().talk().at(-1)!.unread).toBeUndefined();
  });

  test('its agent paused while it reads keeps what it was asked, stays paused across a restart, and answers it once resumed', async () => {
    const { card } = await moved();
    expect(() => canvas.act(card.id, { action: 'pause' })).toThrow('not working on anything');
    canvas.tell(card.id, 'und im Oktober?', [], false);
    const a = answerer();
    canvas.act(card.id, { action: 'pause' });
    expect(a.closed).toBe(true);
    await settle();
    expect(board().item(card.id)).toMatchObject({ paused: true, thread: { answers: 2 } });
    expect(board().item(card.id)!.thread!.thinking).toBeUndefined();
    // nothing answered it: the question stands last
    expect(board().events(card.id).filter((e) => e.kind === 'talk').at(-1)!.text).toBe('und im Oktober?');
    canvas.shutdown();
    canvas = open();
    await settle();
    expect(answerer()).toBe(a);
    expect(board().item(card.id)!.paused).toBe(true);
    canvas.act(card.id, { action: 'resume' });
    await settle();
    const b = answerer();
    expect(b).not.toBe(a);
    expect(b.spec.resume).toBe('look-1');
    expect(b.inbox[0]).toContain('The owner paused you while you worked on your answer and has now let you go on');
    expect(b.inbox[0]).toContain('und im Oktober?');
    expect(board().item(card.id)).toMatchObject({ thread: { thinking: true } });
    expect(board().item(card.id)!.paused).toBeUndefined();
    b.call('answer_owner', { text: 'Oktober: 12 ct.' });
    b.emit({ type: 'idle' });
    await settle();
    expect(board().item(card.id)!.thread).toEqual({ talk: board().item(card.id)!.thread!.talk, answers: 3, files: 1 });
  });

  test('asked more while paused, its agent goes on with that and what it was asked before', async () => {
    const { card } = await moved();
    canvas.tell(card.id, 'und im Oktober?', [], false);
    canvas.act(card.id, { action: 'pause' });
    await settle();
    canvas.tell(card.id, 'und November?', [], false);
    await settle();
    const b = answerer();
    expect(b.inbox[0]).toContain('The owner paused you');
    expect(b.inbox[0]!.indexOf('und im Oktober?')).toBeLessThan(b.inbox[0]!.indexOf('und November?'));
    expect(board().item(card.id)!.paused).toBeUndefined();
  });

  test('its agent the usage limit stops waits on the card and answers once the limit lifts; paused meanwhile, it waits no more', async () => {
    const { card } = await moved();
    canvas.tell(card.id, 'und im Oktober?', [], false);
    const a = answerer();
    limit(a, 20);
    await settle();
    expect(board().item(card.id)).toMatchObject({ thread: { thinking: true } });
    expect(board().item(card.id)!.limitedUntil).toBeDefined();
    await settle(60);
    expect(board().item(card.id)!.limitedUntil).toBeUndefined();
    expect(a.inbox.at(-1)).toContain('usage limit');
    a.call('answer_owner', { text: 'Oktober: 12 ct.' });
    a.emit({ type: 'idle' });
    await settle();
    expect(board().events(card.id).filter((e) => e.kind === 'talk').at(-1)!.text).toBe('Oktober: 12 ct.');

    canvas.tell(card.id, 'und November?', [], false);
    const b = answerer();
    limit(b, 10_000);
    await settle();
    expect(board().item(card.id)!.limitedUntil).toBeDefined();
    canvas.act(card.id, { action: 'pause' });
    expect(b.closed).toBe(true);
    expect(board().item(card.id)!.limitedUntil).toBeUndefined();
  });

  test('what the card asked when Obeya stopped is asked again', async () => {
    const { card } = await moved();
    canvas.tell(card.id, 'und im Oktober?', [], false);
    canvas.shutdown();
    canvas = open();
    await settle();
    const a = answerer();
    expect(a.inbox[0]).toContain('und im Oktober?');
    a.call('answer_owner', { text: 'Oktober: 12 ct.' });
    a.emit({ type: 'idle' });
    await settle();
    expect(board().item(card.id)!.thread!.thinking).toBeUndefined();
  });

  test('"Discuss as idea" makes it an idea whose exploration agent starts from the thread; "Done" archives it', async () => {
    const { first, card } = await moved();
    canvas.act(card.id, { action: 'asIdea' });
    const idea = board().item(card.id)!;
    expect(idea).toMatchObject({ kind: 'task', state: 'idea' });
    const explorer = runtime.sessions.at(-1)!;
    expect(explorer.spec.role).toBe('explorer');
    expect(explorer.spec.resume).toBeUndefined();
    expect(explorer.inbox[0]).toContain('Obeya: Hier die Tabelle.');
    expect(explorer.inbox[0]).toContain('numbers.xlsx – Die Viertelstunden');
    expect(explorer.inbox[0]).toContain(answersDir(dir, canvas.id, first));

    const other = await lookedUp('noch eine frage', 'Another?', 'Ja.', 'look-9');
    const done = canvas.answers.toCard(other);
    board().archive([done.id]);
    expect(board().item(done.id)).toBeUndefined();
    // put back by moving the thread again
    expect(canvas.answers.toCard(other).id).toBe(done.id);
    expect(board().item(done.id)).toBeDefined();
  });
});
