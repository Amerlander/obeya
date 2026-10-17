// A proposal reworked by what the owner said about it: an agent rewrites its text, reason and
// questions in one read-only turn, and the proposal waits for it. What the owner did not touch stays.
// The owner's words on an open proposal come straight to this agent, as to a card's worker, and it
// passes on what asks Obeya for something (`to_obeya`).

import { z } from 'zod';
import { LANGUAGE_NAMES } from '../core/locale';
import { formatQuestion, type Item, type Question } from '../core/types';
import { BadRequest, type Board } from './board';
import type { AgentRuntime } from './runtime';
import { readSession } from './koordinator';
import { toObeyaTool } from './to-obeya';
import { messageOf } from '../core/text';
import { PROPOSAL_QUESTIONS, proposalQuestions, proposalTask } from './workers';

export interface RevisionOptions {
  board: Board;
  runtime: AgentRuntime;
  /** The checkout the agent may read in: the card's repository. */
  pathFor: (card: Item) => string;
  preferences?: () => string;
  /** Passes on to Obeya what the owner's words ask of it (accept the proposal, a rule, another card), with the card in focus. */
  toObeya?: (cardId: string, request: string) => Promise<string>;
  /** The revision is over: the new text stands (`revised`), or the agent ended without one and the old text stays. */
  onRevised?: (cardId: string, revised: boolean) => void;
}

/** A proposal as the agent writes it back. */
interface Revised {
  title: string;
  task: string;
  reason?: string;
  idea?: boolean;
  questions: { question: string; options?: string[]; multiple?: boolean }[];
  /** Its turn in the conversation: the answer to what the owner asked, and what changed. */
  reply?: string;
}

export class Revisions {
  /** Proposals being reworked, so a resume does not start a second agent. */
  private busy = new Set<string>();

  constructor(private o: RevisionOptions) {}

  /**
   * The owner's words on a proposal (`said`: the line of the log with them): it waits while an
   * agent reworks it by them. Said while it is reworked, they wait for the rework after it.
   */
  revise(cardId: string, words: string, spoken: boolean, said?: number) {
    if (!this.o.board.revising(cardId, words, spoken, said)) this.run(cardId);
  }

  /** The owner takes back words that wait for the next rework: they leave the conversation, and no agent hears them. */
  unsay(cardId: string, id: number) {
    if (!this.o.board.unread(cardId, id) || !this.o.board.unrevise(cardId, id)) throw new BadRequest('notHeld', 'the agent has read these words already');
    this.o.board.withdraw(cardId, id);
  }

  /** After a restart: proposals still being reworked are reworked again. */
  resume() {
    for (const i of this.o.board.snapshot().items) if (i.proposal?.revising) this.run(i.id);
  }

  private run(cardId: string) {
    if (this.busy.has(cardId)) return;
    const card = this.o.board.item(cardId);
    const said = card?.proposal?.revising;
    if (!card || !said) return;
    this.busy.add(cardId);
    this.o.board.readNow(cardId, said.said ?? []);
    this.ask(card, said)
      .then(
        (r) => {
          // the words only asked Obeya for something: the proposal stays as it was, and what Obeya did stands in its conversation
          if (!r) return this.o.board.revised(cardId) || undefined;
          const questions = proposalQuestions(r.questions);
          const p = { title: r.title, task: r.task, ...(r.reason?.trim() ? { reason: r.reason.trim() } : {}), idea: !!r.idea, questions };
          if (!this.o.board.revised(cardId, p)) return;
          const reply = r.reply?.trim();
          if (reply) this.o.board.log(cardId, 'talk', 'worker', reply.slice(0, 4000));
          if (changed(card, p)) this.o.board.log(cardId, 'state', 'koordinator', this.o.board.t.koordinator.revised);
          // a question asked anew stands in the conversation from now on; one it kept stands where it was asked
          const asked = new Set(card.proposal!.questions.map(key));
          for (const q of questions) if (!asked.has(key(q))) this.o.board.log(cardId, 'question', 'worker', formatQuestion(q, this.o.board.language()));
          return true;
        },
        (e) => {
          if (!this.o.board.revised(cardId)) return;
          this.o.board.log(cardId, 'error', 'koordinator', this.o.board.t.koordinator.reviseFailed(messageOf(e)));
          return false;
        },
      )
      .then((revised) => revised !== undefined && this.o.onRevised?.(cardId, revised))
      .catch((e) => console.error('revision:', e))
      .finally(() => {
        this.busy.delete(cardId);
        // what the owner said meanwhile is reworked in by the next
        this.run(cardId);
      });
  }

  /** The reworked proposal, or null when the agent only passed the words on to Obeya. */
  private async ask(card: Item, said: { words: string; spoken?: boolean }): Promise<Revised | null> {
    let revised: Revised | undefined;
    let passed = false;
    const toObeya = this.o.toObeya;
    const error = await readSession(this.o.runtime, {
      cwd: this.o.pathFor(card),
      role: 'koordinator',
      // the proposal waits on, and shows until when
      onLimit: (until) => this.o.board.waitsForLimit({ card: card.id }, until),
      system: [SYSTEM, this.o.toObeya ? TO_OBEYA : '', this.o.preferences?.() ?? ''].filter(Boolean).join('\n\n'),
      tools: (finish) => [
        {
          name: 'revise_proposal',
          description: [
            `The whole proposal as it is to stand now, in ${LANGUAGE_NAMES[this.o.board.language()]}.`,
            `title: short and precise. ${proposalTask('the card it came from nor this conversation')}`,
            `reason: for the owner only, why it is proposed, a sentence or two (keep it unless what the owner said changes it). idea: true for something to think through with the owner before anyone builds it.`,
            `questions: what the owner still has to decide, each with up to four short options; keep them out of task. A question the owner's words settle goes, and its decision goes into task.`,
            `reply: your turn in the conversation beside the proposal, a sentence or two for the owner: the answer to what they asked (asked which option you would take: your pick and why), and what you changed, without repeating the text.`,
          ].join(' '),
          schema: {
            title: z.string(),
            task: z.string(),
            reason: z.string().optional(),
            idea: z.boolean().optional(),
            questions: PROPOSAL_QUESTIONS,
            reply: z.string(),
          },
          run: (r) => {
            if (revised) return 'Only the first one counts.';
            if (!String(r.title).trim() || !String(r.task).trim()) return 'Not recorded: title and task must not be empty.';
            revised = r as unknown as Revised;
            return finish('Recorded. End your turn now.');
          },
        },
        ...(toObeya
          ? [
              toObeyaTool((request) => {
                passed = true;
                return toObeya(card.id, request);
              }),
            ]
          : []),
      ],
      brief: this.message(card, said),
    });
    if (revised) return revised;
    if (error !== undefined) throw new Error(error);
    if (passed) return null;
    throw new Error('der Agent hat keinen neuen Text geliefert');
  }

  private message(card: Item, said: { words: string; spoken?: boolean }): string {
    const p = card.proposal!;
    const from = card.from ? this.o.board.item(card.from) : undefined;
    const summary = from ? this.o.board.summary(from.id)?.trim() : undefined;
    return [
      `The proposal as it stands${p.idea ? ' (proposed as an idea)' : ''}:\n\n<title>${card.title}</title>\n\n<task>\n${card.body}\n</task>`,
      p.reason ? `Why it was proposed (for the owner only): ${p.reason}` : '',
      card.retro ? `The Arbeitsrückschau proposed it, resting on: ${card.retro}` : '',
      p.questions.length
        ? `Its questions to the owner:\n${p.questions.map((q) => `- ${q.text}${q.options.length ? ` (options: ${q.options.join(' / ')}${q.multiple ? '; several may be chosen' : ''})` : ''}`).join('\n')}`
        : 'It has no questions to the owner.',
      from ? `It came from the card "${from.title}"${summary ? `, whose worker handed over:\n\n${summary}` : '.'}` : '',
      `What the owner ${said.spoken ? 'said about it (speech recognition, may contain errors)' : 'wrote about it'}:\n\n<owner>\n${said.words}\n</owner>`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }
}

/** A question as the conversation holds it. */
const key = (q: Question) => JSON.stringify([q.text, q.options, !!q.multiple]);

/** Whether the proposal reads otherwise now: words that only asked something leave it as it was. */
function changed(card: Item, p: { title: string; task: string; reason?: string; idea: boolean; questions: Question[] }): boolean {
  const was = card.proposal!;
  return (
    p.title !== card.title ||
    p.task !== card.body ||
    (p.reason ?? '') !== (was.reason ?? '') ||
    p.idea !== !!was.idea ||
    JSON.stringify(p.questions.map(key)) !== JSON.stringify(was.questions.map(key))
  );
}

const TO_OBEYA =
  "Some of the owner's words ask Obeya rather than you: accept the proposal (and start it), dismiss it, a new card, a rule to remember („Merk dir …“), an action on another card, a question about the canvas or another card. Pass those on with to_obeya: Obeya does them as the owner meant, with a confirmation the owner can take back. When that is all they said, revise_proposal is not needed.";

const SYSTEM = `
You rework a card an agent proposed on Obeya, a canvas on which the owner directs coding agents. The owner read the proposal and spoke to you about it: what to add, drop, decide or put differently, or a question. Rewrite the proposal by their words: what they did not touch stays as it was, in its wording; what they said goes in, as they meant it, in the card's text and not as a quote of them. What they only asked (which option you would take, what something means) you answer in your reply; the decision stays theirs, so the proposal stays as it was there. Spoken words may be misheard: read them for what they most likely meant.
The card's text is all the agent who takes it on gets, so it must stand on its own. Read in the repository only where the owner's words need it (a file, a name they mention). Then call revise_proposal once with the whole proposal and your reply, and end your turn. You cannot change files.
`.trim();
