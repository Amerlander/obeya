// Publishes a rendered hero video to obeya.si: uploads `demo.mp4`, `captions.vtt` and
// `chapters.vtt` from the render's directory as `hero.mp4`, `hero.vtt` and `hero.chapters.vtt` of
// the release `site-media` (creating the
// release the first time, replacing the assets after that), then runs the Pages workflow, which
// fetches them into site/media/. It acts on the checkout's origin as the account that owns it, without
// switching the account gh has active (scripts/gh.ts). With `--poster` it first takes the poster
// (`site/img/hero-poster.jpg`) and the README's picture of the video (`docs/images/video.jpg`)
// again from the new video; they are in git and go out with the next push of main. `--poster-only`
// takes them and uploads nothing: a release commits them before its video goes out
// (.claude/skills/release/SKILL.md).
//
//   node scripts/hero-video/publish.ts [--poster | --poster-only]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ghEnv } from '../gh.ts';

const RELEASE = 'site-media';
const OUT = process.env.HERO_OUT ?? path.join(os.homedir(), 'demos', 'obeya-hero');
const posterOnly = process.argv.includes('--poster-only');
const poster = posterOnly || process.argv.includes('--poster');

const video = path.join(OUT, 'demo.mp4');
const captions = path.join(OUT, 'captions.vtt');
const chapters = path.join(OUT, 'chapters.vtt');
for (const f of [video, captions, chapters]) {
  if (!fs.existsSync(f)) fail(`missing ${f}: render first (scripts/hero-video/README.md)`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env });
  if (r.status !== 0) fail(`${cmd} ${args.slice(0, 2).join(' ')} failed`);
}

const root = path.join(import.meta.dirname, '..', '..');
if (poster) {
  console.log('Taking the poster and the README\'s picture from the new video');
  run('uv', ['run', '--with', 'pillow', 'python', path.join(import.meta.dirname, 'poster.py'), video,
    path.join(root, 'site', 'img', 'hero-poster.jpg'), path.join(root, 'docs', 'images', 'video.jpg')]);
}
if (posterOnly) {
  console.log('Took the poster and nothing went up: commit site/img/hero-poster.jpg and docs/images/video.jpg.');
  process.exit(0);
}

let repo: string, env: NodeJS.ProcessEnv;
try {
  ({ repo, env } = ghEnv());
} catch (e) {
  fail((e as Error).message);
}

// gh names an asset after its file, so the files go up under their site names from a temp directory
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-publish-'));
try {
  const files = [path.join(tmp, 'hero.mp4'), path.join(tmp, 'hero.vtt'), path.join(tmp, 'hero.chapters.vtt')] as const;
  fs.copyFileSync(video, files[0], fs.constants.COPYFILE_FICLONE);
  fs.copyFileSync(captions, files[1], fs.constants.COPYFILE_FICLONE);
  fs.copyFileSync(chapters, files[2], fs.constants.COPYFILE_FICLONE);
  const exists = spawnSync('gh', ['release', 'view', RELEASE], { env, stdio: 'ignore' }).status === 0;
  if (exists) {
    console.log(`Replacing hero.mp4, hero.vtt and hero.chapters.vtt in the release ${RELEASE}`);
    run('gh', ['release', 'upload', RELEASE, ...files, '--clobber'], env);
  } else {
    console.log(`Creating the release ${RELEASE} with hero.mp4, hero.vtt and hero.chapters.vtt`);
    run('gh', ['release', 'create', RELEASE, ...files, '--title', 'Site media',
      '--notes', 'Video for obeya.si, fetched by the Pages workflow.', '--prerelease', '--latest=false'], env);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('Running the Pages workflow');
run('gh', ['workflow', 'run', 'pages.yml'], env);
console.log(`Published: https://github.com/${repo}/actions/workflows/pages.yml shows the run.`);
if (poster) console.log('The poster changed: commit site/img/hero-poster.jpg and docs/images/video.jpg and push main, which publishes them.');
