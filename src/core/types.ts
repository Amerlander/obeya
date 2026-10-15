// Shapes shared by the server and the UI.

import type { DemoSettings, VoiceKind } from '../../plugin/skills/demo/lib/settings.ts';
import type { ListenBackend, SetupId, SetupItem } from '../../plugin/skills/demo/lib/setup.ts';
import type { Language } from './locale';
import { MESSAGES } from './messages';
import type { NotAProject } from './plan-doc';

export type { DemoSettings, NarrationLanguage, VoiceKind } from '../../plugin/skills/demo/lib/settings.ts';
export type { Language } from './locale';
export type { ListenBackend, SetupCheck, SetupId, SetupItem } from '../../plugin/skills/demo/lib/setup.ts';

/**
 * `question`: a thread of looked-up answers the owner moved onto a card of its own, with the agent
 * that looked them up; it holds answers, no work, so its state is `done` until the owner archives it.
 */
export type CardKind = 'task' | 'project' | 'question';

export const STATES = ['idea', 'proposal', 'planned', 'working', 'waiting', 'approved', 'inPr', 'live', 'done'] as const;
export type CardState = (typeof STATES)[number];

/** A card whose work is over: `live` once it landed, `done` when it needed no change to the code (a demo, an analysis). */
export const finished = (s: CardState) => s === 'live' || s === 'done';
/** A card an agent worked on until the owner stopped it: planned again, its branch stays the card's. */
export const stopped = (i: Pick<Item, 'state' | 'branch'>) => i.state === 'planned' && !!i.branch;
/**
 * A stopped card of the owner's the archive may take: nothing waits to start it, and its workspace
 * holds no work (a branch with commits or changes keeps it, and archiving would leave that work
 * unseen in a clone).
 */
export const stoppedArchivable = (i: Pick<Item, 'state' | 'branch' | 'source' | 'queue' | 'workspace' | 'prototypeOf' | 'kind'>) =>
  stopped(i) && i.source === 'manual' && i.kind === 'task' && !i.prototypeOf && !i.queue && !i.workspace;
/** A finished card whose agent still works: after the landing, or answering a follow-up question. */
export const finishingUp = (i: Pick<Item, 'state' | 'finishing'>) => !!i.finishing && finished(i.state);
/**
 * Whether the card's agent is working on something right now, so that the owner can pause it: a
 * Question card's agent reading, an idea's agent working on its reply, a worker in a turn (whatever
 * the card's state: at work, taking in the owner's words on its handover, on its pull request, after
 * the landing). An idle agent is no such agent: there is nothing running to pause.
 */
export const pausable = (i: Pick<Item, 'kind' | 'state' | 'idea' | 'thread' | 'inTurn' | 'paused'>) =>
  !i.paused && (i.kind === 'question' ? !!i.thread?.thinking : i.state === 'idea' && i.idea ? i.idea.thinking : !!i.inTurn);

/**
 * A finished card an agent worked on, on the canvas, with no agent on it now: what the owner asks
 * about it resumes the agent that did the work, which answers and ends again.
 */
export const askable = (i: Pick<Item, 'state' | 'branch' | 'prototypeOf' | 'archivedAt' | 'finishing'>) =>
  finished(i.state) && !!i.branch && !i.prototypeOf && !i.archivedAt && !i.finishing;

/**
 * How many cards of each group are still to be done: not finished, not archived, not a dropped
 * idea. A project counts by its workstreams, not as a card of its own.
 */
export function openPerGroup(items: Item[]): Map<string, number> {
  const open = new Map<string, number>();
  for (const i of items)
    if (i.group && i.kind === 'task' && !finished(i.state) && !i.archivedAt && i.idea?.status !== 'dropped') open.set(i.group, (open.get(i.group) ?? 0) + 1);
  return open;
}

/** A workstream a prototype can be built for: nobody has worked on it yet, and the Koordinator does not hold it. */
export const buildableOn = (i: Item) => i.state === 'planned' && !i.branch && !i.queue;

/**
 * A task of the owner's that can still be planned as a project, as an idea can: planned, nobody has
 * worked on it, the Koordinator does not hold it, and it is no prototype nor decided as a project already.
 */
export const plannableAsProject = (i: Item) =>
  i.source === 'manual' && i.kind === 'task' && buildableOn(i) && !i.prototypeOf && !i.becomesProject;

/**
 * The workstream of a project, among `items`, that its idea's prototypes are built for: the one
 * nobody has started that mentions prototypes, as the plan doc's worker writes it. None when no
 * such workstream, or several, leave it to the owner.
 */
export function prototypeWorkstream(items: Item[], projectId: string): Item | undefined {
  const named = items.filter((i) => i.parent === projectId && buildableOn(i) && /prototyp/i.test(`${i.title}\n${i.body}`));
  return named.length === 1 ? named[0] : undefined;
}

/** What a `waiting` card waits for: `demo` a handover with a demo, `review` one without. */
export type Need = 'demo' | 'question' | 'review';

/** A question an agent asks the owner, with answer options to choose from when it has them. */
export interface Question {
  text: string;
  options: string[];
  /** Several options may be chosen together. */
  multiple?: boolean;
  /** What the asking agent would pick if it had to decide: some of the options, and why. */
  pick?: { options: string[]; why: string };
}

/** A question as its card's log holds it: the text, then one line per option. */
export const formatQuestion = (q: Question, language: Language): string =>
  q.options.length ? `${q.text}${q.multiple ? ` (${MESSAGES[language].multiple})` : ''}\n${q.options.map((o) => `– ${o}`).join('\n')}` : q.text;

/** One item on the canvas as the UI sees it: a stored card merged with what its plan doc says. */
/** Its worker takes in the owner's words on its handover: meanwhile the card is at work, and still waits for approval. */
export const answering = (i: Pick<Item, 'state' | 'need' | 'answering'>) => i.state === 'waiting' && (i.need === 'demo' || i.need === 'review') && !!i.answering;

/**
 * Whether an agent hears what the owner says or types on the card when it is open: its worker (at
 * work, waiting, in a pull request, finishing after the landing, or one a question resumes on a
 * finished card), an idea's exploration agent, or the agent that reworks a proposal (while it
 * does, the words wait for the rework after it). The words then go straight to it; on any other
 * card they go to the Koordinator.
 */
export const agentListens = (i: Pick<Item, 'kind' | 'state' | 'branch' | 'prototypeOf' | 'archivedAt' | 'finishing'>) =>
  !i.archivedAt && (i.kind === 'question' || i.state === 'idea' || i.state === 'proposal' || i.state === 'working' || i.state === 'waiting' || i.state === 'inPr' || !!i.finishing || askable(i));

/**
 * A card the owner left without a title but with a task (text or screenshots): Obeya names it from
 * that (`Koordinator.name`). Without either it is an empty card, dropped when closed.
 */
export const nameless = (i: Pick<Item, 'kind' | 'title' | 'body' | 'images'>) => i.kind !== 'project' && !i.title.trim() && (!!i.body.trim() || !!i.images?.length);

/** A title from a task's first words, on a card not named yet, and when Obeya's naming fails. */
export function titleFrom(body: string): string {
  const line = body.trim().split('\n')[0]!.trim();
  if (line.length <= 70) return line;
  const cut = line.slice(0, 70);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 70)}…`;
}

/**
 * A card needs the owner: it waits (but not while its worker takes in what the owner wrote on its
 * handover, nor once they approved it and its work lands), is a proposal, has a pull request that only waits for the
 * owner's merge, or is an open idea whose agent has replied and is done.
 */
export const needsYou = (i: Item) =>
  (i.state === 'waiting' && !answering(i) && !i.landing) || (i.state === 'proposal' && !i.proposal?.revising) || (i.state === 'inPr' && !!i.pr?.ready) || (!!i.idea && i.idea.status === 'open' && i.idea.yourTurn && !i.idea.thinking);

/** Answers in the Koordinator's sheet the owner has not seen yet. */
export const unreadAnswers = (talk: Talk[]) => talk.filter((x) => x.unread).length;

/** What on a canvas waits for the owner: the cards that need them, and the Koordinator while an answer waits unread. */
export const waitingOn = (s: Pick<CanvasSnapshot, 'items' | 'talk'>) => s.items.filter(needsYou).length + (unreadAnswers(s.talk) ? 1 : 0);

export interface Item {
  id: string;
  kind: CardKind;
  state: CardState;
  need?: Need;
  title: string;
  /** Free text: the owner's description, or a workstream's text from the plan doc (inline markdown). */
  body: string;
  /** Position; relative to the parent project for its workstreams. */
  x: number;
  y: number;
  parent?: string;
  /** `manual` cards are the owner's; `plan` cards mirror a plan doc and are read-only here. */
  source: 'manual' | 'plan';
  /** Workstream label from the plan doc (`W3`). */
  label?: string;
  /** Projects only. */
  plan?: { file: string; goal: string };
  /** Projects only: the idea their plan doc was written from. */
  origin?: string;
  /** The worker's latest `report`. */
  statusLine?: string;
  /**
   * Open question: the worker's, when `need` is `question`; or the one in its demo report, while
   * the demo waits for approval and the owner has not answered it.
   */
  question?: Question;
  /** The worker's summary, when `need` is `review` or `demo`. */
  summary?: string;
  /**
   * Its worker takes in what the owner wrote or said on its handover (`need` is `review` or `demo`):
   * until its turn ends, the card is at work and not the owner's, and still waits for approval.
   */
  answering?: true;
  /**
   * Its worker answered what the owner wrote or said on its handover without a new demo: the card
   * waits for the owner because of that answer, not a demo to watch.
   */
  answered?: true;
  /**
   * The owner's comments on places in the demo video (their event ids) that Obeya holds back while
   * they watch, to give them to the worker in one message once they are done (`Spot`).
   */
  held?: number[];
  /** The owner approved the work and Obeya lands it on main (seconds of git): still `waiting`, but no longer the owner's. */
  landing?: true;
  /** The demo, when `need` is `demo`; its files are served under `/api/cards/:id/demo/`. */
  demo?: Demo;
  /** The demo's page for colleagues, once the owner shared it (or is about to). */
  share?: Share;
  /** The card it comes from: a proposal's source, a prototype's idea, or the card a follow-up follows up on. */
  from?: string;
  /** A card the Arbeitsrückschau proposed: the cards and the friction on them it rests on. */
  retro?: string;
  /** A worker's proposal, while it waits: an idea or a task, why, and what the owner has to decide. */
  proposal?: Proposal;
  /** An agent's proposal the owner accepted: its text is that agent's. */
  proposed?: true;
  /** The repository the card belongs to (an id from the canvas's `repos`). */
  repo: string;
  branch?: string;
  /** Where the branch is checked out, while the card has a workspace: a directory, `host:/dir` on another machine. */
  workspace?: string;
  /** Files the Koordinator expects the card to change. */
  scope?: string[];
  /** A planned card the Koordinator is deciding on, or that waits for cards in progress. */
  queue?: Queue;
  /** The pull request, once the worker opened it after approval. */
  pr?: PullRequest;
  /**
   * A workstream planned again: a part of it landed (this commit, this pull request), but its plan
   * doc keeps it open. A new run does the rest.
   */
  landedPart?: { commit?: string; pr?: { url: string; number: number } };
  /** When the owner archived the card; archived cards are not on the canvas but in its archive. */
  archivedAt?: string;
  /** Ideas only: what the discussion has settled so far. */
  idea?: Idea;
  /** Question cards, and an idea that was one: the thread of looked-up answers it holds. */
  thread?: Thread;
  /** A prototype's idea: the throwaway prototype is built for it and never lands itself. */
  prototypeOf?: string;
  /** A prototype of one of the variants its idea's agent planned: that variant's approach. */
  variant?: string;
  /** A prototype in the archive: discarded (its code thrown away), or built (its idea was built on its branch). */
  prototypeEnd?: 'discarded' | 'built';
  /** A prototype built for a workstream of the project its idea became: that workstream ("W6 „Seite bauen“"). */
  builtInto?: string;
  /** A prototype: its idea's title, wherever the idea is (on the canvas, or in the archive once it became a project). */
  ideaTitle?: string;
  /** A prototype whose worker proposes to build the idea on it: why, in its words. */
  buildProposal?: string;
  /** Ideas: their prototypes, on the canvas or in the archive, the oldest first; each shows its demo on the idea. A workstream built on a prototype: that one. */
  prototypes?: Item[];
  /** A card that was an idea, or a workstream of the project an idea became, built on the branch of one of the idea's prototypes: that prototype. */
  builtOn?: string;
  /** The work has landed and its worker finishes what remains (a migration, say) before its session ends. */
  finishing?: boolean;
  /** While `finishing`: nothing just landed, the owner asked about the finished card and its agent answers. */
  followUp?: boolean;
  /** While `followUp`: its agent needs a full clone to answer and waits, without a workspace, for the next free one. */
  waitsForClone?: true;
  /** Its worker is in a turn right now, its background work included (a render, a watcher): what it does shows, and the owner can pause it. */
  inTurn?: true;
  /**
   * The owner paused the card's agent (its worker, the idea's agent, the Question card's agent):
   * nothing of it runs, its session stays, and it goes on where it stopped with „Weitermachen“ or
   * the owner's next words to it.
   */
  paused?: true;
  /** Waiting for approval, its branch holds no change (checked at the handover): approving makes the card `done`. */
  noChange?: boolean;
  /** Screenshots the owner attached to the card's task; its worker gets them at the start. */
  images?: string[];
  /** A card that was an idea and has been decided: the brief it was decided on. */
  brief?: string;
  /** A card that was an idea and has been decided: the mocks of its brief. */
  mocks?: Mock[];
  /** An idea or a task of the owner's, decided as a project: its worker writes the plan doc, and the project takes its place. */
  becomesProject?: boolean;
  /** The group the card belongs to (a `Group` id); a workstream's is its project's. */
  group?: string;
}

/**
 * A group of cards on the canvas, shown as a coloured territory behind them. It exists while a card
 * belongs to it (on the canvas or in the archive).
 */
export interface Group {
  id: string;
  name: string;
  /** Its colour's hue, 0–359. */
  hue: number;
}

/**
 * What a worker proposes beyond the card's text, which it writes for the agent that will take the
 * card on. Accepting it writes the questions into the text: those the owner answered on the
 * proposal as decided, the others as open.
 */
export interface Proposal {
  /** Something to think through with the owner first: accepted, it becomes an idea. */
  idea?: boolean;
  /** Why the worker proposes it, for the owner only; the card's text does not say it. */
  reason?: string;
  questions: Question[];
  /**
   * What the owner said it should become (`spoken`: through speech recognition; `said`: the lines of
   * the log with these words), while an agent reworks the text, the reason and the questions by it;
   * `next`: what they said meanwhile, which the rework after it takes in.
   */
  revising?: Revising & { next?: Revising[] };
  /** "Übernehmen und starten" was clicked while it was reworked: it is accepted once the new text is there, unless that asks questions. */
  acceptAfterRevision?: true;
}

/** The owner's words a proposal is reworked by. */
export interface Revising {
  words: string;
  spoken?: boolean;
  said?: number[];
}

/** A decision taken on a card: an answer to a worker's question, or the owner's call on an idea. */
export interface Decision {
  id: number;
  cardId: string;
  question: string;
  answer: string;
  by: 'owner' | 'project' | 'koordinator';
  at: string;
}

/** What a project's sheet shows beyond the project: its decisions and the idea it came from. */
export interface ProjectHistory {
  /** The project's decisions and those of its idea, oldest first. */
  decisions: Decision[];
  /** The idea the plan doc was written from, wherever it is now (on the canvas or archived). */
  origin: Item | null;
}

/**
 * An idea under discussion with its exploration agent. `open` while it is discussed; parked or
 * dropped ideas stay on the canvas with their state, and talking to them opens them again.
 */
export interface Idea {
  status: 'open' | 'parked' | 'dropped';
  /** The state of the idea as the agent keeps it (markdown): goal, variants, decisions, open questions. */
  brief: string;
  /** The exploration agent is working on a reply. */
  thinking: boolean;
  /** "So bauen" was clicked while the agent worked on a reply: the idea is built once the reply is there, unless it asks questions. */
  buildAfterReply?: true;
  /** The agent replied and the owner has not answered yet: an open idea then needs the owner. */
  yourTurn: boolean;
  /** The questions of the agent's latest reply, until the owner says something. */
  questions: Question[];
  /** What the agent would do next in the owner's place, from its latest reply, until the owner says something. */
  next?: NextStep;
  /** The prototypes the brief plans, one per variant: "Prototyp bauen lassen" offers them, to start at once. */
  variants: PlannedPrototype[];
  /** How the brief's variants look, one mock each, shown beside it. */
  mocks: Mock[];
}

/** The thread of looked-up answers a Question card holds, as its card shows it. */
export interface Thread {
  /** The exchange with Obeya the thread started with: its id names the thread and its output directory. */
  talk: number;
  /** Its agent is reading, for what the owner asked on the card. */
  thinking?: boolean;
  answers: number;
  files: number;
}

/** A file a looked-up answer comes with, in its thread's output directory: its path there and a one-line caption. */
export interface AnswerFile {
  name: string;
  caption: string;
}

/**
 * What makes a message a looked-up answer: the thread it belongs to (whose output directory holds
 * its files), its files, and the question of the answer it continues.
 */
export interface AnswerRef {
  thread: number;
  files?: AnswerFile[];
  continues?: string;
}

/** A few lines of HTML the idea's agent writes to show how something would look; the card shows it in a sandboxed frame. */
export interface Mock {
  title: string;
  html: string;
}

/** A prototype the idea's agent plans: its approach in a few words (its title) and what it builds and shows (its task). */
export interface PlannedPrototype {
  approach: string;
  show: string;
}

/** The owner's next click on an idea: answer its questions, or one of the decisions on the card. */
export const NEXT_STEPS = ['answer', 'build', 'planDoc', 'prototype', 'park', 'drop'] as const;
export interface NextStep {
  step: (typeof NEXT_STEPS)[number];
  why: string;
}

export interface PullRequest {
  url: string;
  number: number;
  /** Checks on the PR's latest commit, as last seen. */
  checks: { name: string; state: 'pending' | 'success' | 'failure'; url?: string }[];
  conflict: boolean;
  /**
   * Nothing is left for the worker (checks green, threads resolved, reviewers answered), and GitHub
   * refused Obeya's merge for `mergeError`, or the reviewer's confidence is too low for Obeya to
   * merge (`held`, Greptile's 3/5 say): the owner merges, or tells the worker what is missing.
   */
  ready?: boolean;
  mergeError?: string;
  held?: { score: string; by: string };
  /** The review as last seen, oldest first (`reviewOf` in the server's forge). */
  review?: PrReviewEntry[];
}

/** A comment on a pull request; `mine` when the PR's author wrote it (the worker, in the owner's name). */
export interface PrComment {
  author: string;
  mine?: boolean;
  body: string;
  /** When it was written, or last changed when `edited`. */
  at: string;
  edited?: boolean;
  url?: string;
}

/** A reviewer's comment on the code and the replies in its thread. */
export interface PrThread extends PrComment {
  path?: string;
  line?: number;
  resolved: boolean;
  replies: PrComment[];
}

/** A round of a reviewer's comments on the code, or a comment in the conversation. */
export type PrReviewEntry = { author: string; mine?: boolean; at: string; threads: PrThread[] } | PrComment;

/**
 * How long a project's workstreams, started together, wait before the Koordinator plans them: the
 * owner can take the start back until then (a button on the project card is easily hit).
 */
export const START_ALL_HOLD_MS = 8000;

/**
 * `since`: when the card came to the Koordinator; of the cards whose turn comes, the one waiting
 * longest goes first. `together`: the project whose workstreams the Koordinator judges all at once.
 * `workspace`: the Koordinator let the card start, but no workspace was free for it (`none`: all
 * leased or none set up; `dirty`: every free one has uncommitted changes); it starts once one is.
 */
export type Queue = Wait & { since: string };

/** What a card in the queue waits for (`Queue`). */
export type Wait = { checking: true; together?: string } | { behind: string[]; reason: string } | { workspace: WorkspaceShortage };

/** Why a card waits to start: no clone free (`none`), the free ones dirty, or every machine with a clean free one busy to its slots (`slots`). */
export type WorkspaceShortage = 'none' | 'dirty' | 'slots';

/**
 * How a demo shows the work: a narrated `video` of something that happens, or an `html` artifact
 * to look at (design drafts side by side, a layout, an analysis).
 */
export type DemoKind = 'video' | 'html';

export interface Demo {
  kind: DemoKind;
  /** Seconds and title of each scene; none for an HTML artifact. */
  chapters: [number, string][];
  /** A question only the owner can answer, beyond "approve or give feedback". */
  question?: string;
  /** The owner's answer to it; the demo keeps waiting for approval. */
  answer?: string;
  /** The handover event it came with: a later handover may keep the demo, and its question stays with the first. */
  handover?: number;
  /** The page it is shared on, for colleagues who have never seen Obeya: written by the worker at handover, or later from its summary. */
  page?: DemoPage;
  /** An HTML artifact that is its `index.html` alone: it also goes out as one HTML file. */
  single?: true;
}

export interface DemoPage {
  title: string;
  /** Two to five sentences on what changes and why. */
  text: string;
}

/**
 * The largest video exported as one HTML file (which holds it in base64, a third larger): such a
 * file still goes by mail. A larger one is exported as a ZIP only.
 */
export const EXPORT_HTML_MAX = 15 * 1024 * 1024;

/**
 * A card's shared demo page. `publishing` while it goes out, `shared` once the page is
 * up, `withdrawing` while it is taken down.
 */
export interface Share {
  state: 'publishing' | 'shared' | 'withdrawing';
  /** The page; set once it was published, kept while it is published again. */
  url?: string;
  /** The card has a newer demo than the one on the page. */
  stale?: boolean;
  /** The page shows the card's demo, but the site writes pages differently now ("Erneut teilen"). */
  outdated?: boolean;
}

/** One line in a card's log. */
export interface CardEvent {
  id: number;
  cardId: string;
  at: string;
  /**
   * `talk` is the discussion of an idea: the owner's messages and the exploration agent's replies.
   * `closing`: a worker's closing words after its reply or handover, which mostly repeat it: they
   * fold under that message. `denied`: a tool call of the worker's refused without asking anyone,
   * with who refused it and why.
   */
  kind: 'report' | 'activity' | 'say' | 'closing' | 'question' | 'answer' | 'hint' | 'review' | 'state' | 'error' | 'talk' | 'denied';
  author: 'worker' | 'owner' | 'project' | 'koordinator' | 'obeya' | 'explorer';
  text: string;
  /** Set on an error the UI words itself; `text` then holds the server's technical detail. */
  code?: ErrorCode;
  /** Screenshots the owner attached (ids under `/api/c/<canvas>/images/`). */
  images?: string[];
  /** The mocks of an exploration agent's reply. */
  mocks?: Mock[];
  /** The owner's words: the message of the conversation they reply to (its id), shown above them as a quote. */
  replyTo?: number;
  /** The owner's words: the place in the card's demo video they are about. */
  spot?: Spot;
  /** A looked-up answer: its exchange and thread, and its files. */
  answer?: AnswerRef;
  /** The owner's answer to a worker's question: the options they picked, which lead its text (`pickedAnswer`). */
  picks?: string[];
  /** The owner's words the card's agent has not read yet: Obeya holds them for it, and the owner can still take them back. */
  unread?: true;
  /** The owner's words the agent read later than they were written: they stand after this line of the log, where it read them. */
  readAfter?: number;
}

/** The owner's answer as the log holds it: the options picked, then their own words. */
export const pickedAnswer = (picks: string[], words: string) => [picks.join(', '), words.trim()].filter(Boolean).join('\n\n');

/** The owner's own words in an answer, without the options picked that lead it. */
export function ownWords(e: Pick<CardEvent, 'text' | 'picks'>): string {
  const lead = e.picks?.join(', ');
  return lead && e.text.startsWith(lead) ? e.text.slice(lead.length).trim() : e.text;
}

/** A place in a card's demo video the owner's words are about, as the worker reads it with them. */
export interface Spot {
  /** Seconds into the video. */
  at: number;
  /** The chapter playing there. */
  chapter?: string;
  /** What the narration says around there. */
  narration?: string;
  /** The frame there, taken in the browser (an image id like a screenshot's). */
  still?: string;
}

/** A place in the demo video as the browser sends it with the owner's words: Obeya adds chapter and narration. */
export type SpotInput = Pick<Spot, 'at' | 'still'>;

export interface CanvasInfo {
  id: string;
  name: string;
  /** The repositories on the canvas; the first is its home. */
  repos: RepoRef[];
}

export interface RepoRef {
  id: string;
  name: string;
  path: string;
  branch: string;
  /** It has a share target: demos go to a page outside Obeya (the configuration's command, or the `demo.site` of the repository's settings); without one they are exported as a file. */
  share?: boolean;
  /** The demo site of its settings needs an env file this machine lacks (as the settings name it, relative to Obeya's home): demos are exported meanwhile. */
  shareNeeds?: { site: string; file: string };
  /** Its workers work in a pool of clones (else a worktree per card, as many as there are cards). */
  clones?: boolean;
  /** Its approved work goes out as a pull request (else it lands on the default branch of the Obeya checkout). */
  pullRequests?: boolean;
  /** With `pullRequests`: the owner may have approved work pushed directly onto the default branch instead (`direct` of its settings). */
  direct?: boolean;
  /**
   * How many times what the configuration's problems of the repository are read from changed on
   * its default branch while the canvas runs (its `.obeya/settings.json`, a leftover
   * `.obeya/adapter/`): the page reads the problems again when it changes.
   */
  configRev?: number;
}

/** A repository's pool of clones, by the machine they are on, in the order new cards go there; or its slots for workers in worktrees. */
export interface ClonePool {
  repo: string;
  hosts: PoolHost[];
}

/** A machine's part of a pool: its clones and the cards that hold them, and how many of their workers may be busy at once. */
export interface PoolHost {
  /** The host's name in the configuration; for the machine Obeya runs on, its own name. */
  name: string;
  /** The machine Obeya runs on. */
  here?: boolean;
  /** Its workers work in worktrees: `total` is its slots, and `cards` those of the workers at work. */
  worktrees?: boolean;
  /** How many of its workers may be in a turn at once; a new card goes elsewhere or waits once they are. */
  slots: number;
  /** Its clones: how many, and the cards that hold one now. */
  total: number;
  cards: string[];
  /** The cards whose worker is in a turn there now. */
  busy: string[];
}

export interface CanvasSnapshot {
  canvas: CanvasInfo;
  items: Item[];
  /** The canvas's groups, the oldest first. */
  groups: Group[];
  preferences: Preference[];
  /** The settings the Arbeitsrückschau proposes for the canvas's repositories, waiting for the owner; none when none waits. */
  settingProposals?: SettingProposal[];
  /** The owner's latest exchanges with the Koordinator without an open card (those with one are in its log). */
  talk: Talk[];
  /** The clone pools of the repositories that use clones; none when no repository does. */
  workspaces?: ClonePool[];
  /** Shared pages their sites now write differently, and sharing many of them again; none when there is neither. */
  reshare?: Reshare;
  /** The plan directories the canvas has a note about (`PlanDir`); none when it has none. */
  planDirs?: PlanDir[];
}

/**
 * A repository's plan directory, shown as a note beside the projects: the docs in it that are not
 * projects, with the reason and the card preparing each as one (`preparing`), or, while the
 * repository has no plan doc and never had a project (`empty`), where the first one goes.
 */
export interface PlanDir {
  repo: string;
  /** As the repository's settings name it, `docs/plan`. */
  dir: string;
  empty: boolean;
  others: { file: string; reason: NotAProject; preparing?: string }[];
}

/**
 * Shared demo pages to bring up to date at once, from the Koordinator's sheet: how many are
 * outdated, and the run that shares them again one after the other.
 */
export interface Reshare {
  /** Pages that could be shared again and are not queued. */
  outdated: number;
  run?: {
    total: number;
    /** Shared again. */
    done: number;
    /** Failed, with the reason in their card's log. */
    failed: { id: string; title: string }[];
    /** Still to go, the one going out now included. */
    left: number;
    /** The card whose page goes out now. */
    current?: string;
    /** The owner stopped it: the pages not yet out stay as they were. */
    stopped?: boolean;
  };
}

/** One exchange between the owner and the Koordinator. */
export interface Talk {
  id: number;
  at: string;
  /** What the owner said or typed. */
  said: string;
  /** Absent while the Koordinator reads the words. */
  reply?: string;
  /** The card that was open. */
  cardId?: string;
  /** The owner took the actions back. */
  undone?: boolean;
  /** Screenshots that came with the command; they went to the cards it created or concerned. */
  images?: string[];
  /** A question the Koordinator looks up; its answer comes later. */
  question?: string;
  answer?: string;
  /** Who answered: the Koordinator, or the project agent of the workstream asked about. */
  answerBy?: 'koordinator' | 'project';
  /** The answer came for the sheet, and the owner has not had the sheet in view since. */
  unread?: true;
  /** A looked-up question: the thread it belongs to (the id of the exchange that started it). */
  thread?: number;
  /** A follow-up: the exchange whose answer it continues, and that one's question. */
  follows?: number;
  continues?: string;
  /** The files the answer came with, in the thread's output directory. */
  files?: AnswerFile[];
  /** The thread moved onto a Question card: that card; its answers stand there from then on. */
  movedTo?: string;
}

/**
 * A lasting preference of the owner, learned by the Koordinator or written by the owner. A learned
 * one is a proposal until the owner accepts it; agents follow active ones only.
 */
export interface Preference {
  id: number;
  text: string;
  state: PreferenceState;
  /** The card whose exchange it was learned from. */
  cardId?: string;
  /** What the owner said there that it was learned from. */
  quote?: string;
  /** Proposed by the Rückschau over many exchanges, not from one. */
  review?: boolean;
  /** The active rule a proposal would change. */
  replaces?: number;
  /**
   * A repository: the rule is about it and belongs in its CLAUDE.md, not in the preference memory.
   * Accepted, it is `filed` there through a card „CLAUDE.md ergänzen“ and applies to no agent until it is.
   */
  target?: string;
}

export type PreferenceState = 'proposed' | 'active' | 'rejected' | 'filed';

/** The settings of a repository the Arbeitsrückschau may propose a value for, in the dialog's order: what friction on workers' runs shows missing. */
export const PROPOSED_SETTINGS = ['checks', 'setup', 'softPaths', 'run'] as const;
export type ProposedSetting = (typeof PROPOSED_SETTINGS)[number];

/** A value for a setting of a repository (`RepoSettings`) that the Arbeitsrückschau proposes, with the cards it rests on. */
export interface SettingProposal {
  id: number;
  /** The repository's id. */
  repo: string;
  field: ProposedSetting;
  /** A command for `setup`, the recipe for `run` (`app.run`), a list for `checks` and `softPaths`. */
  value: string | string[];
  /** One sentence for the owner: what went wrong on the cards it rests on. */
  basis: string;
  cards: { id: string; title: string }[];
  /** The setting's value as it applies now, in the snapshot. */
  now?: string | string[];
}

/**
 * What became of a setting proposal: waiting, set on this machine, put into the repository's
 * `.obeya/settings.json` for everyone, or rejected.
 */
export type SettingProposalState = 'proposed' | 'machine' | 'repository' | 'rejected';

/** `value` as this machine's settings for the repository hold it (`RepoSettings`). */
export function settingPatch(field: ProposedSetting, value: string | string[] | undefined): RepoSettings {
  if (field === 'run') return { app: { ...(value !== undefined ? { run: value as string } : {}) } };
  return { [field]: value } as RepoSettings;
}

export interface NewCard {
  title: string;
  body?: string;
  /** Where it goes; left out for a follow-up, which goes below the card it comes from. */
  x?: number;
  y?: number;
  /** A repository of the canvas; its home repository when left out (a follow-up's: that of its card). */
  repo?: string;
  /** An idea to discuss before anything is planned. */
  idea?: boolean;
  /** The card this one follows up on, e.g. for a finding of its demo. */
  from?: string;
  /** Screenshots for the task (ids from `POST /api/c/<canvas>/images`). */
  images?: string[];
}

export interface CardPatch {
  x?: number;
  y?: number;
  title?: string;
  body?: string;
  state?: CardState;
  need?: Need | null;
  /** Another repository of the canvas, before work on the card has begun. */
  repo?: string;
  /** The task's screenshots, all of them (ids from `POST /api/c/<canvas>/images`). */
  images?: string[];
}

/** Owner actions on a card's work, posted to `/api/c/:canvas/cards/:id/act`. */
export type CardAction =
  /** On a project: all its planned workstreams go to the Koordinator, which orders them. */
  | { action: 'start' }
  /** A card the owner closed without a title (`nameless`): Obeya names it from its text. */
  | { action: 'name' }
  | { action: 'stop' }
  /** The worker stops at once and goes on later where it stopped (`resume`, or the owner's next words to it). */
  | { action: 'pause' }
  | { action: 'resume' }
  /** `images`: ids of screenshots uploaded before (`POST /api/c/<canvas>/images`); with them the text may be empty. */
  /** `spoken`: the words came through speech recognition, which the agent is told. */
  /** `replyTo`: the message of the card's conversation the words reply to (`CardEvent.replyTo`). */
  /** `spot`: the place in the card's demo video the words are about. */
  | { action: 'message'; text: string; spoken?: boolean; images?: string[]; replyTo?: number; spot?: SpotInput }
  /** `picks`: the options of the question the owner picked; with them the text, their own words, may be empty. */
  | { action: 'answer'; text: string; spoken?: boolean; images?: string[]; replyTo?: number; picks?: string[] }
  /**
   * The owner has finished watching the demo video: the comments on places in it that Obeya held back
   * go to the worker. `now`: they sent them themselves ("Jetzt senden"), so they go without a moment's wait.
   */
  | { action: 'release'; now?: boolean }
  /** Deletes a comment on a place in the demo video that Obeya still holds back (`Item.held`). */
  | { action: 'unsay'; id: number }
  /** `direct`: onto the default branch at once, without a pull request, where the repository allows it (`RepoRef.direct`). */
  | { action: 'approve'; direct?: boolean }
  /** Start a queued card although it may collide. */
  | { action: 'force' }
  /** On a project: takes back a start of all its workstreams while the Koordinator has not planned them yet. */
  | { action: 'dequeue' }
  /** A waiting card one place earlier or later in the queue, past a card it has no wait with. */
  | { action: 'reorder'; earlier: boolean }
  /**
   * A proposal becomes the owner's card and starts (a proposed idea: its discussion opens); with
   * `start: false` it is only planned. `picks`: the options the owner chose for each of its questions.
   * While the proposal is reworked, it is accepted and started once the new text is there, unless that asks questions.
   */
  | { action: 'accept'; start?: boolean; picks?: string[][] }
  /** A proposal: accepting it after its revision is taken back. */
  | { action: 'unaccept' }
  | { action: 'dismiss' }
  /** A proposal: an agent reworks its text, reason and questions by what the owner said (`text`). */
  | { action: 'revise'; text: string; spoken?: boolean; replyTo?: number }
  /** Ideas: talk to the exploration agent; `spoken` gets a short spoken summary back. */
  | { action: 'discuss'; text: string; spoken?: boolean; images?: string[]; replyTo?: number }
  /**
   * Ideas: the brief becomes the card's task and the card is planned. While the agent works on a
   * reply, the idea is built once the reply is there, unless it asks questions.
   */
  | { action: 'build' }
  /** Ideas: building after the reply is taken back. */
  | { action: 'unbuild' }
  /** Ideas, and planned tasks of the owner's nobody has worked on: a planned card whose worker writes a plan doc from the brief or the task. */
  | { action: 'planDoc' }
  | { action: 'park' }
  | { action: 'drop' }
  /**
   * Ideas: a worker builds a throwaway prototype and shows it as a demo on the idea; several may run
   * side by side. One per planned variant named in `variants` (by approach), and one for `text`.
   * Neither: one per planned variant without a prototype on the canvas, or, without any planned,
   * the idea as it stands.
   */
  | { action: 'prototype'; text?: string; variants?: string[] }
  /**
   * Prototypes: the idea is built on this prototype's branch; the idea's other prototypes are
   * discarded. Once the idea has become a project, one of its workstreams is built on it instead:
   * `workstream`, or else the one the plan doc builds on the prototypes with.
   */
  | { action: 'buildPrototype'; workstream?: string }
  /** Prototypes: thrown away, into the archive with log, demo and summary. */
  | { action: 'discard' }
  /** A video demo is published for colleagues right away, or again with the card's newer demo. */
  | { action: 'share' }
  /** Withdraws the published page. */
  | { action: 'unshare' }
  /** Question cards: the owner's words to the agent that looked the answers up. */
  | { action: 'ask'; text: string; spoken?: boolean; images?: string[]; replyTo?: number }
  /** Question cards: the thread becomes an idea, whose exploration agent starts from it. */
  | { action: 'asIdea' };

/**
 * Why the server refused a request. The server sends the code and an English detail
 * (`{ code, error }`, status 400); the UI shows its own text for the code.
 */
export type ErrorCode =
  | 'unknownCard'
  /** A group that no card belongs to any more, so it is gone. */
  | 'unknownGroup'
  | 'project'
  | 'notPlanned'
  | 'queued'
  | 'notQueued'
  /** Moving a card in the queue: it is first or last already, or the card it would pass has a wait with it or is being judged. */
  | 'notMovable'
  | 'notPlannable'
  | 'noAgent'
  /** Resuming an agent the owner has not paused. */
  | 'notPaused'
  | 'noQuestion'
  | 'notReady'
  /** Deleting a comment on the demo video: it is no longer held back, the worker has it. */
  | 'notHeld'
  /** Approving directly onto main: the card's repository lands approved work only through a pull request. */
  | 'noDirect'
  | 'notProposal'
  | 'revising'
  | 'planCard'
  | 'noWorkspace'
  | 'dirtyWorkspaces'
  /** Every machine with a clean free clone has as many workers busy as it has slots. */
  | 'noSlot'
  | 'workspace'
  | 'emptyText'
  /** The cloud service for voice in failed or refused the check's sentence (the detail says what it said). */
  | 'voiceCloud'
  | 'unknownPreference'
  | 'unknownSetting'
  /** An uploaded screenshot is no image the agents read, or too large. */
  | 'imageType'
  | 'imageTooLarge'
  /** Only a finished card of the owner's (or a stopped task, a parked or dropped idea) goes into the archive. */
  | 'notDone'
  /** A stopped card whose workspace holds work stays on the canvas. */
  | 'holdsWork'
  | 'notArchived'
  | 'notIdea'
  /** The card holds no thread of looked-up answers (it is no Question card). */
  | 'notQuestion'
  /** A looked-up answer's file that is not in its thread's output directory. */
  | 'noFile'
  /** The idea's agent is still working on its reply: building or planning waits for it. */
  | 'ideaThinking'
  /** A prototype for the idea is still running. */
  | 'prototypeRunning'
  /** The prototype's idea is becoming a project: its plan doc is not there yet. */
  | 'projectPending'
  /** The prototype's idea is gone from the canvas, and no project of it is there. */
  | 'ideaGone'
  /** The prototype's idea became a project whose plan doc does not say which workstream builds on it, and none was chosen. */
  | 'workstreamMissing'
  /** The workstream to build on a prototype was started already. */
  | 'workstreamStarted'
  /** Every variant the idea's agent planned has its prototype on the canvas already. */
  | 'variantsRunning'
  /** A project has no planned workstream left that is not already with the Koordinator. */
  | 'nothingToStart'
  /** The action is for a prototype on the canvas, and the card is none. */
  | 'notPrototype'
  /** A discarded or built prototype stays in the archive; a new attempt is a new prototype. */
  | 'prototypeEnded'
  /** Sharing: the card has no demo, or its repository shares none. */
  | 'noShare'
  /** Sharing: the page is being published or withdrawn right now. */
  | 'shareBusy'
  /** Sharing: the demo is not shared. */
  | 'notShared'
  /** Sharing many pages again: a run is under way already. */
  | 'reshareBusy'
  /** Setup: the folder for the first canvas is no git repository. */
  | 'notRepo'
  /** Setup: the folder a clone would go to exists already. */
  | 'cloneTarget'
  /** Setting up git in a folder: git has no name and e-mail for the first commit. */
  | 'noIdentity'
  /** Setting up git in a folder failed; it is as it was. */
  | 'gitSetup'
  /** Setup: an installation or a clone is running already. */
  | 'setupBusy'
  /** Sharing many pages again: no page is outdated. */
  | 'nothingOutdated'
  /** „Für alle ins Repository übernehmen“: this machine sets nothing to take over. */
  | 'noSettings'
  /** „Für alle ins Repository übernehmen“: the checkout on the main branch has changes of its own in `.obeya/settings.json`. */
  | 'settingsDirty'
  /** „Für alle ins Repository übernehmen“: the commit, the push or the pull request failed; why comes with it. */
  | 'settingsShare'
  /** Export: the video is too large for one HTML file. */
  | 'exportTooLarge'
  /** Export: the HTML artifact loads files beside its page, so it does not fit one HTML file. */
  | 'exportNotAlone'
  /** Approval could not land the work on main. */
  | 'landDirty'
  | 'landConflict'
  | 'landEmpty'
  | 'landCheckout'
  | 'landMerge'
  /** Pushing approved work directly onto `origin`'s default branch was turned away (a protected branch, say). */
  | 'landPush'
  | 'land'
  /** A configuration with problems; they come with it. */
  | 'config'
  /** A voice's sample could not be made; why comes with it. */
  | 'voiceSample'
  /** A voice is being installed already. */
  | 'voiceInstalling'
  /** Malformed input: a bug in the UI rather than something the owner can fix. */
  | 'invalid';

/** A repository on a canvas, as Obeya's configuration lists it (`canvases.json`). */
export interface RepoConfig {
  path: string;
  /** Clones to register as workspaces (adapters that use clones). */
  workspaces?: string[];
  /** Clones to create under Obeya's home (adapters that use clones). */
  clones?: number;
  /** How many of its workers may be busy at once on this machine; left out, as many as it has clones, or any number in worktrees. */
  slots?: number;
  /**
   * Other machines its workers run on, reached over SSH (design: Hosts), in the order a new card
   * looks for a free slot after this one. Only for a repository whose workers use clones and whose work goes out through its
   * remote.
   */
  hosts?: HostConfig[];
  /** The settings the owner set for this machine in the configuration dialog; each goes before the repository's `.obeya/settings.json`. */
  settings?: RepoSettings;
}

/** How the repository's app runs (`app` of its settings): the recipe the workers read, and the two commands Obeya runs itself. */
export interface AppSettings {
  /**
   * How to run the app, in prose for a new colleague: how to start it, what to do after which kind
   * of change, where it gives its address, the login and test data for a demo. Every worker's brief
   * has it; empty, each worker finds it out from the repository.
   */
  run?: string;
  /**
   * Stops the app in a workspace, and does nothing where none runs. Obeya runs it there when the
   * card waits for the owner and its worker has nothing running (Parking), and tells the worker with
   * its next message.
   */
  stop?: string;
  /** Exits 0 when the workspace's app holds what must not be lost (a restored database, say): Obeya then leaves it running. */
  keep?: string;
}

/**
 * A static site the demos are shared on (`demo.site` of a repository's settings): Obeya keeps its
 * directory (one subdirectory per page, and the overview), writes the pages with its own templates
 * and runs the deploy command after each change.
 */
export interface DemoSite {
  /** The overview's heading, and the pages' tab titles. */
  title: string;
  /** Where the site is served; a page's URL is `url/<slug>/`. */
  url: string;
  /** The command line that deploys the site, run in the repository; `{dir}` stands for the site's directory. */
  deploy: string;
  /**
   * A file of `KEY=value` lines, relative to Obeya's home, added to the deploy's environment
   * (credentials, never in git). A machine without it exports demos instead of sharing them.
   */
  env?: string;
  /** Headers for reading the live site's manifest and pages (behind a login), values `${KEY}` from `env`. */
  headers?: Record<string, string>;
  /** The largest file the host takes, in bytes; 25 MiB without it. */
  maxFile?: number;
  /** The overview's words; without it the narration language of the demo settings. */
  language?: 'de' | 'en';
}

/**
 * What Obeya needs to know about how a repository works, and its main branch, as the owner sets
 * them in the configuration dialog for this machine (design: Repository settings). Read where they
 * are used: saving them restarts nothing, but for `workspaces`, which restarts the repository's agents.
 */
export interface RepoSettings {
  /** Its main branch, where cards start from and work lands; detected where left out (`defaultBranch`). */
  branch?: string;
  land?: 'main' | 'pr';
  direct?: boolean;
  checks?: string[];
  setup?: string;
  planDocs?: { dir: string; exclude: string[] };
  softPaths?: string[];
  workspaces?: 'clones' | 'worktrees';
  prNoise?: string[];
  app?: AppSettings;
  demo?: { site?: DemoSite };
}

/**
 * A repository's settings for everyone who runs Obeya on it, in `.obeya/settings.json` as its
 * default branch has it (design: Repository settings): those for this machine but the main branch,
 * which says where the file is read from.
 */
export type SharedSettings = Omit<RepoSettings, 'branch'>;

/** The fields of `SharedSettings`, in the dialog's order. */
export const SHARED_FIELDS = ['land', 'direct', 'checks', 'setup', 'planDocs', 'softPaths', 'workspaces', 'prNoise', 'app', 'demo'] as const satisfies readonly (keyof SharedSettings)[];

/** The settings made of fields that are each set, layered and taken over on their own, and their fields. */
export const NESTED_SETTINGS = { app: ['run', 'stop', 'keep'], demo: ['site'] } as const satisfies { [K in keyof RepoSettings]?: readonly (keyof NonNullable<RepoSettings[K]>)[] };
export type NestedSetting = keyof typeof NESTED_SETTINGS;
export const isNested = (field: string): field is NestedSetting => field in NESTED_SETTINGS;

/** `over` in front of `under`, field by field; the fields of `app` and `demo` each on its own. */
export function layerSettings<T extends RepoSettings>(under: T | undefined, over: T | undefined): T | undefined {
  if (!under) return over;
  if (!over) return under;
  const out: RepoSettings = { ...under, ...over };
  for (const k of Object.keys(NESTED_SETTINGS) as NestedSetting[]) if (under[k] || over[k]) out[k] = { ...under[k], ...over[k] };
  return out as T;
}

/**
 * Where a repository's setting comes from where this machine sets none, highest first: the
 * repository's `.obeya/settings.json`, the clones the configuration names (`workspaces` only),
 * detection (main branch, landing), Obeya's default.
 */
export type SettingSource = 'repository' | 'clones' | 'detected' | 'default';

/** A setting's value without this machine's, and where it comes from. */
export interface SettingValue<T> {
  value: T;
  source: SettingSource;
}

/** A repository's settings as they stand without this machine's: what the dialog shows where the owner set nothing. */
export interface RepoValues {
  branch: SettingValue<string>;
  land: SettingValue<'main' | 'pr'>;
  direct: SettingValue<boolean>;
  checks: SettingValue<string[]>;
  setup: SettingValue<string>;
  planDocs: SettingValue<{ dir: string; exclude: string[] }>;
  softPaths: SettingValue<string[]>;
  workspaces: SettingValue<'clones' | 'worktrees'>;
  prNoise: SettingValue<string[]>;
  app: { run: SettingValue<string>; stop: SettingValue<string>; keep: SettingValue<string> };
  demo: { site: SettingValue<DemoSite | null> };
}

/**
 * A repository's entry in the configuration without what applies as it is read (its settings but
 * where its workers work): where it differs, the repository's agents restart with it.
 */
export function repoShape({ settings, ...r }: RepoConfig): string {
  return JSON.stringify({ ...r, workIn: settings?.workspaces });
}

/** Whether saving `after` over `before` restarts or stops some repository's agents: one that left, or whose shape changed (`repoShape`). */
export function restartsAgents(before: CanvasConfig[], after: CanvasConfig[]): boolean {
  const shapes = (canvases: CanvasConfig[]) => new Map(canvases.flatMap((c) => c.repos.map((r) => [r.path, repoShape(r)] as const)));
  const now = shapes(after);
  return [...shapes(before)].some(([path, shape]) => now.get(path) !== shape);
}

/** The clones a repository gets whose settings say clones, the first canvas's or one added later: two cards run at once. */
export const CLONES = 2;

/**
 * The draft with `CLONES` filled in for each repository the saved configuration does not have whose
 * settings say clones (`resolved`, by index) and that names none, once per path: `filled` keeps the
 * paths, so a count emptied again stays empty. Null when nothing is filled in.
 */
export function withClones(draft: CanvasConfig[], saved: CanvasConfig[], resolved: (ResolvedCanvas | null)[], filled: Set<string>): CanvasConfig[] | null {
  const known = new Set(saved.flatMap((c) => c.repos.map((r) => r.path.trim())));
  let changed = false;
  const next = draft.map((c, i) => ({
    ...c,
    repos: c.repos.map((r, j) => {
      const path = r.path.trim();
      if (!path || known.has(path) || filled.has(path) || resolved[i]?.repos[j]?.workspaces !== 'clones') return r;
      filled.add(path);
      if (r.clones !== undefined || r.workspaces?.length) return r;
      changed = true;
      return { ...r, clones: CLONES };
    }),
  }));
  return changed ? next : null;
}

/** A machine reached over SSH that a repository's workers run on, in clones of their own there. */
export interface HostConfig {
  /** What the owner calls it; workspaces there are named by it. */
  name: string;
  /** What `ssh` connects to: `user@machine`, or a name from `~/.ssh/config`. */
  ssh: string;
  /** The directory there that holds the clones (`~/…` in that machine's home). */
  root: string;
  /** How many clones Obeya keeps there (`<root>/1`, `<root>/2`, …). */
  clones: number;
  /** How many of the repository's workers may be busy there at once; as many as it has clones when left out. */
  slots?: number;
}

/** A canvas in Obeya's configuration. */
export interface CanvasConfig {
  /** Names the canvas; its id follows. Without it, both are the first repository's name. */
  name?: string;
  /** Keeps the canvas's id, and with it its cards, whatever its name says: set when a canvas is renamed. */
  id?: string;
  repos: RepoConfig[];
}

/** What a configuration amounts to: each canvas's id and name, and its repositories with their settings. */
export interface ResolvedCanvas {
  id: string;
  name: string;
  repos: {
    id: string;
    workspaces: 'clones' | 'worktrees';
    /**
     * It still has a `.obeya/adapter/` on its main branch, which Obeya no longer reads: its values
     * belong in `.obeya/settings.json` (problem `adapterGone`).
     */
    adapterGone?: boolean;
    /** Its settings without this machine's, with where each comes from. */
    values: RepoValues;
    /**
     * Where „Für alle ins Repository übernehmen“ puts `.obeya/settings.json`: a commit on the main
     * branch where work lands there, else a pull request.
     */
    shareTo: 'main' | 'pr';
    /** Where it goes out as a pull request, it may also be pushed straight onto `origin`'s main branch (`direct`). */
    shareDirect?: boolean;
  }[];
}

/** Something in a configuration that keeps Obeya from starting with it; `canvas` and `repo` count from 0. */
export interface ConfigProblem {
  code: ConfigProblemCode;
  canvas?: number;
  repo?: number;
  /** In English, for developers and the Koordinator. */
  detail: string;
}

/** Whether a problem keeps the configuration from being saved: not one in the repository, which is fixed there. */
export const blocksSaving = (p: ConfigProblem) => p.code !== 'demoSite' && p.code !== 'adapterGone' && p.code !== 'repoSettings';

export type ConfigProblemCode =
  /** No canvas at all. */
  | 'noCanvas'
  | 'noRepo'
  /** A path that is no git repository. */
  | 'notRepo'
  /** A repository the canvas has already, under this path or another. */
  | 'sameRepo'
  /** The repository still has a `.obeya/adapter/`, which Obeya no longer reads: its values belong in `.obeya/settings.json`. */
  | 'adapterGone'
  /** Two canvases with the same id. */
  | 'sameId'
  /** The repository the canvas was first served with is missing. */
  | 'homeMissing'
  /** A clone listed as a workspace that is no git repository. */
  | 'notClone'
  /** The demo site the repository's settings name cannot be used: a field is missing, or its deploy command names a program that is not there. */
  | 'demoSite'
  /** A host that cannot work for the repository: its workers use worktrees, or its work does not go out through a remote. */
  | 'hostRepo'
  /** Two hosts of one name that connect to different machines. */
  | 'hostName'
  /** A main branch set for this machine that the repository does not have. */
  | 'noBranch'
  /** Something in the repository's `.obeya/settings.json` that does not count (fixed there, so it keeps nothing from being saved). */
  | 'repoSettings'
  /** Malformed: a bug in whoever wrote it. */
  | 'invalid';

/**
 * Obeya's configuration as the owner sees and edits it, at once: what it amounts to and what is
 * wrong with it come after, from its check (`ConfigChecked`), which reads every repository.
 */
export interface ConfigView {
  /** The file it is saved in. */
  file: string;
  /** Where the running canvases come from: that file, or repositories named on the command line. */
  source: 'file' | 'args';
  /** As saved (or as given on the command line, before anything is saved). */
  canvases: CanvasConfig[];
  /** The ids of the canvases this server runs. */
  running: string[];
  /**
   * Settings of the running server, from its command line; its version (`package.json`), and the
   * commit of the checkout it runs from (null for the compiled binary).
   */
  server: { port: number; home: string; permissionMode: string; restarts: boolean; version: string; commit: string | null };
  /** Saved, and Obeya starts again with it once no agent is in the middle of a turn. */
  restarting: boolean;
}

/** A configuration checked: what it amounts to and what keeps it from working. */
export interface ConfigChecked {
  /** As saved, tidied. */
  canvases: CanvasConfig[];
  /** What they amount to, by index; null for a canvas with a problem. */
  resolved: (ResolvedCanvas | null)[];
  problems: ConfigProblem[];
}

/** What „Für alle ins Repository übernehmen“ did with a repository's settings for this machine. */
export type SettingsShared =
  /** Committed `.obeya/settings.json` on the main branch (pushed onto `origin`'s, where it went there directly): the settings now come from the repository. */
  | { committed: string; branch: string }
  /** Opened a pull request with it: once it is merged, the settings come from the repository. */
  | { pr: string };

/** What saving the configuration did: Obeya starts again with it, or (repositories' settings alone) it applies at once. */
export interface ConfigSaved {
  restarting: boolean;
  /** Obeya runs with it now: canvases and repositories new in it started, settings apply as they are read, and agents whose repository's set-up changed restart once they paused. */
  applied?: boolean;
}

/** What keeps the demo settings from working (a voice to install is not one: `DemoVoiceCheck.install`). */
export type DemoSettingsProblem =
  /** `command` without one. */
  | 'noCommand'
  /** The own endpoint, or Azure's region, is missing. */
  | 'noUrl'
  /** A service without its environment variable or a key file. */
  | 'noKey'
  | 'keyFileMissing'
  /** Qwen3's clip to clone is not there, or its transcript beside it. */
  | 'referenceMissing'
  | 'noTranscript'
  /** `say` is macOS only. */
  | 'notHere';

/** What the settings sheet shows about a voice, saved or not yet. */
export interface DemoVoiceCheck {
  /** The person the narration speaks in, which follows from whether the voice is the owner's own. */
  person: 'first' | 'third';
  problems: DemoSettingsProblem[];
  /** What the voice needs installed by Obeya and is missing (Piper, Qwen3-TTS), and about how much that is. */
  install: { installed: boolean; missing: string[]; mb: number };
}

/** An installation Obeya runs for a voice, one at a time. */
export interface VoiceInstallJob {
  voice: VoiceKind;
  running: boolean;
  /** The last line of its output. */
  line: string;
  error?: string;
}

/** The demo settings (`plugin/skills/demo/lib/settings.ts`) as the settings sheet shows them. */
export interface DemoSettingsView {
  /** The file they are saved in, under Obeya's home. */
  file: string;
  settings: DemoSettings;
  /** The saved voice checked. */
  check: DemoVoiceCheck;
  /** The installation running or last run, while Obeya runs. */
  job?: VoiceInstallJob;
  /** `process.platform` of the server: `say` is offered on a Mac only. */
  platform: string;
}

/** The language Obeya speaks to the owner (`src/server/settings.ts`): chosen in the settings, else the system's. */
export interface LanguageView {
  /** The file it is saved in, under Obeya's home. */
  file: string;
  /** What the owner chose; `null` follows the system. */
  chosen: Language | null;
  /** The system's language, or the fallback when Obeya does not speak it. */
  system: Language;
  /** The one that applies. */
  language: Language;
}

/** The look Obeya's pages take (`src/server/settings.ts`): light or dark as chosen in the settings, else as the system's. */
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export interface ThemeView {
  /** The file it is saved in, under Obeya's home. */
  file: string;
  /** What the owner chose; `null` follows the system. */
  chosen: Theme | null;
}

/** The agents Obeya runs, grouped as the owner sets their model and effort (`src/server/settings.ts`). */
export const AGENT_ROLES = ['koordinator', 'worker', 'explorer', 'chores'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];
/** The models offered: Claude Code's default, or one of its aliases, each the newest of its family. */
export const AGENT_MODELS = ['default', 'fable', 'opus', 'sonnet', 'haiku'] as const;
export type AgentModel = (typeof AGENT_MODELS)[number];
export const AGENT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AgentEffort = (typeof AGENT_EFFORTS)[number];
/** The model and effort a group of agents runs with. */
export interface AgentSetting {
  model: AgentModel;
  effort: AgentEffort;
}
/** What applies until the owner chooses otherwise: Opus throughout, high effort for workers and exploration agents. */
export const AGENT_DEFAULTS: Record<AgentRole, AgentSetting> = {
  koordinator: { model: 'opus', effort: 'medium' },
  worker: { model: 'opus', effort: 'high' },
  explorer: { model: 'opus', effort: 'high' },
  chores: { model: 'opus', effort: 'medium' },
};

/** The model and effort of each group of agents, as they apply (`settings.json` over `AGENT_DEFAULTS`). */
export interface AgentsView {
  file: string;
  agents: Record<AgentRole, AgentSetting>;
}

/**
 * The cloud services Obeya's voice in can send recordings to instead, all with the OpenAI-style
 * `/audio/transcriptions` endpoint (`src/server/voice-cloud.ts`). `prompt`: it takes the card
 * titles as vocabulary. `openai` stands for any compatible endpoint: base URL and model can be changed.
 */
export const CLOUD_VOICES = {
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo', keys: 'https://console.groq.com/keys', prompt: true },
  mistral: { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'voxtral-mini-latest', keys: 'https://console.mistral.ai/api-keys', prompt: false },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-transcribe', keys: 'https://platform.openai.com/api-keys', prompt: true },
} as const;
export type CloudPreset = keyof typeof CLOUD_VOICES;
export const CLOUD_PRESETS = Object.keys(CLOUD_VOICES) as CloudPreset[];

/** A cloud service as the owner set it up (its key stays on the server; the page only learns there is one). */
export interface CloudVoiceView {
  preset: CloudPreset;
  baseUrl: string;
  model: string;
  key: boolean;
  /** Recordings go to it rather than to the recognition on this machine. */
  used: boolean;
  /** How long it took for the check's sentence, and what it heard, when it was last tested. */
  tested?: { seconds: number; heard: string };
}

/**
 * How long the recognition on this machine took for the short sentence Obeya ships with
 * (`voice/check-de.ogg`), loaded and warm. `slow`: longer than the sentence itself.
 */
export interface VoiceSpeed {
  backend: ListenBackend;
  seconds: number;
  /** The sentence's length in seconds. */
  clip: number;
  heard: string;
  slow: boolean;
}

/** What Obeya's own voice in needs on this machine (`src/server/voice-setup.ts`). */
export type VoiceSetupId = 'recognition' | 'ffmpeg' | 'uv';
export type VoiceSetupItem = Omit<SetupItem, 'id'> & {
  id: VoiceSetupId;
  /** The recognition, which uv fetches: "Installieren" waits until uv is there. */
  waits?: 'uv';
} & VoiceRecognitionParts;

/** What the recognition's line carries besides its state: how fast it is here, and the cloud service. */
export interface VoiceRecognitionParts {
  /** Measured on this machine; `measuring` while it is. */
  speed?: VoiceSpeed | 'measuring';
  cloud?: CloudVoiceView;
}

export interface VoiceSetupView {
  platform: string;
  arch: string;
  listen: ListenBackend;
  items: VoiceSetupItem[];
  /** What "Installieren" fetches and about how much: the recognition and its model. */
  fetch: { parts: 'recognition'[]; mb: number };
  /** The installation or measurement running or last run. */
  job?: { running: boolean; step: 'fetch' | 'measure'; line: string; error?: string };
}

/** The setup assistant's list (`src/server/machine.ts`): what Obeya needs on this machine, by what it is for. */
export type MachineSectionId = 'needed' | 'pr' | 'voice' | 'demos';
/** Claude Code, its login, git and git's name and e-mail for commits. */
export type NeededId = 'claude' | 'claudeLogin' | 'git' | 'gitUser';
/** gh and its login. */
export type PrId = 'gh' | 'ghLogin';

/** A piece of the list, as a setup check gives it, and what Obeya does about it at a click. */
export type MachineItem = Omit<SetupItem, 'id'> & {
  /** `globalKey`: the app's push-to-talk key in another app, while the app runs (src/server/push-key.ts). */
  id: NeededId | PrId | VoiceSetupId | SetupId | 'globalKey';
  /**
   * `install`: Obeya installs it (no admin rights, or Homebrew or winget). `login`: Obeya opens a
   * terminal that logs in. `identity`: the owner gives git's name and e-mail, which Obeya sets.
   */
  act?: 'install' | 'login' | 'identity';
  /** What has to be installed first (uv, which brings the speech recognition). */
  waits?: 'uv';
} & VoiceRecognitionParts;

export interface MachineSection {
  id: MachineSectionId;
  items: MachineItem[];
  /** About this many megabytes still to download for what the section is for (voice, demos). */
  mb: number;
}

/** An installation, a login or a clone Obeya runs for the assistant, one at a time. */
export interface MachineJob {
  kind: 'install' | 'clone';
  section?: MachineSectionId;
  id?: MachineItem['id'];
  running: boolean;
  /** The last line of its output. */
  line: string;
  error?: string;
  /** A clone that became the first canvas: its id, opened once Obeya runs it. */
  canvas?: string;
  /** Its main branch. */
  branch?: string;
  /** Obeya runs it now, or starts again with it by itself; else the owner starts Obeya again. */
  opens?: boolean;
}

export interface MachineView {
  platform: string;
  arch: string;
  sections: MachineSection[];
  /** The Claude Code Obeya was checked with (the Agent SDK's); the machine's may be newer or older. */
  checkedClaude: string;
  job?: MachineJob;
  /** Obeya can open the system's folder dialog here. */
  picker: boolean;
  /** Where a clone goes by default: the owner's home directory. */
  cloneInto: string;
}

/** What choosing the first canvas did: it is saved, and Obeya runs it (`opens`), or the owner starts Obeya again. */
export interface FirstCanvas {
  canvas: string;
  /** The repository's main branch, as Obeya found it. */
  branch: string;
  opens: boolean;
}

/** A folder for the first canvas, looked at before it is saved: whether it holds a repository, and on which main branch. */
export interface SetupFolder {
  repo: boolean;
  branch?: string;
  /** A folder without a repository, in which git can be set up. */
  folder?: boolean;
}

/** From this size on a file is marked as large in the preview of a first commit. */
export const LARGE_FILE = 1_000_000;

/** What the first commit of a folder without git would hold, shown before the owner confirms it. */
export interface GitSetupPreview {
  path: string;
  /** The branch the repository starts on. */
  branch: string;
  /** The `.gitignore` Obeya writes, where the folder has none. */
  gitignore?: string;
  files: number;
  bytes: number;
  /** What goes in, by the folder's own entries: a directory with its files counted. */
  entries: { path: string; dir: boolean; files: number; bytes: number }[];
  /** Files of a size worth a second look, largest first. */
  large: { path: string; bytes: number }[];
  /** What stays out, as git lists it (an ignored directory once). */
  ignored: string[];
}

/**
 * Why Obeya starts again: new code on the checkout it runs from, a configuration the owner saved,
 * a repository's `.obeya/settings.json` changed on its default branch where its agents work, or a
 * new version of the app the owner installs; or why it stops for good (Ctrl-C, SIGTERM).
 */
export type RestartReason = 'code' | 'config' | 'repository' | 'update' | 'stop';

/** A newer version of the app that its shell has downloaded (app/src/update.rs), shown in the bar. */
export interface AppUpdate {
  version: string;
  /** What changed, from the release. */
  notes?: string;
  /** When it was released (ms since the epoch). */
  date?: number;
  /** Where to get it, when the app cannot install it itself (a .deb). */
  download?: string;
}

/** What the owner does in an open page that a restart would cut off: watching a demo video, dictating. */
export type OwnerHold = 'video' | 'voice';

/** A restart that waits for workers to finish their turns, or for the owner, as one canvas sees it. */
export interface PendingRestart {
  reason: RestartReason;
  /** When it was due, and when it goes ahead however busy the workers are (ms since the epoch). */
  since: number;
  deadline: number;
  /** The cards on this canvas whose worker it waits for. */
  cards: string[];
  /** How many workers on other canvases it waits for. */
  elsewhere: number;
  /** What the owner does in some open page that it waits for, past the deadline too. */
  owner: OwnerHold[];
  /** Only the agents of these repositories (by name) restart, for a change to their configuration; Obeya and the others work on. */
  repos?: string[];
  /** The canvas left the configuration: it stops once its agents paused. */
  leaving?: boolean;
}

/** UI → server over the WebSocket. */
export type ClientMessage =
  /** What the owner does in this page that a restart waits for (sent on every change). */
  | { type: 'hold'; hold: OwnerHold[] }
  /** The owner came back to this page (from GitHub, say): what Obeya polls is looked at now. */
  | { type: 'back' }
  /**
   * What the owner has in view (sent on every change and when the page gets the focus back): a
   * command from the app's push-to-talk key in another app goes there. `target` and `title` as the
   * microphone shows them; `place`: the middle of the canvas in view and its bounds (`placeParam`),
   * where a new card goes that a command without a place of its own makes.
   */
  | { type: 'focus'; card?: string; project?: string; target: string; title?: string; place?: string };

/** Server → UI over the WebSocket. */
export type ServerMessage =
  | { type: 'snapshot'; snapshot: CanvasSnapshot }
  | { type: 'event'; event: CardEvent }
  /** A line taken out of the card's log: a comment the owner deleted before it went to the worker. */
  | { type: 'eventGone'; cardId: string; id: number }
  /**
   * First on every connection: which server process this is, so a page from an earlier one
   * reloads; and the version of Bun it runs on when that is too old (`oldLinuxBun`), for the bar.
   */
  | { type: 'hello'; server: string; oldBun?: string }
  /** On connect and whenever it changes: the restart Obeya waits with, if any. */
  | { type: 'restart'; restart: PendingRestart | null }
  /** On connect and whenever it changes: the newer version of the app there is to install, if any. */
  | { type: 'update'; update: AppUpdate | null }
  /** On connect and whenever it changes: how many cards on each canvas need the owner, by canvas id. */
  | { type: 'waiting'; waiting: Record<string, number> }
  /** Whenever a canvas starts, stops, or changes its name or repositories while Obeya runs. */
  | { type: 'canvases'; canvases: CanvasInfo[] }
  /** A line for the owner above the microphone, wherever they are. */
  | ({ type: 'notice' } & Notice);

/**
 * What Obeya tells the owner above the microphone without a command of theirs to answer: an answer
 * the Koordinator looked up, or what it did with a request a card's agent passed on from the
 * owner's words (`to_obeya`), with `token` while those actions wait for "Rückgängig".
 */
export interface Notice {
  /** The card it is about, named when another one is open. */
  cardId?: string;
  text: string;
  token?: string;
  undoMs?: number;
}
