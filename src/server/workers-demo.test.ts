import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generic } from '../adapters/generic';
import type { RepoAdapter } from '../adapters/types';
import { needsYou } from '../core/types';
import { BadRequest } from './board';
import { DEMO_SKILL_FILE, demoSkillName, OBEYA_PLUGIN } from './demo';
import { Images } from './images';
import { artifact, until } from './testing';
import { Workers } from './workers';
import { board, dir, eachTest, manual, runtime, setup, setWorkers, spaces, state, workers } from './workers-fixture';

eachTest();

describe('parking: the app of a card that waits for the owner', () => {
  /** Workers whose settings stop the app by writing `parked.log` in the workspace, after a grace of `grace` ms. */
  const parking = (more: Partial<NonNullable<RepoAdapter['app']>> = {}, grace = 10, tryGrace?: number) => {
    setWorkers(new Workers({
      board,
      runtime,
      workspaces: spaces,
      adapter: { ...generic, land: 'main', workspaces: 'clones', app: { run: 'Start it with `bun run stack`.', stop: 'echo stopped >> parked.log', ...more } },
      parkGrace: grace,
      ...(tryGrace !== undefined ? { tryGrace } : {}),
    }));
  };
  const stopped = (id: string) => existsSync(join(board.row(id).workspace!, 'parked.log'));
  const handOver = () => {
    const c = manual();
    workers.start(c.id);
    runtime.last.call('ready_for_review', { summary: 'Fertig.', demo: artifact() });
    runtime.last.emit({ type: 'idle' });
    return c;
  };

  test('a card that waits has its app stopped after the grace, and its worker hears so with the next message', async () => {
    parking();
    const c = handOver();
    expect(state(c.id)).toBe('waiting:demo');
    expect(runtime.last.inbox[0]).toContain('While the card waits for the owner, Obeya stops the app in your workspace');
    await until(() => board.row(c.id).parked);
    expect(stopped(c.id)).toBe(true);
    expect(board.events(c.id).at(-1)).toMatchObject({ kind: 'state', author: 'obeya', text: board.t.worker.parked });
    workers.message(c.id, 'Bitte noch die Spalte umbenennen.');
    expect(runtime.last.inbox.at(-1)).toContain('Bitte noch die Spalte umbenennen.');
    expect(runtime.last.inbox.at(-1)).toContain('Obeya stopped the app in your workspace (`echo stopped >> parked.log`)');
    expect(runtime.last.inbox.at(-1)).toContain('start it again as the recipe in your brief says');
    expect(board.row(c.id).parked).toBeNull();
    // only once: the message after that says nothing of it
    runtime.last.emit({ type: 'idle' });
    workers.message(c.id, 'Danke.');
    expect(runtime.last.inbox.at(-1)).not.toContain('stopped the app');
  });

  test('without a recipe, the worker still hears that the app stops while the card waits', async () => {
    parking({ run: undefined });
    const c = handOver();
    expect(runtime.last.inbox[0]).not.toContain('How to run the app:');
    expect(runtime.last.inbox[0]).toContain('While the card waits for the owner, Obeya stops the app in your workspace');
    await until(() => board.row(c.id).parked);
    workers.message(c.id, 'Noch eine Spalte.');
    expect(runtime.last.inbox.at(-1)).toContain('When you need it again, start it again.');
  });

  test('a paused worker has its app stopped like a waiting card, and hears so when it goes on', async () => {
    parking();
    const c = manual();
    workers.start(c.id);
    workers.pause(c.id);
    await until(() => board.row(c.id).parked);
    expect(stopped(c.id)).toBe(true);
    workers.resume(c.id);
    expect(runtime.last.inbox[0]).toContain('The owner paused you and has now let you go on');
    expect(runtime.last.inbox[0]).toContain('Obeya stopped the app in your workspace');
  });

  test('an answer within the grace keeps the app running', async () => {
    parking({}, 60);
    const c = manual();
    workers.start(c.id);
    runtime.last.call('ask', { question: 'Welche Spalten?' });
    runtime.last.emit({ type: 'idle' });
    workers.answer(c.id, 'Datum und Stand.');
    await Bun.sleep(100);
    expect(stopped(c.id)).toBe(false);
    expect(runtime.last.inbox.at(-1)).not.toContain('stopped the app');
  });

  test('a worker whose background work still runs keeps its app', async () => {
    parking();
    const c = manual();
    workers.start(c.id);
    runtime.last.call('ready_for_review', { summary: 'Fertig.', demo: artifact() });
    runtime.last.emit({ type: 'idle', background: 1 });
    await Bun.sleep(60);
    expect(stopped(c.id)).toBe(false);
  });

  test('a card still at work keeps its app', async () => {
    parking();
    const c = manual();
    workers.start(c.id);
    runtime.last.emit({ type: 'text', text: 'Weiter.' });
    runtime.last.emit({ type: 'idle' });
    await Bun.sleep(60);
    expect(stopped(c.id)).toBe(false);
  });

  test('an app that holds what must stay keeps running, and the owner hears why', async () => {
    parking({ keep: 'exit 0' });
    const c = handOver();
    await until(() => board.events(c.id).at(-1)!.text === board.t.worker.parkKept);
    expect(stopped(c.id)).toBe(false);
    expect(board.row(c.id).parked).toBeNull();
  });

  test('an app that does not need keeping is stopped', async () => {
    parking({ keep: 'exit 1' });
    const c = handOver();
    await until(() => board.row(c.id).parked);
    expect(stopped(c.id)).toBe(true);
  });

  test('a stop that fails is an error on the card, and the worker is not told of a stopped app', async () => {
    parking({ stop: 'echo "no pid file" >&2; exit 3' });
    const c = handOver();
    await until(() => board.events(c.id).at(-1)!.kind === 'error');
    expect(board.events(c.id).at(-1)!.text).toBe(board.t.worker.parkFailed('no pid file'));
    expect(board.row(c.id).parked).toBeNull();
    workers.message(c.id, 'Noch etwas.');
    expect(runtime.last.inbox.at(-1)).not.toContain('stopped the app');
  });

  test('a message while the stop runs reaches the worker once the app is stopped', async () => {
    parking({ stop: 'sleep 0.3; echo stopped >> parked.log' });
    const c = handOver();
    await Bun.sleep(80);
    const before = runtime.last.inbox.length;
    workers.message(c.id, 'Noch etwas.');
    expect(runtime.last.inbox.length).toBe(before);
    await until(() => runtime.last.inbox.length > before);
    expect(stopped(c.id)).toBe(true);
    expect(runtime.last.inbox.at(-1)).toContain('Noch etwas.');
    expect(runtime.last.inbox.at(-1)).toContain('Obeya stopped the app');
  });

  test('after a restart, a card that waits is parked; its worker hears so when the session resumes', async () => {
    parking();
    const c = manual();
    workers.start(c.id);
    runtime.last.emit({ type: 'session', id: 'sess-1' });
    runtime.last.call('ask', { question: 'Welche Spalten?' });
    workers.shutdown();
    parking();
    workers.resumeAll();
    await until(() => board.row(c.id).parked);
    workers.answer(c.id, 'Datum.');
    expect(runtime.last.spec.resume).toBe('sess-1');
    expect(runtime.last.inbox[0]).toContain('Obeya stopped the app');
  });

  test('the app the worker says runs is offered on the card until Obeya stops it', async () => {
    parking({}, 40);
    const c = manual();
    workers.start(c.id);
    expect(runtime.last.inbox[0]).toContain('give its address with app_running');
    expect(runtime.last.call('app_running', { url: 'localhost:5173' })).toContain('Not recorded');
    runtime.last.call('app_running', { url: 'http://localhost:5173/' });
    expect(board.item(c.id)!.app).toBe('http://localhost:5173/');
    runtime.last.call('app_running', { url: '' });
    expect(board.item(c.id)!.app).toBeUndefined();
    runtime.last.call('app_running', { url: 'http://localhost:5174/' });
    runtime.last.call('ready_for_review', { summary: 'Fertig.', demo: artifact() });
    runtime.last.emit({ type: 'idle' });
    await until(() => board.row(c.id).parked);
    expect(board.item(c.id)!.app).toBeUndefined();
    expect(await workers.openApp(c.id)).toBeNull();
  });

  test('the owner opening the app keeps it running past the grace', async () => {
    parking({}, 10, 150);
    const c = manual();
    workers.start(c.id);
    runtime.last.call('app_running', { url: 'http://localhost:5173/' });
    runtime.last.call('ready_for_review', { summary: 'Fertig.', demo: artifact() });
    runtime.last.emit({ type: 'idle' });
    expect(await workers.openApp(c.id)).toBe('http://localhost:5173/');
    await Bun.sleep(80);
    expect(stopped(c.id)).toBe(false);
    await until(() => board.row(c.id).parked);
    expect(stopped(c.id)).toBe(true);
  });

  test('the app counts as running while it answers at its address', async () => {
    parking();
    const c = manual();
    workers.start(c.id);
    expect(await workers.appUp(c.id)).toBe(false);
    const app = Bun.serve({ port: 0, fetch: () => new Response('nicht gefunden', { status: 404 }) });
    runtime.last.call('app_running', { url: `http://localhost:${app.port}/` });
    expect(await workers.appUp(c.id)).toBe(true);
    await app.stop(true);
    expect(await workers.appUp(c.id)).toBe(false);
  });

  test('without a stop in the settings nothing is stopped', async () => {
    const c = handOver();
    await Bun.sleep(30);
    expect(board.row(c.id).parked).toBeNull();
  });
});

describe('handing over with a demo', () => {
  const demoDir = () => {
    const d = join(dir, 'demo');
    Bun.spawnSync(['mkdir', '-p', d]);
    writeFileSync(join(d, 'demo.mp4'), 'x');
    writeFileSync(join(d, 'poster.jpg'), 'x');
    writeFileSync(join(d, 'captions.vtt'), 'WEBVTT\n\n00:00:00.350 --> 00:00:05.000\nA.\n\n00:00:06.350 --> 00:00:09.000\nB.\n');
    return d;
  };
  const demo = (d: string, chapters = ['Vorher', 'Nachher']) => ({ dir: d, chapters, question: 'Semikolon oder Komma?' });

  test('the worker gets the demo skill from the plugin that comes with Obeya, its brief names it, and it knows where Obeya is', () => {
    rmSync(dir, { recursive: true, force: true });
    setup({ ...generic, land: 'main', workspaces: 'clones', app: { run: 'bun start' } });
    const c = manual();
    workers.start(c.id);
    expect(runtime.last.spec.plugins).toEqual([OBEYA_PLUGIN]);
    // a demo's narration finds Obeya, which holds the voice across renders
    expect(runtime.last.spec.env).toEqual({ OBEYA_URL: 'http://127.0.0.1:4417' });
    expect(existsSync(DEMO_SKILL_FILE)).toBe(true);
    // a session that does not know the skill reads its file
    expect(runtime.last.inbox[0]).toContain(`recorded with the demo skill (\`${demoSkillName()}\`; if your session does not know it, read its file ${DEMO_SKILL_FILE} and follow that)`);
  });

  test("a repository that names the language of its demos gives it to the worker's demo skill", () => {
    rmSync(dir, { recursive: true, force: true });
    setup({ ...generic, land: 'main', workspaces: 'clones', demo: { language: 'en' } });
    workers.start(manual().id);
    expect(runtime.last.spec.env).toEqual({ OBEYA_URL: 'http://127.0.0.1:4417', DEMO_LANGUAGE: 'en' });
  });

  test('the card waits with the demo; its files are found; words under it answer its question and leave the demo', () => {
    const c = manual();
    workers.start(c.id);
    const d = demoDir();
    expect(runtime.last.call('ready_for_review', { summary: 'S', demo: demo(d) })).toContain('End your turn');
    expect(state(c.id)).toBe('waiting:demo');
    const { id: handover, at } = board.events(c.id).findLast((e) => e.kind === 'review')!;
    expect(board.item(c.id)!.demo).toEqual({ kind: 'video', chapters: [[0, 'Vorher'], [6, 'Nachher']], question: 'Semikolon oder Komma?', handover, at });
    expect(board.item(c.id)!.summary).toBe('S');
    expect(board.demoFiles(c.id)).toEqual({ dir: d, kind: 'video' });
    workers.message(c.id, 'Semikolon, und bitte mit Kopfzeile.');
    expect(state(c.id)).toBe('waiting:demo');
    expect(board.item(c.id)!.answering).toBe(true);
    expect(board.item(c.id)!.demo!.answer).toBe('Semikolon, und bitte mit Kopfzeile.');
    expect(runtime.last.inbox.at(-1)).toContain('a change their words call for goes into a new handover');
    // the demo stays with the card while it is reworked and after it is done
    expect(board.demoFiles(c.id)).toEqual({ dir: d, kind: 'video' });
    expect(board.item(c.id)!.demo!.chapters).toHaveLength(2);
  });

  test('the question in the demo report is answered on the card; the demo still waits for approval', () => {
    const c = manual();
    workers.start(c.id);
    runtime.last.call('ready_for_review', { summary: 'S', demo: demo(demoDir()) });
    runtime.last.emit({ type: 'idle' });
    expect(board.item(c.id)!.question).toEqual({ text: 'Semikolon oder Komma?', options: [] });
    const n = runtime.last.inbox.length;
    workers.answer(c.id, 'Semikolon.');
    expect(state(c.id)).toBe('waiting:demo');
    expect(board.item(c.id)!.question).toBeUndefined();
    expect(board.item(c.id)!.demo!.answer).toBe('Semikolon.');
    expect(runtime.last.inbox.at(-1)).toContain('answered the question in your demo report');
    expect(runtime.last.inbox.at(-1)).toContain('Semikolon.');
    // while the worker takes in the answer, the card is not the owner's
    expect(board.item(c.id)!.answering).toBe(true);
    expect(needsYou(board.item(c.id)!)).toBe(false);
    // the worker takes note and ends its turn: no nudge, the card keeps waiting, and is the owner's again
    runtime.last.emit({ type: 'text', text: 'Bleibt beim Semikolon.' });
    runtime.last.emit({ type: 'idle' });
    expect(runtime.last.inbox).toHaveLength(n + 1);
    expect(state(c.id)).toBe('waiting:demo');
    expect(board.item(c.id)!.answering).toBeUndefined();
    expect(needsYou(board.item(c.id)!)).toBe(true);
    expect(board.decisions(null).at(-1)).toMatchObject({ question: 'Semikolon oder Komma?', answer: 'Semikolon.', by: 'owner' });
    expect(() => workers.answer(c.id, 'Komma.')).toThrow(BadRequest);
  });

  test('a handover that keeps the demo leaves its answered question with the handover it came with', () => {
    const c = manual();
    workers.start(c.id);
    runtime.last.call('ready_for_review', { summary: 'S', demo: demo(demoDir()) });
    runtime.last.emit({ type: 'idle' });
    const first = board.events(c.id).findLast((e) => e.kind === 'review')!.id;
    workers.answer(c.id, 'Semikolon.');
    runtime.last.call('ready_for_review', { summary: 'Entscheidung festgehalten.' });
    runtime.last.emit({ type: 'idle' });
    expect(state(c.id)).toBe('waiting:demo');
    expect(board.item(c.id)!.question).toBeUndefined();
    expect(board.item(c.id)!.demo).toMatchObject({ question: 'Semikolon oder Komma?', answer: 'Semikolon.', handover: first });
  });

  test('a worker that reworks its demo after the answer hands over anew; until then the card is at work', () => {
    const c = manual();
    workers.start(c.id);
    runtime.last.call('ready_for_review', { summary: 'S', demo: demo(demoDir()) });
    runtime.last.emit({ type: 'idle' });
    workers.answer(c.id, 'Komma, bitte.');
    // a turn the session ends before it took in the answer leaves the card with the worker
    runtime.last.emit({ type: 'idle' });
    expect(needsYou(board.item(c.id)!)).toBe(false);
    runtime.last.emit({ type: 'tool', name: 'Edit', input: {} });
    expect(needsYou(board.item(c.id)!)).toBe(false);
    runtime.last.call('ready_for_review', { summary: 'Jetzt mit Komma.', demo: { dir: demoDir(), chapters: ['Vorher', 'Nachher'] } });
    runtime.last.emit({ type: 'idle' });
    expect(state(c.id)).toBe('waiting:demo');
    expect(board.item(c.id)!.summary).toEndWith('Jetzt mit Komma.');
    expect(board.item(c.id)!.answering).toBeUndefined();
    expect(needsYou(board.item(c.id)!)).toBe(true);
  });

  test('an answer to the owner\'s words without a new demo marks the card answered; a new demo is a demo again', () => {
    const c = manual();
    workers.start(c.id);
    runtime.last.call('ready_for_review', { summary: 'S', demo: { dir: demoDir(), chapters: ['Vorher', 'Nachher'] } });
    runtime.last.emit({ type: 'idle' });
    expect(board.item(c.id)!.answered).toBeUndefined();
    // a reply alone
    workers.message(c.id, 'Warum zwei Spalten?');
    expect(board.item(c.id)!.answered).toBeUndefined();
    runtime.last.emit({ type: 'tool', name: 'Read', input: {} });
    runtime.last.call('reply', { text: 'Weil die Tabelle sonst zu breit wird.' });
    runtime.last.emit({ type: 'idle' });
    expect(state(c.id)).toBe('waiting:demo');
    expect(board.item(c.id)!.answered).toBe(true);
    expect(needsYou(board.item(c.id)!)).toBe(true);
    // further words: the card is at work again, not answered
    workers.message(c.id, 'Und die Kopfzeile?');
    expect(board.item(c.id)!.answering).toBe(true);
    expect(board.item(c.id)!.answered).toBeUndefined();
    // a handover that keeps the demo answers them too
    runtime.last.call('ready_for_review', { summary: 'Kopfzeile ergänzt.' });
    runtime.last.emit({ type: 'idle' });
    expect(state(c.id)).toBe('waiting:demo');
    expect(board.item(c.id)!.answered).toBe(true);
    // a new demo is what the owner looks at next
    workers.message(c.id, 'Zeig mal.');
    runtime.last.call('ready_for_review', { summary: 'Mit Video.', demo: { dir: demoDir(), chapters: ['Vorher', 'Nachher'] } });
    runtime.last.emit({ type: 'idle' });
    expect(state(c.id)).toBe('waiting:demo');
    expect(board.item(c.id)!.answered).toBeUndefined();
  });

  test('words its worker never answers do not read as answered, though it answered the ones before', async () => {
    const c = manual();
    workers.start(c.id);
    runtime.last.call('ready_for_review', { summary: 'S', demo: { dir: demoDir(), chapters: ['Vorher', 'Nachher'] } });
    runtime.last.emit({ type: 'idle' });
    workers.message(c.id, 'Warum zwei Spalten?');
    runtime.last.emit({ type: 'tool', name: 'Read', input: {} });
    runtime.last.call('reply', { text: 'Weil die Tabelle sonst zu breit wird.' });
    runtime.last.emit({ type: 'idle' });
    expect(board.item(c.id)!.answered).toBe(true);
    // a turn that breaks off with an error, without a word for the owner
    workers.message(c.id, 'Stimmen die Werte?');
    runtime.last.emit({ type: 'error', message: 'API Error: 500' });
    runtime.last.emit({ type: 'idle' });
    expect(state(c.id)).toBe('waiting:demo');
    expect(board.item(c.id)!.answered).toBeUndefined();
    expect(board.events(c.id).at(-1)).toMatchObject({ kind: 'state', author: 'obeya', text: board.t.worker.unanswered });
    // a session that ends before its turn does
    workers.message(c.id, 'Und jetzt?');
    runtime.last.close();
    await until(() => !board.item(c.id)!.answering);
    expect(state(c.id)).toBe('waiting:demo');
    expect(board.item(c.id)!.answered).toBeUndefined();
    expect(board.events(c.id).at(-1)).toMatchObject({ kind: 'state', text: board.t.worker.unanswered });
    expect(needsYou(board.item(c.id)!)).toBe(true);
    // an error after the turn ended (a session that cannot be resumed reports it twice) leaves no worker shown in a turn
    workers.message(c.id, 'Noch da?');
    const gone = runtime.last;
    gone.emit({ type: 'error', message: 'No conversation found' });
    gone.emit({ type: 'idle' });
    gone.emit({ type: 'error', message: 'Claude Code returned an error result: No conversation found' });
    gone.close();
    await until(() => !board.item(c.id)!.inTurn);
    expect(board.item(c.id)!.answered).toBeUndefined();
    // words that end the turn answer it, without a reply
    workers.message(c.id, 'Und jetzt?');
    runtime.last.emit({ type: 'text', text: 'Ja, sie stimmen.' });
    runtime.last.emit({ type: 'idle' });
    expect(board.item(c.id)!.answered).toBe(true);
  });

  test('a worker that a background command wakes after it answered is at work again until its turn ends', () => {
    const c = manual();
    workers.start(c.id);
    runtime.last.call('ready_for_review', { summary: 'S', demo: { dir: demoDir(), chapters: ['Vorher', 'Nachher'] } });
    runtime.last.emit({ type: 'idle' });
    workers.message(c.id, 'Auf dem Telefon geht es nicht.');
    runtime.last.emit({ type: 'tool', name: 'Bash', input: { command: 'bun test', run_in_background: true } });
    runtime.last.call('reply', { text: 'Nachgestellt und behoben; Tests laufen, eine neue Übergabe folgt.' });
    // the test run ended before the turn did: the turn ends with nothing in the background
    runtime.last.emit({ type: 'idle' });
    expect(board.item(c.id)!.answered).toBe(true);
    // its notification wakes the worker, which reruns what failed
    runtime.last.emit({ type: 'tool', name: 'Bash', input: { command: 'bun test' } });
    expect(board.item(c.id)).toMatchObject({ state: 'waiting', need: 'demo', answering: true });
    expect(board.item(c.id)!.answered).toBeUndefined();
    expect(needsYou(board.item(c.id)!)).toBe(false);
    // more steps in the same turn change nothing
    runtime.last.emit({ type: 'text', text: 'Läuft.' });
    expect(board.item(c.id)!.answering).toBe(true);
    // the new handover keeps the demo: the card is the owner's again
    runtime.last.call('ready_for_review', { summary: 'Behoben.' });
    runtime.last.emit({ type: 'idle' });
    expect(board.item(c.id)!.answered).toBe(true);
    expect(needsYou(board.item(c.id)!)).toBe(true);
  });

  test('a worker taking in an answer resumes after a restart; a session that ends gives the demo back to the owner', async () => {
    const c = manual();
    workers.start(c.id);
    runtime.last.emit({ type: 'session', id: 'sess-1' });
    runtime.last.call('ready_for_review', { summary: 'S', demo: demo(demoDir()) });
    runtime.last.emit({ type: 'idle' });
    workers.answer(c.id, 'Semikolon.');
    workers.shutdown();
    workers.resumeAll();
    expect(runtime.last.spec.resume).toBe('sess-1');
    expect(needsYou(board.item(c.id)!)).toBe(false);
    runtime.last.close();
    await until(() => !board.item(c.id)!.answering);
    expect(state(c.id)).toBe('waiting:demo');
    expect(needsYou(board.item(c.id)!)).toBe(true);
  });

  test('a worker taking in an answer that pauses for a restart is resumed by it', () => {
    const c = manual();
    workers.start(c.id);
    runtime.last.emit({ type: 'session', id: 'sess-1' });
    runtime.last.call('ready_for_review', { summary: 'S', demo: demo(demoDir()) });
    runtime.last.emit({ type: 'idle' });
    workers.answer(c.id, 'Nimm die andere Stimme.');
    const busy = runtime.last;
    busy.emit({ type: 'text', text: 'Ich rendere mit der anderen Stimme.' });
    workers.restartDue({ reason: 'code', deadline: Date.now() + 15 * 60_000 });
    busy.emit({ type: 'text', text: 'Ich pausiere für den Neustart.' });
    busy.emit({ type: 'idle' });
    expect(board.events(c.id).at(-1)).toMatchObject({ kind: 'state', text: 'Pausiert bis zum Neustart von Obeya.' });
    expect(board.item(c.id)!.answering).toBe(true);
    expect(needsYou(board.item(c.id)!)).toBe(false);
    workers.shutdown();
    workers.restartDue(null);
    workers.resumeAll();
    expect(runtime.last).not.toBe(busy);
    expect(runtime.last.spec.resume).toBe('sess-1');
  });

  test('after feedback, the worker may hand over again without a new demo: the one on the card stands', () => {
    rmSync(dir, { recursive: true, force: true });
    setup({ ...generic, land: 'main', workspaces: 'clones', app: { run: 'bun start' } });
    const c = manual();
    workers.start(c.id);
    runtime.last.call('ready_for_review', { summary: 'S', demo: demo(demoDir()) });
    workers.message(c.id, 'Nur den Text ändern.');
    expect(runtime.last.call('ready_for_review', { summary: 'Text geändert.' })).toContain('End your turn');
    expect(state(c.id)).toBe('waiting:demo');
    expect(board.item(c.id)!.summary).toEndWith('Text geändert.');
    expect(board.item(c.id)!.demo!.chapters).toHaveLength(2);
  });

  test('a new demo keeps the one it replaces for the owner to go back to, while its files are on disk', () => {
    const c = manual();
    workers.start(c.id);
    const first = artifact();
    runtime.last.call('ready_for_review', { summary: 'S', demo: first });
    const handover = board.events(c.id).findLast((e) => e.kind === 'review')!;
    workers.message(c.id, 'Den Button ausrichten.');
    const second = demoDir();
    runtime.last.call('ready_for_review', { summary: 'Ausgerichtet.', demo: demo(second, ['Nachher', 'Danach']) });
    expect(board.item(c.id)!.demo!.chapters).toEqual([[0, 'Nachher'], [6, 'Danach']]);
    expect(board.item(c.id)!.demos).toEqual([{ kind: 'html', chapters: [], single: true, handover: handover.id, at: handover.at, n: 0 }]);
    expect(board.demoFiles(c.id, 0)).toEqual({ dir: first.dir, kind: 'html' });
    expect(board.demoFiles(c.id)).toEqual({ dir: second, kind: 'video' });
    // a handover without a new demo keeps both as they are
    runtime.last.call('ready_for_review', { summary: 'Text geändert.' });
    expect(board.item(c.id)!.demos).toHaveLength(1);
    // a demo rendered again into the same directory replaced the files of the one before: nothing to go back to
    runtime.last.call('ready_for_review', { summary: 'Neu aufgenommen.', demo: demo(second) });
    expect(board.item(c.id)!.demos!.map((d) => d.n)).toEqual([0]);
    // demos are deleted to free space: one whose files are gone is no longer offered, from the canvas's next change on
    rmSync(first.dir, { recursive: true, force: true });
    board.work(c.id, { status_line: 'Liest' });
    expect(board.item(c.id)!.demos).toBeUndefined();
  });

  test('where demos are shared, a video or an artifact comes with its page for colleagues, kept with the demo', () => {
    rmSync(dir, { recursive: true, force: true });
    setup({ ...generic, land: 'main', workspaces: 'clones', app: { run: 'bun start' }, demo: { site: { title: 'Demos', url: 'https://demos.example.dev', deploy: 'deploy {dir}' } } });
    const c = manual();
    workers.start(c.id);
    expect(runtime.last.inbox[0]).toContain('share the demo, a video or an HTML artifact, with colleagues');
    const d = demoDir();
    expect(runtime.last.call('ready_for_review', { summary: 'S', demo: demo(d) })).toContain('needs its page');
    expect(state(c.id)).toBe('working');
    const page = { title: 'Zählerstände als CSV', text: 'Vermieter laden die Zählerstände jetzt als CSV herunter.' };
    expect(runtime.last.call('ready_for_review', { summary: 'S', demo: { ...demo(d), page } })).toContain('End your turn');
    expect(board.item(c.id)!.demo!.page).toEqual(page);

    const a = join(dir, 'auswertung');
    Bun.spawnSync(['mkdir', '-p', a]);
    writeFileSync(join(a, 'index.html'), '<h2>Graph</h2>');
    const html = { kind: 'html', dir: a, shown: ['Graph'], not_shown: [], findings: [] };
    workers.message(c.id, 'Bitte als Auswertung.');
    expect(runtime.last.call('ready_for_review', { summary: 'S', demo: html })).toContain('needs its page');
    expect(runtime.last.call('ready_for_review', { summary: 'S', demo: { ...html, page } })).toContain('End your turn');
    // its index.html alone: it also goes out as one HTML file
    expect(board.item(c.id)!.demo).toMatchObject({ kind: 'html', page, single: true });
  });

  test('a broken demo or a missing one is refused, and the worker keeps the card', () => {
    const c = manual();
    workers.start(c.id);
    expect(runtime.last.call('ready_for_review', { summary: 'S', demo: demo(demoDir(), ['Nur eins']) })).toContain('Not handed over');
    expect(state(c.id)).toBe('working');
    rmSync(dir, { recursive: true, force: true });
    setup({ ...generic, land: 'main', workspaces: 'clones', app: { run: 'bun start' } });
    const d = manual();
    workers.start(d.id);
    expect(runtime.last.inbox[0]).toContain('How to run the app: bun start');
    expect(runtime.last.call('ready_for_review', { summary: 'S' })).toContain(`every handover brings a demo. Record it with the demo skill (\`${demoSkillName()}\`; if your session does not know it, read its file ${DEMO_SKILL_FILE} and follow that)`);
    expect(state(d.id)).toBe('working');
  });

  test('an HTML artifact instead of a video: it needs its page', () => {
    const c = manual();
    workers.start(c.id);
    const d = join(dir, 'logos');
    Bun.spawnSync(['mkdir', '-p', join(d, 'img')]);
    const html = { kind: 'html', dir: d };
    expect(runtime.last.call('ready_for_review', { summary: 'S', demo: html })).toContain('index.html is missing');
    expect(state(c.id)).toBe('working');
    writeFileSync(join(d, 'index.html'), '<img src="img/a.svg">');
    writeFileSync(join(d, 'img', 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(runtime.last.call('ready_for_review', { summary: 'S', demo: html })).toContain('End your turn');
    expect(state(c.id)).toBe('waiting:demo');
    expect(board.item(c.id)!.demo).toMatchObject({ kind: 'html', chapters: [] });
    expect(board.demoFiles(c.id)).toEqual({ dir: d, kind: 'html' });
  });

  test('every handover brings a demo: one without is refused; without a recipe the worker finds out how to run the app', () => {
    rmSync(dir, { recursive: true, force: true });
    setup({ ...generic, land: 'main', workspaces: 'clones' });
    const c = manual();
    workers.start(c.id);
    expect(runtime.last.inbox[0]).toContain('Then show the owner the result with a demo');
    expect(runtime.last.inbox[0]).toContain("The repository's settings say nothing yet about how to run the app: find it out from the repository");
    expect(runtime.last.inbox[0]).not.toContain('How to run the app:');
    expect(runtime.last.inbox[0]).toContain('Where either would do, record the video');
    expect(runtime.last.inbox[0]).not.toContain('no_demo');
    expect(runtime.last.call('ready_for_review', { summary: 'Gibt es schon.' })).toContain('Not handed over: every handover brings a demo.');
    expect(state(c.id)).toBe('working');
    expect(runtime.last.call('ready_for_review', { summary: 'Gibt es schon.', demo: artifact() })).toContain('End your turn');
    expect(state(c.id)).toBe('waiting:demo');
    // after feedback, a handover without a new demo keeps the one on the card
    workers.message(c.id, 'Wo genau?');
    expect(runtime.last.call('ready_for_review', { summary: 'In der Kopfzeile.' })).toContain('End your turn');
    expect(state(c.id)).toBe('waiting:demo');
  });
});

describe('comments on places in the demo video', () => {
  let images: Images;
  /** A card waiting with a demo of two scenes, the second narrated in two sentences. */
  const waiting = (question?: string) => {
    images = new Images(join(dir, 'images'));
    setWorkers(new Workers({ board, runtime, workspaces: spaces, adapter: generic, imageFiles: (ids = []) => ids.flatMap((i) => images.path(i) ?? []), releaseDelay: 5, holdGrace: 60_000 }));
    const d = join(dir, 'demo');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'demo.mp4'), 'x');
    writeFileSync(join(d, 'captions.vtt'), 'WEBVTT\n\n00:00:00.350 --> 00:00:05.000\nDie Liste.\n\n00:00:06.350 --> 00:00:16.350\nJetzt der Export. Die Datei hat eine Kopfzeile.\n');
    const c = manual();
    workers.start(c.id);
    runtime.last.call('ready_for_review', { summary: 'S', demo: { dir: d, chapters: ['Liste', 'Export'], ...(question ? { question } : {}) } });
    runtime.last.emit({ type: 'idle' });
    return c;
  };
  const still = () => images.save(new Uint8Array([1, 2, 3]), 'image/jpeg');

  test('stand in the conversation at once, and reach the worker together once the owner has finished watching', async () => {
    const c = waiting();
    const n = runtime.last.inbox.length;
    const frame = still();
    workers.message(c.id, 'Hier fehlt die Kopfzeile.', [], false, undefined, { at: 7.24, still: frame });
    workers.message(c.id, 'Zu schnell.', [], true, undefined, { at: 14 });
    const said = board.events(c.id).filter((e) => e.author === 'owner');
    const demo = board.item(c.id)!.demo!.handover;
    expect(said.map((e) => e.spot)).toEqual([
      { at: 7.2, chapter: 'Export', narration: 'Jetzt der Export.', still: frame, demo },
      { at: 14, chapter: 'Export', narration: 'Die Datei hat eine Kopfzeile.', demo },
    ]);
    // the worker hears nothing yet, and the card is still the owner's
    expect(runtime.last.inbox).toHaveLength(n);
    expect(board.item(c.id)!.held).toEqual(said.map((e) => e.id));
    expect(needsYou(board.item(c.id)!)).toBe(true);
    workers.released(c.id);
    await until(() => runtime.last.inbox.length > n);
    expect(runtime.last.inbox).toHaveLength(n + 1);
    expect(runtime.last.inbox.at(-1)).toBe(
      [
        'The owner watched your demo video and commented on places in it. The card still waits for their approval of what you handed over; a change their words call for goes into a new handover:',
        '2 comments on places in your demo video (their frames and screenshots are shown below, in this order):',
        `[Demo video at 0:07, chapter „Export“, narration: „Jetzt der Export.“]\nHier fehlt die Kopfzeile.\n(frame: ${images.path(frame)})`,
        '[Demo video at 0:14, chapter „Export“, narration: „Die Datei hat eine Kopfzeile.“] (spoken, so speech recognition may have misheard words)\nZu schnell.',
      ].join('\n\n'),
    );
    expect(runtime.last.images.at(-1)).toEqual([images.path(frame)!]);
    expect(board.item(c.id)!.held).toBeUndefined();
    expect(board.item(c.id)!.answering).toBe(true);
    // released again, nothing more goes
    workers.released(c.id);
    await Bun.sleep(20);
    expect(runtime.last.inbox).toHaveLength(n + 1);
  });

  test('sent by the owner, they go at once; one deleted before leaves the conversation and never reaches the worker', () => {
    const c = waiting();
    const n = runtime.last.inbox.length;
    const gone: number[] = [];
    board.onEventGone((_, id) => gone.push(id));
    workers.message(c.id, 'Das stimmt nicht.', [], false, undefined, { at: 2 });
    workers.message(c.id, 'Hier fehlt die Kopfzeile.', [], false, undefined, { at: 7 });
    const [first, second] = board.events(c.id).filter((e) => e.author === 'owner');
    workers.unsay(c.id, first!.id);
    expect(gone).toEqual([first!.id]);
    expect(board.events(c.id).some((e) => e.id === first!.id)).toBe(false);
    expect(board.item(c.id)!.held).toEqual([second!.id]);
    // what went already, or was never held, cannot be deleted
    expect(() => workers.unsay(c.id, first!.id)).toThrow(BadRequest);
    workers.released(c.id, true);
    expect(runtime.last.inbox).toHaveLength(n + 1);
    expect(runtime.last.inbox.at(-1)).toContain('A comment on places in your demo video:\n\n[Demo video at 0:07, chapter „Export“, narration: „Jetzt der Export.“]\nHier fehlt die Kopfzeile.');
    expect(runtime.last.inbox.at(-1)).not.toContain('Das stimmt nicht.');
    expect(board.item(c.id)!.held).toBeUndefined();
    expect(() => workers.unsay(c.id, second!.id)).toThrow(BadRequest);
  });

  test('stand below what the worker does meanwhile until sent, then where they went', () => {
    const c = waiting();
    const comment = (workers.message(c.id, 'Zu schnell.', [], false, undefined, { at: 2 }), board.events(c.id).at(-1)!);
    expect(comment.unread).toBe(true);
    // the worker still takes in earlier words on its handover
    const step = board.log(c.id, 'say', 'worker', 'Editing the adapter code now.');
    expect(board.events(c.id).find((e) => e.id === comment.id)!.unread).toBe(true);
    workers.released(c.id, true);
    const sent = board.events(c.id).find((e) => e.id === comment.id)!;
    expect(sent.unread).toBeUndefined();
    expect(sent.readAfter).toBe(step.id);
  });

  test('all deleted, nothing goes, also once the wait is over', async () => {
    const c = waiting();
    setWorkers(new Workers({ board, runtime, workspaces: spaces, adapter: generic, holdGrace: 10 }));
    const n = runtime.last.inbox.length;
    workers.message(c.id, 'Doch nicht.', [], false, undefined, { at: 1 });
    workers.unsay(c.id, board.events(c.id).at(-1)!.id);
    expect(board.item(c.id)!.held).toBeUndefined();
    await Bun.sleep(30);
    expect(runtime.last.inbox).toHaveLength(n);
  });

  test('words without a place take the comments along in one message; a comment does not answer the demo report’s question', () => {
    const c = waiting('Semikolon oder Komma?');
    const n = runtime.last.inbox.length;
    workers.message(c.id, 'Hier ruckelt es.', [], false, undefined, { at: 2 });
    expect(board.item(c.id)!.question).toEqual({ text: 'Semikolon oder Komma?', options: [] });
    expect(runtime.last.inbox).toHaveLength(n);
    workers.message(c.id, 'Semikolon.');
    expect(runtime.last.inbox).toHaveLength(n + 1);
    expect(runtime.last.inbox.at(-1)).toContain('A comment on places in your demo video:\n\n[Demo video at 0:02, chapter „Liste“, narration: „Die Liste.“]\nHier ruckelt es.\n\nThen they answered:\n\nSemikolon.');
    expect(board.item(c.id)!.demo!.answer).toBe('Semikolon.');
    expect(board.item(c.id)!.held).toBeUndefined();
  });

  test('go without a sign from the owner once the last one has waited long enough, also after a restart', async () => {
    const c = waiting();
    setWorkers(new Workers({ board, runtime, workspaces: spaces, adapter: generic, holdGrace: 10 }));
    const n = runtime.last.inbox.length;
    workers.message(c.id, 'Hier.', [], false, undefined, { at: 1 });
    workers.shutdown();
    expect(runtime.last.inbox).toHaveLength(n);
    workers.resumeAll();
    await until(() => !board.item(c.id)!.held);
    expect(runtime.sessions.flatMap((s) => s.inbox).at(-1)).toContain('Hier.');
  });

  test('an approval takes them, also one clicked as the card closes', async () => {
    const c = waiting();
    workers.message(c.id, 'Etwas kleiner.', [], false, undefined, { at: 1 });
    // the card folds with the click: its video stops being watched while the approval is on its way
    workers.released(c.id);
    await workers.approve(c.id);
    await Bun.sleep(20);
    const told = runtime.sessions.flatMap((s) => s.inbox);
    expect(told.filter((m) => m.includes('Etwas kleiner.'))).toHaveLength(1);
    expect(told.at(-1)).toContain('The owner approved your work.');
    expect(told.at(-1)).toContain('Before approving, the owner watched your demo video. A comment on places in your demo video:\n\n[Demo video at 0:01, chapter „Liste“, narration: „Die Liste.“]\nEtwas kleiner.\n\nThey approved the work as it is all the same');
  });

  test('one on a demo a later handover replaced is placed in that demo, and the worker hears which', () => {
    const c = waiting();
    const first = board.events(c.id).findLast((e) => e.kind === 'review')!.id;
    const d = join(dir, 'demo-2');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'demo.mp4'), 'x');
    writeFileSync(join(d, 'captions.vtt'), 'WEBVTT\n\n00:00:00.350 --> 00:00:04.000\nNur die Zeile.\n');
    runtime.last.call('ready_for_review', { summary: 'Nur die Zeile.', demo: { dir: d, chapters: ['Zeile'] } });
    const second = board.events(c.id).findLast((e) => e.kind === 'review')!.id;
    board.work(c.id, { state: 'working', need: null });
    workers.message(c.id, 'Hier war es noch falsch.', [], false, undefined, { at: 7, demo: first });
    expect(board.events(c.id).at(-1)!.spot).toEqual({ at: 7, chapter: 'Export', narration: 'Jetzt der Export.', demo: first, earlier: true });
    expect(runtime.last.inbox.at(-1)).toContain('[Earlier demo video, one a later handover of yours replaced, at 0:07, chapter „Export“, narration: „Jetzt der Export.“]\nHier war es noch falsch.');
    // one on the card's demo names it too, for a click on it once a later handover replaced that one as well
    runtime.last.emit({ type: 'idle' });
    board.work(c.id, { state: 'working', need: null });
    workers.message(c.id, 'Gut so.', [], false, undefined, { at: 1 });
    expect(board.events(c.id).at(-1)!.spot).toEqual({ at: 1, chapter: 'Zeile', narration: 'Nur die Zeile.', demo: second });
    expect(runtime.last.inbox.at(-1)).toContain('[Demo video at 0:01, chapter „Zeile“');
  });

  test('while the worker works, one goes to it at once, with its place and frame', () => {
    const c = waiting();
    // at work again, after a note say
    board.work(c.id, { state: 'working', need: null });
    const frame = still();
    workers.message(c.id, 'Und hier.', [], false, undefined, { at: 6.5, still: frame });
    expect(runtime.last.inbox.at(-1)).toContain(`[Demo video at 0:06, chapter „Export“, narration: „Jetzt der Export.“]\nUnd hier.\n\nThe frame at that place in the video is shown below (file: ${images.path(frame)}).`);
    expect(runtime.last.images.at(-1)).toEqual([images.path(frame)!]);
    expect(board.events(c.id).at(-1)).toMatchObject({ text: 'Und hier.', spot: { at: 6.5, still: frame } });
    expect(board.item(c.id)!.held).toBeUndefined();
  });
});
