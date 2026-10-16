// Obeya's own settings, in `settings.json` under its home beside `canvases.json` and `demo.json`:
// the language Obeya speaks to the owner, light or dark, the model and effort of each group of
// agents, the key that records a command from anywhere on the machine (heard by the app's shell),
// and how other devices reach Obeya (remote.ts). The owner chooses them in the settings sheet;
// until then the system's language and look apply, the agents run as `AGENT_DEFAULTS` says, and
// no other device reaches Obeya. Saving restarts nothing: the page loads again in the new
// language, takes the new look at once, and the server reads the file whenever it needs the
// language or starts an agent.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OWNER_SETTINGS_FILE, systemLanguage } from '../../plugin/skills/demo/lib/language.ts';
import { type Language, LANGUAGES } from '../core/locale';
import { AGENT_DEFAULTS, AGENT_EFFORTS, AGENT_MODELS, AGENT_ROLES, type AgentRole, type AgentSetting, type AgentsView, type LanguageView, type RemoteSetting, type Theme, THEMES, type ThemeView } from '../core/types';
import { defaultPushKey, parsePushKey } from '../core/push-key';
import { BadRequest } from './board';

export { systemLanguage };

export const SETTINGS_FILE = OWNER_SETTINGS_FILE;

interface Settings {
  language?: Language;
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
    const theme = THEMES.find((x) => x === o.theme);
    const pushKey = parsePushKey(o.pushKey) ?? undefined;
    return { ...o, ...(language ? { language } : { language: undefined }), theme, agents: agentsOf(o.agents), pushKey, remote: remoteOf(o.remote) ?? undefined };
  } catch {
    return {};
  }
}

export function languageView(home: string, system = systemLanguage()): LanguageView {
  const chosen = read(home).language ?? null;
  return { file: join(home, SETTINGS_FILE), chosen, system, language: chosen ?? system };
}

/** The language that applies: the owner's choice, else the system's. */
export const ownerLanguage = (home: string) => languageView(home).language;

/** Saves the owner's choice; `null` follows the system again. Other settings in the file stay. */
export function saveLanguage(home: string, input: unknown): LanguageView {
  const language = (input as { language?: unknown } | null)?.language;
  if (language !== null && !LANGUAGES.some((l) => l === language)) throw new BadRequest('invalid', `language must be one of ${LANGUAGES.join(', ')} or null`);
  const { language: _, ...rest } = existsSync(join(home, SETTINGS_FILE)) ? read(home) : {};
  write(home, language ? { ...rest, language: language as Language } : rest);
  console.log(`Obeya: language ${language ?? 'of the system'} saved to ${join(home, SETTINGS_FILE)}`);
  return languageView(home);
}

export const themeView = (home: string): ThemeView => ({ file: join(home, SETTINGS_FILE), chosen: read(home).theme ?? null });

/** Saves light or dark; `null` follows the system again. Other settings in the file stay. */
export function saveTheme(home: string, input: unknown): ThemeView {
  const theme = (input as { theme?: unknown } | null)?.theme;
  if (theme !== null && !THEMES.some((x) => x === theme)) throw new BadRequest('invalid', `theme must be one of ${THEMES.join(', ')} or null`);
  const { theme: _, ...rest } = existsSync(join(home, SETTINGS_FILE)) ? read(home) : {};
  write(home, theme ? { ...rest, theme: theme as Theme } : rest);
  console.log(`Obeya: ${theme ?? 'the system\'s'} look saved to ${join(home, SETTINGS_FILE)}`);
  return themeView(home);
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
  const settings = existsSync(join(home, SETTINGS_FILE)) ? read(home) : {};
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
  const { pushKey: _, ...rest } = existsSync(join(home, SETTINGS_FILE)) ? read(home) : {};
  write(home, key && key !== defaultPushKey(platform) ? { ...rest, pushKey: key } : rest);
  console.log(`Obeya: push-to-talk key ${key ?? 'by default'} saved to ${join(home, SETTINGS_FILE)}`);
  return pushKeyChoice(home, platform);
}

/** A setting for other devices as the file or the page gives it; `null` for none or one Obeya cannot use. */
export function remoteOf(input: unknown): RemoteSetting | null {
  const o = (input && typeof input === 'object' ? input : {}) as { via?: unknown; address?: unknown };
  if (o.via === 'tailscale') return { via: 'tailscale' };
  if (o.via === 'address' && typeof o.address === 'string' && o.address.trim()) return { via: 'address', address: o.address.trim() };
  return null;
}

/** How other devices reach Obeya, as the owner set it; `null`: they do not. */
export const remoteSetting = (home: string): RemoteSetting | null => read(home).remote ?? null;

/** Saves how other devices reach Obeya (`{ remote }`); `null` turns it off. Other settings in the file stay. */
export function saveRemote(home: string, input: unknown): RemoteSetting | null {
  const given = (input as { remote?: unknown } | null)?.remote;
  const remote = given === null ? null : remoteOf(given);
  if (given !== null && !remote) throw new BadRequest('invalid', 'remote must be null, { via: "tailscale" } or { via: "address", address }');
  const { remote: _, ...rest } = existsSync(join(home, SETTINGS_FILE)) ? read(home) : {};
  write(home, remote ? { ...rest, remote } : rest);
  console.log(`Obeya: other devices ${remote ? `reach it ${remote.via === 'tailscale' ? 'through Tailscale' : `at ${remote.address}`}` : 'do not reach it'}, saved to ${join(home, SETTINGS_FILE)}`);
  return remote;
}
