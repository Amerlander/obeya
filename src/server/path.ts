// The PATH the programs Obeya checks and starts are looked up on: what a process started from the
// desktop may lack, and on Windows what an installer added since Obeya started (an installation
// Obeya ran, or one the owner ran by hand), which only a new process would get from the registry.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { output } from '../../plugin/skills/demo/lib/setup.ts';

type Env = Record<string, string | undefined>;

/** Where the official installers of Claude Code and uv put their programs. */
export const localBin = () => join(homedir(), '.local', 'bin');

/**
 * Puts the directories on the PATH that the programs Obeya checks and starts are installed in but
 * a process started from the desktop may lack: the official installers' `~/.local/bin`, and
 * Homebrew's on a Mac.
 */
export function extendPath(env: Env = process.env, platform: string = process.platform) {
  const dirs = [localBin(), ...(platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : [])];
  const parts = (env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const d of dirs) if (existsSync(d) && !parts.includes(d)) parts.push(d);
  env.PATH = parts.join(delimiter);
}

/** On Windows, what installers added to the user's and the machine's PATH since Obeya started. */
async function windowsPath(env: Env) {
  const out = await output('powershell', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"], env);
  if (!out) return;
  const parts = (env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const d of out.trim().split(';')) if (d && !parts.includes(d)) parts.push(d);
  env.PATH = parts.join(delimiter);
}

/** The reading of the registry under way, which a check that starts meanwhile waits for too. */
const reading = new WeakMap<Env, Promise<void>>();

/** On Windows, the PATH as the registry has it now: before every check, so what was installed meanwhile, by Obeya or by hand, is found. */
export function freshPath(env: Env = process.env, platform: string = process.platform): Promise<void> {
  if (platform !== 'win32') return Promise.resolve();
  let read = reading.get(env);
  if (!read) {
    read = windowsPath(env).finally(() => reading.delete(env));
    reading.set(env, read);
  }
  return read;
}
