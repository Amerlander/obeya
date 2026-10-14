// Questions the Koordinator looks up: what it cannot answer in its quick reading of a command (what
// an agent would do on a card, what the plan says, what a release holds) goes to an agent with a
// worker's tools that takes the time to read and check.
// A workstream's question goes to its project agent, any other to a thorough Koordinator turn. The
// answer comes later: in full in the log of the card that was open (else in the Koordinator's
// sheet), and summed up aloud.
// A look-up starts a thread: a follow-up on its answer resumes the same agent, which still has all
// it read and computed, and the thread's output directory holds the files its answers come with.
// The owner can move a thread onto a Question card of its own, where their words go straight to
// that agent.

import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AnswerFile, AnswerRef, CardEvent, Item, Talk } from '../core/types';
import { INFORM_RULES, inform, type OwnerAnswer } from './advisor';
import { BadRequest, type Board, replyNote } from './board';
import { imageNote } from './images';
import type { AgentRuntime } from './runtime';
import { TO_OBEYA, toObeyaTool } from './to-obeya';
import { describeTool, SPOKEN } from './workers';

export interface AnswerOptions {
  board: Board;
  runtime: AgentRuntime;
  /** The checkout the answer is read from: the card's repository, or the canvas's home. */
  pathFor: (card: Item | undefined) => string;
  /** The task the card's worker gets at its start. */
  startBrief: (card: Item) => string | undefined;
  /** The project agent of a project answers what is asked about it and its workstreams. */
  projectAgent: (project: Item) => {
    inform: (project: Item, message: string, onTool?: (name: string, input: Record<string, unknown>) => void, dir?: string) => Promise<OwnerAnswer>;
  };
  /** A thread's output directory, outside every repository. */
  dirOf: (thread: number) => string;
  /** The files of the owner's screenshots, by id; unknown ones are left out. */
  imageFiles?: (ids?: string[]) => string[];
  preferences?: () => string;
  /** The workers' permission mode, which the answering Koordinator turn runs in too. */
  permissionMode?: PermissionMode;
  /** The answer to an exchange is in: the Koordinator hears it with the owner's next command. */
  onAnswer?: (talk: number, question: string, answer: string) => void;
  /** Passes on what the owner's words on a Question card ask of Obeya (`to_obeya`). */
  toObeya?: (cardId: string, request: string) => Promise<string>;
}

/** Log lines of a card the answering agent reads. */
const LOG_LINES = 25;

type Exchange = Talk & { about?: string; session?: string };
type By = 'koordinator' | 'project';

export class Answers {
  /** Exchanges being looked up, so a resume does not ask twice. */
  private busy = new Set<number>();
  /** The turns of each thread, one after the other: two never run in one session at once. */
  private turns = new Map<number, Promise<unknown>>();

  constructor(private o: AnswerOptions) {}

  /** Looks up the question of an exchange with the Koordinator; a follow-up goes on in its thread. */
  lookUp(talkId: number) {
    if (this.busy.has(talkId)) return;
    const t = this.o.board.exchange(talkId);
    if (!t?.question || t.answer !== undefined) return;
    const thread = t.thread ?? t.id;
    const root = thread === t.id ? t : (this.o.board.exchange(thread) ?? t);
    // a thread on a Question card goes on there, with the card's agent
    const card = root.movedTo ? this.o.board.item(root.movedTo) : undefined;
    if (card?.kind === 'question') {
      if (!t.movedTo) this.o.board.moveThread(thread, card.id);
      if (!(this.o.board.thread(card.id).pending ?? []).some((p) => p.talk === talkId)) this.ask(card.id, t.said, this.o.imageFiles?.(t.images) ?? [], true, undefined, talkId);
      return;
    }
    this.busy.add(talkId);
    const { by, about, project } = this.agentFor(root);
    const reading = t.cardId && this.o.board.item(t.cardId) ? t.cardId : undefined;
    // what it reads shows on the open card, as an exploration agent's reading does
    const onTool = (name: string, input: Record<string, unknown>) => {
      if (reading && !name.startsWith('mcp__')) this.o.board.log(reading, 'activity', by, describeTool(name, input, this.o.board.t));
    };
    const follow = t.id !== thread;
    // the session of the answer it continues, else the thread's latest; a thread moved onto a card that is gone has the card's
    const resume = follow ? (this.o.board.threadTalk(thread).findLast((x) => x.session && x.id <= (t.follows ?? t.id))?.session ?? this.cardSession(root)) : undefined;
    const fresh = this.message(root.said, root.question!, about, project);
    this.queue(thread, () =>
      this.consult({
        thread,
        by,
        about,
        project,
        onTool,
        onSession: (id) => this.o.board.talkSession(talkId, id),
        ...(follow
          ? {
              resume,
              message: followUp(t.said, t.question!, false),
              fallback: `${fresh}\n\n${this.history(thread)}\n\n${followUp(t.said, t.question!, false)}`,
            }
          : { message: fresh }),
      })
        .then((a) => this.deliver(talkId, thread, by, t.question!, a, reading))
        .catch((e) => this.deliver(talkId, thread, by, t.question!, { text: this.o.board.t.answer.failed(e instanceof Error ? e.message : String(e)) }, reading)),
    ).finally(() => this.busy.delete(talkId));
  }

  /**
   * The owner's words to the agent of a Question card, maybe with screenshots and in reply to a
   * message of its conversation; `talk`: asked in Obeya's sheet as a follow-up of its thread, whose
   * exchange gets the answer too. Words that come while it reads go in with the next turn.
   */
  ask(cardId: string, text: string, images: string[], spoken: boolean, replyTo?: number, talk?: number) {
    const card = this.questionCard(cardId);
    this.o.board.logThread(cardId, { kind: 'talk', author: 'owner', text, images: images.map((f) => f.split(/[\\/]/).pop()!), ...(replyTo ? { replyTo } : {}) });
    const quoted = replyTo ? this.o.board.quoted(cardId, replyTo) : undefined;
    const said = `${replyNote(quoted, 'koordinator')}${text}${imageNote(images)}`;
    const thread = this.o.board.thread(cardId);
    const pending = [...(thread.pending ?? []), { text: spoken ? `(${SPOKEN}:) ${said}` : said, images, ...(talk ? { talk } : {}) }];
    this.o.board.setThread(cardId, { thinking: true, pending });
    this.queue(thread.talk, () => this.cardTurn(card.id));
  }

  /** After a restart: questions still being looked up are looked up again, and Question cards answer what waited. */
  resume() {
    for (const i of this.o.board.snapshot().items) {
      if (i.kind !== 'question' || !i.thread?.thinking) continue;
      if (this.o.board.thread(i.id).pending?.length) this.queue(i.thread.talk, () => this.cardTurn(i.id));
      else this.o.board.setThread(i.id, { thinking: false });
    }
    for (const id of this.o.board.lookingUp()) this.lookUp(id);
  }

  /**
   * "Make it a card": the thread moves onto a Question card, near the card whose log holds it: the
   * question as its title, its exchanges as its conversation, the same agent going on. A thread that
   * moved before has its card, put back from the archive if need be.
   */
  toCard(thread: number): Item {
    const rows = this.o.board.threadTalk(thread);
    const root = rows[0];
    if (!root?.question || root.id !== thread) throw new BadRequest('invalid', 'no looked-up thread');
    if (root.movedTo && this.o.board.card(root.movedTo)) {
      const moved = this.o.board.row(root.movedTo);
      if (moved.archived_at) this.o.board.unarchive(root.movedTo);
      return this.o.board.card(root.movedTo)!;
    }
    const { by, about } = this.agentFor(root);
    const answered = rows.filter((r) => r.answer !== undefined);
    const files = answered.reduce((n, r) => n + (r.files?.length ?? 0), 0);
    const session = rows.findLast((r) => r.session)?.session;
    const card = this.o.board.addQuestion(root.question, { talk: thread, answers: answered.length, files }, session, about?.repo, root.cardId);
    for (const r of rows) {
      this.o.board.logThread(card.id, { kind: 'talk', author: 'owner', text: r.said, ...(r.images?.length ? { images: r.images } : {}), at: r.at });
      if (r.answer !== undefined) this.o.board.logThread(card.id, { kind: 'talk', author: r.answerBy ?? by, text: r.answer, answer: answerRef(thread, r.files, r.continues), at: r.at });
    }
    this.o.board.moveThread(thread, card.id);
    return this.o.board.item(card.id)!;
  }

  /**
   * How an idea that was a Question card opens its discussion: with the thread, its files, and the
   * directory they are in.
   */
  opening(cardId: string): string {
    const { talk } = this.o.board.thread(cardId);
    return [
      'The owner looked a question up with Obeya and asked on, then chose to discuss it as an idea. The conversation so far, oldest first, is where this discussion starts:',
      this.o.board
        .events(cardId)
        .filter((e) => e.kind === 'talk' || (e.kind === 'say' && e.answer))
        .map((e) => (e.author === 'owner' ? `The owner: "${e.text}"` : `Obeya: ${e.text}${fileList(e.answer?.files)}`))
        .join('\n\n'),
      `The files of its answers are in ${this.o.dirOf(talk)}. They have not said more yet. Look into it and open the discussion.`,
    ].join('\n\n');
  }

  /** One turn of a Question card's agent: what the owner asked since its last answer, answered on the card. */
  private async cardTurn(cardId: string) {
    const card = this.o.board.item(cardId);
    const stored = card?.kind === 'question' ? this.o.board.thread(cardId) : undefined;
    const taken = stored?.pending ?? [];
    if (!card || !stored || !taken.length) return;
    const root = this.o.board.exchange(stored.talk);
    if (!root?.question) return;
    const { by, about, project } = this.agentFor(root);
    const words = taken.map((p) => p.text).join('\n\n');
    let a: OwnerAnswer;
    try {
      a = await this.consult({
        thread: stored.talk,
        by,
        about,
        project,
        card: cardId,
        images: taken.flatMap((p) => p.images),
        onTool: (name, input) => {
          if (!name.startsWith('mcp__')) this.o.board.log(cardId, 'activity', by, describeTool(name, input, this.o.board.t));
        },
        onSession: (id) => this.o.board.work(cardId, { session_id: id }),
        resume: this.o.board.row(cardId).session_id ?? undefined,
        message: followUp(words, undefined, true),
        fallback: `${this.message(root.said, root.question, about, project)}\n\n${this.history(stored.talk, cardId)}\n\n${followUp(words, undefined, true)}`,
      });
    } catch (e) {
      a = { text: this.o.board.t.answer.failed(e instanceof Error ? e.message : String(e)) };
    }
    const text = clip(a.text, 12000);
    // the card may have become an idea meanwhile; the answer stands in its conversation all the same
    this.o.board.logThread(cardId, { kind: 'talk', author: by, text, answer: answerRef(stored.talk, a.files) });
    const now = this.o.board.row(cardId).thread ? this.o.board.thread(cardId) : undefined;
    if (now) {
      const left = (now.pending ?? []).slice(taken.length);
      this.o.board.setThread(cardId, { answers: now.answers + 1, files: now.files + (a.files?.length ?? 0), thinking: left.length > 0, pending: left });
    }
    this.o.board.notify({ cardId, text: clip(text, 300) });
    for (const p of taken) if (p.talk) this.answer(p.talk, root.question, text, by, a.files);
  }

  /**
   * Asks the thread's agent: a project's agent in its own session, else the look-up's session,
   * resumed when there is one. A session that cannot be resumed (its transcript is gone) is
   * replaced by a fresh agent that gets the thread so far (`fallback`).
   */
  private consult(c: {
    thread: number;
    by: By;
    about: Item | undefined;
    project: Item | undefined;
    message: string;
    resume?: string | undefined;
    fallback?: string;
    card?: string;
    images?: string[];
    onTool: (name: string, input: Record<string, unknown>) => void;
    onSession: (id: string) => void;
  }): Promise<OwnerAnswer> {
    const dir = this.o.dirOf(c.thread);
    mkdirSync(dir, { recursive: true });
    if (c.by === 'project') return this.o.projectAgent(c.project!).inform(c.project!, `${c.message}\n\n${filesNote(dir)}`, c.onTool, dir);
    const toObeya = c.card && this.o.toObeya ? this.o.toObeya : undefined;
    const ask = (message: string, resume?: string) =>
      inform({
        runtime: this.o.runtime,
        cwd: this.o.pathFor(c.about),
        system: `You are the Koordinator of Obeya, a canvas on which the owner directs coding agents; the owner knows you simply as Obeya.\n\n${INFORM_RULES}${toObeya ? `\n\n${TO_OBEYA}` : ''}`,
        message: [message, filesNote(dir), this.o.preferences?.() ?? ''].filter(Boolean).join('\n\n'),
        dir,
        onTool: c.onTool,
        onSession: c.onSession,
        language: this.o.board.language(),
        ...(resume ? { resume } : {}),
        ...(c.images?.length ? { images: c.images } : {}),
        ...(toObeya ? { tools: [toObeyaTool((request) => toObeya(c.card!, request))] } : {}),
        ...(this.o.permissionMode ? { permissionMode: this.o.permissionMode } : {}),
      });
    if (!c.resume) return ask(c.fallback ?? c.message);
    return ask(c.message, c.resume).catch(() => ask(c.fallback ?? c.message));
  }

  /** Who answers a thread: the project agent for a project or one of its workstreams, else a Koordinator turn. */
  private agentFor(root: Exchange): { by: By; about: Item | undefined; project: Item | undefined } {
    const about = root.about ? this.o.board.item(root.about) : undefined;
    const project = about?.kind === 'project' ? about : about?.parent ? this.o.board.item(about.parent) : undefined;
    return { by: project?.plan ? 'project' : 'koordinator', about, project };
  }

  /** The session of the Question card a thread moved onto, archived or deleted since. */
  private cardSession(root: Exchange): string | undefined {
    if (!root.movedTo) return;
    try {
      return this.o.board.row(root.movedTo).session_id ?? undefined;
    } catch {
      return;
    }
  }

  /** One turn after the other in each thread; with none running, it starts at once. */
  private queue(thread: number, fn: () => Promise<unknown>): Promise<unknown> {
    const running = this.turns.get(thread);
    const next = running ? running.catch(() => {}).then(fn) : fn();
    this.turns.set(thread, next);
    void next.finally(() => {
      if (this.turns.get(thread) === next) this.turns.delete(thread);
    });
    return next;
  }

  private deliver(talkId: number, thread: number, by: By, question: string, a: OwnerAnswer, card: string | undefined) {
    const text = clip(a.text, 12000);
    const t = this.o.board.exchange(talkId);
    // in the log of the card that was open; with the thread moved onto a Question card meanwhile, there too
    const moved = t?.movedTo && this.o.board.item(t.movedTo)?.kind === 'question' ? t.movedTo : undefined;
    this.o.board.answerTalk(talkId, text, by, a.files);
    const ref = answerRef(thread, a.files, t?.continues);
    if (card) this.o.board.logThread(card, { kind: 'say', author: by, text, answer: ref });
    if (moved) {
      this.o.board.logThread(moved, { kind: 'talk', author: by, text, answer: ref });
      const s = this.o.board.thread(moved);
      this.o.board.setThread(moved, { answers: s.answers + 1, files: s.files + (a.files?.length ?? 0) });
    }
    // above the microphone too, wherever the owner is by now; in full on the card or in the sheet
    this.o.board.notify({ ...(card || moved ? { cardId: card ?? moved } : {}), text: clip(text, 300) });
    this.o.onAnswer?.(talkId, question, text);
  }

  /** An exchange from the sheet answered on its thread's Question card. */
  private answer(talkId: number, question: string, text: string, by: By, files: AnswerFile[] = []) {
    this.o.board.answerTalk(talkId, text, by, files);
    this.o.onAnswer?.(talkId, question, text);
  }

  /** The thread so far, for an agent that starts afresh: the owner's words and the answers, with their files. */
  private history(thread: number, cardId?: string): string {
    const lines = cardId
      ? this.o.board
          .events(cardId)
          .filter((e) => e.kind === 'talk' || (e.kind === 'say' && e.answer))
          .map((e) => said(e))
      : this.o.board
          .threadTalk(thread)
          .flatMap((r) => [`The owner: "${r.said}"`, ...(r.answer !== undefined ? [`You: ${r.answer}${fileList(r.files)}`] : [])]);
    // the words being asked now come after it
    return `You answered the owner before, in a session that cannot be resumed. The conversation so far, oldest first:\n\n${lines.join('\n\n')}`;
  }

  private questionCard(id: string): Item {
    const i = this.o.board.item(id);
    if (!i) throw new BadRequest('unknownCard', 'unknown card');
    if (i.kind !== 'question') throw new BadRequest('notQuestion', 'the card is no Question card');
    return i;
  }

  private message(said: string, question: string, about: Item | undefined, project: Item | undefined): string {
    const parts = [`The owner said: "${said}"`, `The question, as you understood it then: ${question}`];
    if (about && about.kind !== 'project') {
      const state = about.queue ? 'planned, queued' : about.need ? `${about.state}: ${about.need}` : about.state;
      parts.push(
        [
          `It is about the ${about.kind} "${about.title}"${about.label ? ` (workstream ${about.label} of the project "${project?.title ?? ''}")` : ''}, state ${state}.`,
          about.statusLine ? `Its last status line: ${about.statusLine}` : '',
          about.question ? `Its open question: ${about.question.text}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
      const brief = ['planned', 'proposal', 'working', 'waiting', 'inPr', 'approved'].includes(about.state) ? this.o.startBrief(about) : undefined;
      if (brief)
        parts.push(
          `${about.state === 'planned' || about.state === 'proposal' ? 'The task its worker would get if the owner started it now' : 'The task its worker got at its start'} (the worker also follows the repository's CLAUDE.md and docs):\n\n<task>\n${brief}\n</task>`,
        );
      const log = this.o.board
        .events(about.id)
        .filter((e) => e.kind !== 'activity')
        .slice(-LOG_LINES);
      if (log.length) parts.push(`The card's log, latest last:\n${log.map((e) => `- ${e.at.slice(0, 16)} ${e.author} (${e.kind}): ${clip(e.text, 300)}`).join('\n')}`);
    } else if (project) parts.push(`It is about the project "${project.title}".`);
    if (project?.plan) parts.push(`The project's plan doc: ${project.plan.file}.`);
    return parts.join('\n\n');
  }
}

/** What the agent hears when the owner goes on: in Obeya's sheet (with the question as Obeya understood it) or on the Question card. */
const followUp = (said: string, question: string | undefined, onCard: boolean) =>
  [
    onCard
      ? `The owner moved this conversation onto a card of its own, and goes on there; their words come to you directly:\n\n${said}`
      : `The owner follows up on your answer. They said: "${said}"`,
    question ? `The question, as Obeya understood it: ${question}` : '',
    'Answer it the same way: read and check what you need (what you read and computed before is still yours), then call answer_owner once.',
  ]
    .filter(Boolean)
    .join('\n\n');

/** Where the thread's files go, as every turn of it hears. */
const filesNote = (dir: string) =>
  `Your output directory for this conversation is ${dir}, outside every repository; it stays with the conversation, so what you wrote there before is there still, and earlier answers still show their files: leave those as they are and write a changed version under a new name. Files the owner asks for, or that help your answer, go there and never into a repository: a spreadsheet of the numbers, a chart or a page, the queries and scripts behind them, a draft as a document, whatever fits. Pass those the owner should see with answer_owner's files, each with a one-line caption; a page (HTML) or an image shows under your answer, any other file opens with the owner's app for it.`;

const answerRef = (thread: number, files?: AnswerFile[], continues?: string): AnswerRef => ({
  thread,
  ...(files?.length ? { files } : {}),
  ...(continues ? { continues } : {}),
});

const fileList = (files?: AnswerFile[]) => (files?.length ? `\n(files: ${files.map((f) => `${f.name} – ${f.caption}`).join('; ')})` : '');

/** A message of a Question card's conversation, as an agent that starts afresh reads it. */
const said = (e: CardEvent) => (e.author === 'owner' ? `The owner: "${e.text}"` : `You: ${e.text}${fileList(e.answer?.files)}`);

/**
 * Opens a file (or a directory) with the system's app for it, on the machine Obeya runs on, which
 * the owner sits at: Finder or Explorer for a directory.
 */
export function openWithSystem(path: string): Promise<boolean> {
  const [cmd, ...args] =
    process.platform === 'darwin' ? ['open', path] : process.platform === 'win32' ? ['explorer.exe', path] : ['xdg-open', path];
  return new Promise((done) => {
    const p = spawn(cmd!, args, { detached: true, stdio: 'ignore' });
    p.on('error', () => done(false));
    p.on('spawn', () => (p.unref(), done(true)));
  });
}

/** How the Koordinator names an answer it looked up, to say which one the owner's words follow up on. */
export const answerTag = (talk: number) => `A${talk}`;
export const fromAnswerTag = (tag: string): number | undefined => {
  const m = /^A?(\d+)$/i.exec(tag.trim());
  return m ? Number(m[1]) : undefined;
};

/** A thread's output directory under Obeya's home: never in a repository, like demos. */
export const answersDir = (home: string, canvas: string, thread: number) => join(home, 'answers', canvas, String(thread));

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
