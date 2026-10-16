import { useEffect, useState } from 'react';
import type { CardDiff } from '../core/diff';
import type { PushKeyView } from '../core/push-key';
import { type Place, placeParam } from '../core/layout';
import type { AccessView, Pairing, RemoteSetting, AgentRole, AgentSetting, CloudPreset, AgentsView, CanvasConfig, CanvasInfo, CanvasSnapshot, ClientMessage, ConfigSaved, ConfigView, CardAction, ConfigChecked, DemoSettings, Group, DemoSettingsView, DemoVoiceCheck, FirstCanvas, GitSetupPreview, MachineItem, MachineSectionId, MachineView, SetupCheck, SetupFolder, VoiceSetupView, CardEvent, CardPatch, Item, Language, LanguageView, NewCard, Notice, OwnerHold, PendingRestart, ProjectHistory, ServerMessage, SettingsShared, SpotInput, TalkRef, AppUpdate, Theme, ThemeView } from '../core/types';
import type { Wish } from '../core/wish';

/** A request the server refused; `code` picks the owner's text, the message is the server's detail. */
export class ApiError extends Error {
  constructor(
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await send(method, path, body);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** The request, with `body` as JSON; throws the server's refusal. */
async function send(method: string, path: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await refused(res);
  return res;
}

/** Throws the server's refusal as an ApiError. */
async function refused(res: Response) {
  if (res.ok) return;
  const body = await res.text();
  let code: string | undefined;
  let detail = body;
  try {
    ({ code, error: detail = body } = JSON.parse(body));
  } catch {}
  throw new ApiError(code, detail || `HTTP ${res.status}`);
}

/** Saves a file the server makes, under the name it gives. */
async function download(path: string, fallback: string) {
  const res = await fetch(path);
  await refused(res);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallback;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const query = (where: Where) =>
  !where ? '' : 'card' in where ? `?card=${encodeURIComponent(where.card)}` : `?project=${encodeURIComponent(where.project)}`;

/** The canvas this page shows; every call goes to its API. */
let canvasId = '';
export function setCanvas(id: string) {
  canvasId = id;
}
/** A path in the shown canvas's API. */
export const at = (path: string) => `/api/c/${encodeURIComponent(canvasId)}${path}`;
/** Where a looked-up answer's file is served; `download` to save it. */
export const answerFile = (thread: number, name: string, download = false) =>
  at(`/threads/${thread}/files/${name.split('/').map(encodeURIComponent).join('/')}${download ? '?download' : ''}`);

/** What a command is said about: the open card, the open project, or neither. */
export type Where = { card: string } | { project: string } | null;
/** The field on a card words were typed into, which tells the Koordinator what they were meant as. */
export type Field = 'note' | 'answer' | 'feedback' | 'demo' | 'discuss' | 'revise';

/** What Obeya made of a command. */
export interface Heard {
  confirm: string;
  token?: string;
  /** How long the command still waits for "Rückgängig". */
  undoMs?: number;
  /** Said to the open card's agent: the card shows it, so there is nothing to confirm. */
  quiet?: boolean;
  /** Nothing was heard: the screenshots shown with it wait for the next recording. */
  unheard?: boolean;
  /** The words heard. */
  text?: string;
  /** The owner asked to tell Obeya's makers something: the draft for them opens with it. */
  wish?: Wish;
}
/** How long "Rückgängig" shows: until shortly before the command stops waiting. */
export const undoShownMs = (undoMs: number) => Math.max(0, undoMs - 400);
/** How long a confirmation stays: 7 s, unless its undo window is longer (above the microphone and in the app's panel alike). */
export const confirmShownMs = (undoMs = 0) => Math.max(7000, undoMs + 1500);

export const api = {
  canvases: () => call<CanvasInfo[]>('GET', '/api/canvases'),
  /** Obeya's configuration, for all canvases. */
  config: () => call<ConfigView>('GET', '/api/config'),
  /** What the configuration as saved amounts to, and what is wrong with it: it reads every repository, so it comes after `config`. */
  configCheck: () => call<ConfigChecked>('GET', '/api/config/check'),
  checkConfig: (canvases: CanvasConfig[]) => call<ConfigChecked>('POST', '/api/config/check', canvases),
  /** Saves it; Obeya then starts again with it where something restarts it. */
  saveConfig: (canvases: CanvasConfig[]) => call<ConfigSaved>('PUT', '/api/config', canvases),
  /** „Für alle ins Repository übernehmen“: the repository's settings for this machine into its `.obeya/settings.json`. */
  shareSettings: (path: string, direct = false) => call<SettingsShared>('POST', '/api/config/share-settings', { path, direct }),
  /** The language Obeya speaks to the owner: chosen, or the system's. */
  language: () => call<LanguageView>('GET', '/api/language'),
  /** The push-to-talk key in another app, and the app's shell that hears it. */
  pushKey: () => call<PushKeyView>('GET', '/api/push-to-talk'),
  savePushKey: (key: string | null) => call<PushKeyView>('PUT', '/api/push-to-talk', { key }),
  /** Saves the owner's choice; `null` follows the system again. */
  saveLanguage: (language: Language | null) => call<LanguageView>('PUT', '/api/language', { language }),
  /** Light or dark as the owner chose, or `null` for the system's. */
  theme: () => call<ThemeView>('GET', '/api/theme'),
  // other devices reaching Obeya: the section „Von anderen Geräten“ and „Telefon verbinden“
  access: () => call<AccessView | { local: false }>('GET', '/api/access'),
  saveAccess: (remote: RemoteSetting | null) => call<AccessView>('PUT', '/api/access', { remote }),
  pair: () => call<Pairing>('POST', '/api/access/pair'),
  removeDevice: (id: string) => call<{ removed: boolean }>('DELETE', `/api/access/devices/${encodeURIComponent(id)}`),
  saveTheme: (theme: Theme | null) => call<ThemeView>('PUT', '/api/theme', { theme }),
  /** The model and effort of each group of agents. */
  agents: () => call<AgentsView>('GET', '/api/agents'),
  /** Saves the model or the effort of one group. */
  saveAgents: (role: AgentRole, choice: Partial<AgentSetting>) => call<AgentsView>('PUT', '/api/agents', { [role]: choice }),
  /** The setup assistant's list: what Obeya needs on this machine. */
  setup: () => call<MachineView>('GET', '/api/setup'),
  setupInstall: (section: MachineSectionId, id: MachineItem['id']) => call<MachineView>('POST', '/api/setup/install', { section, id }),
  /** Opens a terminal that logs in; `opened: false` where Obeya found none. */
  setupLogin: (section: MachineSectionId, id: MachineItem['id']) => call<{ opened: boolean }>('POST', '/api/setup/login', { section, id }),
  setupIdentity: (name: string, email: string) => call<MachineView>('POST', '/api/setup/identity', { name, email }),
  /** A folder from the system's dialog; null when cancelled. */
  setupPick: (prompt: string) => call<{ path: string | null }>('POST', '/api/setup/pick', { prompt }),
  /** The first canvas from a folder (saved at once) or a clone (the view follows it). */
  setupFolder: (path: string) => call<SetupFolder>('POST', '/api/setup/folder', { path }),
  setupGitPreview: (path: string) => call<GitSetupPreview>('POST', '/api/setup/git-preview', { path }),
  setupGit: (path: string) => call<{ branch: string }>('POST', '/api/setup/git', { path }),
  setupCanvas: (input: { path: string } | { clone: string; into: string }) => call<FirstCanvas | MachineView>('POST', '/api/setup/canvas', input),
  voiceSetup: () => call<VoiceSetupView>('GET', '/api/voice-setup'),
  installVoice: () => call<VoiceSetupView>('POST', '/api/voice-setup/install'),
  measureVoice: () => call<VoiceSetupView>('POST', '/api/voice-setup/measure'),
  /** Tests a cloud service with the check's sentence and hears through it from then on; a key left out keeps the saved one. */
  useCloudVoice: (service: { preset: CloudPreset; baseUrl?: string; model?: string; key?: string }) => call<VoiceSetupView>('PUT', '/api/voice-setup/cloud', service),
  useLocalVoice: () => call<VoiceSetupView>('DELETE', '/api/voice-setup/cloud'),
  demoSettings: () => call<DemoSettingsView>('GET', '/api/demo-settings'),
  saveDemoSettings: (settings: DemoSettings) => call<DemoSettingsView>('PUT', '/api/demo-settings', settings),
  checkDemoVoice: (settings: DemoSettings) => call<DemoVoiceCheck>('POST', '/api/demo-settings/check', settings),
  demoSetup: (settings: DemoSettings) => call<SetupCheck>('POST', '/api/demo-settings/setup', settings),
  installDemoVoice: (settings: DemoSettings) => call<DemoSettingsView>('POST', '/api/demo-settings/install', settings),
  /** One sentence in the voice, as a WAV to play. */
  demoVoiceSample: async (settings: DemoSettings) => (await send('POST', '/api/demo-settings/sample', settings)).blob(),
  /** Has a restart that waits for workers go ahead now; false when none waits. */
  restartNow: () => call<{ restarting: boolean }>('POST', '/api/restart'),
  /** Has the restart of this canvas's repositories' agents that waits for them go ahead at once. */
  restartReposNow: () => call<{ restarting: boolean }>('POST', at('/restart')),
  /** Installs the newer version of the app once the workers paused, as a restart waits for them. */
  installUpdate: () => call<{ updating: boolean }>('POST', '/api/app-update/install'),
  create: (c: NewCard) => call<Item>('POST', at('/cards'), c),
  /** The card that writes a repository's settings for everyone, on the canvas it belongs to (not necessarily the shown one). */
  adapterSetup: (canvas: string, repo: string) => call<Item>('POST', `/api/c/${encodeURIComponent(canvas)}/adapter-setup`, { repo }),
  preparePlanDoc: (canvas: string, repo: string, file: string) => call<Item>('POST', `/api/c/${encodeURIComponent(canvas)}/prepare-plan-doc`, { repo, file }),
  /** Downloads a card's demo as a ZIP of its page with the files, or as one HTML file. */
  exportDemo: (id: string, as: 'zip' | 'html') => download(at(`/cards/${id}/export?as=${as}`), `demo.${as}`),
  /** The size of a card's demo video in bytes; null when unknown. */
  demoSize: async (id: string) => {
    const res = await fetch(at(`/cards/${id}/demo/demo.mp4`), { headers: { range: 'bytes=0-0' } });
    await res.body?.cancel();
    const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1]);
    return res.ok && total > 0 ? total : null;
  },
  patch: (id: string, p: CardPatch) => call<void>('PATCH', at(`/cards/${id}`), p),
  remove: (id: string) => call<void>('DELETE', at(`/cards/${id}`)),
  restore: (id: string) => call<void>('POST', at(`/cards/${id}/restore`)),
  /** Takes a finished card off the canvas into the archive. */
  archive: (id: string) => call<void>('POST', at(`/cards/${id}/archive`)),
  unarchive: (id: string) => call<void>('POST', at(`/cards/${id}/unarchive`)),
  /** The archive, the most recently archived first. */
  archived: () => call<Item[]>('GET', at('/archive')),
  /** Archives every finished card of the owner's on the canvas. */
  archiveDone: () => call<{ ids: string[] }>('POST', at('/archive')),
  act: (id: string, a: CardAction) => call<void>('POST', at(`/cards/${id}/act`), a),
  /** "Make it a card": a looked-up thread moves onto a Question card, which comes back. */
  threadCard: (thread: number) => call<Item>('POST', at(`/threads/${thread}/card`)),
  /** Opens an answer's file with the system's app, or without `file` the thread's directory. */
  openAnswer: (thread: number, file?: string) => call<void>('POST', at(`/threads/${thread}/open`), file === undefined ? {} : { file }),
  /** A new group with the cards in it; a name a group has already puts them into that one. */
  createGroup: (name: string, cards: string[], hue?: number) => call<Group>('POST', at('/groups'), { name, cards, hue }),
  /** Ends the group: its cards belong to none. Returns what brings it back. */
  deleteGroup: (id: string) => call<{ group: Group; cards: string[] }>('DELETE', at(`/groups/${id}`)),
  /** Puts the cards into the group, or with `null` into none. */
  assign: (cards: string[], group: string | null) => call<void>('POST', at('/assign'), { cards, group }),
  /** Stores a screenshot for a message; the message names it by the id. */
  uploadImage: async (image: Blob) => {
    const res = await fetch(at('/images'), { method: 'POST', headers: { 'content-type': image.type }, body: image });
    await refused(res);
    return ((await res.json()) as { id: string }).id;
  },
  events: (id: string) => call<CardEvent[]>('GET', at(`/cards/${id}/events`)),
  /** Whether the app in the card's workspace answers now. */
  appUp: async (id: string) => (await call<{ up: boolean }>('GET', at(`/cards/${id}/app`))).up,
  /** Where the owner's browser opens the card's app: through Obeya, which keeps it running a while after. */
  appOpen: (id: string) => at(`/cards/${id}/app/open`),
  /** What the card's work changes (null: nothing to read, no workspace and not landed); `full`: with the diff itself. */
  diff: async (id: string, full = false) => (await call<CardDiff | undefined>('GET', at(`/cards/${id}/diff${full ? '?full' : ''}`))) ?? null,
  /** A project's plan doc as written. */
  planDoc: (id: string) => call<{ file: string; markdown: string }>('GET', at(`/cards/${id}/plan`)),
  /** A project's decisions and the idea it came from. */
  history: (id: string) => call<ProjectHistory>('GET', at(`/cards/${id}/history`)),
  /**
   * What the owner said about the card or project in view, with the screenshots shown with it;
   * `replyTo`: in reply to that message of the card's conversation, or of the sheet; `text`: typed in the field
   * before it, which goes first; `listen`: dictated into a field, the words only come back; `spot`:
   * about that place in the card's demo video; `place`: where on the canvas the owner was, for a card it makes;
   * `sent`: the page's name for the recording, to ask whether it arrived (`voiceArrived`). A refusal
   * throws an ApiError; a connection that broke, anything else.
   */
  voice: async (
    audio: Blob,
    where: Where,
    { images = [], replyTo, text, listen, spot, place, sent }: { images?: string[]; replyTo?: number | TalkRef; text?: string; listen?: boolean; spot?: SpotInput; place?: Place; sent?: string } = {},
  ) => {
    const q = [
      ...(sent ? [`sent=${encodeURIComponent(sent)}`] : []),
      ...images.map((id) => `image=${encodeURIComponent(id)}`),
      ...(place ? [`place=${placeParam(place)}`] : []),
      ...(replyTo ? [`replyTo=${typeof replyTo === 'number' ? replyTo : `${replyTo.talk}.${replyTo.part}`}`] : []),
      ...(listen ? ['listen'] : []),
      ...(spot ? [`at=${spot.at}`, ...(spot.still ? [`still=${encodeURIComponent(spot.still)}`] : []), ...(spot.demo !== undefined ? [`demo=${spot.demo}`] : [])] : []),
    ].join('&');
    let body: Blob | FormData = audio;
    if (text?.trim()) {
      body = new FormData();
      body.set('audio', audio);
      body.set('text', text);
    }
    const res = await fetch(at(`/voice${query(where)}${q && (where ? '&' : '?')}${q}`), { method: 'POST', body });
    await refused(res);
    return (await res.json()) as Heard;
  },
  /** Whether the recording `voice` sent as `sent` arrived whole. */
  voiceArrived: async (sent: string) => (await call<{ arrived: boolean }>('GET', at(`/voice/arrived/${encodeURIComponent(sent)}`))).arrived,
  /** The owner started speaking (or typing a command): Obeya gets ready to read it. */
  warmVoice: () => fetch(at('/voice/warm'), { method: 'POST' }).catch(() => {}),
  /** The same, typed; `field`: the field of the open card it was typed into. */
  command: (text: string, where: Where, { images, field, replyTo, spot, place }: { images?: string[]; field?: Field; replyTo?: number | TalkRef; spot?: SpotInput; place?: Place } = {}) =>
    call<Heard>('POST', at(`/command${query(where)}${place ? `${where ? '&' : '?'}place=${placeParam(place)}` : ''}`), { text, ...(images?.length ? { images } : {}), ...(field ? { field } : {}), ...(replyTo ? { replyTo } : {}), ...(spot ? { spot } : {}) }),
  /** A typed request to the Koordinator of another canvas, about nothing in view there. */
  commandOn: (canvas: string, text: string) => call<Heard>('POST', `/api/c/${encodeURIComponent(canvas)}/command`, { text }),
  undo: (token: string) => call<{ undone: boolean }>('POST', at('/command/undo'), { token }),
  /** The issue for Obeya's makers as a small job writes it from the owner's words, reworking the draft so far; `app`: Obeya runs in its app. */
  writeWish: (w: { said: string; answer?: string; title?: string; body?: string; images?: string[]; app: boolean }) =>
    call<{ title: string; body: string; raw?: true }>('POST', at('/wish'), w),
  /** A rule of the owner's, active at once, or with `target` one for that repository's CLAUDE.md. */
  addPreference: (text: string, target?: string) => call<void>('POST', at('/preferences'), { text, ...(target ? { target } : {}) }),
  /** Changes a preference, or deletes it with `null`. */
  setPreference: (id: number, text: string | null) =>
    text === null ? call<void>('DELETE', at(`/preferences/${id}`)) : call<void>('PATCH', at(`/preferences/${id}`), { text }),
  /** Accepts a proposed rule, in the owner's words and for the place they chose (a repository, `null` for the preferences) when they changed these. */
  acceptProposal: (id: number, text?: string, target?: string | null) =>
    call<void>('POST', at(`/preferences/${id}/accept`), { ...(text === undefined ? {} : { text }), ...(target === undefined ? {} : { target }) }),
  rejectProposal: (id: number) => call<void>('POST', at(`/preferences/${id}/reject`)),
  /** Takes a setting the Arbeitsrückschau proposed, as it is or with the owner's `value`: on this machine, or into the repository for everyone. */
  takeSetting: (id: number, where: 'machine' | 'repository', value?: string | string[]) => call<unknown>('POST', at(`/setting-proposals/${id}/take`), { where, ...(value === undefined ? {} : { value }) }),
  rejectSetting: (id: number) => call<void>('POST', at(`/setting-proposals/${id}/reject`)),
  /** Shares outdated pages again, the newest demos first: `count` of them, or all with null. */
  reshare: (count: number | null) => call<void>('POST', at('/reshare'), { count }),
  stopReshare: () => call<void>('POST', at('/reshare/stop')),
  /** "Ausblenden": puts away what the finished run says, and the notice of outdated pages until a newer change. */
  dismissReshare: () => call<void>('DELETE', at('/reshare')),
  /** The owner has the Koordinator's sheet in view: the answers waiting there are read. */
  readTalk: () => call<void>('POST', at('/talk/read')),
};

// Log lines arrive over the canvas's WebSocket; whoever shows a card's log listens here.
const eventListeners = new Set<(e: CardEvent) => void>();
export function onCardEvent(fn: (e: CardEvent) => void): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

// A line taken out of a card's log (a comment deleted before it went to the worker).
const goneListeners = new Set<(cardId: string, id: number) => void>();
export function onCardEventGone(fn: (cardId: string, id: number) => void): () => void {
  goneListeners.add(fn);
  return () => goneListeners.delete(fn);
}

// What Obeya tells the owner without a command of theirs to answer (an answer looked up, what a
// request an agent passed on came to): it shows above the microphone, with "Rückgängig" while actions wait.
const noticeListeners = new Set<(n: Notice) => void>();
/** Notices that came before anything showed them: those a page gets as it opens, before the canvas is drawn. */
let heldNotices: { n: Notice; at: number }[] = [];
export function onNotice(fn: (n: Notice) => void): () => void {
  noticeListeners.add(fn);
  const held = heldNotices;
  heldNotices = [];
  // the undo window went on meanwhile
  for (const { n, at } of held) fn(n.undoMs ? { ...n, undoMs: Math.max(0, n.undoMs - (Date.now() - at)) } : n);
  return () => noticeListeners.delete(fn);
}
function notice(n: Notice) {
  if (!noticeListeners.size) heldNotices.push({ n, at: Date.now() });
  for (const fn of noticeListeners) fn(n);
}

// What the owner does in this page that a restart would cut off, by who holds it (the demo video,
// push-to-talk); the server hears every change, and again after a reconnect.
const holds = new Map<string, OwnerHold>();
/** The page's open WebSockets: one for the canvas it shows, one per canvas in the phone view. */
const sockets = new Map<string, WebSocket>();
const sendHolds = () => {
  for (const ws of sockets.values()) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'hold', hold: [...new Set(holds.values())] } satisfies ClientMessage));
};
/** Holds a due restart off while the owner watches (`video`) or dictates (`voice`); `null` lets go. */
export function holdRestart(by: string, what: OwnerHold | null) {
  if ((holds.get(by) ?? null) === what) return;
  if (what) holds.set(by, what);
  else holds.delete(by);
  sendHolds();
}

// What the owner has in view, for a command from the app's push-to-talk key in another app: the
// server hears every change, again after a reconnect, and when the page gets the focus back, so
// the page the owner looked at last wins.
let focusMessage: Extract<ClientMessage, { type: 'focus' }> | null = null;
const sendFocus = () => {
  const ws = sockets.get(canvasId);
  if (focusMessage && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(focusMessage));
};
export function reportFocus(where: Where, target: string, title: string | undefined, place: Place) {
  focusMessage = { type: 'focus', ...(where ?? {}), target, ...(title ? { title } : {}), place: placeParam(place) };
  sendFocus();
}

// Whoever has something to keep across the reload a restart brings writes it down here first.
const reloadListeners = new Set<() => void>();
export function beforeReload(fn: () => void): () => void {
  reloadListeners.add(fn);
  return () => reloadListeners.delete(fn);
}

/** Loads the page again, keeping what is open, as after a restart. */
export function reload() {
  for (const fn of reloadListeners) fn();
  location.reload();
}

/**
 * The live canvas `id` (the shown one by default): the server pushes a snapshot on connect and after
 * every change, the restart that waits, the newer version of the app there is, how many cards on
 * each canvas need the owner, and the Bun it runs on when that is too old. A lost connection is
 * tried again with a growing pause, and at once when the page comes back into view (a phone that
 * was locked).
 */
export function useCanvas(id = canvasId): {
  snapshot: CanvasSnapshot | null;
  online: boolean;
  /** Since when the server does not answer; null while it does. */
  offlineSince: number | null;
  restart: PendingRestart | null;
  update: AppUpdate | null;
  waiting: Record<string, number>;
  oldBun: string | null;
  /** The canvases as they changed while the page is open (one started, stopped or renamed); null until they do. */
  canvases: CanvasInfo[] | null;
} {
  const [snapshot, setSnapshot] = useState<CanvasSnapshot | null>(null);
  const [online, setOnline] = useState(true);
  const [offlineSince, setOfflineSince] = useState<number | null>(null);
  const [restart, setRestart] = useState<PendingRestart | null>(null);
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [waiting, setWaiting] = useState<Record<string, number>>({});
  const [oldBun, setOldBun] = useState<string | null>(null);
  const [canvases, setCanvases] = useState<CanvasInfo[] | null>(null);
  useEffect(() => {
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let delay = 500;
    let closed = false;
    let server: string | undefined;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/c/${encodeURIComponent(id)}/ws`);
      sockets.set(id, ws);
      ws.onopen = () => {
        setOnline(true);
        setOfflineSince(null);
        delay = 500;
        sendHolds();
        sendFocus();
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMessage;
        // a new server process may run new code: the page loads it, and keeps what was open
        if (msg.type === 'hello') {
          if (server && server !== msg.server) reload();
          server = msg.server;
          setOldBun(msg.oldBun ?? null);
        } else if (msg.type === 'snapshot') setSnapshot(msg.snapshot);
        else if (msg.type === 'restart') setRestart(msg.restart);
        else if (msg.type === 'update') setUpdate(msg.update);
        else if (msg.type === 'waiting') setWaiting(msg.waiting);
        else if (msg.type === 'canvases') setCanvases(msg.canvases);
        else if (msg.type === 'event') for (const fn of eventListeners) fn(msg.event);
        else if (msg.type === 'eventGone') for (const fn of goneListeners) fn(msg.cardId, msg.id);
        else if (msg.type === 'notice') notice(msg);
      };
      ws.onclose = () => {
        if (closed) return;
        setOnline(false);
        setOfflineSince((t) => t ?? Date.now());
        // a canvas the configuration no longer has: the page goes to the first one there is; a
        // device removed from Obeya's devices gets the page that says how to connect again
        api.canvases().then(
          (list) => list.some((c) => c.id === id) || location.replace(location.pathname),
          (e) => e instanceof ApiError && e.code === 'notPaired' && location.reload(),
        );
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 8000);
      };
    };
    connect();
    // back from GitHub, say: the server looks at the pull requests now instead of at its next round
    const back = () => {
      if (document.visibilityState === 'visible' && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'back' } satisfies ClientMessage));
      // a connection lost meanwhile is tried again now, not after the pause it waits
      if (document.visibilityState === 'visible' && ws.readyState === WebSocket.CLOSED && !closed) {
        clearTimeout(retry);
        delay = 500;
        connect();
      }
      sendFocus();
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    return () => {
      closed = true;
      clearTimeout(retry);
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
      if (sockets.get(id) === ws) sockets.delete(id);
      ws.close();
    };
  }, [id]);
  return { snapshot, online, offlineSince, restart, update, waiting, oldBun, canvases };
}
