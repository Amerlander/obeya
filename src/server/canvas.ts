// One canvas and everything that works on it: its repositories (each with adapter, workspaces,
// workers, project agents and PR watcher), the board, the Koordinator and the voice commands.

import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { mkdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defaultsFor, hasAdapterModule, readingAdapterModule, readingShared, readShared, repoValues, type SharedRead, withSettings } from '../adapters';
import { Answers, answersDir, answerTag } from './answers';
import { demoFile } from './demo-page';
import { openWithSystem } from './machine';
import { repoName } from '../adapters/generic';
import type { DemoSite, RepoAdapter, RepoInfo } from '../adapters/types';
import type { CardDiff } from '../core/diff';
import type { Language } from '../core/locale';
import { AGENT_DEFAULTS, agentListens, type AgentRole, type AgentSetting, buildableOn, type CanvasConfig, prototypeWorkstream, type CardAction, type CardPatch, type ConfigProblemCode, finished, type Item, layerSettings, nameless, type PendingRestart, plannableAsProject, type RepoConfig, type RepoRef, repoShape, type ProposedSetting, type RepoSettings, type SettingsShared, type SharedSettings, type SpotInput } from '../core/types';
import { BadRequest, Board, replyNote } from './board';
import { type Command, Commander } from './commands';
import type { Config } from './config';
import type { Store } from './db';
import { Explorers } from './explorers';
import { Images, MAX_IMAGES } from './images';
import type { Forge } from './forge';
import { Koordinator } from './koordinator';
import { WorkRetro } from './work-retro';
import { PrWatcher } from './pr-watcher';
import { branchCommit, ReadTree } from './read-tree';
import { Revisions } from './revisions';
import { ProjectAgents } from './project-agents';
import { readPlanDocs, watchPlanDocs } from './repo';
import { boundsOf, GAP, type Place, unionBounds } from '../core/layout';
import { type AgentRuntime, withAgentSetting } from './runtime';
import { changesCode, RESTART_PATIENCE_MS, whenIdle } from './self-update';
import { Sharing, siteIncomplete } from './share';
import { siteMissing, siteName } from './site';
import { type DueRestart, Workers } from './workers';
import { branchSetting, defaultBranch, detectingBranch, gitCalls, type GitSteps, gitStepsSync, type Landed, readingBranches, together, useBranchSetting, Workspaces } from './workspaces';
import { claudeToken, githubToken, hostName, registerHost } from './hosts';
import { messageOf } from '../core/text';

export type { CanvasConfig, RepoConfig };

export interface CanvasDeps {
  store: Store;
  /** Obeya's data directory (workspaces live under it). */
  home: string;
  runtime: AgentRuntime;
  /** Runs the cards' workers; `runtime` when left out. */
  workerRuntime?: AgentRuntime;
  forge: Forge;
  permissionMode?: PermissionMode;
  /** Watch plan docs and pull requests; off in tests. */
  watch?: boolean;
  /** How long a voice command waits for undo. */
  commandDelayMs?: number;
  /** The checkout this Obeya runs from, when it starts again for new code there (self-update.ts). */
  ownCheckout?: string | null;
  /** Obeya's configuration, which the Koordinator reads and changes on the owner's word. */
  config?: Config;
  /** How long the owner stops typing in a card before what they wrote counts as written. */
  writingPauseMs?: number;
  /** Added to every worker's environment (`OBEYA_URL`). */
  workerEnv?: Record<string, string>;
  /** How long a waiting card's app runs on before it is stopped (Parking); five minutes when left out. */
  parkGrace?: number;
  /** The language Obeya speaks to the owner now (`ownerLanguage`); German when left out (the tests). */
  language?: () => Language;
  /** The model and effort of a group of agents (`agentSetting`), asked whenever one starts; the defaults when left out. */
  agents?: (role: AgentRole) => AgentSetting;
  /** How long a restart of a repository's agents waits for them to pause at most; Obeya's patience for a restart when left out. */
  restartPatienceMs?: number;
  /** How often that restart looks whether they paused; every two seconds when left out. */
  restartIntervalMs?: number;
  /**
   * The settings the owner set for a repository on this machine, by its path, read whenever one is
   * used (`Config.repoSettings`); those the canvas started with when left out.
   */
  settings?: (repoPath: string) => RepoSettings | undefined;
}

export interface RepoRuntime {
  ref: RepoRef;
  info: RepoInfo;
  adapter: RepoAdapter;
  /** The demo site of its settings, where its demos are shared; null where they are exported. */
  site: DemoSite | null;
  /** Its Lesestand: the default branch, where plan docs are read and the agents that only read work. */
  read: ReadTree;
  workspaces: Workspaces;
  workers: Workers;
  projectAgents: ProjectAgents;
}

/** A repository as the canvas runs it, with what it was set up by and what stops what it set up. */
interface Repo extends RepoRuntime {
  /** Its entry in the configuration. */
  config: RepoConfig;
  /** Stops its Lesestand and the retries for clones on other machines. */
  stops: (() => void)[];
  /** Stops watching its plan docs. */
  docs?: () => void;
  /** Watches its pull requests, once its work went out as one; it stays for those still open. */
  prs?: PrWatcher;
  /** What the configuration's problems of the repository are read from on its default branch, as last seen (`problemSources`). */
  problemSources?: string;
}

/**
 * A restart of some repositories' agents that waits for them to pause (their configuration
 * changed where they work, or they leave the canvas): the repositories by path, why, since when and
 * until when at most.
 */
interface RepoRestart {
  paths: Set<string>;
  reason: 'config' | 'repository';
  since: number;
  deadline: number;
  /** The cards it waits for, as the page was last told. */
  waiting: string[];
  stop: () => void;
}

/** How long a host that could not be reached at start (or failed to clone) waits before Obeya tries again. */
const HOST_RETRY_MS = 2 * 60_000;

export class CanvasRuntime {
  readonly board: Board;
  readonly koordinator: Koordinator;
  /** The Arbeitsrückschau: friction in the workers' runs, made into proposals. */
  readonly workRetro: WorkRetro;
  readonly commander: Commander;
  readonly explorers: Explorers;
  /** Screenshots the owner attaches to what they write. */
  readonly images: Images;
  readonly answers: Answers;
  readonly revisions: Revisions;
  /** Demos shared with colleagues, on the demo site of the card's repository. */
  readonly sharing: Sharing;
  /** Its repositories, the home one first. */
  readonly repos: Repo[] = [];
  /** Its configuration as it runs now (the home repository first). */
  private config: CanvasConfig;
  /** By repository's path: what takes back where the main branch the owner set is read. */
  private branchSettings = new Map<string, () => void>();
  /** By repository's path: its `.obeya/settings.json` as the Lesestand last had it. */
  private shared = new Map<string, SharedRead>();
  /** By repository's path: whether its main branch had an adapter module as the configuration was last resolved, which a repository starting takes. */
  private adapterModules = new Map<string, boolean>();
  /** The restart of some repositories' agents that waits, if one does. */
  private pending: RepoRestart | null = null;
  /** The restart of all of Obeya that waits, if one does: it covers the repositories' too. */
  private obeyaDue: DueRestart | null = null;
  private pendingListeners = new Set<() => void>();
  /** Set while the canvas leaves the configuration: called once its agents paused and it stopped. */
  private retiring: (() => void) | null = null;
  /** What the owner last said or typed to each card's agent, for the Koordinator to read beside a request the agent passes on. */
  private said = new Map<string, { text: string; spoken: boolean }>();
  /** Cards the owner is writing in, with their text before; a pause in typing hands it to the learner. */
  private writing = new Map<string, { before: string; timer: ReturnType<typeof setTimeout> }>();
  /**
   * The part of the canvas the owner last had in view in a page (its middle and its bounds): a new
   * card that comes without a place of its own (said with the app's key in another app, passed on
   * by an agent) goes there.
   */
  inView: Place | undefined;

  constructor(config: CanvasConfig, private deps: CanvasDeps) {
    const agents = deps.agents ?? ((role: AgentRole) => AGENT_DEFAULTS[role]);
    deps = { ...deps, runtime: withAgentSetting(deps.runtime, agents), ...(deps.workerRuntime ? { workerRuntime: withAgentSetting(deps.workerRuntime, agents) } : {}) };
    this.deps = deps;
    // the main branch the owner set counts from the start: the repository's id, its settings and its Lesestand go by it
    for (const r of config.repos) this.useBranch(r);
    const resolved = this.resolve(config);
    const { id, name, repos, stored } = resolved;
    this.config = resolved.config;
    const images = (this.images = new Images(join(deps.home, 'images', id)));
    this.board = new Board(
      deps.store,
      { id, name, repos: [] },
      () => this.planDocs(),
      images,
      (repo, commit) => !!this.repos.find((r) => r.ref.id === repo)?.read.holds(commit),
      deps.language,
    );
    const board = this.board;
    if (!stored) deps.store.setSetting(id, 'home_repo', repos[0]!.ref.id);

    this.workRetro = new WorkRetro({
      board,
      runtime: deps.runtime,
      pathFor: (repo) => (this.repos.find((r) => r.ref.id === repo) ?? this.repos[0]!).read.path,
      settingsFor: this.settingsNow,
    });
    board.showSettings(this.settingsNow);
    // the Koordinator needs the workers, and the workers ask it: it is set right after them
    repos.forEach((_, i) => this.addRepo(this.startRepo(resolved, i)));
    board.showPools(() =>
      this.repos.filter((r) => r.workspaces.pooled).map((r) => ({ repo: r.ref.id, hosts: r.workspaces.pool(r.workers.inTurn()) })),
    );
    for (const r of this.repos) r.workers.resumeAll();
    const koordinator = (this.koordinator = new Koordinator({
      board,
      runtime: deps.runtime,
      preferences: this.preferences,
      home: () => this.repos[0]!.read.path,
      repoFor: (card) => {
        const r = this.repoOf(card);
        return { workers: r.workers, workspaces: r.workspaces, adapter: r.adapter, path: r.read.path };
      },
      imageFiles: this.imageFiles,
    }));
    koordinator.resume();
    // a card whose page closed before Obeya named it
    for (const i of board.snapshot().items) if (i.state === 'planned' && !i.queue && nameless(i)) void koordinator.name(i.id);
    this.explorers = new Explorers({
      board,
      runtime: deps.runtime,
      preferences: this.preferences,
      pathFor: (card) => this.repoOf(card).read.path,
      onOwnerInput: (card, text) => koordinator.learn(card, 'idea', text),
      imageFiles: this.imageFiles,
      onReplied: (cardId, replied) => this.replied(cardId, replied),
      toObeya: this.toObeya,
      ...(deps.permissionMode ? { permissionMode: deps.permissionMode } : {}),
    });
    this.explorers.resumeAll();
    this.answers = new Answers({
      board,
      runtime: deps.runtime,
      preferences: this.preferences,
      pathFor: (card) => (card ? this.repoOf(card) : this.repos[0]!).read.path,
      startBrief: (card) => this.repoOf(card).workers.startBrief(card),
      projectAgent: (project) => this.repoOf(project).projectAgents,
      ...(deps.permissionMode ? { permissionMode: deps.permissionMode } : {}),
      dirOf: (thread) => answersDir(deps.home, id, thread),
      imageFiles: this.imageFiles,
      toObeya: this.toObeya,
      onAnswer: (talk, question, answer) =>
        this.commander.tell(`The answer ${answerTag(talk)} you looked up for the owner's question „${question}“ came in and was shown to them: ${answer}`),
    });
    this.commander = new Commander({
      board,
      runtime: deps.runtime,
      cwd: this.repos[0]!.read.path,
      execute: (c) => this.run(c),
      imageFiles: this.imageFiles,
      lookUp: (talk) => this.answers.lookUp(talk),
      onOwnerInput: (card, kind, text, reply) => this.koordinator.learn((card && board.item(card)) || null, kind, text, { reply }),
      ...(deps.config ? { config: deps.config } : {}),
      agentSetting: () => agents('koordinator'),
      ...(deps.commandDelayMs !== undefined ? { delayMs: deps.commandDelayMs } : {}),
    });
    board.interruptTalk();
    this.commander.resume();
    this.answers.resumeAll();
    this.revisions = new Revisions({ board, runtime: deps.runtime, preferences: this.preferences, pathFor: (card) => this.repoOf(card).read.path, toObeya: this.toObeya, onRevised: (cardId, revised) => this.revised(cardId, revised) });
    this.revisions.resume();
    this.sharing = new Sharing({
      board,
      runtime: deps.runtime,
      home: deps.home,
      forge: deps.forge,
      sourceFor: (card) => {
        const r = this.repoOf(card);
        return r.site ? { site: r.site, repo: r.info.path } : null;
      },
    });
    this.sharing.resume();
  }

  get id() {
    return this.board.canvas.id;
  }

  private preferences = () => this.board.preferencesText();

  /** What an agent passes on to Obeya (`forward`). */
  private toObeya = (cardId: string, request: string) => this.forward(cardId, request);

  /** The settings of a repository the Arbeitsrückschau may propose a value for, as they apply now. */
  private settingsNow = (repo: string): Record<ProposedSetting, string | string[]> | undefined => {
    const a = this.repos.find((r) => r.ref.id === repo)?.adapter;
    return a && { checks: a.checks ?? [], setup: a.setup ?? '', softPaths: a.softPaths, run: a.app?.run ?? '' };
  };

  private imageFiles = (ids: string[] = []) => ids.flatMap((i) => this.images.path(i) ?? []);

  /** The settings the owner set for a repository on this machine, read whenever they are used. */
  private settingsOf = (r: RepoConfig): (() => RepoSettings | undefined) => (this.deps.settings ? () => this.deps.settings!(resolve(r.path)) : () => r.settings);

  /** The repository's settings for everyone, as its Lesestand last had them (read again whenever it moves, `reread`). */
  private sharedOf = (path: string): (() => SharedSettings | undefined) => {
    if (!this.shared.has(path)) this.shared.set(path, readShared(path));
    return () => this.shared.get(path)!.settings;
  };

  /**
   * What a configuration of this canvas amounts to, with this machine's settings and the
   * repositories' (`resolveCanvas`): those of a repository new here as its read has them.
   */
  private resolve(config: CanvasConfig) {
    return resolveCanvas(config, this.deps.store, this.settingsOf, this.sharedOf, (path) => {
      const read = readRepo(path);
      if (read && !this.shared.has(path)) this.shared.set(path, read.shared);
      if (read) this.adapterModules.set(path, read.adapterModule);
      return read;
    });
  }

  /** Registers where the main branch the owner set for the repository is read, once per path. */
  private useBranch(r: RepoConfig) {
    const path = resolve(r.path);
    if (!this.branchSettings.has(path)) this.branchSettings.set(path, useBranchSetting(path, () => this.settingsOf(r)()?.branch));
  }

  /** The plan docs of all its repositories, each from its Lesestand: the home repository's by their bare path, the others' with the repository's id before it. */
  private planDocs() {
    const home = this.repos[0]?.ref.id;
    const read = this.repos.map((r) => ({ r, ...readPlanDocs(r.read.path, r.adapter) }));
    return {
      docs: read.flatMap(({ r, docs }) => docs.map((d) => (r.ref.id === home ? d : { ...d, file: `${r.ref.id}:${d.file}` }))),
      dirs: read.map(({ r, others }) => ({ repo: r.ref.id, dir: r.adapter.planDocs.dir, others })),
    };
  }

  /**
   * Sets up the repository at `index` of a resolved configuration: its Lesestand, workspaces (clones
   * here and on other machines), project agents and workers. Its workers resume nothing yet.
   */
  private startRepo(resolved: Resolved, index: number): Repo {
    const deps = this.deps;
    const board = this.board;
    const {
      config: rc,
      read: { info },
      adapter,
      ref,
    } = resolved.repos[index]!;
    const isHome = index === 0;
    for (const p of this.shared.get(info.path)?.problems ?? []) console.warn(`Obeya: ${info.path}: ${p} (ignored)`);
    const site = siteOf(adapter);
    // whether the repository shares here, which the UI shows
    Object.assign(ref, shareRef(site, deps.home));
    const stops: (() => void)[] = [];
    // filled in below; what is set up here reaches it once it is
    const repo = { config: rc, stops } as Repo;
    repo.problemSources = this.problemSources(info.path, this.adapterModules.get(info.path));
    // where work lands on the local main, the checkout is the Lesestand; otherwise it is a pool clone on a card's branch
    const read = new ReadTree({
      repoPath: info.path,
      dir: adapter.land === 'main' ? null : join(deps.home, 'read', resolved.id, ref.id),
      remote: !!info.remote,
      onChange: () => {
        board.lesestandMoved(repo.ref.id, read.head());
        if (this.moved(repo) === 'follow') this.follow();
      },
    });
    stops.push(() => read.stop());
    const remoteHosts = info.remote && adapter.workspaces === 'clones' && adapter.land !== 'main' ? (rc.hosts ?? []) : [];
    // the workers set up below say how many are busy where
    let workers!: Workers;
    const workspaces = new Workspaces(deps.store, resolved.id, {
      mode: adapter.workspaces,
      repoPath: info.path,
      dir: isHome ? join(deps.home, 'workspaces', resolved.id) : join(deps.home, 'workspaces', resolved.id, ref.id),
      repo: isHome ? null : ref.id,
      machines: [{ host: null, ...(rc.slots !== undefined ? { slots: rc.slots } : {}) }, ...remoteHosts.map((h) => ({ host: h.name, ...(h.slots !== undefined ? { slots: h.slots } : {}) }))],
      busy: (host) => workers.busyOn(host),
    });
    // a clone registered for this repository must be one of it
    for (const w of rc.workspaces ?? []) workspaces.register(resolve(w), [info.remote, info.path].filter((x): x is string => !!x));
    // landing on main needs clones that see the local main; otherwise they track the remote
    if (rc.clones) workspaces.ensureClones(adapter.land === 'main' || !info.remote ? info.path : info.remote, rc.clones);
    // clones on other machines, made in the background: a host that is off now gets them once it answers
    if (remoteHosts.length) {
      const token = githubToken(info.path, info.remote!);
      let stopped = false;
      stops.push(() => (stopped = true));
      for (const h of remoteHosts) {
        const host = registerHost({ name: h.name, ssh: h.ssh, home: deps.home, claudeToken: () => claudeToken(deps.home) });
        // cards that wait for a clone look again once the host answers after it did not
        stops.push(host.onBack(() => board.changed()));
        // the log tells what goes wrong once, not at every try while the host stays off
        let told: string | null = null;
        const ensure = async () => {
          const wrong = await workspaces.ensureHostClones(host, h.root, info.remote!, h.clones, token);
          if (stopped) return;
          if (!wrong) {
            if (told) console.log(`clones on ${h.name}: in place`);
            return board.changed();
          }
          if (wrong !== told) console.error(`clones on ${h.name}: ${wrong}; trying again every ${HOST_RETRY_MS / 60_000} minutes`);
          told = wrong;
          const retry = setTimeout(ensure, HOST_RETRY_MS);
          stops.push(() => clearTimeout(retry));
        };
        void ensure();
      }
    }
    const projectAgents = new ProjectAgents(board, deps.runtime, () => read.path, this.preferences, deps.permissionMode);
    workers = new Workers({
      board,
      runtime: deps.workerRuntime ?? deps.runtime,
      workspaces,
      adapter,
      machineSettings: this.settingsOf(rc),
      shares: () => !!repo.site,
      repo: ref.id,
      preferences: this.preferences,
      onOwnerInput: (card, kind, text, context) => this.koordinator.learn(card, kind, text, context),
      onPrOpened: (cardId) => {
        // a card whose own branch has its work go out as a pull request, where the repository's does not yet
        this.watchPrs(repo);
        this.sharing.prOpened(cardId);
      },
      onMerged: () => void read.refresh(),
      onPrototype: (prototype, summary, demo) => this.prototypeReady(prototype, summary, demo),
      onPrototypeAnswer: (prototype, question, answer) => this.prototypeAnswered(prototype, question, answer),
      // where work lands on the local main, the Lesestand is the checkout and moves with the landing;
      // a push leaves the checkout as it is: what it changes applies once the Lesestand fetches it
      restartsFor: (l: Landed, pushedFrom?: string) => {
        if (pushedFrom) return false;
        if (deps.ownCheckout && sameDir(deps.ownCheckout, info.path) && changesCode(info.path, l.from, l.to)) return 'obeya';
        const moved = this.moved(repo);
        if (moved === 'follow') this.follow();
        return moved === 'due' ? 'repo' : false;
      },
      imageFiles: this.imageFiles,
      onWorkEnded: (cardId, workspace) => this.workRetro.ended(cardId, workspace),
      toObeya: this.toObeya,
      ...(deps.permissionMode ? { permissionMode: deps.permissionMode } : {}),
      ...(deps.workerEnv ? { env: deps.workerEnv } : {}),
      ...(deps.parkGrace !== undefined ? { parkGrace: deps.parkGrace } : {}),
    });
    return Object.assign(repo, { ref, info, adapter, site, read, workspaces, workers, projectAgents });
  }

  /** Puts a repository set up by `startRepo` on the canvas, last. */
  private addRepo(r: Repo) {
    this.repos.push(r);
    this.board.canvas.repos.push(r.ref);
    this.watch(r);
  }

  /** Stops what the repository set up: its Lesestand, the watchers, its workers' sessions. Its cards stay. */
  private stopRepo(r: Repo) {
    for (const stop of r.stops) stop();
    r.docs?.();
    r.prs?.stop();
    r.workers.shutdown();
  }

  /**
   * Watches the plan docs of the repository in its Lesestand, afresh where they were watched (the
   * directory or the Lesestand moved), and its pull requests once its work goes out as one or a
   * card is in one (its own branch said so); a watcher of pull requests stays, for those still open.
   */
  private watch(r: Repo) {
    if (!this.deps.watch) return;
    r.docs?.();
    r.docs = watchPlanDocs(r.read.path, r.adapter, () => this.board.docsChanged());
    if (r.adapter.land === 'pr' || this.board.snapshot().items.some((i) => i.state === 'inPr' && i.repo === r.ref.id)) this.watchPrs(r);
  }

  /** Watches the repository's pull requests, unless it does already. */
  private watchPrs(r: Repo) {
    if (!this.deps.watch || r.prs) return;
    const board = this.board;
    r.prs = new PrWatcher(board, r.workers, this.deps.forge, (cardId) => localDir(board.row(cardId).workspace) ?? r.info.path, () => r.adapter.prNoise ?? [], r.ref.id, () => void r.read.refresh());
    r.prs.start();
  }

  /**
   * The configuration of the canvas changed while it runs (design: Live configuration). A new name
   * applies at once, and so does a repository new on it. A repository whose agents now work
   * elsewhere (other clones, other machines, another adapter, worktrees instead of clones) or that
   * left the canvas has its agents restarted once they paused, or stopped; the other repositories
   * work on, and their settings apply as they are read.
   */
  apply(next: CanvasConfig) {
    // back in the configuration before it left: it stays, and so do its repositories
    if (this.retiring) {
      this.retiring = null;
      this.cancelPending();
    }
    for (const r of next.repos) this.useBranch(r);
    let resolved: Resolved;
    try {
      resolved = this.resolve(next);
    } catch (e) {
      console.error(`Obeya: the new configuration of the canvas ${this.id} does not resolve; it runs on as it was: ${messageOf(e)}`);
      return;
    }
    this.config = resolved.config;
    if (resolved.name !== this.board.canvas.name) {
      this.board.canvas.name = resolved.name;
      this.deps.store.ensureCanvas(this.id, resolved.name);
      console.log(`Obeya: the canvas ${this.id} is called ${resolved.name} now`);
    }
    const changed = this.repos.filter((r) => {
      const now = resolved.repos.find((x) => x.read.info.path === r.info.path);
      if (!now || repoShape(r.config) !== repoShape(now.config) || r.ref.id !== now.ref.id) return true;
      r.config = now.config;
      return false;
    });
    if (changed.length) this.due(changed.map((r) => r.info.path), 'config');
    // a repository new on the canvas starts at once; one whose restart waits starts with it
    resolved.repos.forEach(({ read: { info } }, i) => {
      if (this.repos.some((r) => r.info.path === info.path) || this.pending?.paths.has(info.path)) return;
      const r = this.startRepo(resolved, i);
      this.addRepo(r);
      console.log(`Obeya: ${info.path} is on the canvas ${this.id} now`);
      if (this.obeyaDue) r.workers.restartDue(this.obeyaDue);
      r.workers.resumeAll(true);
    });
    this.settingsChanged();
  }

  /** The configuration no longer has the canvas: it stops once its agents paused, and then `done`. */
  retire(done: () => void) {
    this.retiring = done;
    this.due(
      this.repos.map((r) => r.info.path),
      'config',
    );
  }

  /**
   * Restarts the agents of the repositories at `paths` once they paused (`restartRepos`), at most
   * after Obeya's patience for a restart; Obeya and the other repositories' agents work on. They
   * hear of it and pause at a safe point, unless a restart of all of Obeya is due already.
   */
  private due(paths: string[], reason: RepoRestart['reason']) {
    if (!paths.length) return;
    let p = this.pending;
    const fresh = !p;
    if (p) for (const path of paths) p.paths.add(path);
    else {
      const since = Date.now();
      const patience = this.deps.restartPatienceMs ?? RESTART_PATIENCE_MS;
      p = this.pending = { paths: new Set(paths), reason, since, deadline: since + patience, waiting: [], stop: () => {} };
    }
    const due = repoDue(p);
    for (const r of this.repos) if (paths.includes(r.info.path) && !this.obeyaDue) r.workers.restartDue(due);
    console.log(`Obeya: ${this.retiring ? `the canvas ${this.id} leaves the configuration; it stops` : `restarting the agents of ${paths.join(', ')}`}${this.pendingBusy().length ? ' once they paused' : ''}`);
    p.waiting = this.pendingBusy();
    this.emitPending();
    if (!fresh) return;
    const pending = p;
    pending.stop = whenIdle(
      () => {
        const now = this.pendingBusy();
        if (this.pending === pending && now.join() !== pending.waiting.join()) {
          pending.waiting = now;
          this.emitPending();
        }
        return now.length > 0;
      },
      () => {
        if (this.pending === pending) this.restartRepos();
      },
      pending.deadline - Date.now(),
      this.deps.restartIntervalMs,
    );
  }

  /** The cards whose worker the restart of repositories' agents waits for. */
  private pendingBusy(): string[] {
    const p = this.pending;
    return p ? this.repos.filter((r) => p.paths.has(r.info.path)).flatMap((r) => r.workers.busyCards()) : [];
  }

  /** The restart of repositories' agents that waits is off (the canvas came back into the configuration): their workers hear so. */
  private cancelPending() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    p.stop();
    for (const r of this.repos) if (p.paths.has(r.info.path)) r.workers.restartDue(this.obeyaDue);
    this.emitPending();
  }

  /**
   * Restarts the agents of the repositories the restart waited for: each one's set-up stops, and
   * starts again as the configuration has it now, its workers resuming where they paused; one that
   * left the canvas stays stopped, its cards kept. A canvas that left the configuration stops.
   */
  private restartRepos() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    p.stop();
    if (this.retiring) {
      const done = this.retiring;
      this.retiring = null;
      this.shutdown();
      console.log(`Obeya: the canvas ${this.id} stopped; its cards are kept`);
      done();
      return;
    }
    let resolved: Resolved;
    try {
      resolved = this.resolve(this.config);
    } catch (e) {
      console.error(`Obeya: the configuration of the canvas ${this.id} does not resolve; its repositories run on as they were: ${messageOf(e)}`);
      for (const r of this.repos) if (p.paths.has(r.info.path)) r.workers.restartDue(this.obeyaDue);
      this.emitPending();
      return;
    }
    const started: Repo[] = [];
    for (const path of p.paths) {
      const at = this.repos.findIndex((r) => r.info.path === path);
      if (at >= 0) this.stopRepo(this.repos[at]!);
      const i = resolved.repos.findIndex((x) => x.read.info.path === path);
      if (i < 0) {
        if (at >= 0) this.repos.splice(at, 1);
        this.branchSettings.get(path)?.();
        this.branchSettings.delete(path);
        console.log(`Obeya: ${path} left the canvas ${this.id}; its cards are kept`);
        continue;
      }
      const r = this.startRepo(resolved, i);
      if (at >= 0) this.repos.splice(at, 1, r);
      else this.repos.push(r);
      started.push(r);
      console.log(`Obeya: restarted the agents of ${path}`);
    }
    this.board.canvas.repos.splice(0, this.board.canvas.repos.length, ...this.repos.map((r) => r.ref));
    for (const r of started) {
      this.watch(r);
      if (this.obeyaDue) r.workers.restartDue(this.obeyaDue);
      r.workers.resumeAll(true);
    }
    this.board.docsChanged();
    this.emitPending();
  }

  /** Restarts the repositories' agents the restart waits for at once, cutting off those still in a turn; false when none waits. */
  restartNow(): boolean {
    if (!this.pending) return false;
    this.restartRepos();
    return true;
  }

  /** The restart of repositories' agents that waits, as the page shows it; null when none does. */
  pendingRestart(): PendingRestart | null {
    const p = this.pending;
    if (!p) return null;
    return {
      reason: p.reason,
      since: p.since,
      deadline: p.deadline,
      cards: p.waiting,
      elsewhere: 0,
      owner: [],
      repos: this.repos.filter((r) => p.paths.has(r.info.path)).map((r) => r.ref.name),
      ...(this.retiring ? { leaving: true } : {}),
    };
  }

  /** Calls `fn` whenever the restart of repositories' agents begins to wait, waits for others, or happened. */
  onPending(fn: () => void): () => void {
    this.pendingListeners.add(fn);
    return () => this.pendingListeners.delete(fn);
  }

  private emitPending() {
    for (const fn of this.pendingListeners) fn();
  }

  /**
   * The owner saved settings of the repositories (`RepoSettings`), or committed them for everyone
   * (`.obeya/settings.json`): they are read where they are used; what the canvas set up
   * by them follows (`follow`), and a repository whose agents now work elsewhere restarts them.
   */
  settingsChanged() {
    for (const r of [...this.repos]) this.moved(r);
    this.follow();
  }

  /**
   * The Lesestand of the repository moved, or its settings were saved: reads its
   * `.obeya/settings.json` again from the default branch; the settings apply where they are read.
   * Where the repository's agents now work elsewhere (clones or worktrees, set up when they start),
   * they restart once they paused (`due`); where demos are shared may have changed, and so may the
   * configuration's problems of the repository (`configRev`). Says which of these it came to:
   * `follow` where the canvas follows what changed.
   */
  private moved(r: Repo): 'same' | 'follow' | 'due' {
    if (!this.repos.includes(r)) return 'same';
    const path = r.info.path;
    if (this.pending?.paths.has(path)) return 'due';
    const shared = this.reread(r);
    const sources = this.problemSources(path);
    const problems = sources !== r.problemSources;
    if (problems) {
      // the page reads the configuration's problems again
      r.problemSources = sources;
      r.ref.configRev = (r.ref.configRev ?? 0) + 1;
    }
    const workIn = namesClones(r.config) ? 'clones' : (layerSettings<RepoSettings>(this.sharedOf(path)(), this.settingsOf(r.config)())?.workspaces ?? defaultsFor(r.info).workspaces);
    if (workIn !== r.workspaces.mode) {
      this.due([path], shared ? 'repository' : 'config');
      return 'due';
    }
    const site = siteOf(r.adapter);
    if (JSON.stringify(site) !== JSON.stringify(r.site)) {
      r.site = site;
      setShare(r.ref, shareRef(site, this.deps.home));
      return 'follow';
    }
    return shared || problems ? 'follow' : 'same';
  }

  /**
   * What the configuration's problems of the repository are read from on its default branch: its
   * `.obeya/settings.json` as the file has it (a field that does not count included), and whether a
   * leftover `.obeya/adapter/` is there (`adapterModule`, where it was just read).
   */
  private problemSources(path: string, adapterModule = hasAdapterModule(path)): string {
    const read = this.shared.get(path);
    return JSON.stringify([read?.raw, read?.problems, adapterModule]);
  }

  /**
   * Reads the repository's `.obeya/settings.json` again from its default branch. Where it changed,
   * this machine's values that it now holds as well go (they were taken over for everyone, see
   * `Config.takenOver`). Says whether it changed.
   */
  private reread(r: Repo): boolean {
    const path = r.info.path;
    const before = this.shared.get(path);
    const now = readShared(path);
    if (JSON.stringify(now.settings) === JSON.stringify(before?.settings)) {
      // a field that does not count changed alone: the problems change, the settings do not
      this.shared.set(path, now);
      return false;
    }
    this.shared.set(path, now);
    for (const p of now.problems) console.warn(`Obeya: ${path}: ${p} (ignored)`);
    this.deps.config?.takenOver(path, before?.settings, now.settings);
    return true;
  }

  /**
   * What the canvas set up by the repositories' settings follows them: the Lesestand where work
   * now lands elsewhere, the watched plan directory, the pull requests, what the page shows of
   * each repository.
   */
  private follow() {
    for (const r of this.repos) {
      r.info.branch = defaultBranch(r.info.path);
      for (const k of ['clones', 'pullRequests', 'direct'] as const) delete r.ref[k];
      Object.assign(r.ref, settled(r.info, r.adapter));
      // where work lands on the local main, the checkout is the Lesestand; otherwise a worktree on the default branch
      r.read.retarget(r.adapter.land === 'main' ? null : join(this.deps.home, 'read', this.id, r.ref.id));
      this.watch(r);
    }
    this.board.docsChanged();
  }

  /** The repository a card belongs to. */
  repoOf(card: Item | string): RepoRuntime {
    const item = typeof card === 'string' ? this.board.item(card) : card;
    if (!item) throw new BadRequest('unknownCard', 'unknown card');
    return this.repos.find((r) => r.ref.id === item.repo) ?? this.repos[0]!;
  }

  /** What the card's work changes (`Workers.diff`), for an archived card too. */
  diff(cardId: string, full: boolean): Promise<CardDiff | null> {
    return this.repoOf(this.board.card(cardId) ?? cardId).workers.diff(cardId, full);
  }

  /** Whether the app in the card's workspace answers, for the owner to try it by hand (`Workers.appUp`). */
  async appUp(cardId: string): Promise<{ up: boolean }> {
    return { up: await this.repoOf(cardId).workers.appUp(cardId) };
  }

  /** The address of the card's app as the owner opens it, which keeps it running a while (`Workers.openApp`); none once it no longer runs. */
  openApp(cardId: string): Promise<string | null> {
    return this.repoOf(cardId).workers.openApp(cardId);
  }

  /** The owner edits a card; what they write in it is offered for learning once they have written it. */
  patch(cardId: string, p: CardPatch) {
    const { body: before, state } = this.board.row(cardId);
    this.board.patch(cardId, p);
    if (p.body !== undefined) {
      const w = this.writing.get(cardId);
      clearTimeout(w?.timer);
      this.writing.set(cardId, { before: w?.before ?? before ?? '', timer: setTimeout(() => this.written(cardId), this.deps.writingPauseMs ?? 60_000) });
    }
    // an idea's agent starts from the card's text, and opens the discussion with it
    if (p.state === 'idea' && state !== 'idea') {
      this.written(cardId);
      void this.koordinator.name(cardId);
      this.explorers.open(cardId);
    }
  }

  /** The owner has written in the card (a pause, or they act on it): the learner gets what they wrote. */
  private written(cardId: string) {
    const w = this.writing.get(cardId);
    if (!w) return;
    clearTimeout(w.timer);
    this.writing.delete(cardId);
    const card = this.board.item(cardId);
    const [text, before] = [card?.body.trim() ?? '', w.before.trim()];
    if (card && text && text !== before) this.koordinator.learn(card, 'card', text, before ? { before } : {});
  }

  /** The owner accepts a rule proposal, maybe in their words or for another place (a repository's CLAUDE.md, or none). */
  acceptRule(id: number, text?: string, target?: string | null) {
    this.board.acceptProposal(id, text, target);
    this.fileRules();
  }

  /**
   * A rule the owner gives outright, by „Merk dir: …“ or in the sheet: one of theirs, active at once,
   * or with `repos` one for those repositories' CLAUDE.md, which goes straight into their cards
   * „CLAUDE.md ergänzen“. `replaces`: the active rule it changes; `card`: the card open when it was said.
   */
  remember(text: string, o: { repos?: string[]; replaces?: number; card?: string } = {}) {
    // the rule it changes may have been deleted in the meantime: then it is a new one
    const replaces = o.replaces !== undefined && this.board.preferences('active').some((p) => p.id === o.replaces) ? o.replaces : undefined;
    if (o.repos?.length) {
      this.board.fileRule(text, o.repos, o.card ?? null, replaces);
      this.fileRules();
    } else if (replaces !== undefined) this.board.setPreference(replaces, text);
    else this.board.addPreference(text, o.card ?? null);
  }

  rejectRule(id: number) {
    this.board.rejectProposal(id);
    this.fileRules();
  }

  /**
   * The owner takes a setting the Arbeitsrückschau proposed, as it is or with their `value`: on
   * this machine, or into the repository's `.obeya/settings.json` for everyone (`Config.takeSetting`).
   */
  async takeSetting(id: number, where: unknown, value?: unknown): Promise<SettingsShared | null> {
    if (where !== 'machine' && where !== 'repository') throw new BadRequest('invalid', 'where is machine or repository');
    const p = this.board.settingProposal(id);
    const v = value === undefined ? p.value : typeof p.value === 'string' ? (typeof value === 'string' && value.trim() ? value.trim() : null) : Array.isArray(value) ? value.map(String).map((x) => x.trim()).filter(Boolean) : null;
    if (v === null || (Array.isArray(v) && !v.length)) throw new BadRequest('invalid', 'the value is missing');
    const r = this.repos.find((x) => x.ref.id === p.repo);
    if (!r || !this.deps.config) throw new BadRequest('invalid', 'no configuration to set it in');
    const done = await this.deps.config.takeSetting(resolve(r.config.path), p.field, v, where);
    this.board.decideSetting(id, where, v);
    const m = this.board.t.retro;
    const name = m.settings[p.field];
    this.board.notify({ text: !done ? m.onMachine(name, r.ref.name) : 'pr' in done ? m.opened(name, r.ref.name, done.pr) : m.committed(name, r.ref.name, done.branch) });
    return done;
  }

  rejectSetting(id: number) {
    this.board.decideSetting(id, 'rejected');
  }

  /**
   * Once no proposal waits any more, the cards „CLAUDE.md ergänzen“ start, with all the rules
   * accepted for them: a waiting proposal might yet become one of theirs.
   */
  private fileRules() {
    if (this.board.preferences('proposed').length) return;
    for (const r of this.board.canvas.repos) {
      const card = this.board.collecting(r.id);
      if (card) this.koordinator.request(card.id);
    }
  }

  /**
   * What the owner says or types with a card open that an agent listens on (`agentListens`) goes
   * straight to that agent, by the card's state: talk to an idea, words a proposal is reworked by,
   * the answer to its worker's question, or else words the worker takes in (a note while it works,
   * words on its handover, a question once its work is done). The agent passes on what asks Obeya for something (`to_obeya`).
   * `replyTo`: the message of the card's conversation the words reply to; `spot`: the place in the
   * card's demo video they are about.
   */
  tell(cardId: string, text: string, images: string[], spoken: boolean, replyTo?: number, spot?: SpotInput) {
    const card = this.board.item(cardId);
    if (!card) throw new BadRequest('unknownCard', 'unknown card');
    if (!agentListens(card)) throw new BadRequest('noAgent', 'no agent works on this card');
    const said = { text, spoken, ...(images.length ? { images } : {}), ...(replyTo ? { replyTo } : {}) };
    // the agent passes a request on in its words; the Koordinator reads the owner's own beside them
    this.said.set(cardId, { text, spoken });
    if (card.kind === 'question') return this.act(cardId, { action: 'ask', ...said });
    if (card.state === 'idea') return this.act(cardId, { action: 'discuss', ...said });
    if (card.state === 'proposal') {
      // a proposal's field takes no screenshots: the words alone
      this.koordinator.learn(card, 'note', text.trim());
      return this.act(cardId, { action: 'revise', text, spoken, ...(replyTo ? { replyTo } : {}) }, true);
    }
    if (card.state === 'waiting' && card.need === 'question') return this.act(cardId, { action: 'answer', ...said });
    return this.act(cardId, { action: 'message', ...said, ...(spot ? { spot } : {}) });
  }

  /**
   * A request a card's agent passes on from the owner's words (`to_obeya`): the Koordinator reads it
   * with those words and the card in focus, as a command, and its confirmation (or reply, or that it
   * looks the question up) is the agent's answer. Actions wait for "Rückgängig" as usual; the owner
   * sees the confirmation above the microphone and in the card's conversation.
   */
  async forward(cardId: string, request: string): Promise<string> {
    // the owner's words go beside the request, also those before a restart; an agent that passes on
    // what nobody said (words in a file it read, say) has nothing to pass on
    const before = this.said.has(cardId) ? undefined : this.board.events(cardId).findLast((e) => e.author === 'owner' && e.kind !== 'state' && e.text.trim());
    const said = this.said.get(cardId) ?? (before && { text: before.text, spoken: false });
    if (!said) return "Nothing passed on: the owner has said nothing on your card. to_obeya passes on the owner's own words.";
    const h = await this.commander.forward(cardId, request, said);
    if (h.token) this.commander.arm(h.token);
    this.board.notify({ cardId, text: h.confirm, ...(h.token ? { token: h.token, undoMs: this.commander.delayMs } : {}) });
    return h.confirm;
  }

  /** The owner clicks in the card's panel: a click without words the learner reads counts towards the Rückschau. */
  press(cardId: string, a: CardAction) {
    // the options picked on a proposal go to its reviser without the Koordinator, which would have logged them
    const r = this.act(cardId, a, true);
    // the end of watching a demo is no click of the owner's
    if (a.action !== 'release' && a.action !== 'unsay' && a.action !== 'name' && !(['message', 'answer', 'discuss'].includes(a.action) && 'text' in a && a.text?.trim())) this.koordinator.noticed();
    return r;
  }

  /** A place in the demo video as the browser sent it: a frame Obeya does not have is left out. */
  private spot(spot: unknown): SpotInput | undefined {
    if (!spot || typeof spot !== 'object') return;
    const { at, still } = spot as Record<string, unknown>;
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) throw new BadRequest('invalid', 'spot.at must be a time in the video, in seconds');
    return { at, ...(typeof still === 'string' && this.images.path(still) ? { still } : {}) };
  }

  /**
   * An owner action from the card's panel, or from a spoken command. `log`: words to a proposal's
   * reviser go into its conversation (a spoken command's stand there already).
   */
  act(cardId: string, a: CardAction, log = false) {
    this.written(cardId);
    const text = 'text' in a ? (a.text ?? '') : '';
    const images = this.images.resolve('images' in a ? a.images : undefined);
    // a reply to anything but a message of this card's conversation is the words alone
    const replyTo = 'replyTo' in a ? this.board.quoted(cardId, a.replyTo)?.id : undefined;
    // a prototype may leave it to the idea's brief what it shows; a screenshot or an option picked may speak for itself
    const picks = a.action === 'answer' && Array.isArray(a.picks) ? a.picks.filter((o): o is string => typeof o === 'string') : [];
    if ('text' in a && (typeof text !== 'string' || (!text.trim() && a.action !== 'prototype' && !images.length && !picks.length) || text.length > 20000))
      throw new BadRequest('emptyText', 'text must be a non-empty string');
    switch (a.action) {
      case 'start':
        return this.koordinator.request(cardId);
      case 'name':
        return void this.koordinator.name(cardId);
      case 'force':
        return this.koordinator.force(cardId);
      case 'dequeue':
        return this.koordinator.dequeue(cardId);
      case 'reorder':
        return this.koordinator.reorder(cardId, !!a.earlier);
      case 'stop':
        return this.repoOf(cardId).workers.stop(cardId);
      case 'pause':
      case 'resume': {
        // whichever agent works on the card: a Question card's, an idea's, or its worker
        const card = this.board.item(cardId);
        const agent = card?.kind === 'question' ? this.answers : card?.state === 'idea' ? this.explorers : this.repoOf(cardId).workers;
        return a.action === 'pause' ? agent.pause(cardId) : agent.resume(cardId);
      }
      case 'message':
        // a note to a Question card is a question to its agent
        if (this.board.item(cardId)?.kind === 'question') return this.answers.ask(cardId, text.trim(), images, !!a.spoken, replyTo);
        return this.repoOf(cardId).workers.message(cardId, text.trim(), images, !!a.spoken, replyTo, this.spot(a.spot));
      case 'release':
        return this.repoOf(cardId).workers.released(cardId, !!a.now);
      case 'unsay': {
        // words the card's agent has not read yet, whichever agent it is
        const card = this.board.item(cardId);
        if (card?.kind === 'question') return this.answers.unsay(cardId, a.id);
        if (card?.state === 'idea') return this.explorers.unsay(cardId, a.id);
        if (card?.state === 'proposal') return this.revisions.unsay(cardId, a.id);
        return this.repoOf(cardId).workers.unsay(cardId, a.id);
      }
      case 'answer':
        return this.repoOf(cardId).workers.answer(cardId, text.trim(), images, !!a.spoken, replyTo, picks);
      case 'approve':
        return this.repoOf(cardId).workers.approve(cardId, { direct: !!a.direct });
      case 'accept':
        return this.accept(cardId, a.picks, a.start !== false);
      case 'unaccept':
        return this.unaccept(cardId);
      case 'dismiss':
        if (this.board.row(cardId).state !== 'proposal') throw new BadRequest('notProposal', 'not a proposal');
        return this.board.remove(cardId);
      case 'revise': {
        // said while it is reworked, they wait for the next rework, unread until then
        const later = !!this.board.item(cardId)?.proposal?.revising;
        const said = log ? this.board.log(cardId, 'say', 'owner', text.trim(), { replyTo, unread: later }).id : undefined;
        return this.revisions.revise(cardId, `${replyNote(this.board.quoted(cardId, replyTo), 'koordinator')}${text.trim()}`, !!a.spoken, said);
      }
      case 'discuss':
        return this.explorers.discuss(cardId, text.trim(), !!a.spoken, images, replyTo);
      case 'build':
        return this.build(cardId);
      case 'unbuild':
        return this.unbuild(cardId);
      case 'planDoc':
        return this.planDoc(cardId);
      case 'park':
      case 'drop':
        return this.shelve(cardId, a.action);
      case 'prototype':
        if (a.variants !== undefined && (!Array.isArray(a.variants) || a.variants.length > 20 || a.variants.some((v) => typeof v !== 'string')))
          throw new BadRequest('invalid', 'variants must be a list of the planned approaches');
        return this.prototype(cardId, text.trim(), a.variants);
      case 'buildPrototype':
        return this.buildOnPrototype(cardId, a.workstream);
      case 'discard':
        return this.repoOf(this.prototypeCard(cardId)).workers.endPrototype(cardId, 'discarded');
      case 'ask':
        return this.answers.ask(cardId, text.trim(), images, !!a.spoken, replyTo);
      case 'asIdea':
        return this.questionAsIdea(cardId);
      case 'share':
        return this.sharing.share(cardId);
      case 'unshare':
        return this.sharing.unshare(cardId);
      default:
        throw new BadRequest('invalid', 'unknown action');
    }
  }

  /** The output directory of a looked-up thread of this canvas. */
  answerDir(thread: number): string {
    if (!Number.isInteger(thread) || !this.board.threadTalk(thread).length) throw new BadRequest('invalid', 'unknown thread');
    return answersDir(this.deps.home, this.id, thread);
  }

  /** "Im Ordner zeigen", or a click on an answer's file: opened with the system's app on this machine. */
  async openAnswerFile(thread: number, file?: string) {
    const dir = this.answerDir(thread);
    mkdirSync(dir, { recursive: true });
    // a file by its real path: a link out of the directory is no file of the answer's
    const path = file === undefined ? dir : demoFile(dir, String(file));
    if (!path) throw new BadRequest('noFile', 'no such file in the answer’s directory');
    if (!(await openWithSystem(path, path !== dir))) throw new BadRequest('invalid', 'the system has no app to open it with');
  }

  /**
   * "Als Idee besprechen" on a Question card: it becomes an idea, whose exploration agent starts from
   * the thread (questions, answers, the files in its output directory) instead of the look-up's session.
   */
  private questionAsIdea(cardId: string) {
    const card = this.board.item(cardId);
    if (card?.kind !== 'question') throw new BadRequest('notQuestion', 'the card is no Question card');
    if (card.thread?.thinking) throw new BadRequest('ideaThinking', 'its agent is still reading; discuss it as an idea once the answer is there');
    // a paused agent's question goes into the discussion with the rest of the thread
    this.board.work(cardId, { kind: 'task', state: 'idea', idea: JSON.stringify({ status: 'open', brief: '' }), session_id: null, paused: null });
    this.board.log(cardId, 'state', 'owner', this.board.t.answer.asIdea);
    this.explorers.tell(cardId, this.answers.opening(cardId));
  }

  /** Deletes a card of the owner's, stopping its worker first; a prototype is discarded into the archive instead. */
  remove(cardId: string) {
    clearTimeout(this.writing.get(cardId)?.timer);
    this.writing.delete(cardId);
    const { state, landed, workspace, prototype_of } = this.board.row(cardId);
    if (prototype_of) return this.repoOf(cardId).workers.endPrototype(cardId, 'discarded');
    if (state === 'working' || state === 'waiting' || (landed && workspace)) this.repoOf(cardId).workers.stop(cardId);
    if (state === 'idea') this.explorers.close(cardId);
    // work thrown away ended too (finished work counted when it landed)
    else if (!state || !finished(state)) this.workRetro.ended(cardId, workspace);
    this.board.remove(cardId);
  }

  /**
   * The card whose worker fills in a repository's settings for everyone (`.obeya/settings.json`)
   * with the `settings` skill, for one that has none yet or still has an adapter module; one still
   * open for it is returned rather than a second made. It goes right of everything on the canvas,
   * at the top.
   */
  adapterSetupCard(repo: string): Item {
    const r = this.repos.find((x) => x.ref.id === repo);
    if (!r) throw new BadRequest('invalid', 'unknown repository');
    const { title, body } = this.board.t.adapterSetup;
    const items = this.board.snapshot().items;
    const open = items.find((i) => i.kind === 'task' && i.repo === repo && i.title === title(r.ref.name) && !finished(i.state) && !i.archivedAt);
    if (open) return open;
    const at = items.length ? { x: Math.max(...items.map((i) => i.x)) + 560, y: Math.min(...items.map((i) => i.y)) } : { x: 0, y: 0 };
    return this.board.create({ title: title(r.ref.name), body, repo, ...at });
  }

  /**
   * A doc in the plan directory that is not a project: a card whose worker adds the workstream
   * checklist, started at once; once its change lands, the doc is a project. It goes right of
   * everything on the canvas, at the top, clear of the note on the plan directory at the left.
   */
  preparePlanDoc(repo: string, file: string): Item {
    const dir = this.board.snapshot().planDirs?.find((d) => d.repo === repo);
    const doc = dir?.others.find((o) => o.file === file);
    if (!doc) throw new BadRequest('invalid', 'not a doc in the plan directory that is not a project');
    if (doc.preparing) return this.board.card(doc.preparing)!;
    const { title, body } = this.board.t.preparePlanDoc;
    const items = this.board.snapshot().items;
    const box = unionBounds(items.filter((i) => !i.parent).map((i) => boundsOf(i, items)));
    const card = this.board.create({ title: title(file), body: body(file), repo, ...(box ? { x: box.x + box.w + 2 * GAP, y: box.y } : { x: 0, y: 0 }) });
    this.koordinator.request(card.id);
    return this.board.card(card.id)!;
  }

  // ---------------------------------------------------------------- proposals

  /**
   * Accepting a proposal is the owner's go unless they keep it to edit first (`start` false): the
   * card goes to the Koordinator like a started one, a proposed idea to its exploration agent.
   * Clicked while the proposal is reworked, it is accepted once the new text is there, unless that
   * asks questions.
   */
  private accept(cardId: string, picks: string[][] | undefined, start: boolean) {
    const proposal = this.board.item(cardId)?.proposal;
    if (start && proposal?.revising) {
      // the owner knows what comes; the new text still may ask what must be settled first
      if (this.board.acceptAfterRevision(cardId, true))
        this.board.log(cardId, 'state', 'owner', this.board.t.proposal.acceptAfterRevision(!!proposal.idea));
      return;
    }
    if (this.board.accept(cardId, picks, start)) this.explorers.open(cardId, true);
    else if (start) this.koordinator.request(cardId);
  }

  /** Accepting after the revision is taken back: the proposal stays one. */
  private unaccept(cardId: string) {
    if (this.board.acceptAfterRevision(cardId, false)) this.board.log(cardId, 'state', 'owner', this.board.t.proposal.notAccepting);
  }

  /** The revision is over (`revised`, or the agent ended without a text): a proposal accepted meanwhile is accepted now, unless it asks questions. */
  private revised(cardId: string, revised: boolean) {
    const card = this.board.item(cardId);
    // words the owner said meanwhile are reworked in first
    if (card?.state !== 'proposal' || !card.proposal?.acceptAfterRevision || card.proposal.revising) return;
    this.board.acceptAfterRevision(cardId, false);
    const asks = card.proposal.questions.length;
    if (revised && !asks) return this.accept(cardId, [], true);
    const t = this.board.t.proposal;
    this.board.log(cardId, 'state', 'obeya', !revised ? t.notAcceptedNoRevision : asks > 1 ? t.notAcceptedQuestions : t.notAcceptedQuestion);
  }

  // ---------------------------------------------------------------- ideas

  /**
   * The idea is built as it stands: its brief becomes the card's task, and the card goes to the
   * Koordinator to start. A prototype still running for it is discarded: what is built now is the brief.
   */
  private build(cardId: string) {
    const card = this.ideaCard(cardId);
    if (card.idea?.thinking) {
      // the owner knows what comes; the reply still may ask what must be settled first
      if (card.idea.buildAfterReply) return;
      this.board.setIdea(cardId, { buildAfterReply: true });
      this.board.log(cardId, 'state', 'owner', this.board.t.idea.buildAfterReply);
      return;
    }
    this.decided(card, { answer: this.board.t.idea.buildAnswer, log: this.board.t.idea.buildLog });
    this.koordinator.request(cardId);
  }

  /** Building after the reply is taken back: the idea stays in its discussion. */
  private unbuild(cardId: string) {
    if (!this.ideaCard(cardId).idea?.buildAfterReply) return;
    this.board.setIdea(cardId, { buildAfterReply: false });
    this.board.log(cardId, 'state', 'owner', this.board.t.idea.unbuild);
  }

  /**
   * The idea's agent has answered all it was told (`replied`), or its turn ended without (an error,
   * a restart): an idea to build after the reply is built now, unless the reply asks questions.
   */
  private replied(cardId: string, replied: boolean) {
    const card = this.board.item(cardId);
    if (card?.state !== 'idea' || !card.idea?.buildAfterReply) return;
    this.board.setIdea(cardId, { buildAfterReply: false });
    const asks = card.idea.questions.length;
    if (replied && !asks && card.idea.status === 'open') return this.build(cardId);
    const t = this.board.t.idea;
    this.board.log(cardId, 'state', 'obeya', !replied ? t.notBuiltNoReply : asks > 1 ? t.notBuiltQuestions : t.notBuiltQuestion);
  }

  /**
   * The idea is built on this prototype: the prototype's workspace and branch become the idea's,
   * whose worker goes on from there with the brief, the prototype's handover and the owner's answers
   * on it. The prototype goes into the archive as built, the idea's other prototypes as discarded.
   */
  private buildOnPrototype(prototypeId: string, workstreamId?: string) {
    const prototype = this.prototypeCard(prototypeId);
    const project = this.board.projectOf(prototype.prototypeOf!);
    if (project) return this.buildWorkstreamOn(prototype, project, workstreamId);
    const planning = this.board.item(prototype.prototypeOf!);
    if (planning?.becomesProject) throw new BadRequest('projectPending', 'the idea becomes a project; build on the prototype once its plan doc has landed');
    if (!planning) throw new BadRequest('ideaGone', 'the prototype’s idea is no longer on the canvas, and no project of it is');
    const idea = this.settledIdea(prototype.prototypeOf!);
    const { workers } = this.repoOf(prototype);
    const { path, branch } = workers.buildOn(prototype.id, idea);
    this.board.work(idea.id, { workspace: path, branch, built_on: prototype.id });
    this.decided(idea, { answer: this.board.t.idea.buildOnAnswer(prototype.title), log: this.board.t.idea.buildOnLog(prototype.title) });
    this.koordinator.request(idea.id);
  }

  /**
   * The idea has become a project: the workstream the owner chose, or else the one its plan doc
   * builds on the prototypes with, is built on the prototype's branch and starts at once; the
   * idea's other prototypes are discarded.
   */
  private buildWorkstreamOn(prototype: Item, project: Item, workstreamId?: string) {
    const ws = workstreamId ? this.board.item(workstreamId) : prototypeWorkstream(this.board.snapshot().items, project.id);
    if (!ws && !workstreamId) throw new BadRequest('workstreamMissing', 'the plan doc does not say which workstream builds on the prototype: choose it');
    if (!ws || ws.parent !== project.id) throw new BadRequest('invalid', 'not a workstream of the project the idea became');
    if (!buildableOn(ws)) throw new BadRequest('workstreamStarted', 'only a workstream nobody has started can be built on a prototype');
    const named = `${ws.label ? `${ws.label} ` : ''}${this.board.t.quote(ws.title)}`;
    const { path, branch } = this.repoOf(prototype).workers.buildOn(prototype.id, ws, named);
    this.board.work(ws.id, { workspace: path, branch, built_on: prototype.id });
    this.discardPrototypes(prototype.prototypeOf!);
    const t = this.board.t.idea;
    this.board.decide({ project_id: project.id, card_id: ws.id, question: t.whichPrototype(named), answer: t.onPrototype(prototype.title), by: 'owner' });
    this.board.log(ws.id, 'state', 'owner', t.workstreamOnLog(prototype.title));
    this.koordinator.request(ws.id);
  }

  /** The idea's prototypes still on the canvas go into the archive as discarded. */
  private discardPrototypes(ideaId: string) {
    for (const p of this.board.snapshot().items.filter((i) => i.prototypeOf === ideaId)) this.repoOf(p).workers.endPrototype(p.id, 'discarded', 'obeya');
  }

  /** The idea is decided for building: its agent's conversation ends, the brief becomes the task, the other prototypes are discarded. */
  private decided(idea: Item, how: { answer: string; log: string }) {
    const { brief } = this.board.idea(idea.id);
    this.explorers.close(idea.id);
    this.discardPrototypes(idea.id);
    this.board.work(idea.id, { state: 'planned', ...(brief.trim() ? { body: brief.trim() } : {}) });
    // the screenshots the owner showed in the discussion belong to what is built
    const shown = this.board.events(idea.id).flatMap((e) => (e.kind === 'talk' && e.author === 'owner' ? (e.images ?? []) : []));
    if (shown.length) this.addTaskImages(idea.id, shown);
    this.board.decide({ project_id: null, card_id: idea.id, question: this.board.t.idea.howOn(idea.title), answer: how.answer, by: 'owner' });
    this.board.log(idea.id, 'state', 'owner', how.log);
  }

  /**
   * A big idea becomes a project: a worker writes its plan doc on the idea's card at once, and once
   * the doc lands, the project takes the idea's place. Its prototypes stay: the worker hears what
   * they showed, and the owner builds a workstream on one of them once the project stands.
   */
  private planDoc(cardId: string) {
    const task = this.board.item(cardId);
    if (task && task.state !== 'idea') return this.planTaskDoc(task);
    const card = this.settledIdea(cardId);
    const idea = this.board.idea(cardId);
    const dir = this.repoOf(card).adapter.planDocs.dir;
    const prototypes = this.board.snapshot().items.filter((i) => i.prototypeOf === cardId);
    const t = this.board.t.idea;
    this.explorers.close(cardId);
    this.board.work(cardId, {
      state: 'planned',
      becomes_project: 1,
      body: [
        t.planDocTask(dir),
        t.planDocIdea(card.title),
        idea.brief.trim() || card.body.trim(),
        prototypes.length
          ? [
              t.planDocPrototypes(prototypes.length),
              ...prototypes.map((p) => {
                const summary = this.board.summary(p.id)?.trim();
                return summary ? t.planDocHandedOver(p.title, summary) : t.planDocInProgress(p.title);
              }),
            ].join('\n\n')
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    });
    this.board.decide({ project_id: null, card_id: cardId, question: t.howOn(card.title), answer: t.planDocAnswer, by: 'owner' });
    this.board.log(cardId, 'state', 'owner', t.planDocLog);
    this.koordinator.request(cardId);
  }

  /**
   * A planned task of the owner's that nobody has worked on becomes a project the same way: its
   * worker writes the plan doc from the task, with its screenshots, on the task's card.
   */
  private planTaskDoc(card: Item) {
    if (!plannableAsProject(card))
      throw new BadRequest('notPlannable', 'only an idea, or a planned task of your own nobody has worked on yet, can be planned as a project');
    const t = this.board.t.idea;
    const dir = this.repoOf(card).adapter.planDocs.dir;
    this.board.work(card.id, { becomes_project: 1, body: [t.planDocTask(dir, true), t.planDocCard(card.title), card.body.trim()].filter(Boolean).join('\n\n') });
    this.board.decide({ project_id: null, card_id: card.id, question: t.howOnTask(card.title), answer: t.planDocAnswer, by: 'owner' });
    this.board.log(card.id, 'state', 'owner', t.planDocTaskLog);
    this.koordinator.request(card.id);
  }

  /** Parked or dropped, the idea stays on the canvas with its brief; what its agent has not answered yet waits for the conversation to go on. */
  private shelve(cardId: string, how: 'park' | 'drop') {
    const card = this.ideaCard(cardId);
    this.explorers.interrupt(cardId, how === 'park' ? 'parked' : 'dropped');
    this.board.setIdea(cardId, { status: how === 'park' ? 'parked' : 'dropped', buildAfterReply: false });
    const t = this.board.t.idea;
    if (how === 'drop') this.board.decide({ project_id: null, card_id: cardId, question: t.howOn(card.title), answer: t.dropped, by: 'owner' });
    this.board.log(cardId, 'state', 'owner', how === 'park' ? t.parked : t.dropped);
  }

  /**
   * Workers build throwaway prototypes for the idea, each in its own workspace; they never land
   * themselves. One per planned variant chosen, each with its approach in its title, and one for
   * what the owner wrote. Neither chosen nor written: the planned variants that have no prototype
   * on the canvas, or, with none planned, the idea as it stands.
   */
  private prototype(cardId: string, what: string, chosen?: string[]) {
    const card = this.ideaCard(cardId);
    const { variants = [] } = this.board.idea(cardId);
    const t = this.board.t.idea;
    const running = new Set(this.board.snapshot().items.flatMap((i) => (i.prototypeOf === cardId && i.variant ? [i.variant] : [])));
    const picked = chosen ? variants.filter((v) => chosen.includes(v.approach)) : what ? [] : variants.filter((v) => !running.has(v.approach));
    if (chosen?.length && !picked.length && !what) throw new BadRequest('invalid', 'none of the chosen variants is planned');
    if (!chosen && !what && variants.length && !picked.length) throw new BadRequest('variantsRunning', 'every planned variant has its prototype on the canvas');
    const runs = picked.map((v) => {
      const others = variants.filter((o) => o !== v).map((o) => o.approach);
      return { approach: v.approach, task: others.length ? `${v.show}\n\n${t.onlyThisVariant(others.join(', '))}` : v.show, variant: v.approach };
    });
    if (what || !runs.length) runs.push({ approach: approachOf(what), task: what || t.showAsItStands, variant: '' });
    const taken = new Set((this.board.item(cardId)?.prototypes ?? []).map((p) => p.title));
    const started: string[] = [];
    try {
      for (const run of runs) {
        const base = t.prototypeTitle(`${card.title}${run.approach ? ` – ${run.approach}` : ''}`);
        let title = base;
        for (let n = 2; taken.has(title); n++) title = `${base} (${n})`;
        taken.add(title);
        const prototype = this.board.addPrototype(cardId, title, run.task, run.variant || undefined);
        try {
          this.repoOf(prototype).workers.start(prototype.id);
        } catch (e) {
          this.board.remove(prototype.id);
          throw e;
        }
        started.push(title);
      }
    } finally {
      if (started.length) {
        // the owner now waits for the prototypes, not the other way round; the agent's reply to a result gives the turn back
        this.board.setIdea(cardId, { yourTurn: false });
        this.board.log(
          cardId,
          'state',
          'owner',
          started.length > 1 ? t.prototypesStarted(started.map((s) => this.board.t.quote(s)).join(', ')) : t.prototypeStarted(started[0]!, what && !picked.length ? what.replace(/[.!?]$/, '') : ''),
        );
      }
    }
  }

  /** A prototype handed over: its demo shows on the idea beside those of the other prototypes, and the idea's agent hears what it found. */
  private prototypeReady(prototype: Item, summary: string, demo: string | undefined) {
    const idea = this.board.item(prototype.prototypeOf!);
    if (!idea) return;
    this.board.log(idea.id, 'state', 'worker', this.board.t.idea.prototypeReady(prototype.title, !!demo));
    if (idea.state === 'idea')
      this.explorers.tell(
        idea.id,
        `A worker built the throwaway prototype “${prototype.title}” for this idea. Its summary:\n\n${summary}\n\nTake what it showed and what it means for the idea into the brief, then reply to the owner in a sentence or two.`,
      );
  }

  /** A question on a prototype was answered: the idea's agent takes it into the brief, so the idea does not ask it again. */
  private prototypeAnswered(prototype: Item, question: string, answer: string) {
    this.explorers.tell(
      prototype.prototypeOf!,
      `On the prototype “${prototype.title}”, its worker asked: „${question}“\n\nThe owner answered: ${answer}\n\nTake what this settles into the brief (decisions, open questions), so it is not asked again. Do not reply to the owner for it; end your turn without a reply unless it raises something they must decide now.`,
      true,
    );
  }

  private prototypeCard(cardId: string): Item {
    const card = this.board.item(cardId);
    if (!card) throw new BadRequest('unknownCard', 'unknown card');
    if (!card.prototypeOf) throw new BadRequest('notPrototype', 'the card is not a prototype');
    return card;
  }

  private ideaCard(cardId: string): Item {
    const card = this.board.item(cardId);
    if (!card) throw new BadRequest('unknownCard', 'unknown card');
    if (card.state !== 'idea') throw new BadRequest('notIdea', 'the card is not an idea');
    return card;
  }

  /** An idea to build or plan: not while its agent works on a reply, which will change the brief the owner decides on. */
  private settledIdea(cardId: string): Item {
    const card = this.ideaCard(cardId);
    if (card.idea?.thinking) throw new BadRequest('ideaThinking', 'the idea’s agent is still working on its reply; decide once it is there');
    return card;
  }

  /** A voice (or typed) command, once its undo window has passed. */
  run(c: Command) {
    switch (c.do) {
      case 'newCard': {
        const at = c.from ? { from: c.from } : this.board.freeSpot(c.place ?? this.inView);
        const card = this.board.create({
          title: c.title,
          body: c.body,
          ...(c.repo ? { repo: c.repo } : {}),
          ...(c.images?.length ? { images: c.images } : {}),
          ...at,
        });
        this.board.log(card.id, 'state', 'owner', this.board.t.voice.created);
        if (c.start) this.koordinator.request(card.id);
        return;
      }
      case 'newIdea': {
        const card = this.board.create({ idea: true, title: c.title, body: c.body, ...(c.repo ? { repo: c.repo } : {}), ...this.board.freeSpot(c.place ?? this.inView) });
        this.board.log(card.id, 'state', 'owner', this.board.t.voice.created);
        // the agent opens the discussion with what the owner said
        this.explorers.discuss(card.id, c.body.trim() || c.title, true, this.images.resolve(c.images));
        return;
      }
      case 'discuss':
        return this.act(c.card, { action: 'discuss', text: c.text, spoken: c.spoken ?? true, ...(c.images ? { images: c.images } : {}) });
      case 'prototype':
        return this.act(c.card, { action: 'prototype', text: c.text });
      case 'buildPrototype':
        return this.act(c.card, { action: 'buildPrototype', ...(c.workstream ? { workstream: c.workstream } : {}) });
      case 'discard':
        return this.act(c.card, { action: 'discard' });
      case 'build':
      case 'planDoc':
      case 'park':
      case 'drop':
        return this.act(c.card, { action: c.do });
      case 'start':
      case 'force':
        // screenshots said with the start belong to the task, so the worker gets them with it
        if (c.images?.length) this.addTaskImages(c.card, c.images);
        return this.act(c.card, { action: c.do });
      case 'note':
      case 'feedback':
        return this.act(c.card, { action: 'message', text: c.text, spoken: c.spoken ?? true, ...(c.images ? { images: c.images } : {}) });
      case 'answer':
        return this.act(c.card, { action: 'answer', text: c.text, spoken: c.spoken ?? true, ...(c.images ? { images: c.images } : {}) });
      case 'revise':
        return this.act(c.card, { action: 'revise', text: c.text, spoken: c.spoken ?? true });
      case 'approve':
        return this.act(c.card, { action: 'approve', ...(c.direct ? { direct: true } : {}) });
      case 'accept':
      case 'dismiss':
      case 'dequeue':
      case 'stop':
      case 'pause':
      case 'resume':
        return this.act(c.card, { action: c.do });
      case 'configure':
        return this.deps.config?.save(c.canvases);
      case 'remember':
        return this.remember(c.text, c);
      case 'workRetro':
        return this.workRetro.now(c.repo);
      case 'group':
        return void this.board.createGroup(c.name, c.cards);
      case 'ungroup':
        return this.board.group(c.cards, null);
      case 'renameGroup':
        return this.board.renameGroup(c.group, c.name);
    }
  }

  /** Adds screenshots to a card's task, keeping the latest when there are more than a message takes. */
  private addTaskImages(cardId: string, images: string[]) {
    const had = this.board.item(cardId)?.images ?? [];
    this.board.work(cardId, { images: JSON.stringify([...had.filter((i) => !images.includes(i)), ...images].slice(-MAX_IMAGES)) });
  }

  /** The cards whose worker is in the middle of a turn, which a restart would cut off. */
  busy(): string[] {
    return this.repos.flatMap((r) => r.workers.busyCards());
  }

  /** The owner came back to a page of this canvas: its open pull requests are looked at now, and its demo sites. */
  ownerBack() {
    for (const r of this.repos) r.prs?.soon();
    this.sharing.soon();
    this.siteCredentials();
  }

  /** A site's env file placed or removed on this machine since: its repository's cards share again, or export. */
  private siteCredentials() {
    let changed = false;
    for (const r of this.repos) {
      const next = shareRef(r.site, this.deps.home);
      if (r.ref.share !== next.share || r.ref.shareNeeds?.file !== next.shareNeeds?.file) {
        setShare(r.ref, next);
        changed = true;
      }
    }
    if (changed) this.board.changed();
  }

  /** Obeya is about to restart, or no longer is: the workers hear so and pause for it (or for their repository's restart that waits). */
  restartDue(due: DueRestart | null) {
    this.obeyaDue = due;
    const p = this.pending;
    for (const r of this.repos) r.workers.restartDue(due ?? (p?.paths.has(r.info.path) ? repoDue(p) : null));
  }

  shutdown() {
    this.pending?.stop();
    this.pending = null;
    for (const [, w] of this.writing) clearTimeout(w.timer);
    for (const stop of this.branchSettings.values()) stop();
    for (const r of this.repos) this.stopRepo(r);
    this.koordinator.shutdown();
    this.explorers.shutdown();
  }
}

/** A prototype's approach, for its title: the first sentence of what it is to show, kept short. */
export function approachOf(what: string, max = 40): string {
  const text = what.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  const first = (text.match(/^.+?[.!?;:](?=\s|$)/)?.[0] ?? text).replace(/[.;:]$/, '');
  if (first.length <= max) return first;
  const cut = first.slice(0, max - 1);
  const word = cut.lastIndexOf(' ');
  return `${(word > max / 2 ? cut.slice(0, word) : cut).replace(/[\s,;:–—-]+$/, '')}…`;
}

/**
 * Starts the canvases; one that does not start is left out, with why in Obeya's log (and in
 * "Konfiguration", which checks the configuration again), and the others run.
 */
export function startCanvases(configs: CanvasConfig[], deps: CanvasDeps): CanvasRuntime[] {
  return configs.flatMap((c) => {
    try {
      return new CanvasRuntime(c, deps);
    } catch (e) {
      const why = e instanceof ConfigError ? e.message : e instanceof Error ? (e.stack ?? e.message) : String(e);
      console.error(`Obeya: the canvas ${c.name ?? c.id ?? c.repos[0]?.path} does not start, left out: ${why}`);
      return [];
    }
  });
}

/**
 * The canvases Obeya serves, as its configuration has them while it runs (design: Live
 * configuration): a canvas new in it starts at once, one that changed takes the change
 * (`CanvasRuntime.apply`), one no longer in it stops once its agents paused, its cards kept.
 */
export class Canvases {
  private list: CanvasRuntime[];
  private listeners = new Set<() => void>();

  constructor(
    configs: CanvasConfig[],
    private deps: CanvasDeps,
    /** A canvas started while Obeya runs. */
    private started: (c: CanvasRuntime) => void = () => {},
  ) {
    this.list = startCanvases(configs, deps);
  }

  all(): CanvasRuntime[] {
    return this.list;
  }

  get(id: string): CanvasRuntime | undefined {
    return this.list.find((c) => c.id === id);
  }

  /** Calls `fn` whenever a canvas starts, stops, or changes its name or repositories. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * The configuration saved: `ids` are its canvases' ids as its check resolved them (null where one
   * does not resolve; then no canvas leaves, since which one it is stays unknown).
   */
  apply(configs: CanvasConfig[], ids: (string | null)[]) {
    configs.forEach((config, i) => {
      const id = ids[i];
      if (!id) return;
      const running = this.get(id);
      if (running) return running.apply(config);
      const [c] = startCanvases([config], this.deps);
      if (!c) return;
      this.list.push(c);
      console.log(`Obeya: the canvas ${c.board.canvas.name} (?c=${c.id}) runs now`);
      this.started(c);
    });
    if (!ids.includes(null))
      for (const c of [...this.list])
        if (!ids.includes(c.id))
          c.retire(() => {
            this.list = this.list.filter((x) => x !== c);
            this.emit();
          });
    this.emit();
  }

  /** Stops every canvas, for Obeya to end. */
  shutdown() {
    for (const c of this.list) c.shutdown();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

/** Why a canvas's configuration does not work; `repo` is the index of the repository in question. */
export class ConfigError extends Error {
  constructor(
    readonly code: ConfigProblemCode,
    message: string,
    readonly repo?: number,
  ) {
    super(message);
  }
}

/**
 * What resolving a repository reads of it with git (`readingRepo`): where it is and its main
 * branch (`info`), that branch as git tells it whatever the owner set (`detected`), whether its
 * main branch still has an adapter module (`hasAdapterModule`), and its `.obeya/settings.json`
 * there (`readShared`).
 */
export interface RepoRead {
  info: RepoInfo;
  detected: string;
  adapterModule: boolean;
  shared: SharedRead;
}

/** Reads a repository for `resolveCanvas`, as git steps; null where `path` is no git repository. */
export function* readingRepo(path: string): GitSteps<RepoRead | null> {
  const [[remote], branches] = yield* together(gitCalls(['remote', 'get-url', 'origin']), readingBranches());
  if (branches == null) return null;
  const detected = yield* detectingBranch(branches);
  const branch = branchSetting(path) || detected;
  const commit = yield* branchCommit(branch, branches);
  const [adapterModule, shared] = yield* together(readingAdapterModule(commit), readingShared(commit));
  return { info: { path, remote: remote ?? null, branch }, detected, adapterModule, shared };
}

/** Reads a repository for `resolveCanvas`, the server waiting; null where `path` is no git repository. */
export const readRepo = (path: string): RepoRead | null => gitStepsSync(path, readingRepo(path));

/**
 * What a canvas's configuration amounts to, without touching anything: its repositories (home
 * first), each with Obeya's defaults and in front of them the repository's `.obeya/settings.json`
 * (`shared`: where they are read, by the repository's path; as `read` read them when left out) and
 * this machine's settings (`settings`: where a repository's are read; its entry's when left out),
 * each with its id and its settings without this machine's (`values`), and the canvas's id and
 * name. `read` reads each repository, by its absolute path (git, waiting for it, when left out).
 * Throws a ConfigError.
 */
export function resolveCanvas(
  config: CanvasConfig,
  store: Store,
  settings: (r: RepoConfig) => () => RepoSettings | undefined = (r) => () => r.settings,
  shared?: (path: string) => () => SharedSettings | undefined,
  read: (path: string) => RepoRead | null = readRepo,
) {
  if (!config.repos.length) throw new ConfigError('noRepo', 'a canvas needs at least one repository');
  const reads = config.repos.map((r, i) => {
    const got = read(resolve(r.path));
    if (!got) throw new ConfigError('notRepo', `${r.path} is not a git repository`, i);
    return got;
  });
  // a repository runs once on a canvas: twice, it would have two of everything, its plan docs' note too
  reads.forEach(({ info }, i) => {
    if (reads.findIndex((x) => x.info.path === info.path) < i) throw new ConfigError('sameRepo', `${config.repos[i]!.path} is on the canvas already`, i);
  });
  const sharedOf =
    shared ??
    ((path: string) => {
      const settings = reads.find((x) => x.info.path === path)?.shared.settings;
      return () => settings;
    });
  let repos = config.repos.map((r, i) => ({ config: r, read: reads[i]!, adapter: repoAdapter(r, reads[i]!.info, settings(r), sharedOf(reads[i]!.info.path)) }));
  const refsOf = () => uniqueRefs(repos.map((x) => x.read.info), repos.map((x) => x.adapter));
  let refs = refsOf();
  const id = config.id ? slug(config.id) : config.name ? slug(config.name) : slug(repoName(reads[0]!.info));
  // the home repository is fixed when the canvas is first served: bare plan references, cards
  // without a repository and the home workspace directory are its, whatever the order later
  const stored = store.setting(id, 'home_repo');
  if (stored && stored !== refs[0]!.id) {
    const at = refs.findIndex((r) => r.id === stored);
    if (at < 0) throw new ConfigError('homeMissing', `canvas ${id}: its home repository "${stored}" is not configured; list it (first or anywhere)`);
    repos = [repos[at]!, ...repos.filter((_, i) => i !== at)];
    refs = refsOf();
  }
  const name = config.name ?? repoName(repos[0]!.read.info);
  return {
    config: { ...config, repos: repos.map((x) => x.config) },
    id,
    name,
    repos: repos.map((x, i) => ({ ...x, ref: refs[i]!, values: () => repoValues(x.read.info, namesClones(x.config), sharedOf(x.read.info.path)() ?? {}, x.read.detected) })),
    stored,
  };
}

/** What `resolveCanvas` resolved. */
type Resolved = ReturnType<typeof resolveCanvas>;

/**
 * How a canvas runs a repository: Obeya's defaults with the repository's `shared` settings and this
 * machine's `settings` in front, each read when it is asked for; its workers work in clones where
 * the configuration names some.
 */
export function repoAdapter(r: RepoConfig, info: RepoInfo, settings: () => RepoSettings | undefined, shared: () => SharedSettings | undefined): RepoAdapter {
  return withSettings(defaultsFor(info), () => layerSettings<RepoSettings>(shared(), settings()), namesClones(r));
}

/** Whether a repository's configuration names clones for its workers (to create, existing ones, on other machines). */
export const namesClones = (r: RepoConfig) => !!r.clones || !!r.workspaces?.length || !!r.hosts?.length;

/** Repository ids unique on the canvas: the repository's name, with a number when two share one. */
function uniqueRefs(infos: RepoInfo[], adapters: RepoAdapter[]): RepoRef[] {
  const seen = new Map<string, number>();
  return infos.map((info, i) => {
    const base = slug(repoName(info)) || `repo${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return {
      id: n === 1 ? base : `${base}${n}`,
      name: repoName(info),
      path: info.path,
      ...settled(info, adapters[i]!),
    };
  });
}

/** What a repository's ref says of its settings, which may change while the canvas runs: its main branch, its workspaces, how work lands. */
function settled(info: RepoInfo, adapter: RepoAdapter): Pick<RepoRef, 'branch' | 'clones' | 'pullRequests' | 'direct'> {
  return {
    branch: info.branch,
    ...(adapter.workspaces === 'clones' ? { clones: true } : {}),
    ...(adapter.land === 'pr' ? { pullRequests: true, ...(adapter.direct ? { direct: true } : {}) } : {}),
  };
}

/** Where a repository shares demos: the site its settings name, once it is complete; null without one. */
function siteOf(adapter: RepoAdapter): DemoSite | null {
  const site = adapter.demo?.site;
  return site && !siteIncomplete(site) ? site : null;
}

/** What the canvas tells the UI about it: a site to share on here, or the env file the site lacks on this machine. */
function shareRef(site: DemoSite | null, home: string): Pick<RepoRef, 'share' | 'shareNeeds'> {
  if (!site) return {};
  const missing = siteMissing(home, site);
  return missing ? { shareNeeds: { site: siteName(site), file: missing } } : { share: true };
}

/** Tells the UI about sharing on the repository what `share` says, in place of what it was told before. */
function setShare(ref: RepoRef, share: Pick<RepoRef, 'share' | 'shareNeeds'>) {
  delete ref.share;
  delete ref.shareNeeds;
  Object.assign(ref, share);
}

/** The restart of a repository's agents that waits, as its workers hear of it. */
const repoDue = (p: RepoRestart): DueRestart => ({ reason: p.reason, deadline: p.deadline, repo: true });

function sameDir(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

const slug = (s: string) =>
  s
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-|-$/g, '');

/** A workspace as a directory on this machine, for a program that runs here (gh on a pull request's URL); none for one on another machine. */
const localDir = (workspace: string | null) => (workspace && !hostName(workspace) ? workspace : null);
