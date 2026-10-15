// A card's conversation, from its events.

import { LANGUAGES } from '../core/locale';
import { MESSAGES } from '../core/messages';
import { askable, type CardEvent, type Demo, finishingUp, formatQuestion, type Item, ownWords, pausable, type Question } from '../core/types';
import type { Field } from './api';

/** One entry of the conversation: a message, with how the agent got to it folded under it, or a small line. */
export interface Turn {
  e: CardEvent;
  /** What led to the message: tool calls, thoughts, status lines, the Koordinator's confirmations. */
  steps: CardEvent[];
  /** A state change or an error between the messages. */
  line?: true;
  /** A worker's question: the answer it got. */
  answer?: string;
  /** A worker's question: the options the owner picked in the answer, marked on it. */
  picks?: string[];
  /** The owner's answer whose picks its question marks: what the message says beside them, their own words. */
  words?: string;
  /** A worker's question the owner's note took back instead of an answer. */
  settled?: true;
  /** Only the agent's steps, without words: a turn it ended silently, in a conversation nobody works on any more. */
  quiet?: true;
}

export interface Talk {
  shown: Turn[];
  /** The steps of a turn without a message yet. */
  pending: CardEvent[];
  /** What the owner said that the agent has not read yet, in the order said: it stands below its work, until it reads it. */
  unread: CardEvent[];
  /** The question the card waits on, with the steps that led to it: it stands at the end, to be answered. */
  asked?: Turn;
}

/** Obeya's lines that mark where the work stands, or why an idea clicked to build was not; its other notes (restarts, sessions, what happens on the pull request) fold away. */
const MILESTONE =
  /^(Agent gestartet|Agent started|Pull Request gemergt|Pull request merged|Nach der Freigabe auf main gelandet|Landed on main after the approval|Pull Request ohne Merge geschlossen|Pull request closed without a merge|Das Projekt steht jetzt|The project now stands|Nicht gebaut|Not built|Teil gelandet|Part landed)/;

/** The agent that works on the card or thinks the idea through. */
const agentAuthor = (e: CardEvent) => e.author === 'worker' || e.author === 'explorer';

/** What the owner says to the card's agent. */
const toAgent = (e: CardEvent) => (e.kind === 'hint' || e.kind === 'answer' || e.kind === 'talk') && (e.author === 'owner' || e.kind === 'answer');

const place = (e: CardEvent, prev: CardEvent | undefined): 'owner' | 'agent' | 'aside' | 'line' | 'step' | 'after' => {
  if (toAgent(e)) return 'owner';
  switch (e.kind) {
    case 'closing':
      return 'after';
    case 'talk':
    case 'question':
    case 'review':
      return 'agent';
    case 'say':
      // the Koordinator's confirmation of what the owner just said folds away; what it looked up for them stands
      if (e.author === 'owner') return 'owner';
      return (e.author === 'koordinator' || e.author === 'project') && !(prev?.kind === 'say' && prev.author === 'owner') ? 'aside' : 'step';
    case 'error':
    case 'denied':
      return 'line';
    case 'state':
      return e.author === 'explorer' || (e.author === 'obeya' && !MILESTONE.test(e.text)) ? 'step' : 'line';
    default:
      return 'step';
  }
};

/**
 * The handover a demo came with: a later one may keep it. A demo from before it knew its handover
 * (2026-10-09) came with the last one before the owner answered its question, else the last one.
 */
export function demoHandover(demo: Demo, shown: Turn[]): Turn | undefined {
  if (demo.handover !== undefined) return shown.find((x) => x.e.id === demo.handover);
  const answer = demo.answer === undefined ? -1 : shown.findLastIndex((x) => x.e.kind === 'answer' && x.e.text === demo.answer);
  return (answer < 0 ? shown : shown.slice(0, answer)).findLast((x) => x.e.kind === 'review');
}

/**
 * A card's events as its conversation, in the order the agent saw them: what the owner says, where
 * the agent read it (`CardEvent.readAfter`), the agents' replies, questions and handovers, each with
 * the steps that led to it (and a worker's closing words after it, which mostly repeat it, with
 * the steps it took between the two), and the
 * state changes between them. The agent's steps before it read the owner's words close above them
 * (`closed`). What the owner says to a worker that does not `reply` is answered by the first words
 * it says after it; words before its reply are steps on the way to it. What the agent has not read yet stands apart (`unread`).
 * `asking`: the question the card waits on. `over`: no agent works on the card, so no message will
 * come for the steps without one (`settle`). `paused`: the agent is paused now, at the last line that says so.
 */
export function talkTurns(all: CardEvent[], opts: { asking?: Question; over?: boolean; paused?: boolean } = {}): Talk {
  const shown: Turn[] = [];
  let steps: CardEvent[] = [];
  // the owner said something to the agent, and the worker has not answered yet
  let open = false;
  const events = asRead(all.filter((e) => !e.unread));
  const lastPause = events.findLast(pauseLine);
  events.forEach((e, i) => {
    const where = place(e, events[i - 1]);
    if (where === 'step' && open && e.kind === 'say' && e.author === 'worker' && !repliesLater(events, i)) {
      shown.push({ e, steps });
      steps = [];
      open = false;
    } else if (where === 'step') steps.push(e);
    else if (where === 'after') {
      // closing words after a reply or handover fold under it, the last of its steps; so do the
      // steps the agent took after it in the same turn (a card it proposed, say)
      const last = shown.findLast((x) => !x.line && agentAuthor(x.e));
      if (last && last === shown.at(-1)) {
        last.steps.push(...steps, e);
        steps = [];
      } else if (last) last.steps.push(e);
      else steps.push(e);
    }
    else if (where === 'line' || where === 'aside') {
      // what the agent did until the owner paused it stays above that line once it went on; while it
      // is paused there, its bubble shows it
      if (pauseLine(e) && !(opts.paused && e === lastPause)) {
        const run = closed(steps);
        if (run) {
          shown.push(run);
          steps = [];
        }
      }
      shown.push({ e, steps: [], ...(where === 'line' ? { line: true as const } : {}) });
    }
    else if (where === 'agent') {
      // a turn that ended without a reply took its last words as the reply
      shown.push({ e, steps: steps.filter((s) => !(s.kind === 'say' && s.text === e.text.trim())) });
      steps = [];
      open = false;
    } else {
      // a spoken command that became a note or an answer stands once, as that
      if (e.kind === 'say' && duplicate(all, all.indexOf(e))) return;
      if (toAgent(e)) {
        const run = closed(steps);
        if (run) {
          shown.push(run);
          steps = [];
        }
      }
      shown.push({ e, steps: [] });
      if (toAgent(e)) open = true;
    }
  });
  for (const turn of shown) if (turn.e.kind === 'question') Object.assign(turn, outcome(events, turn.e));
  marked(shown);
  const asked = opts.asking ? openQuestion(shown, opts.asking) : undefined;
  if (asked) {
    shown.splice(shown.indexOf(asked), 1);
    delete asked.settled;
  }
  if (opts.over && !asked) {
    settle(shown, steps, events);
    steps = [];
  }
  return { shown, pending: steps, unread: all.filter((e) => e.unread), ...(asked ? { asked } : {}) };
}

/** Whether the worker replies after its words at `i`, before the owner says anything more: then those words were a step on the way to the reply. */
function repliesLater(events: CardEvent[], i: number): boolean {
  for (const e of events.slice(i + 1)) {
    if (toAgent(e)) return false;
    if (e.kind === 'talk' && agentAuthor(e)) return true;
  }
  return false;
}

/** The line that the owner paused the card's agent (before 2026-10-15 it went on with how the agent goes on again). */
const pauseLine = (e: CardEvent) => e.kind === 'state' && e.author === 'owner' && LANGUAGES.some((l) => e.text.startsWith(MESSAGES[l].worker.pausedByOwner));

/** The events in the order the agent saw them: the owner's words it read later stand after the line it read them at, in the order said. */
function asRead(events: CardEvent[]): CardEvent[] {
  if (!events.some((e) => e.readAfter)) return events;
  const place = (e: CardEvent) => (e.readAfter ? e.readAfter + 0.5 : e.id);
  return [...events].sort((a, b) => place(a) - place(b) || a.id - b.id);
}

/**
 * The agent's steps before it read the owner's words, closed above them: its last words in them as
 * its message, or, without words, as its steps. Steps only Obeya and the Koordinator noted go on to
 * the next message.
 */
function closed(steps: CardEvent[]): Turn | undefined {
  const words = steps.findLast((s) => s.kind === 'say' && agentAuthor(s));
  if (words) return { e: words, steps: steps.filter((s) => s !== words) };
  const own = steps.find(agentAuthor);
  return own ? { e: own, steps, quiet: true } : undefined;
}

/** A proposal's conversation without where its open questions were asked: the last time each was. */
export function withoutOpen(events: CardEvent[], open: Question[]): CardEvent[] {
  if (!open.length) return events;
  const asked = new Set(open.map((q) => events.findLast((e) => e.kind === 'question' && parseQuestion(e.text).text === q.text)?.id));
  return events.filter((e) => !asked.has(e.id));
}

/**
 * Steps no message came after, in a conversation nobody works on any more, go where they happened,
 * before what came later. Each run of them between two turns ends with the agent's last words in
 * it, as its message; a run without words stands as the agent's steps; what only Obeya and the
 * Koordinator noted there goes.
 */
function settle(shown: Turn[], pending: CardEvent[], events: CardEvent[]) {
  const at = new Map(events.map((e, i) => [e, i]));
  const runs = new Map<number, CardEvent[]>();
  for (const s of pending) {
    const k = shown.findIndex((x) => at.get(x.e)! > at.get(s)!);
    const where = k < 0 ? shown.length : k;
    runs.set(where, [...(runs.get(where) ?? []), s]);
  }
  for (const [where, run] of [...runs].reverse()) {
    const turn = closed(run);
    if (turn) shown.splice(where, 0, turn);
  }
}

/** Whether the owner's words at `i` reached the agent as the note or answer that follows, in the same words. */
function duplicate(events: CardEvent[], i: number): boolean {
  const said = events[i]!.text.trim();
  const next = events.slice(i + 1).find((e) => e.author === 'owner' && (e.kind === 'say' || toAgent(e)));
  return !!next && next.kind !== 'say' && next.text.trim() === said;
}

/** How a question ended: answered, or taken back by a note of the owner's before anything else was asked. */
function outcome(events: CardEvent[], q: CardEvent): Pick<Turn, 'answer' | 'picks' | 'settled'> {
  const after = events.slice(events.indexOf(q) + 1);
  const until = after.findIndex((e) => e.kind === 'question');
  const before = until < 0 ? after : after.slice(0, until);
  const answer = before.find((e) => e.kind === 'answer');
  if (answer) return { answer: answer.text, ...(answer.picks ? { picks: answer.picks } : {}) };
  return before.some((e) => e.kind === 'hint' && e.author === 'owner') ? { settled: true } : {};
}

/**
 * The options an answer picked stand once, marked on the question it answers: its message keeps the
 * owner's own words, and an answer that was nothing but a pick stands as no message of its own.
 */
function marked(shown: Turn[]) {
  for (const q of shown.filter((x) => x.picks)) {
    const i = shown.findIndex((x, j) => j > shown.indexOf(q) && x.e.kind === 'answer');
    const a = shown[i];
    if (!a?.e.picks) continue;
    a.words = ownWords(a.e);
    if (!a.words && !a.e.images?.length) shown.splice(i, 1);
  }
}

/**
 * The card's last question, if it is the one the card waits on: nothing answered it, and no note
 * took it back (a card from before notes did so still waits on it, in the same words).
 */
function openQuestion(shown: Turn[], asking: Question): Turn | undefined {
  const last = shown.findLast((x) => x.e.kind === 'question');
  if (!last || last.answer !== undefined) return;
  return !last.settled || LANGUAGES.some((l) => last.e.text === formatQuestion(asking, l)) ? last : undefined;
}

/** A question as the log holds it (`formatQuestion`): its text and the options after it. */
export function parseQuestion(text: string): { text: string; options: string[] } {
  const lines = text.split('\n');
  let n = lines.length;
  while (n > 1 && lines[n - 1]!.startsWith('– ')) n--;
  return {
    text: lines
      .slice(0, n)
      .join('\n')
      .replace(/ \((Mehrfachauswahl|multiple choice)\)$/, ''),
    options: lines.slice(n).map((l) => l.slice(2)),
  };
}

/**
 * The one field a card has for the owner's words, by its state: the answer to its agent's question,
 * a note while the agent works, feedback on work waiting for review; under a demo whose report asks
 * a question, the answer and feedback together, sorted out by the Koordinator as spoken words are.
 * Null where no agent hears it. Ideas and proposals have fields of their own.
 */
export function ownerField(item: Pick<Item, 'state' | 'need' | 'question' | 'finishing' | 'branch' | 'prototypeOf' | 'archivedAt'>): Field | null {
  if (item.state === 'waiting') return item.need === 'question' ? 'answer' : item.need === 'demo' && item.question ? 'demo' : 'feedback';
  // a finished card's agent is resumed for what the owner asks about it
  return item.state === 'working' || item.state === 'inPr' || item.finishing || askable(item) ? 'note' : null;
}

/**
 * Whether the card's agent is at work on it, so its conversation ends with the agent at work: an
 * agent working on something, which the owner can pause (`pausable`), or a proposal reworked.
 */
export const agentWorks = (i: Pick<Item, 'kind' | 'state' | 'idea' | 'thread' | 'inTurn' | 'paused' | 'proposal'>) =>
  pausable(i) || (i.state === 'proposal' && !!i.proposal?.revising);

/**
 * Whether the Koordinator still reads what the owner said on the card: their words stand in the log
 * at once, its confirmation follows them. (Options picked on a proposal go to its reviser, which
 * notes when it is done.)
 */
export const koordinatorReads = (events: CardEvent[]) => {
  const last = events.at(-1);
  return last?.kind === 'say' && last.author === 'owner';
};

/** A task an agent has worked on, stopped ones included: what came of it stands beside its conversation. */
export const worked = (i: Pick<Item, 'state' | 'branch'>) => ['planned', 'working', 'waiting', 'approved', 'inPr', 'live', 'done'].includes(i.state) && !!i.branch;

/** What decides a card's layout. */
type Laid = Pick<Item, 'state' | 'branch' | 'prototypeEnd' | 'demo' | 'pr' | 'landedPart' | 'finishing' | 'brief' | 'prototypes'>;

/**
 * What a task an agent worked on shows beside its conversation: a demo, a pull request, what landed,
 * what remains after the landing, a decided idea's brief.
 */
export const result = (i: Laid) =>
  !!i.demo || i.state === 'inPr' || (!!i.pr && i.state === 'waiting') || !!i.landedPart || finishingUp(i) || (i.brief !== undefined && (!!i.brief.trim() || !!i.prototypes?.length));

/** A card laid out with its conversation beside what it is about (`Split` in detail.tsx): an idea, a proposal, a task an agent worked on once there is a result. */
export const split = (i: Laid) => i.state === 'idea' || i.state === 'proposal' || ((!!i.prototypeEnd || worked(i)) && result(i));

/** A task an agent works or worked on without a result yet: its conversation stands alone, the card only as wide as it. */
export const talkAlone = (i: Laid) => (!!i.prototypeEnd || worked(i)) && !result(i);

/** Obeya's line that the agent started: the task stands above it, as the conversation's first message. */
export const started = (e: CardEvent) => e.kind === 'state' && e.author === 'obeya' && /^(Agent gestartet|Agent started)/.test(e.text);
