// Renders the hero video (`demo.ts`) in the owner's ElevenLabs voice, without touching Obeya's own
// demo settings: a home of its own beside the output holds the voice settings, its voices directory
// is Obeya's (for Qwen3-TTS with `--qwen`). The key lies in `.voice/elevenlabs.key` of the main
// checkout, gitignored. `--qwen` renders in the owner's voice cloned by Qwen3-TTS instead (the
// reference `.voice/qwen-reference-en.wav` there), which costs no credits: for trying a change out,
// into `~/demos/obeya-hero-qwen`. Other arguments go on to the demo (`--narration`, `--dry`).
//
//   node scripts/hero-video/render.ts [--qwen] [--narration | --dry]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VOICE = 'IErGHDQU4vPqicCi8dwR';
const qwen = process.argv.includes('--qwen');
const OUT = process.env.HERO_OUT ?? path.join(os.homedir(), 'demos', qwen ? 'obeya-hero-qwen' : 'obeya-hero');
const common = spawnSync('git', ['-C', import.meta.dirname, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).stdout.trim();
const voiceDir = path.join(path.dirname(common), '.voice');
const keyFile = path.join(voiceDir, 'elevenlabs.key');
const reference = path.join(voiceDir, 'qwen-reference-en.wav');
const needed = qwen ? reference : keyFile;
if (!fs.existsSync(needed)) {
  console.error(`missing ${needed}`);
  process.exit(1);
}

const home = path.join(OUT, 'home');
fs.mkdirSync(home, { recursive: true });
const settings = qwen
  ? { language: 'en', voice: 'qwen3', ownVoice: true, reference }
  : { language: 'en', voice: 'elevenlabs', ownVoice: true, voiceName: VOICE, keyFile };
fs.writeFileSync(path.join(home, 'demo.json'), JSON.stringify(settings, null, 2));
const voices = path.join(process.env.OBEYA_HOME ?? path.join(os.homedir(), '.obeya'), 'voices');
if (fs.existsSync(voices) && !fs.existsSync(path.join(home, 'voices'))) fs.symlinkSync(voices, path.join(home, 'voices'));

const r = spawnSync('node', [path.join(import.meta.dirname, 'demo.ts'), ...process.argv.slice(2).filter((a) => a !== '--qwen')], {
  stdio: 'inherit',
  env: { ...process.env, OBEYA_HOME: home, HERO_OUT: OUT, DEMO_ELEVENLABS_MODEL: 'eleven_v4' },
});
process.exit(r.status ?? 1);
