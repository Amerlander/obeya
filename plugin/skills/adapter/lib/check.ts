// Checks the adapter of the repository in the working directory as it stands in the checkout
// (`.obeya/adapter/index.ts` and `.obeya/settings.json`, committed or not), the way Obeya will
// load them once they are on the default branch: the module loads, every field of either is known
// and of the right type, the share command's or the site's deploy program is there (the problems
// the configuration sheet reports). Prints what Obeya makes of them, the docs in the plan directory
// among it: which are projects and which are not, and why; exits with 1 when something is wrong.
// Run with Bun (`bun check.ts [<module>]`), since it loads the adapter as Obeya does.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { genericFor, loadAdapter, parseShared, REPO_ADAPTER_DIR, REPO_SETTINGS_FILE, withSettings } from '../../../../src/adapters/index.ts';
import { allTicked, type NotAProject } from '../../../../src/core/plan-doc.ts';
import { readPlanDocs, repoInfo } from '../../../../src/server/repo.ts';
import { adapterRepoProblems } from '../../../../src/server/share.ts';

const repo = repoInfo(process.cwd());
const file = resolve(process.argv[2] ?? join(repo.path, REPO_ADAPTER_DIR, 'index.ts'));
const settingsFile = join(repo.path, REPO_SETTINGS_FILE);
if (!existsSync(file) && !existsSync(settingsFile)) {
  console.log(`Neither ${file} nor ${settingsFile}: write the repository's settings (and its adapter, for what is code) first.`);
  process.exit(1);
}
let own;
try {
  own = existsSync(file) ? loadAdapter(file, repo) : genericFor(repo);
} catch (e) {
  console.log(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
// the settings for everyone go before the module's values, as in Obeya
const shared = existsSync(settingsFile) ? parseShared(readFileSync(settingsFile, 'utf8')) : { problems: [] };
const adapter = withSettings(own, () => shared.settings);
const problems = [...adapterRepoProblems(own, repo.path), ...shared.problems];

let canvas: string;
try {
  canvas = `${adapter.canvasName(repo)} (id ${adapter.canvasId(repo)})`;
} catch (e) {
  canvas = `canvasId/canvasName throw: ${e instanceof Error ? e.message : String(e)}`;
  problems.push(canvas);
}
const site = adapter.demo?.site;
const plans = readPlanDocs(repo.path, adapter);
const why: Record<NotAProject, string> = { noWorkstreams: 'no `## Workstreams` section', noChecklist: 'no checklist under `## Workstreams`' };
const name = (file: string) => file.slice(file.lastIndexOf('/') + 1);
const planLines = !existsSync(join(repo.path, adapter.planDocs.dir))
  ? [`plan docs: ${adapter.planDocs.dir}/ does not exist yet; the first plan doc ("Als Projekt planen" on an idea or task card) creates it`]
  : [
      `plan docs in ${adapter.planDocs.dir}/: ${plans.docs.length} ${plans.docs.length === 1 ? 'is a project' : 'are projects'}${plans.docs.length ? ` (${plans.docs.map((d) => `${name(d.file)}${allTicked(d) ? ', done: archived' : ''}`).join('; ')})` : ''}, ${plans.others.length} ${plans.others.length === 1 ? 'is not' : 'are not'}`,
      ...plans.others.map((o) => `- ${name(o.file)}: ${why[o.reason]}`),
    ];
const show = (v: unknown) => (v === undefined ? '(none)' : JSON.stringify(v));
console.log(
  [
    `adapter ${adapter.name}, from ${existsSync(file) ? file : 'Obeya (no module of its own)'}`,
    ...(shared.settings ? [`settings from ${settingsFile}: ${Object.keys(shared.settings).join(', ') || '(none)'}`] : []),
    `canvas: ${canvas}`,
    `setup: ${show(adapter.setup)}`,
    `checks: ${show(adapter.checks)}`,
    `land: ${adapter.land}${adapter.direct ? ' (direct allowed)' : ''}, workspaces: ${adapter.workspaces}`,
    `planDocs: ${show(adapter.planDocs)}, softPaths: ${show(adapter.softPaths)}`,
    ...planLines,
    `demo: share ${show(adapter.demo?.share)}${site ? `; site ${site.title} at ${site.url}, deploy ${show(site.deploy)}` : ''}\nhowToRun: ${adapter.demo?.howToRun || '(none: each worker finds out from the repository how to run the app)'}`,
    ...(adapter.prNoise ? [`prNoise: ${show(adapter.prNoise)}`] : []),
    ...(adapter.stack ? [`stack: ${show(adapter.stack)}`] : []),
  ].join('\n'),
);
if (problems.length) {
  console.log(`\nProblems (a field that is unknown or of the wrong type does not count: the generic adapter's value stands in its place):\n${problems.map((p) => `- ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('\nNo problems.');
