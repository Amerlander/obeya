// What a repository's settings may hold (this machine's in the configuration, everyone's in its
// `.obeya/settings.json`), checked where they are read: a misspelt field (`check:` for `checks:`)
// or a wrong type would otherwise be ignored without a word, or break whatever reads it later. Each
// problem names its field; the field does not count, so Obeya's default stands for it, and the rest
// of the settings work.

import { z } from 'zod';
import type { SharedSettings } from '../core/types';

const strings = z.array(z.string());

const planDocs = z.object({ dir: z.string(), exclude: strings }).strict();
// what a site or a stack needs to be used (a title, a URL, commands) is checked where it is used
// (`siteProblem`, `usableStack`): the dialog saves one while the owner fills it in
const site = z
  .object({
    title: z.string(),
    url: z.string(),
    deploy: z.string(),
    env: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    maxFile: z.number().int().positive().optional(),
    language: z.enum(['de', 'en']).optional(),
  })
  .strict();
const demo = z.object({ howToRun: z.string().optional(), site: site.optional() }).strict();
const stack = z
  .object({
    start: z.string(),
    refresh: z.string().optional(),
    urls: z.object({ file: z.string(), frontendKey: z.string() }).strict().optional(),
    stop: z.string().optional(),
    keep: z.string().optional(),
  })
  .strict();

/** What a repository's settings for this machine may hold (`RepoSettings`): how it works, and its main branch. */
export const settingsShape = z
  .object({
    branch: z.string().optional(),
    land: z.enum(['main', 'pr']).optional(),
    direct: z.boolean().optional(),
    checks: strings.optional(),
    setup: z.string().optional(),
    planDocs: planDocs.optional(),
    softPaths: strings.optional(),
    workspaces: z.enum(['clones', 'worktrees']).optional(),
    prNoise: strings.optional(),
    stack: stack.optional(),
    demo: demo.optional(),
  })
  .strict();

/**
 * What a repository's `.obeya/settings.json` may hold (`SharedSettings`): the settings for this
 * machine but the main branch, which says where the file is read from.
 */
export const sharedShape = settingsShape.omit({ branch: true });

// the fields each object knows, for a guess at what a misspelt one meant
const KNOWN: Record<string, string[]> = {
  '': Object.keys(sharedShape.shape),
  planDocs: Object.keys(planDocs.shape),
  demo: Object.keys(demo.shape),
  'demo.site': Object.keys(site.shape),
  stack: Object.keys(stack.shape),
  'stack.urls': ['file', 'frontendKey'],
};

/**
 * Checks what a repository's `.obeya/settings.json` holds, the same way: the settings without the
 * fields that are wrong, and one line per problem.
 */
export function checkShared(made: Record<string, unknown>): { settings: SharedSettings; problems: string[] } {
  const { kept, problems } = checkFields(sharedShape, made, KNOWN);
  // the main branch says where the file is read from, so it is set on each machine
  return { settings: kept as SharedSettings, problems: problems.map((p) => (p.startsWith('branch: ') ? 'branch: the main branch is set on each machine (or detected), not in the repository' : p)) };
}

/** `made` without the top-level fields `shape` refuses, and a line for each problem; `known` names the fields of each object, for a guess at a misspelt one. */
function checkFields(shape: z.ZodType, made: Record<string, unknown>, known: Record<string, string[]>): { kept: Record<string, unknown>; problems: string[] } {
  const parsed = shape.safeParse(made);
  if (parsed.success) return { kept: made, problems: [] };
  const kept: Record<string, unknown> = { ...made };
  const problems: string[] = [];
  for (const issue of parsed.error.issues) {
    const at = issue.path.join('.');
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        const guess = closest(key, known[at] ?? []);
        problems.push(`${at ? `${at}.` : ''}${key}: no such field${guess ? ` (did you mean ${guess}?)` : ''}`);
        // a field misspelt inside one takes the whole top-level field along, as a wrong type does below
        delete kept[at ? String(issue.path[0]) : key];
      }
      continue;
    }
    const missing = issue.code === 'invalid_type' && issue.message.endsWith('received undefined');
    problems.push(`${at}: ${missing ? 'missing' : issue.message.replace(/^Invalid (input|option): /, '')}`);
    // the whole top-level field goes: half a `demo` or `planDocs` would be worse than the default
    delete kept[String(issue.path[0])];
  }
  return { kept, problems };
}

/** The known field a misspelt one most likely meant: the same ignoring case, the start of it, or at most two edits away. */
function closest(key: string, known: string[]): string | undefined {
  let best: { name: string; d: number } | undefined;
  for (const name of known) {
    const [a, b] = [key.toLowerCase(), name.toLowerCase()];
    const d = a === b ? 0 : a.length >= 4 && b.startsWith(a) ? 1 : distance(a, b);
    if (d <= 2 && (!best || d < best.d)) best = { name, d };
  }
  return best?.name;
}

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next.push(Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    row = next;
  }
  return row[b.length]!;
}
