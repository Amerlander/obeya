// A page that froze tells the server, which logs it beside its own stalls (design: Running Obeya,
// Stalls): how long, where the time went as far as the browser says (Chromium's long animation
// frames; Safari and Firefox tell only the length), and the server's messages it took in just before.

import type { PageStall } from '../core/types';

/** As the server's: a pause of half a second is one the owner notices. */
const STALL_MS = 500;
const TICK_MS = 100;
/** What the page did this long before a stall still counts as before it. */
const BEFORE_MS = 3000;
/** Without long animation frames to tell a freeze from a machine that slept, a pause this long is taken for sleep. */
const SLEPT_MS = 60_000;
const KEPT = 8;
/** Parts of a stall shorter than this say nothing of it. */
const PART_MS = 50;
/** The browser tells of a long frame shortly after it, not at once. */
const REPORTED_MS = 1000;

/** A long animation frame, as far as the page uses it (`PerformanceLongAnimationFrameTiming`). */
export interface LongFrame {
  startTime: number;
  duration: number;
  styleAndLayoutStart: number;
  scripts: { invoker: string; sourceURL: string; sourceFunctionName: string; sourceCharPosition: number; duration: number }[];
}

/** Something the page took in: a server message by its type and size. */
export interface Noted {
  at: number;
  what: string;
}

/** The long frames between `from` and `to`. */
export const framesWithin = (frames: LongFrame[], from: number, to: number) => frames.filter((f) => f.startTime + f.duration >= from && f.startTime <= to);

/** Where the time of these long frames went: their scripts and their style and layout, longest first. */
export function scriptsOf(frames: LongFrame[]): PageStall['scripts'] {
  const ms = new Map<string, number>();
  const add = (what: string, d: number) => d > 0 && ms.set(what, (ms.get(what) ?? 0) + d);
  for (const f of frames) {
    for (const s of f.scripts) {
      const file = s.sourceURL.split(/[?#]/)[0]!.split('/').pop();
      const at = file ? ` (${file}${s.sourceCharPosition >= 0 ? `@${s.sourceCharPosition}` : ''})` : '';
      add(`${s.invoker}: ${s.sourceFunctionName || '(anonymous)'}${at}`, s.duration);
    }
    if (f.styleAndLayoutStart > 0) add('style and layout', f.startTime + f.duration - f.styleAndLayoutStart);
  }
  return [...ms]
    .filter(([, d]) => d >= PART_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([what, d]) => ({ what, ms: Math.round(d) }));
}

/**
 * What the page took in shortly before a stall from `from` to `to`, as the log reads it; a message
 * whose handling began the stall is in it too (its reading time says so).
 */
export function beforeOf(noted: Noted[], from: number, to: number): string[] {
  return noted
    .filter((n) => n.at >= from - BEFORE_MS && n.at <= to)
    .map((n) => `${n.what} ${(Math.max(0, from - n.at) / 1000).toFixed(1)} s before`);
}

const noted: Noted[] = [];

/** A server message the page began to handle at `at`: `bytes` long, read and handled in `ms`. */
export function noteMessage(type: string, bytes: number, at: number, ms: number) {
  const size = bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : '';
  const took = ms >= 10 ? `read in ${Math.round(ms)} ms` : '';
  noted.push({ at, what: size || took ? `${type} (${[size, took].filter(Boolean).join(', ')})` : type });
  if (noted.length > KEPT) noted.shift();
}

/** Watches this page for stalls; `send` passes one on to the server, and says whether it could. */
export function watchPageStalls(send: (s: PageStall) => boolean) {
  const frames: LongFrame[] = [];
  const supported = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame');
  if (supported)
    new PerformanceObserver((list) => {
      frames.push(...(list.getEntries() as unknown as LongFrame[]));
      const old = performance.now() - SLEPT_MS;
      while (frames.length && frames[0]!.startTime < old) frames.shift();
    }).observe({ type: 'long-animation-frame', buffered: true });
  // stalls the browser may not have told the long frames of yet, and those the server has not heard
  // of yet: one during a reconnect goes out once the page is connected again
  const found: { from: number; to: number; before: string[] }[] = [];
  const unsent: PageStall[] = [];
  let last = performance.now();
  let visible = document.visibilityState === 'visible';
  setInterval(() => {
    const now = performance.now();
    const from = last;
    const seen = visible && document.visibilityState === 'visible';
    last = now;
    visible = document.visibilityState === 'visible';
    // the browser holds a page out of view back by itself, and a machine asleep runs nothing at all
    if (now - from - TICK_MS >= STALL_MS && seen) found.push({ from, to: now, before: beforeOf(noted, from, now) });
    while (found.length && (!supported || now - found[0]!.to >= REPORTED_MS)) {
      const f = found.shift()!;
      const ms = f.to - f.from - TICK_MS;
      const long = supported ? framesWithin(frames, f.from, f.to) : [];
      // the ticks see a stall up to one tick short; the long frames tell its length to the millisecond
      const length = Math.max(ms, long.reduce((sum, l) => sum + l.duration, 0));
      if (supported ? long.length : ms < SLEPT_MS) unsent.push({ ms: Math.round(length), scripts: scriptsOf(long), before: f.before });
    }
    while (unsent.length > KEPT) unsent.shift();
    while (unsent.length && send(unsent[0]!)) unsent.shift();
  }, TICK_MS);
}
