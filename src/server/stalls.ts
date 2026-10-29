// Stalls: moments Obeya's server did nothing else (a synchronous git call, a long computation), so
// that no page got an answer meanwhile, and moments a page froze; each goes into the server's log
// and into `stalls.log` in the home, with where the time went (design: Running Obeya, Stalls).

import * as jsc from 'bun:jsc';
import { appendFileSync, renameSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { PageStall } from '../core/types';

/** A stall from this long on is logged: a pause of half a second is one the owner notices. */
export const STALL_MS = 500;
/** How often the server looks whether it was held up. */
const TICK_MS = 100;
/** A process the server waited for this long is named in the stall it falls into. */
const SLOW_PROCESS_MS = 50;
/** The places a stall names: the few where most of its time went. */
const PLACES = 3;
/** Frames of Obeya's own code a place names, innermost first. */
const FRAMES = 4;
/** `stalls.log` grows to this size, then starts afresh beside the one before (`stalls.previous.log`). */
const KEPT_BYTES = 1_000_000;
/** Below this share of the stall covered by samples, the thread did not run: the machine slept, or the process was suspended. */
const RAN_SHARE = 0.25;
/** How often the profiler samples the thread's stack, in microseconds: 250 samples in the shortest stall logged. */
const SAMPLE_US = 2000;
/** JavaScriptCore's line and column of a frame it knows no source position of. */
const NO_POSITION = 4294967295;

export const STALLS_FILE = 'stalls.log';

/** A stack the sampling profiler took, innermost frame first. */
export interface Trace {
  timestamp: number;
  frames: { name: string; sourceURL?: string | null; line: number; column: number }[];
}

/** A process run synchronously, and how long the server waited for it. */
export interface Waited {
  argv: string[];
  ms: number;
}

/** A frame of code, as a place names it: the function and where it is. */
function frame(f: Trace['frames'][number]): string {
  const name = f.name || '(anonymous)';
  return f.sourceURL && f.line !== NO_POSITION ? `${name} (${basename(f.sourceURL)}:${f.line})` : name;
}

/** Where a sample was: the runtime's own function it was in (`spawnSync`, `stringify`), then the code that called it. */
export function placeOf(t: Trace): string {
  if (!t.frames.length) return '(no JavaScript: garbage collection or the runtime itself)';
  const native = t.frames[0]!.sourceURL ? null : t.frames[0]!.name;
  // the timing of synchronous processes below is not where the time went
  const sourced = t.frames.filter((f) => f.sourceURL && f.sourceURL !== import.meta.path);
  // Obeya's own code says more than a library's; a stall entirely inside one names the library's
  const own = sourced.filter((f) => !f.sourceURL!.includes('/node_modules/'));
  const shown = (own.length ? own : sourced).slice(0, FRAMES).map(frame);
  return [...(native ? [native] : []), ...shown].join(' ← ') || native || '(unknown)';
}

/** A command as the log shows it: the program by its name, not its path, and long ones shortened. */
function command(argv: string[]): string {
  const [program = '', ...args] = argv;
  const text = [basename(program), ...args].join(' ');
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * The lines a server stall of `ms` gets: where the samples taken meanwhile were, by share, and the
 * processes it waited for. Null where the samples cover too little of it to have run at all;
 * `traces` null where there is no profiler to ask.
 */
export function describeStall(ms: number, traces: Trace[] | null, waited: Waited[], intervalMs = 1): string[] | null {
  if (traces && traces.length * intervalMs < ms * RAN_SHARE) return null;
  const counts = new Map<string, number>();
  for (const t of traces ?? []) {
    const p = placeOf(t);
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const places = [...counts].sort((a, b) => b[1] - a[1]).slice(0, PLACES);
  return [
    `Obeya: the server stalled for ${seconds(ms)}; meanwhile it answered no page and heard no agent`,
    ...places.map(([p, n]) => `  ${String(Math.round((100 * n) / traces!.length)).padStart(3)}% ${p}`),
    ...waited.map((w) => `  waited ${seconds(w.ms)} for: ${command(w.argv)}`),
  ];
}

/** The lines a page's stall gets. */
export function describePageStall(s: PageStall, where: string): string[] {
  return [
    `Obeya: a page (${where}) stalled for ${seconds(s.ms)}; meanwhile it took no click or key`,
    ...s.scripts.map((x) => `  ${seconds(x.ms)} ${x.what}`),
    ...(s.before.length ? [`  before it: ${s.before.join('; ')}`] : []),
  ];
}

/** What a page sent of its stall, if it is one: the server takes nothing else from it, and no more than it logs. */
export function pageStall(msg: unknown): PageStall | null {
  const m = msg as Partial<PageStall> | null;
  if (!m || typeof m.ms !== 'number' || !(m.ms >= STALL_MS) || m.ms > 3600_000) return null;
  const text = (s: unknown) => (typeof s === 'string' ? s.slice(0, 200) : '');
  const scripts = (Array.isArray(m.scripts) ? m.scripts : []).slice(0, PLACES).flatMap((x) => (x && typeof x.ms === 'number' && text(x.what) ? [{ ms: x.ms, what: text(x.what) }] : []));
  const before = (Array.isArray(m.before) ? m.before : []).slice(-8).map(text).filter(Boolean);
  return { ms: m.ms, scripts, before };
}

export interface StallOptions {
  /** Obeya's home, where `stalls.log` is kept. */
  home: string;
  /** The server's log. */
  log?: (line: string) => void;
}

/**
 * Watches the server's thread for stalls and logs them. The JavaScript engine's sampling profiler
 * samples the thread's stack on a thread of its own, also while the thread waits in a synchronous
 * call, so the samples taken during a stall say where it went; the processes run synchronously are
 * timed by their command.
 */
export class Stalls {
  private timer: ReturnType<typeof setInterval> | undefined;
  private last = 0;
  private waited: (Waited & { end: number })[] = [];
  private spawnSync: typeof Bun.spawnSync | undefined;

  constructor(private readonly o: StallOptions) {}

  start(): this {
    jsc.startSamplingProfiler(undefined, SAMPLE_US);
    this.drain();
    const spawnSync = (this.spawnSync = Bun.spawnSync);
    const waited = this.waited;
    Bun.spawnSync = ((...args: Parameters<typeof Bun.spawnSync>) => {
      const start = performance.now();
      try {
        return spawnSync(...args);
      } finally {
        const end = performance.now();
        const first = args[0] as string[] | { cmd: string[] };
        if (end - start >= SLOW_PROCESS_MS) waited.push({ argv: Array.isArray(first) ? first : first.cmd, ms: end - start, end });
      }
    }) as typeof Bun.spawnSync;
    this.last = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
    return this;
  }

  stop() {
    clearInterval(this.timer);
    if (this.spawnSync) Bun.spawnSync = this.spawnSync;
  }

  /** A page's stall, from the page on `where` (this machine, or a paired device). */
  page(s: PageStall, where: string) {
    this.write(describePageStall(s, where));
  }

  /**
   * The samples taken since the last look; the profiler hands each out once. Bun's types leave the
   * call out: a Bun without it gets stalls logged by their length alone.
   */
  private drain(): { traces: Trace[]; intervalMs: number } | null {
    const take = (jsc as unknown as { samplingProfilerStackTraces?: () => { traces: Trace[]; interval: number } }).samplingProfilerStackTraces;
    if (!take) return null;
    const { traces, interval } = take();
    return { traces, intervalMs: interval * 1000 };
  }

  private tick() {
    const now = performance.now();
    const ms = now - this.last - TICK_MS;
    const since = this.last;
    this.last = now;
    const samples = this.drain();
    const waited = this.waited.splice(0).filter((w) => w.end >= since);
    if (ms < STALL_MS) return;
    const lines = describeStall(ms, samples?.traces ?? null, waited, samples?.intervalMs);
    if (lines) this.write(lines);
  }

  private write(lines: string[]) {
    const log = this.o.log ?? ((line: string) => console.log(line));
    for (const line of lines) log(line);
    const file = join(this.o.home, STALLS_FILE);
    try {
      if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > KEPT_BYTES) renameSync(file, join(this.o.home, 'stalls.previous.log'));
      appendFileSync(file, `${new Date().toISOString()}\n${lines.join('\n')}\n\n`);
    } catch {}
  }
}
