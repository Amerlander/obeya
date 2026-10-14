// gh on this checkout's GitHub repository (its `origin`) as the account that owns it, whichever
// account gh has active on this machine: changes to the repository (running a workflow, rerunning
// a job) need the owner's rights, and another active account gets "HTTP 403: Must have admin
// rights to Repository". In a fork, that is the fork and its owner.
//
//   bun scripts/gh.ts <gh args…>
//       e.g. `bun scripts/gh.ts workflow run build.yml --ref main -f sign=true`,
//       `bun scripts/gh.ts run rerun <id> --failed`
//
// It runs gh with GH_REPO=<owner>/<name> of `origin`, which every gh command takes as its
// repository unless its args name another (`--repo`, a repository or a URL); unlike `--repo` it
// also reaches `gh api` (`repos/{owner}/{repo}/…`). When gh has a login for the owner, its token
// goes to gh as GH_TOKEN, without switching the active account; else (an organisation, say) gh
// runs as it would anyway. Standard input, output, error and the exit code pass through.
// scripts/release-status.ts and scripts/hero-video/publish.ts take their environment from here too.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/** The checkout this script lies in. */
export const CHECKOUT = path.join(import.meta.dirname, '..');

/** `owner/name` of a GitHub remote URL (https, ssh or scp-like), or null for any other. */
export function githubRepo(url: string): string | null {
  const m = /^(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** gh's environment for the GitHub repository of the checkout at `cwd`; throws when its origin is none. */
export function ghEnv(cwd = CHECKOUT): { repo: string; env: NodeJS.ProcessEnv } {
  const origin = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' });
  const repo = origin.status === 0 ? githubRepo(origin.stdout) : null;
  if (!repo) throw new Error(`the origin of ${cwd} is no GitHub repository, which gh would run on: ${(origin.status === 0 ? origin.stdout : origin.stderr).trim()}`);
  const owner = repo.split('/')[0]!;
  // without GH_TOKEN, which gh would hand back instead of the account's own token
  const { GH_TOKEN: _, GITHUB_TOKEN: __, ...plain } = process.env;
  const r = spawnSync('gh', ['auth', 'token', '--user', owner], { encoding: 'utf8', env: plain });
  const token = r.status === 0 ? r.stdout.trim() : '';
  return { repo, env: token ? { ...plain, GH_TOKEN: token, GH_REPO: repo } : { ...process.env, GH_REPO: repo } };
}

if (import.meta.main) {
  let env: NodeJS.ProcessEnv;
  try {
    env = ghEnv().env;
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  const r = spawnSync('gh', process.argv.slice(2), { stdio: 'inherit', env });
  if (r.error) console.error(`gh: ${r.error.message}`);
  process.exit(r.status ?? 1);
}
