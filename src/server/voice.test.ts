import { expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resource } from './resources';
import { looping, silence, voiceBackends } from './voice';
import { VoiceSetup } from './voice-setup';

test('a loop is one word, phrase or syllable six times in a row, whatever the case and punctuation', () => {
  for (const loop of [
    'Fall '.repeat(40),
    'PLEASE PLEASE PLEASE PLEASE PLEASE PLEASE',
    `Pann ${'quarterback '.repeat(20)}`,
    `${'lächpt '.repeat(30)}lä`,
    `Ich finde, ${'ihr arbeitet dafür als ihr arbeitet, '.repeat(6)}`,
    'An aktuellen An aktuellen An aktuellen An aktuellen An aktuellen An aktuellen',
    `auf${'ging'.repeat(40)}`,
  ])
    expect(looping(loop)).toBe(true);
  for (const speech of [
    'Starte alle Karten, die noch in der Warteschlange sind.',
    'Nein, nein, nein, nicht diese Karte, die andere.',
    'Was ist der Stand? Was ist der Stand bei Export?',
    'Ja, ja, ja, ja, mach das.',
    'Die Zählerstände der Zähler 1111 und 2222 exportieren.',
    '',
  ])
    expect(looping(speech)).toBe(false);
});

test("Whisper's words for silence are told from a command", () => {
  for (const s of ['Vielen Dank.', ' vielen Dank ', 'Untertitelung des ZDF, 2020', 'Danke fürs Zuschauen!', 'Musik', '[Musik]', '*Musik*']) expect(silence(s)).toBe(true);
  for (const s of ['Vielen Dank, das war gut.', 'Danke, gib das frei.', 'Musik im Demo-Video leiser.']) expect(silence(s)).toBe(false);
});

test('a Mac on Apple Silicon hears with MLX, everything else with faster-whisper', () => {
  expect(voiceBackends({}, 'darwin', 'arm64')).toEqual({ listen: 'mlx' });
  expect(voiceBackends({}, 'darwin', 'x64')).toEqual({ listen: 'faster' });
  expect(voiceBackends({}, 'linux', 'x64')).toEqual({ listen: 'faster' });
  expect(voiceBackends({}, 'win32', 'arm64')).toEqual({ listen: 'faster' });
  expect(voiceBackends({ OBEYA_WHISPER_BACKEND: 'faster' }, 'darwin', 'arm64')).toEqual({ listen: 'faster' });
  expect(voiceBackends({ OBEYA_WHISPER_BACKEND: 'nope' }, 'linux', 'x64')).toEqual({ listen: 'faster' });
});

test('the voice check names what is missing, how to install it here, and what "Installieren" fetches', async () => {
  const home = mkdtempSync(join(tmpdir(), 'obeya-voice-setup-'));
  try {
    const setup = new VoiceSetup({ home, backends: { listen: 'faster' }, prepare: async () => {}, env: { PATH: join(home, 'none') } });
    const view = await setup.view();
    const by = Object.fromEntries(view.items.map((i) => [i.id, i]));
    // uv first: it brings Whisper
    expect(view.items.map((i) => i.id)).toEqual(['uv', 'whisper', 'ffmpeg']);
    expect(by.ffmpeg).toMatchObject({ state: 'missing' });
    expect(by.ffmpeg!.install?.commands.length || by.ffmpeg!.install?.url).toBeTruthy();
    expect(by.uv).toMatchObject({ state: 'missing' });
    expect(by.uv!.install?.url).toContain('astral');
    // without uv the package is not in its cache: fetched by "Installieren" or the first command, once uv is there
    expect(by.whisper).toMatchObject({ state: 'later', found: 'faster-whisper', waits: 'uv' });
    await expect(setup.install()).rejects.toThrow('uv');
    expect(by.speech).toBeUndefined();
    expect(view.fetch.parts).toEqual(['whisper']);
    expect(view.fetch.mb).toBe(by.whisper!.mb!);

    // a Python of one's own without the package is missing
    const own = new VoiceSetup({ home, backends: { listen: 'mlx' }, prepare: async () => {}, env: { PATH: join(home, 'none'), OBEYA_WHISPER_PYTHON: join(home, 'python') } });
    const mac = Object.fromEntries((await own.view()).items.map((i) => [i.id, i]));
    expect(mac.whisper).toMatchObject({ state: 'missing', need: 'mlx-whisper' });
    expect(mac.uv).toBeUndefined();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('"Installieren" loads Whisper, and says why when it fails', async () => {
  const home = mkdtempSync(join(tmpdir(), 'obeya-voice-setup-'));
  try {
    let loaded = 0;
    // uv is there; the package is not in its cache
    writeFileSync(join(home, 'uv'), '#!/bin/sh\ncase "$1" in --version) echo "uv 0.9.2";; *) exit 1;; esac\n');
    chmodSync(join(home, 'uv'), 0o755);
    const setup = new VoiceSetup({ home, backends: { listen: 'mlx' }, prepare: async () => void loaded++, env: { PATH: home } });
    await setup.install();
    await Bun.sleep(10);
    expect(loaded).toBe(1);
    expect((await setup.view()).job).toEqual({ running: false, step: 'whisper', line: '' });
    const failing = new VoiceSetup({ home, backends: { listen: 'mlx' }, prepare: () => Promise.reject(new Error('transcription sidecar exited (1)')), env: { PATH: home } });
    await failing.install();
    await Bun.sleep(10);
    expect((await failing.view()).job).toMatchObject({ running: false, error: 'transcription sidecar exited (1)' });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the Whisper sidecar ends quietly when Obeya is gone before it has written a recording down', async () => {
  // a fake mlx-whisper that takes a moment for a recording longer than the warm-up's second
  const dir = mkdtempSync(join(tmpdir(), 'obeya-sidecar-'));
  try {
    writeFileSync(join(dir, 'mlx_whisper.py'), 'import time\ndef transcribe(audio, **kw):\n    time.sleep(1 if len(audio) > 16000 else 0)\n    return {"text": "Hallo"}\n');
    expect(Bun.spawnSync(['ffmpeg', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', join(dir, 'speech.wav')]).exitCode).toBe(0);
    const p = Bun.spawn(['uv', 'run', '--quiet', '--no-project', '--with', 'numpy', 'python', join(resource('voice'), 'whisper_sidecar.py')], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PYTHONPATH: dir },
    });
    const out = (p.stdout as ReadableStream<Uint8Array>).getReader();
    expect(new TextDecoder().decode((await out.read()).value)).toContain('"ready": true');
    p.stdin.write(`${JSON.stringify({ id: 1, path: join(dir, 'speech.wav') })}\n`);
    // Obeya ends the sidecar's stdin as it stops, and is gone before the words are written
    p.stdin.end();
    await out.cancel();
    expect(await p.exited).toBe(0);
    const log = await new Response(p.stderr).text();
    expect(log).toContain('whisper: 3.0 s');
    expect(log).not.toContain('BrokenPipeError');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
