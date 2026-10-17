import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { needsYou } from '../core/types';
import { CanvasRuntime } from './canvas';
import { Store } from './db';
import { FakeRuntime, type FakeSession, gitRepo, noForge } from './testing';

let dir: string;
let main: string;
let store: Store;
let runtime: FakeRuntime;
let canvas: CanvasRuntime;

const open = () => new CanvasRuntime({ repos: [{ path: main, clones: 1, settings: { land: 'main' } }] }, { store, home: dir, runtime, forge: noForge, commandDelayMs: 10 });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-snooze-'));
  main = join(dir, 'main');
  gitRepo(main);
  mkdirSync(join(main, 'docs/plan'), { recursive: true });
  store = new Store(':memory:');
  runtime = new FakeRuntime();
  canvas = open();
});
afterEach(() => {
  canvas.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const board = () => canvas.board;
const item = (id: string) => board().item(id)!;
const workers = () => canvas.repos[0]!.workers;
const last = (id: string) => board().events(id).at(-1)!;
const HOUR = 60 * 60_000;
/** A time from now, as the agent or the browser sends it. */
const later = (ms: number) => new Date(Date.now() + ms).toISOString();

/** A card at work, its session known as `sess-1`. */
function atWork(): { id: string; s: FakeSession } {
  const c = board().create({ title: 'Lüftertest', x: 0, y: 0 });
  workers().start(c.id);
  const s = runtime.last;
  s.emit({ type: 'session', id: 'sess-1' });
  s.emit({ type: 'tool', name: 'Bash', input: { command: 'ha automation reload' } });
  return { id: c.id, s };
}

describe('the agent snoozes itself', () => {
  test('its session ends with its turn, the card holds no slot and needs nobody, and a restart touches nothing', () => {
    const { id, s } = atWork();
    const until = later(30 * HOUR);
    expect(s.call('snooze', { until, why: 'Testergebnis prüfen' })).toContain('End your turn now');
    expect(item(id).snoozed).toEqual({ until: new Date(until).toISOString(), by: 'agent', why: 'Testergebnis prüfen' });
    expect(last(id)).toMatchObject({ kind: 'state', author: 'worker', text: expect.stringMatching(/^Zurückgestellt bis .* · Testergebnis prüfen$/) });
    // its closing words repeat the snooze
    s.emit({ type: 'text', text: 'Ich melde mich morgen früh.' });
    s.emit({ type: 'idle' });
    expect(s.closed).toBe(true);
    expect(workers().busyCards()).toEqual([]);
    expect(board().events(id).some((e) => e.text === 'Ich melde mich morgen früh.')).toBe(false);
    expect(item(id)).toMatchObject({ state: 'working', snoozed: { by: 'agent' } });
    expect(needsYou(item(id))).toBe(false);
    expect(item(id).question).toBeUndefined();

    // a restart starts no session for it, and the time comes all the same
    const n = runtime.sessions.length;
    canvas.shutdown();
    canvas = open();
    expect(runtime.sessions.length).toBe(n);
    canvas.wakeDue(Date.parse(until) - 1000);
    expect(runtime.sessions.length).toBe(n);
    canvas.wakeDue(Date.parse(until) + 1000);
    expect(runtime.last.spec.resume).toBe('sess-1');
    expect(runtime.last.inbox[0]).toContain('the time you snoozed until, to: Testergebnis prüfen');
    expect(item(id).snoozed).toBeUndefined();
    expect(last(id)).toMatchObject({ kind: 'state', author: 'obeya', text: 'Wieder da: Zeitpunkt erreicht' });
    expect(workers().busyCards()).toEqual([id]);
  });

  test('a note from the owner wakes it early, and so does what Obeya has for it', () => {
    const { id, s } = atWork();
    s.call('snooze', { until: later(10 * HOUR), why: 'Prüfen' });
    s.emit({ type: 'idle' });
    workers().message(id, 'Schau jetzt schon mal nach.');
    expect(runtime.last.spec.resume).toBe('sess-1');
    expect(runtime.last.inbox[0]).toContain('the owner wakes you early');
    expect(runtime.last.inbox[0]).toContain('Schau jetzt schon mal nach.');
    expect(item(id).snoozed).toBeUndefined();
    expect(board().events(id).some((e) => e.kind === 'state' && e.author === 'owner' && e.text === 'Wieder da: von dir zurückgeholt')).toBe(true);

    runtime.last.call('snooze', { until: later(10 * HOUR), why: 'Prüfen' });
    runtime.last.emit({ type: 'idle' });
    workers().prEvent(id, 'Check rot.', 'A check of your pull request failed: test.');
    expect(runtime.last.inbox[0]).toContain('what follows wakes you early');
    expect(runtime.last.inbox[0]).toContain('A check of your pull request failed');
    expect(board().events(id).some((e) => e.text === 'Wieder da: Neues für den Agenten')).toBe(true);
  });

  test('the owner moves the time it snoozed until: woken then, it hears so', () => {
    const { id, s } = atWork();
    s.call('snooze', { until: later(10 * HOUR), why: 'Prüfen' });
    s.emit({ type: 'idle' });
    const soon = later(HOUR);
    canvas.act(id, { action: 'snooze', until: soon });
    expect(item(id).snoozed).toMatchObject({ by: 'agent', why: 'Prüfen', moved: true });
    canvas.wakeDue(Date.parse(soon) + 1);
    expect(runtime.last.inbox[0]).toContain('you snoozed, to: Prüfen, and the owner moved the time to now.');
    // woken early after the owner moved it, it hears both
    runtime.last.call('snooze', { until: later(10 * HOUR), why: 'Prüfen' });
    runtime.last.emit({ type: 'idle' });
    canvas.act(id, { action: 'snooze', until: later(20 * HOUR) });
    canvas.act(id, { action: 'wake' });
    expect(runtime.last.inbox[0]).toContain('You snoozed, to: Prüfen, and the owner moved the time to');
    expect(runtime.last.inbox[0]).toContain('the owner wakes you early');
  });

  test('a time that passed, or no time, is refused; a question in the same turn wins over the snooze', () => {
    const { id, s } = atWork();
    expect(s.call('snooze', { until: later(-HOUR), why: 'x' })).toContain('has passed');
    expect(s.call('snooze', { until: 'morgen früh', why: 'x' })).toContain('ISO 8601');
    expect(item(id).snoozed).toBeUndefined();
    s.call('snooze', { until: later(HOUR * 5), why: 'x' });
    s.call('ask', { question: 'Doch lieber gleich?' });
    s.emit({ type: 'idle' });
    expect(item(id).snoozed).toBeUndefined();
    expect(item(id)).toMatchObject({ state: 'waiting', need: 'question' });
    expect(s.closed).toBe(false);
    // the card waits for the owner: nothing to snooze until they answered
    expect(s.call('snooze', { until: later(HOUR * 5), why: 'x' })).toContain('Not snoozed');
  });

  test('stopping a snoozed card plans it again, not snoozed', () => {
    const { id, s } = atWork();
    s.call('snooze', { until: later(HOUR * 5), why: 'x' });
    s.emit({ type: 'idle' });
    canvas.act(id, { action: 'stop' });
    expect(item(id).state).toBe('planned');
    expect(item(id).snoozed).toBeUndefined();
  });
});

describe('the agent snoozes until another card gets somewhere', () => {
  /** Another card at work on the canvas. */
  const other = (title = 'Tests auf Linux grün machen') => {
    const c = board().create({ title, x: 0, y: 0 });
    board().work(c.id, { state: 'working', branch: 'obeya/linux' });
    return c.id;
  };

  test('until that card is done: it wakes once its work is on main, and hears so', () => {
    const fix = other();
    const { id, s } = atWork();
    expect(s.call('snooze', { card: 'tests auf linux grün machen', why: 'Tag verschieben' })).toContain('Snoozed until the card “Tests auf Linux grün machen” is done');
    expect(item(id).snoozed).toEqual({ on: { card: fix, title: 'Tests auf Linux grün machen', state: 'done' }, by: 'agent', why: 'Tag verschieben' });
    expect(last(id)).toMatchObject({ kind: 'state', author: 'worker', text: 'Zurückgestellt bis „Tests auf Linux grün machen“ erledigt ist · Tag verschieben' });
    s.emit({ type: 'idle' });
    expect(s.closed).toBe(true);
    const n = runtime.sessions.length;
    // it waits for the owner's approval: not done yet
    board().work(fix, { state: 'waiting', need: 'demo' });
    canvas.wakeDue(Date.now() + 400 * 24 * HOUR);
    expect(runtime.sessions.length).toBe(n);
    board().work(fix, { state: 'live' });
    canvas.wakeDue();
    expect(runtime.last.spec.resume).toBe('sess-1');
    expect(runtime.last.inbox[0]).toContain('The card “Tests auf Linux grün machen” is done: its work is on main');
    expect(runtime.last.inbox[0]).toContain('to: Tag verschieben');
    expect(item(id).snoozed).toBeUndefined();
    expect(last(id)).toMatchObject({ author: 'obeya', text: 'Wieder da: „Tests auf Linux grün machen“ ist erledigt' });
  });

  test('until it waits for the owner, at the latest at a time: whichever comes first wakes it', () => {
    other('Demo des Exports');
    const { id, s } = atWork();
    const until = later(5 * HOUR);
    s.call('snooze', { card: 'Export', state: 'waits_for_owner', until, why: 'Vergleichen' });
    expect(last(id).text).toMatch(/^Zurückgestellt bis „Demo des Exports“ auf dich wartet, spätestens .* · Vergleichen$/);
    s.emit({ type: 'idle' });
    canvas.wakeDue(Date.parse(until) + 1);
    expect(runtime.last.inbox[0]).toContain('you snoozed until the card “Demo des Exports” waits for the owner');
    expect(runtime.last.inbox[0]).toContain('has not got there yet');
  });

  test('a card that asks the owner is one that waits for them', () => {
    const demo = other('Demo des Exports');
    const { s } = atWork();
    s.call('snooze', { card: 'Demo des Exports', state: 'waits_for_owner', why: 'Vergleichen' });
    s.emit({ type: 'idle' });
    board().work(demo, { state: 'waiting', need: 'question' });
    canvas.wakeDue();
    expect(runtime.last.inbox[0]).toContain('waits for the owner now');
  });

  test('a state the card passes through between two ticks wakes it all the same', async () => {
    const demo = other('Demo des Exports');
    const { s } = atWork();
    s.call('snooze', { card: 'Demo des Exports', state: 'waits_for_owner', why: 'Vergleichen' });
    s.emit({ type: 'idle' });
    board().work(demo, { state: 'waiting', need: 'question' });
    await Bun.sleep(5);
    board().work(demo, { state: 'working', need: null });
    expect(runtime.last.inbox[0]).toContain('waits for the owner now');
  });

  test('an idea whose questions wait for the owner waits for them', () => {
    const idea = board().create({ idea: true, title: 'Export-Formate', body: 'Welche?', x: 0, y: 0 });
    board().work(idea.id, { idea: JSON.stringify({ status: 'open', brief: '', yourTurn: false, thinking: true, questions: [] }) });
    const { s } = atWork();
    s.call('snooze', { card: 'Export-Formate', state: 'waits_for_owner', why: 'x' });
    s.emit({ type: 'idle' });
    board().work(idea.id, { idea: JSON.stringify({ status: 'open', brief: '', yourTurn: true, questions: [] }) });
    canvas.wakeDue();
    expect(runtime.last.inbox[0]).toContain('waits for the owner now');
  });

  test('the card stopped, archived or removed: it wakes, as that card no longer gets there', () => {
    const fix = other();
    const { s } = atWork();
    s.call('snooze', { card: 'Tests auf Linux grün machen', why: 'x' });
    s.emit({ type: 'idle' });
    board().work(fix, { state: 'planned' });
    canvas.wakeDue();
    expect(runtime.last.inbox[0]).toContain('The owner stopped the card “Tests auf Linux grün machen”');

    const gone = other('Weg damit');
    runtime.last.call('snooze', { card: 'Weg damit', why: 'x' });
    runtime.last.emit({ type: 'idle' });
    board().remove(gone);
    canvas.wakeDue();
    expect(runtime.last.inbox[0]).toContain('The card “Weg damit” is gone from the canvas.');
  });

  test('a card nobody can find, one done already, several alike, or neither card nor time is refused', () => {
    other('Linux-Tests');
    other('Linux-Build');
    const done = board().create({ title: 'Fertig', x: 0, y: 0 });
    board().work(done.id, { state: 'live' });
    const { id, s } = atWork();
    expect(s.call('snooze', { card: 'Windows', why: 'x' })).toContain('no card on the canvas is called “Windows”');
    expect(s.call('snooze', { card: 'Linux', why: 'x' })).toContain('several cards have “Linux” in their title');
    // a finished card makes no part of a title ambiguous
    expect(s.call('snooze', { card: 'ertig', why: 'x' })).toContain('no card on the canvas is called “ertig”');
    expect(s.call('snooze', { card: 'Fertig', why: 'x' })).toContain('is done already');
    expect(s.call('snooze', { why: 'x' })).toContain('give until, card, or both');
    expect(s.call('snooze', { card: 'Lüftertest', why: 'x' })).toContain('no card on the canvas');
    expect(item(id).snoozed).toBeUndefined();
  });
});

describe('the owner snoozes a card', () => {
  test('at work: its worker stops at once as on a pause, Obeya’s messages wait, and at the time it goes on with them', () => {
    const { id, s } = atWork();
    const until = later(14 * HOUR);
    canvas.act(id, { action: 'snooze', until });
    expect(s.closed).toBe(true);
    expect(workers().busyCards()).toEqual([]);
    expect(item(id)).toMatchObject({ state: 'working', snoozed: { by: 'owner' } });
    expect(last(id)).toMatchObject({ kind: 'state', author: 'owner', text: expect.stringMatching(/^Zurückgestellt bis /) });
    const n = runtime.sessions.length;
    workers().prEvent(id, 'Check rot.', 'A check of your pull request failed: test.');
    expect(runtime.sessions.length).toBe(n);
    canvas.wakeDue(Date.parse(until) + 1);
    const inbox = runtime.last.inbox[0]!;
    expect(runtime.last.spec.resume).toBe('sess-1');
    expect(inbox).toContain('The owner snoozed you until');
    expect(inbox).toContain('exit code 137');
    expect(inbox).toContain('While you were snoozed, Obeya had this for you');
    expect(inbox).toContain('A check of your pull request failed');
    expect(item(id).snoozed).toBeUndefined();
    expect(item(id).paused).toBeUndefined();
    expect(last(id).text).toBe('Wieder da: Zeitpunkt erreicht');
  });

  test('waiting for them: it leaves them and comes back at the time; nothing goes to its agent', () => {
    const { id, s } = atWork();
    s.call('ask', { question: 'CSV oder Excel?' });
    s.emit({ type: 'idle' });
    expect(needsYou(item(id))).toBe(true);
    const n = runtime.sessions.length;
    const inbox = s.inbox.length;
    const until = later(3 * HOUR);
    canvas.act(id, { action: 'snooze', until });
    expect(item(id)).toMatchObject({ state: 'waiting', need: 'question', snoozed: { by: 'owner', waiting: true } });
    expect(needsYou(item(id))).toBe(false);
    // the owner changes the time
    const changed = later(5 * HOUR);
    canvas.act(id, { action: 'snooze', until: changed });
    expect(item(id).snoozed!.until).toBe(new Date(changed).toISOString());
    canvas.wakeDue(Date.parse(until) + 1);
    expect(item(id).snoozed).toBeDefined();
    canvas.wakeDue(Date.parse(changed) + 1);
    expect(item(id).snoozed).toBeUndefined();
    expect(needsYou(item(id))).toBe(true);
    expect(runtime.sessions.length).toBe(n);
    expect(s.inbox.length).toBe(inbox);
  });

  test('waiting for them, answered all the same: snoozed no longer', () => {
    const { id, s } = atWork();
    s.call('ask', { question: 'CSV oder Excel?' });
    s.emit({ type: 'idle' });
    canvas.act(id, { action: 'snooze', until: later(3 * HOUR) });
    canvas.act(id, { action: 'answer', text: 'CSV' });
    expect(item(id).state).toBe('working');
    expect(item(id).snoozed).toBeUndefined();
  });

  test('„Jetzt zurückholen“ wakes it at once, whoever snoozed it', () => {
    const { id, s } = atWork();
    s.call('snooze', { until: later(30 * HOUR), why: 'Prüfen' });
    s.emit({ type: 'idle' });
    canvas.act(id, { action: 'wake' });
    expect(runtime.last.spec.resume).toBe('sess-1');
    expect(runtime.last.inbox[0]).toContain('You snoozed until');
    expect(runtime.last.inbox[0]).toContain('the owner wakes you early, without words, so tell them with reply where things stand');
    expect(last(id)).toMatchObject({ author: 'owner', text: 'Wieder da: von dir zurückgeholt' });
    expect(() => canvas.act(id, { action: 'wake' })).toThrow('not snoozed');
  });

  test('an idea whose agent replied, until tomorrow; a planned card or a past time is refused', () => {
    const i = board().create({ idea: true, title: 'Export', body: 'Vermieter wollen ihn.', x: 0, y: 0 });
    board().work(i.id, { idea: JSON.stringify({ status: 'open', brief: '', yourTurn: true, questions: [] }) });
    expect(needsYou(item(i.id))).toBe(true);
    canvas.act(i.id, { action: 'snooze', until: later(20 * HOUR) });
    expect(item(i.id).snoozed).toMatchObject({ waiting: true });
    expect(needsYou(item(i.id))).toBe(false);
    canvas.act(i.id, { action: 'wake' });
    expect(needsYou(item(i.id))).toBe(true);

    const p = board().create({ title: 'Geplant', x: 0, y: 0 });
    expect(() => canvas.act(p.id, { action: 'snooze', until: later(HOUR) })).toThrow('neither at work nor waiting');
    expect(() => canvas.act(i.id, { action: 'snooze', until: later(-HOUR) })).toThrow('within the coming year');
  });
});

describe('edges a review found', () => {
  test('a restart notice that comes after the snooze keeps it: the session ends after the turn the notice starts, background work or not', () => {
    const { id, s } = atWork();
    s.call('snooze', { until: later(10 * HOUR), why: 'x' });
    s.emit({ type: 'idle', more: true });
    expect(s.closed).toBe(false);
    s.emit({ type: 'idle', background: 1 });
    expect(s.closed).toBe(true);
    expect(workers().busyCards()).toEqual([]);
    expect(item(id).snoozed).toBeDefined();
  });

  test('its pull request closed while the agent snoozes: the question reaches the owner, snoozed no longer', () => {
    const { id, s } = atWork();
    board().work(id, { state: 'inPr', pr: JSON.stringify({ url: 'https://github.com/acme/app/pull/7', number: 7, seen: [], reported: [] }) });
    s.call('snooze', { until: later(10 * HOUR), why: 'x' });
    s.emit({ type: 'idle' });
    workers().prClosed(id);
    expect(item(id).snoozed).toBeUndefined();
    expect(board().events(id).some((e) => e.text === 'Wieder da: die Karte braucht dich')).toBe(true);
    expect(needsYou(item(id))).toBe(true);
  });

  test('snoozing a card that waits for the owner leaves its background work running, and its pause offered', () => {
    const { id, s } = atWork();
    s.call('ask', { question: 'CSV?' });
    s.emit({ type: 'idle', background: 1 });
    canvas.act(id, { action: 'snooze', until: later(HOUR * 3) });
    expect(s.closed).toBe(false);
    expect(item(id)).toMatchObject({ inTurn: true, snoozed: { waiting: true } });
    canvas.act(id, { action: 'pause' });
    expect(s.closed).toBe(true);
  });

  test('a worker that waited for the restart after the landing and snoozed hears of the restart, which wakes it', () => {
    const { id, s } = atWork();
    board().work(id, { state: 'live', landed: JSON.stringify({ commit: 'abc', restarts: true, waits: true }) });
    s.call('snooze', { until: later(10 * HOUR), why: 'x' });
    s.emit({ type: 'idle' });
    canvas.shutdown();
    canvas = open();
    expect(runtime.last.inbox[0]).toContain('Obeya has started again and runs main with your change now.');
    expect(JSON.parse(board().row(id).landed!)).toEqual({ commit: 'abc' });
    expect(item(id).snoozed).toBeUndefined();
  });
});
