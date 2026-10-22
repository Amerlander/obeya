// The hero video for obeya.si, recorded with Obeya's own demo pipeline (`plugin/skills/demo`): a
// scratch Obeya with Tipjar, a small tip calculator, and real workers. The owner arranges the wall,
// an idea said into the microphone becomes a task, a message mixed of typing, pasting and speaking
// goes to Obeya in its sidebar, the agent builds the first task and records its demo, the owner
// approves and the change lands. Run it through `render.ts`, which sets the voice; the README says
// how. The microphone is a WAV played into a fake stream: the narration clip of the scene that
// speaks the words, so what the viewer hears is what Obeya hears.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { runDemo, type Director, type Scene } from '../../plugin/skills/demo/lib/director.ts';
import { narration } from './narration.ts';
import { PORT, writeStage } from './stage.ts';
import { KEY_HEADER, ownerHeaders } from '../../src/server/owner.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
/** Where the video, its stills and the work files go: outside the repository. */
const OUT = process.env.HERO_OUT ?? path.join(os.homedir(), 'demos', 'obeya-hero');
const base = `http://127.0.0.1:${PORT}`;
/** HERO_SHORT: the scenes up to Obeya’s sidebar and its preferences, without agents, to check them in a few minutes. */
const SHORT = !!process.env.HERO_SHORT;
/**
 * HERO_RECORD: the take's agents are recorded into that directory as they work; HERO_REPLAY: the
 * agents of such a recording play back instead of real ones (`scratch-obeya.ts`, `--record`, `--replay`).
 */
const RECORD = process.env.HERO_RECORD;
const REPLAY = process.env.HERO_REPLAY;
if (RECORD && SHORT) throw new Error('HERO_SHORT records no agents: record a whole take');
/** The screenshot pasted into the message: Tipjar with a comma in the bill. */
const SHOT = path.join(OUT, 'tipjar-comma.png');

/** What scratch-obeya.ts staged: its directory and the ids of the cards by their keys. */
let staged: { url: string; dir: string; cards: Record<string, string> };
/** The scratch Obeya's owner key, for the API (design: Who may talk to it). */
const owner = () => ownerHeaders(path.join(staged.dir, 'home'));

function stage() {
  const file = path.join(OUT, 'stage.json');
  writeStage(file);
  const agents = RECORD ? ['--record', RECORD] : REPLAY ? ['--replay', REPLAY] : SHORT ? [] : ['--real-workers'];
  const printed = execFileSync('bun', [path.join(ROOT, 'scripts/scratch-obeya.ts'), file, ...agents], {
    env: { ...process.env, OBEYA_HOME: undefined },
    encoding: 'utf8',
  });
  staged = JSON.parse(printed);
  // the worker's own demo: English, a quick voice (the hero video has no page audio)
  fs.writeFileSync(path.join(staged.dir, 'home', 'demo.json'), JSON.stringify({ language: 'en', voice: 'say', voiceName: 'Samantha' }));
  const key = `${KEY_HEADER}: ${owner()[KEY_HEADER]}`;
  execFileSync('curl', ['-s', '-H', key, '-X', 'PUT', `${base}/api/language`, '-d', '{"language":"en"}']);
  // Whisper and Obeya loaded before the take, so the spoken command is heard at once
  execFileSync('curl', ['-s', '-H', key, '-X', 'POST', `${base}/api/c/tipjar/voice/warm`]);
  execFileSync('sleep', ['20']);
}

/** Tipjar as a user sees it with a comma in the bill: served from `tipjar/` into the login's page. */
async function tipjarShot(page: Page) {
  const app = path.join(import.meta.dirname, 'tipjar');
  await page.setViewportSize({ width: 560, height: 560 });
  await page.route('http://tipjar.test/**', (r) => {
    const p = new URL(r.request().url()).pathname;
    return r.fulfill({ path: path.join(app, p === '/' ? 'index.html' : p) });
  });
  await page.goto('http://tipjar.test/');
  await page.locator('#bill').fill('84,50');
  await page.locator('.calc').screenshot({ path: SHOT });
}

/** The narration clip of the scene that says `text` and its length, else (a dry run) one from `say`. */
function clipOf(text: string): { file: string; seconds: number } {
  const id = `s${scenes.findIndex((s) => s.say === text) + 1}`;
  try {
    const tts = JSON.parse(fs.readFileSync(path.join(OUT, '.work', 'tts.json'), 'utf8')) as { clips: { id: string; file: string; seconds: number }[] };
    const clip = tts.clips.find((c) => c.id === id);
    if (clip && fs.existsSync(clip.file)) return clip;
  } catch {}
  const wav = path.join(OUT, `${id}-say.wav`);
  if (!fs.existsSync(wav)) execFileSync('say', ['-v', 'Samantha', '-o', wav, '--data-format=LEI16@22050', text]);
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], { encoding: 'utf8' }));
  return { file: wav, seconds };
}

/**
 * Where `phrase` lies in the clip of the scene that says `text`, in seconds: estimated by `at`, then
 * moved to the nearest long pause in the clip (the `[long pause]` around the phrase), so the
 * microphone gets the whole phrase and nothing beside it. A short pause inside the phrase, which
 * ElevenLabs makes before a last word, cut it off there.
 */
function partOf(text: string, phrase: string) {
  const { file, seconds } = clipOf(text);
  const log = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'silencedetect=n=-35dB:d=0.6', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const times = (re: RegExp) => [...log.matchAll(re)].map((m) => Number(m[1]));
  const nearest = (ts: number[], t: number) => (ts.length ? ts.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a)) : t);
  const i = text.indexOf(phrase);
  const from = nearest(times(/silence_end: ([\d.]+)/g), atIndex(text, i) * seconds);
  const to = nearest(times(/silence_start: ([\d.]+)/g), atIndex(text, i + phrase.length) * seconds);
  return { from, to, seconds };
}

/**
 * Pans the canvas until `target` stands in the middle, at the pace of a hand on a trackpad, so the
 * viewer follows where the card is before it opens rather than seeing the camera jump.
 */
async function bringIntoView(d: Director, target: Locator) {
  const box = (await target.boundingBox())!;
  const view = d.page.viewportSize()!;
  const dx = box.x + box.width / 2 - view.width / 2;
  const dy = box.y + box.height / 2 - (view.height - 120) / 2;
  if (Math.hypot(dx, dy) < 80) return;
  await pointer(d, view.width / 2, view.height / 2 - 60);
  const steps = 30;
  for (let i = 0; i < steps; i++) {
    await d.page.mouse.wheel(dx / steps, dy / steps);
    await d.wait(28);
  }
  await d.wait(500);
}

const card = (d: Director, title: RegExp | string) => d.page.locator('.card', { hasText: title }).first();
const split = (d: Director) => card(d, 'Split the bill');
const field = (d: Director) => d.page.locator('.composer.tell textarea');

/** The card of the task the video creates, as the API has it; a playback that was refused ends the take. */
async function created() {
  const refused = path.join(staged.dir, 'home', 'replay-refused.txt');
  if (fs.existsSync(refused)) throw new Error(`the recording ${REPLAY} no longer fits: ${fs.readFileSync(refused, 'utf8').trim()}; record anew`);
  const snap = (await (await fetch(`${base}/api/c/tipjar/canvas`, { headers: owner() })).json()) as {
    items: { title: string; state: string; statusLine?: string; answering?: true; held?: number[] }[];
  };
  return snap.items.find((x) => /split the bill/i.test(x.title));
}

/** Until the card of the task the video creates is in `states` (25 min at most). */
async function until(states: string[], what: string) {
  const end = Date.now() + 25 * 60_000;
  while (Date.now() < end) {
    if (states.includes((await created())?.state ?? '')) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`the task did not ${what} within 25 minutes`);
}

/** Until the agent has reported a status line, or a minute has passed: it does not always report one. */
async function statusLine() {
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    if ((await created())?.statusLine) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/**
 * About when `phrase` is spoken in a scene's narration `text`, as a fraction of its clip: by the
 * characters before it, an audio tag counted as the pause it makes.
 */
function at(text: string, phrase: string) {
  const i = text.indexOf(phrase);
  if (i < 0) throw new Error(`"${phrase}" is not in the narration "${text}"`);
  return atIndex(text, i);
}

/** `at` for the character at `i`. */
function atIndex(text: string, i: number) {
  // a pause is silence of 0.5 s or 1.5 s (`tts.py`), at about fourteen characters a second
  const weigh = (t: string) => t.replace(/\[long pause\]/g, ' '.repeat(21)).replace(/\[[^\]]*\]/g, ' '.repeat(7)).length;
  return weigh(text.slice(0, i)) / weigh(text);
}

/** Until the narration of the scene, `text`, says `phrase`. */
const saying = (d: Director, text: string, phrase: string) => d.untilSpoken(at(text, phrase));

/** The demo's pointer to a point, as the real one goes there. */
async function pointer(d: Director, x: number, y: number) {
  await d.page.mouse.move(x, y);
  await d.page.evaluate(([px, py]) => (window as unknown as { __demo: { moveTo: (x: number, y: number, i: boolean) => void } }).__demo.moveTo(px!, py!, true), [x, y]);
}

/** Shift + drag in a loop round `cards`: the lasso that opens the colour ring at its end. */
async function lasso(d: Director, cards: Locator[]) {
  const boxes = await Promise.all(cards.map(async (c) => (await c.boundingBox())!));
  const x0 = Math.min(...boxes.map((b) => b.x));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2 + 60;
  const ry = (y1 - y0) / 2 + 45;
  // from the left, clockwise round, ending a little past the start so the loop closes
  const at = (a: number) => [cx - rx * Math.cos(a), cy - ry * Math.sin(a)] as const;
  await d.page.evaluate(([x, y]) => (window as unknown as { __demo: { moveTo: (x: number, y: number) => void } }).__demo.moveTo(x!, y!), at(0));
  await d.wait(750);
  await d.page.mouse.move(...at(0));
  await d.page.keyboard.down('Shift');
  await d.page.mouse.down();
  const steps = 45;
  for (let i = 1; i <= steps; i++) {
    await pointer(d, ...at((i / steps) * Math.PI * 2.08));
    await d.wait(15);
  }
  await d.page.mouse.up();
  await d.page.keyboard.up('Shift');
  await d.wait(500);
}

/** Zooms by `steps` turns of the wheel with Ctrl at (x, y): out for positive steps, in for negative. */
async function zoom(d: Director, x: number, y: number, steps: number) {
  await pointer(d, x, y);
  await d.page.keyboard.down('Control');
  for (let i = 0; i < Math.abs(steps); i++) {
    await d.page.mouse.wheel(0, Math.sign(steps) * 5);
    await d.wait(45);
  }
  await d.page.keyboard.up('Control');
}

type Mic = { __load: (name: string, url: string) => Promise<void>; __play: (name: string, from?: number, to?: number) => Promise<number> };

/** Plays the clip `name` into the microphone, exactly when the narration track plays it, while `hold` is down. */
async function speak(d: Director, name: string) {
  await d.page.keyboard.down('Space');
  await d.untilSpoken(0);
  const seconds = await d.page.evaluate((n) => (window as unknown as Mic).__play(n), name);
  await d.wait(seconds * 1000 + 250);
  await d.page.keyboard.up('Space');
}

/**
 * Space held on the open card while its demo video plays, for `phrase` of the narration `text`,
 * which the microphone hears as the narration track says it: a comment on that place in the video.
 */
async function comment(d: Director, text: string, phrase: string) {
  const { from, to, seconds } = partOf(text, phrase);
  await d.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // early, in the pause before the phrase: the key pauses the video and the page draws its frame
  // for the comment, and a recording started 0.3 s before the words lost one ("Show each person
  // pays in bold") in two renders of three
  await d.untilSpoken(Math.max(0, from - 0.9) / seconds);
  await d.page.keyboard.down('Space');
  await d.untilSpoken(from / seconds);
  const played = await d.page.evaluate(([f, t]) => (window as unknown as Mic).__play('comments', f, t), [from, to] as const);
  await d.wait(played * 1000 + 250);
  await d.page.keyboard.up('Space');
}

/** A paste of the screenshot into the focused field, as ⌘V with an image on the clipboard. */
async function pasteShot(d: Director) {
  const png = fs.readFileSync(SHOT).toString('base64');
  await field(d).evaluate((el, b64) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'tipjar.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, png);
}

const scenes: Scene[] = [
  {
    title: 'One canvas',
    say: narration.canvas,
    run: async (d) => {
      const say = narration.canvas;
      await saying(d, say, 'they show up as projects');
      await d.highlight(d.page.locator('.item.project').first(), 'project');
      await saying(d, say, 'The colour says');
      await d.clearHighlights();
      await saying(d, say, 'is working');
      await d.highlight(card(d, 'Run the tests'), 'working');
      // one ring at a time: the pipeline dims around the first ring only
      await saying(d, say, 'needs you');
      await d.clearHighlights();
      await d.highlight(card(d, 'App icon'), 'needs you');
      await d.untilSpoken(1);
      // a moment longer than the words
      await d.wait(900);
      await d.clearHighlights();
    },
  },
  {
    title: 'Your wall',
    say: narration.arrange,
    run: async (d) => {
      const say = narration.arrange;
      await saying(d, say, 'Draw a lasso');
      await lasso(d, [card(d, 'Dark mode'), card(d, 'Remember the last tip')]);
      await d.click(d.page.locator('.ball.new'));
      await d.page.locator('.rname').pressSequentially('Look and feel', { delay: 60 });
      await d.wait(300);
      await d.page.locator('.rname').press('Enter');
      // App icon, of the group Launch, goes up beside Look and feel, whose territory makes way
      await saying(d, say, 'Drag cards');
      await d.drag(card(d, 'App icon'), { x: 1215, y: 628 }, 2000);
      await d.untilSpoken(1);
    },
  },
  {
    title: 'An idea, by voice',
    say: narration.command,
    run: async (d) => {
      await d.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await speak(d, 'command');
      await d.untilSpoken(1);
      // Whisper and Obeya take some seconds: the wait is cut when it is long
      // Obeya's confirmation, in its own words: what was said, heard, above the microphone
      await d.skip(() => d.page.locator('#acks .told.heard').waitFor({ timeout: 90_000 }), { quiet: true });
    },
  },
  {
    title: 'The agent starts',
    say: narration.starts,
    run: async (d) => {
      const ack = d.page.locator('#acks');
      await d.page.locator('#acks .told.heard').waitFor({ timeout: 60_000 });
      await d.highlight(ack, 'confirmation');
      await saying(d, narration.starts, 'and puts the task');
      // cleared before the camera flies to the new card, marked once it stands: a ring cleared
      // during the flight flashed the page
      await d.clearHighlights();
      await split(d).waitFor({ timeout: 60_000 });
      await d.wait(1200);
      await d.highlight(split(d), 'new task');
      // Obeya mostly starts a new task by itself; a planned one is started by a click
      await d.wait(1500);
      if (await split(d).getByText(/^Planned$/).isVisible()) {
        // the play button shows while the pointer is on the card
        await split(d).hover();
        await d.wait(500);
        await d.click(split(d).getByRole('button', { name: 'Start agent' }));
      }
      await d.untilSpoken(1);
      await d.clearHighlights();
      if (SHORT) return;
      // until the agent works and has a few steps behind it to show: one cut, two in a row jumped
      // twice with a glimpse between them
      // the agent's session starting up: no time an owner waits for, so no label
      await d.skip(
        async () => {
          await split(d).getByText(/Agent at work/i).first().waitFor({ timeout: 90_000 });
          await statusLine();
          await d.wait(1000);
        },
        { quiet: true },
      );
    },
  },
  {
    title: 'Obeya’s sidebar',
    say: narration.sidebar,
    run: async (d) => {
      await d.click(d.page.getByRole('button', { name: 'Obeya' }));
      await d.wait(900);
      await d.highlight(d.page.locator('.talk.conv').first(), 'what you said');
      const say = narration.sidebar;
      await saying(d, say, 'You can also type');
      await d.clearHighlights();
      await d.type(field(d), 'Bug report from a user: ');
      await saying(d, say, 'pasted text');
      // pasted text arrives at once
      await d.page.keyboard.insertText('“I typed 84,50 and Tipjar says the tip is $0.00.” ');
      await saying(d, say, 'a screenshot');
      await pasteShot(d);
      await d.untilSpoken(1);
    },
  },
  {
    title: 'Typed, pasted and spoken',
    say: narration.dictation,
    run: async (d) => {
      // Space held in the field dictates into it, at the cursor
      await field(d).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
      await speak(d, 'dictation');
      await d.untilSpoken(1);
      // Whisper writing the words down: its latency, cut whole
      await d.skip(
        async () => {
          await d.page.waitForFunction(() => /comma/i.test(document.querySelector<HTMLTextAreaElement>('.composer.tell textarea')?.value ?? ''), undefined, { timeout: 30_000 });
        },
        { quiet: true },
      );
      await d.wait(400);
      await d.click(d.page.locator('.composer.tell .c-send'));
      // Obeya answers in the sidebar: a second message of its own
      await d.skip(() => d.page.locator('.talk.conv .msg.by-koordinator:not(.thinking)').nth(1).waitFor({ timeout: 120_000 }), { quiet: true });
      await d.wait(1800);
    },
  },
  {
    title: 'Preferences',
    say: narration.preferences,
    run: async (d) => {
      const say = narration.preferences;
      // the proposals, folded while the video showed the chat
      await d.click(d.page.locator('#ksheet .fold-head', { hasText: 'Proposals' }));
      await saying(d, say, 'Obeya also proposes');
      await d.highlight(d.page.locator('#ksheet li.proposal').first(), 'proposed by Obeya');
      await saying(d, say, 'Once you accept');
      await d.clearHighlights();
      await d.click(d.page.locator('#ksheet li.proposal button', { hasText: 'Accept' }));
      await d.wait(700);
      await d.click(d.page.locator('#ksheet .fold-head', { hasText: 'Preferences' }));
      await d.untilSpoken(1);
      await d.wait(600);
    },
  },
  {
    title: 'The agents at work',
    say: narration.working,
    run: async (d) => {
      await d.click(d.page.getByRole('button', { name: 'Obeya' }));
      await d.wait(900);
      await bringIntoView(d, split(d));
      await d.click(split(d));
      await d.wait(1500);
      // what the agent did so far, folded under its history as in every chat: unfolded a moment
      const say = narration.working;
      const steps = d.page.locator('.talk.conv details.steps').last();
      await saying(d, say, 'Like every chat');
      if (await steps.isVisible()) {
        await d.highlight(steps, 'its steps, folded');
        await saying(d, say, 'folds away');
        // unfolded without the ring, which would reach past the conversation's edge
        await d.clearHighlights();
        await d.click(steps.locator('summary'));
        await d.wait(1800);
        await d.click(steps.locator('summary'));
      }
      await d.untilSpoken(1);
      await d.wait(600);
      await d.page.keyboard.press('Escape');
      await d.skip(async () => {
        await until(['waiting'], 'hand over');
        await d.wait(1500);
      });
    },
  },
  {
    title: 'Its demo',
    say: narration.demo,
    run: async (d) => {
      await bringIntoView(d, split(d));
      await d.click(split(d));
      // the demo starts by itself on its first opening; where it did not (one render of 2026-10-17,
      // with the agent's app still served in the background), it is started as the owner would
      await d.wait(1200);
      const play = d.page.locator('.player button.start');
      if (await play.isVisible()) await d.click(play);
      await saying(d, narration.demo, 'and a short report');
      await d.highlight(d.page.locator('.talk.conv').first(), 'report');
      await saying(d, narration.demo, 'You judge');
      await d.clearHighlights();
      await d.untilSpoken(1);
    },
  },
  {
    title: 'Comments while it plays',
    say: narration.comments,
    run: async (d) => {
      const say = narration.comments;
      await comment(d, say, 'Start the number of people at two.');
      await comment(d, say, 'Show what each person pays in bold.');
      // paused while the narration says what becomes of the comments, so the end of the video does
      // not send them before; Whisper writing the second one down is cut
      await d.page.evaluate(() => document.querySelector('video')?.pause());
      const held = d.page.locator('.talk.conv .msg.held');
      await d.skip(() => held.nth(1).waitFor({ timeout: 30_000 }), { quiet: true });
      await saying(d, say, 'Your comments wait');
      // both comments, each with its place, and the note with Send now under them
      await d.highlight([held.first(), held.last(), d.page.locator('.held-note')], 'held back until the end');
      await d.untilSpoken(1);
      await d.clearHighlights();
      await d.page.evaluate(() => document.querySelector('video')?.play());
      // the end of the video sends them; one that ran past it is sent by hand
      await d.skip(
        async () => {
          const end = Date.now() + 90_000;
          while (Date.now() < end && (await created())?.held?.length) await new Promise((r) => setTimeout(r, 1000));
          if ((await created())?.held?.length) await d.page.locator('.held-send').click();
          await d.wait(1200);
        },
        { quiet: true },
      );
    },
  },
  {
    title: 'A new demo',
    say: narration.feedback,
    run: async (d) => {
      await d.untilSpoken(1);
      // the agent takes the comments in, reworks, and hands over again
      await d.skip(async () => {
        const end = Date.now() + 25 * 60_000;
        let took = false;
        while (Date.now() < end) {
          const c = await created();
          took ||= !!c?.answering;
          if (took && !c?.answering && c?.state === 'waiting') break;
          await new Promise((r) => setTimeout(r, 3000));
        }
        await d.wait(2500);
      });
    },
  },
  {
    title: 'Approval',
    say: narration.approval,
    run: async (d) => {
      await d.wait(1200);
      await d.click(d.page.getByRole('button', { name: /^Approve/ }).first());
      await d.wait(2500);
      await d.untilSpoken(1);
      // landing takes Obeya some seconds: no wait an owner sits through, so no label
      await d.skip(
        async () => {
          await until(['live'], 'land');
          // Obeya's proposal from its retrospective, which the stage kept back so far
          await fetch(`${base}/api/c/tipjar/cards/${staged.cards.R}/unarchive`, { method: 'POST', headers: owner() });
          await d.wait(1200);
        },
        { quiet: true },
      );
    },
  },
  {
    title: 'Landed on main',
    say: narration.landed,
    run: async (d) => {
      // the whole wall, where new cards land at the pointer: the landed card is in it wherever it stands
      await d.page.keyboard.press('0');
      await d.wait(900);
      await d.highlight(split(d), 'on main');
      await d.untilSpoken(1);
      await d.clearHighlights();
    },
  },
  {
    title: 'Proposals and ideas',
    say: narration.proposals,
    run: async (d) => {
      // done with: into the archive, with the button on the card
      await split(d).hover();
      await d.wait(400);
      await d.click(split(d).getByRole('button', { name: 'Archive' }));
      await d.wait(600);
      // the whole wall: the proposal hangs off Dark mode, out of the picture beside the new card
      await d.page.keyboard.press('0');
      await d.wait(900);
      const say = narration.proposals;
      await d.highlight(card(d, 'Remember the last tip'), 'proposed by an agent');
      await saying(d, say, 'And Obeya itself');
      await d.clearHighlights();
      await d.highlight(card(d, 'A script that serves Tipjar'), 'proposed by Obeya');
      await saying(d, say, 'Not every thought');
      await d.clearHighlights();
      await saying(d, say, 'goes on the wall as an idea');
      await d.highlight(card(d, 'Settle up after a trip'), 'idea');
      await saying(d, say, 'and you think it through');
      await d.clearHighlights();
      // opened: the agent's questions and the owner's answers beside the brief it keeps
      await d.click(card(d, 'Settle up after a trip'));
      await d.wait(900);
      await d.highlight(d.page.locator('.talk.conv').first(), 'the agent asks back');
      await saying(d, say, 'and keeps a brief');
      await d.clearHighlights();
      await d.highlight(d.page.locator('.question.brief'), 'brief');
      await saying(d, say, 'It also suggests');
      await d.clearHighlights();
      await d.highlight(d.page.locator('.next-step'), 'suggested next step');
      await d.untilSpoken(1);
      await d.clearHighlights();
    },
  },
  {
    title: 'The big room',
    say: narration.room,
    run: async (d) => {
      await d.page.keyboard.press('Escape');
      await d.wait(900);
      // a step back from the wall, where the groups' names show
      await zoom(d, 720, 450, 8);
      await d.untilSpoken(1);
    },
  },
];

await runDemo(
  {
    title: 'Obeya',
    baseUrl: `${base}/`,
    // for the site: as sharp as the app on a Retina screen
    sharp: true,
    login: async (page) => {
      stage();
      // the staged link signs this browser in
      await page.goto(staged.url);
      await tipjarShot(page);
    },
    open: async (d) => {
      const clips = { command: clipOf(narration.command).file, dictation: clipOf(narration.dictation).file, comments: clipOf(narration.comments).file };
      await d.page.route('**/__demo/*.wav', (r) => r.fulfill({ path: clips[path.basename(new URL(r.request().url()).pathname, '.wav') as keyof typeof clips] }));
      await d.page.addInitScript(() => {
        let ctx: AudioContext | undefined;
        let dest: MediaStreamAudioDestinationNode | undefined;
        navigator.mediaDevices.getUserMedia = async () => {
          ctx ??= new AudioContext();
          dest ??= ctx.createMediaStreamDestination();
          return dest.stream;
        };
        // decoded before the take, so a clip starts the moment the narration does
        const bufs = new Map<string, AudioBuffer>();
        const w = window as unknown as Mic;
        w.__load = async (name, url) => {
          ctx ??= new AudioContext();
          dest ??= ctx.createMediaStreamDestination();
          bufs.set(name, await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer()));
        };
        // `from` and `to`: a part of the clip, in seconds
        w.__play = async (name, from = 0, to) => {
          await ctx!.resume();
          const src = ctx!.createBufferSource();
          src.buffer = bufs.get(name)!;
          // a little below full scale: the clip peaks at -1.4 dB, and the recording of the second
          // comment came out at +2 dBFS, clipped, with a word lost
          const gain = ctx!.createGain();
          gain.gain.value = 0.6;
          src.connect(gain).connect(dest!);
          const length = (to ?? src.buffer.duration) - from;
          src.start(0, from, length);
          return length;
        };
      });
      // Obeya's sidebar opens with the proposed rules folded: the video shows the chat first
      const snap = (await (await fetch(`${base}/api/c/tipjar/canvas`, { headers: owner() })).json()) as { preferences: { id: number; state: string }[] };
      const proposed = snap.preferences.filter((p) => p.state === 'proposed').map((p) => p.id);
      await d.page.addInitScript((ids) => localStorage.setItem('obeya-ksheet-tipjar', JSON.stringify({ proposalsClosed: ids })), proposed);
      // an owner who knows double-click and `?`: the bar's New task and ? buttons have gone (`help.tsx`)
      await d.page.addInitScript(() => {
        localStorage.setItem('obeya-double-click-known', '1');
        localStorage.setItem('obeya-help-key-known', '1');
      });
      await d.goto('/?c=tipjar');
      await d.page.addStyleTag({ content: 'bun-hmr { display: none !important; }' });
      for (const name of Object.keys(clips)) await d.page.evaluate((n) => (window as unknown as Mic).__load(n, `/__demo/${n}.wav`), name);
      await card(d, 'App icon').waitFor();
      await d.wait(1200);
    },
    scenes: scenes.slice(0, SHORT ? 7 : undefined),
    report: {
      summary:
        'The hero video for obeya.si: on a scratch canvas with the example app Tipjar, the owner groups and moves cards, an idea said into the microphone becomes a task, a message typed, pasted and spoken goes to Obeya in its sidebar, a real agent builds the task and records its demo, and the approval lands the change on main.',
      meta: { Stack: `Scratch Obeya on port ${PORT} from this checkout, ${REPLAY ? `the agents played back from ${REPLAY}` : 'real workers'}, Obeya and Whisper real` },
    },
  },
  OUT,
);
// what the take cut, for its playback: there it goes by in a moment
if (RECORD) fs.copyFileSync(path.join(OUT, '.work', 'cuts.json'), path.join(RECORD, 'cuts.json'));
