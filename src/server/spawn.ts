// A program run on this machine and waited for, with what it printed.

/**
 * Whether a process Obeya starts and ends itself goes into a process group of its own (POSIX):
 * Ctrl-C in the terminal goes to the whole foreground group. It reached every agent in the middle
 * of its turn, and what each ran, while Obeya meant to wait for them to pause; a sidecar it reached
 * died with a traceback. Out of that group, Ctrl-C reaches Obeya alone, which ends them itself. Not
 * on Windows, where a detached process has no console and every console program it starts opens a
 * window.
 */
export const OWN_GROUP = process.platform !== 'win32';

type Options = Omit<Bun.SpawnOptions.SpawnOptions<Bun.SpawnOptions.Writable, 'pipe', 'pipe'>, 'stdout' | 'stderr'>;

/** Runs `argv` and waits for it: its exit code, its output, and the signal that stopped it (a timeout), if one did. */
export async function spawnOutput(argv: string[], o: Options = {}): Promise<{ code: number; stdout: string; stderr: string; signal: string | null }> {
  const p = Bun.spawn<Bun.SpawnOptions.Writable, 'pipe', 'pipe'>(argv, { ...o, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, stdout, stderr, signal: p.signalCode };
}
