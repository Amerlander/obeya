// gh as the GitHub account `sadilek` on sadilek/obeya, whichever account gh has active on this
// machine: changes to the repository (running a workflow, rerunning a job) need its admin rights,
// and another active account gets "HTTP 403: Must have admin rights to Repository".
//
//   bun scripts/gh.ts <gh args…>
//       e.g. `bun scripts/gh.ts workflow run build.yml --ref main -f sign=true`,
//       `bun scripts/gh.ts run rerun <id> --failed`
//
// It runs gh with the token of the `sadilek` login as GH_TOKEN, without switching the active
// account, and with GH_REPO=sadilek/obeya, which every gh command takes as its repository unless
// its args name another (`--repo`, a repository or a URL); unlike `--repo` it also reaches `gh api`
// (`repos/{owner}/{repo}/…`). Standard input, output, error and the exit code pass through.
// scripts/release-status.ts and scripts/hero-video/publish.ts take their environment from here too.
import { spawnSync } from 'node:child_process';

export const REPO = 'sadilek/obeya';
export const ACCOUNT = 'sadilek';

/** The environment for gh as `sadilek` on sadilek/obeya; throws without a gh login for `sadilek`. */
export function ghEnv(): NodeJS.ProcessEnv {
  // without GH_TOKEN, which gh would hand back instead of the account's own token
  const { GH_TOKEN: _, GITHUB_TOKEN: __, ...plain } = process.env;
  const r = spawnSync('gh', ['auth', 'token', '--user', ACCOUNT], { encoding: 'utf8', env: plain });
  const token = r.status === 0 ? r.stdout.trim() : '';
  if (!token) throw new Error(`no gh login for ${ACCOUNT}: gh auth login, then try again\n${r.stderr ?? r.error?.message ?? ''}`.trim());
  return { ...plain, GH_TOKEN: token, GH_REPO: REPO };
}

if (import.meta.main) {
  let env: NodeJS.ProcessEnv;
  try {
    env = ghEnv();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  const r = spawnSync('gh', process.argv.slice(2), { stdio: 'inherit', env });
  if (r.error) console.error(`gh: ${r.error.message}`);
  process.exit(r.status ?? 1);
}
