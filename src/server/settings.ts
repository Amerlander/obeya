// Obeya's own settings, in `settings.json` under its home beside `canvases.json` and `demo.json`:
// the language of Obeya's interface and the one its agents talk to the owner in, light or dark, the model and effort of each group of
// agents, the key that records a command from anywhere on the machine (heard by the app's shell),
// and how other devices reach Obeya (remote.ts). The owner chooses them in the settings sheet;
// until then the system's language and look apply, the agents run as `AGENT_DEFAULTS` says, and
// no other device reaches Obeya. Saving restarts nothing: the page loads again in the new
// language, takes the new look at once, and the server reads the file whenever it needs the
// language or starts an agent.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chosenConversationLanguage, chosenLanguage, conversationLanguageIn, OWNER_SETTINGS_FILE as SETTINGS_FILE, ownerLanguageIn, systemLanguage } from '../../plugin/skills/demo/lib/language.ts';
import { type Language, LANGUAGES } from '../core/locale';
import { AGENT_DEFAULTS, AGENT_EFFORTS, AGENT_MODELS, AGENT_ROLES, type AgentRole, type AgentSetting, type AgentsView, type LanguageView, type RemoteSetting, type Theme, THEMES, type ThemeView } from '../core/types';
import { defaultPushKey, parsePushKey } from '../core/push-key';
import { BadRequest } from './board';

interface Settings {
  /** The interface's: Obeya's own words. */
  language?: Language;
  /** The agents' to the owner until the owner's words say otherwise; absent, the interface's. */
  conversationLanguage?: Language;
  /** Light or dark; absent follows the system. */
  theme?: Theme;
  /** Only what differs from `AGENT_DEFAULTS`, so a changed default reaches what the owner left. */
  agents?: Partial<Record<AgentRole, Partial<AgentSetting>>>;
  /** The push-to-talk key anywhere on the machine, when not the default. */
  pushKey?: string;
  /** How other devices reach Obeya; absent, they do not. */
  remote?: RemoteSetting;
}

function read(home: string): Settings {
  try {
    const o = JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8')) as Record<string, unknown>;
    const language = LANGUAGES.find((l) => l === o.language);
    const conversationLanguage = LANGUAGES.find((l) => l === o.conversationLanguage);
    const theme = THEMES.find((x) => x === o.theme);
    const pushKey = parsePushKey(o.pushKey) ?? undefined;
    return { ...o, language, conversationLanguage, theme, agents: agentsOf(o.agents), pushKey, remote: remoteOf(o.remote) ?? undefined };
  } catch {
    return {};
  }
}

export function languageView(home: string, system = systemLanguage()): LanguageView {
  const chosen = chosenLanguage(home) ?? null;
  const language = chosen ?? system;
  const conversationChosen = chosenConversationLanguage(home) ?? null;
  return { file: join(home, SETTINGS_FILE), chosen, system, language, conversationChosen, conversation: conversationChosen ?? language };
}

/** The interface language that applies: the owner's choice, else the system's. */
export const ownerLanguage = ownerLanguageIn;

/** The conversation language that applies: the owner's choice, else the interface language. */
export const conversationLanguage = conversationLanguageIn;

/**
 * Saves the owner's choice of the interface language (`language`) or the conversation language
 * (`conversation`), whichever the input names; `null` follows the system, or the interface, again.
 * Other settings in the file stay.
 */
export function saveLanguage(home: string, input: unknown): LanguageView {
  const given = (input && typeof input === 'object' ? input : {}) as { language?: unknown; conversation?: unknown };
  const valid = (v: unknown) => v === null || LANGUAGES.some((l) => l === v);
  if (!('language' in given) && !('conversation' in given)) throw new BadRequest('invalid', 'name language or conversation');
  for (const key of ['language', 'conversation'] as const)
    if (key in given && !valid(given[key])) throw new BadRequest('invalid', `${key} must be one of ${LANGUAGES.join(', ')} or null`);
  if ('language' in given) save(home, 'language', given.language as Language | null, `language ${given.language ?? 'of the system'}`);
  if ('conversation' in given) save(home, 'conversationLanguage', given.conversation as Language | null, `conversation language ${given.conversation ?? 'of the interface'}`);
  return languageView(home);
}

export const themeView = (home: string): ThemeView => ({ file: join(home, SETTINGS_FILE), chosen: read(home).theme ?? null });

/** Saves light or dark; `null` follows the system again. Other settings in the file stay. */
export function saveTheme(home: string, input: unknown): ThemeView {
  const theme = (input as { theme?: unknown } | null)?.theme;
  if (theme !== null && !THEMES.some((x) => x === theme)) throw new BadRequest('invalid', `theme must be one of ${THEMES.join(', ')} or null`);
  save(home, 'theme', theme as Theme | null, `${theme ?? "the system's"} look`);
  return themeView(home);
}

/** Saves one of the owner's choices, or with `null` takes it out; the other settings in the file stay. */
function save<K extends 'language' | 'conversationLanguage' | 'theme' | 'pushKey' | 'remote'>(home: string, key: K, value: Settings[K] | null, what: string) {
  write(home, { ...read(home), [key]: value ?? undefined });
  console.log(`Obeya: ${what} saved to ${join(home, SETTINGS_FILE)}`);
}

function write(home: string, settings: Settings) {
  const { agents, ...rest } = settings;
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, SETTINGS_FILE), `${JSON.stringify(agents && Object.keys(agents).length ? { ...rest, agents } : rest, null, 2)}\n`);
}

/** The known choices in a file's `agents` that differ from the defaults; anything else in it is left out. */
function agentsOf(input: unknown): Partial<Record<AgentRole, Partial<AgentSetting>>> {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, { model?: unknown; effort?: unknown } | undefined>;
  const agents: Partial<Record<AgentRole, Partial<AgentSetting>>> = {};
  for (const role of AGENT_ROLES) {
    const model = AGENT_MODELS.find((m) => m === o[role]?.model && m !== AGENT_DEFAULTS[role].model);
    const effort = AGENT_EFFORTS.find((e) => e === o[role]?.effort && e !== AGENT_DEFAULTS[role].effort);
    if (model || effort) agents[role] = { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
  }
  return agents;
}

/** The model and effort a group of agents runs with: the owner's choice, else the default; read whenever one starts. */
export const agentSetting = (home: string, role: AgentRole): AgentSetting => ({ ...AGENT_DEFAULTS[role], ...read(home).agents?.[role] });

export function agentsView(home: string): AgentsView {
  return { file: join(home, SETTINGS_FILE), agents: Object.fromEntries(AGENT_ROLES.map((r) => [r, agentSetting(home, r)])) as Record<AgentRole, AgentSetting> };
}

/** Saves the choices for the groups given (`{ worker: { model: 'opus' } }`). Other groups and settings in the file stay. */
export function saveAgents(home: string, input: unknown): AgentsView {
  const given = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const settings = read(home);
  const agents: Record<string, unknown> = { ...settings.agents };
  for (const [role, choice] of Object.entries(given)) {
    if (!AGENT_ROLES.some((r) => r === role)) throw new BadRequest('invalid', `agents are one of ${AGENT_ROLES.join(', ')}`);
    const { model, effort, ...other } = (choice && typeof choice === 'object' ? choice : {}) as Record<string, unknown>;
    if (Object.keys(other).length) throw new BadRequest('invalid', 'a choice has a model and an effort');
    if (model !== undefined && !AGENT_MODELS.some((m) => m === model)) throw new BadRequest('invalid', `model must be one of ${AGENT_MODELS.join(', ')}`);
    if (effort !== undefined && !AGENT_EFFORTS.some((e) => e === effort)) throw new BadRequest('invalid', `effort must be one of ${AGENT_EFFORTS.join(', ')}`);
    agents[role] = { ...agents[role]!, ...(model !== undefined ? { model } : {}), ...(effort !== undefined ? { effort } : {}) };
  }
  write(home, { ...settings, agents: agentsOf(agents) });
  console.log(`Obeya: models and effort of the agents saved to ${join(home, SETTINGS_FILE)}`);
  return agentsView(home);
}

/** The push-to-talk key anywhere on the machine: the owner's, else the platform's default. */
export function pushKeyChoice(home: string, platform: string = process.platform) {
  const chosen = read(home).pushKey ?? null;
  return { key: chosen ?? defaultPushKey(platform), chosen, default: defaultPushKey(platform) };
}

/** Saves the owner's key (`{ key }`); `null` takes the default again. Other settings in the file stay. */
export function savePushKey(home: string, input: unknown, platform: string = process.platform) {
  const given = (input as { key?: unknown } | null)?.key;
  const key = given === null ? null : parsePushKey(given);
  if (given !== null && !key) throw new BadRequest('invalid', 'key must be a key held alone (a modifier, an F key …) or modifiers and a key, such as Control+Shift+Space');
  save(home, 'pushKey', key !== defaultPushKey(platform) ? key : null, `push-to-talk key ${key ?? 'by default'}`);
  return pushKeyChoice(home, platform);
}

/** A setting for other devices as the file or the page gives it; `null` for none or one Obeya cannot use. */
export function remoteOf(input: unknown): RemoteSetting | null {
  const o = (input && typeof input === 'object' ? input : {}) as { via?: unknown; address?: unknown; awake?: unknown };
  const awake = o.awake === 'always' ? { awake: 'always' as const } : {};
  if (o.via === 'tailscale') return { via: 'tailscale', ...awake };
  if (o.via === 'address' && typeof o.address === 'string' && o.address.trim()) return { via: 'address', address: o.address.trim(), ...awake };
  return null;
}

/** How other devices reach Obeya, as the owner set it; `null`: they do not. */
export const remoteSetting = (home: string): RemoteSetting | null => read(home).remote ?? null;

/** Saves how other devices reach Obeya (`{ remote }`); `null` turns it off. Other settings in the file stay. */
export function saveRemote(home: string, input: unknown): RemoteSetting | null {
  const given = (input as { remote?: unknown } | null)?.remote;
  const remote = given === null ? null : remoteOf(given);
  if (given !== null && !remote) throw new BadRequest('invalid', 'remote must be null, { via: "tailscale" } or { via: "address", address }, each with an optional awake: "always"');
  save(home, 'remote', remote, `other devices ${remote ? `reach it ${remote.via === 'tailscale' ? 'through Tailscale' : `at ${remote.address}`}` : 'do not reach it'},`);
  return remote;
}
