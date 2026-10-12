// The screenshots on obeya.si (`site/img/`), taken again from a scratch Obeya in English: the Tipjar
// app of the hero video as the repository, cards in the states the page talks about, and a demo of
// a Tipjar change on the card whose demo the page shows, so that the picture is of a demo and not of
// Obeya itself.
//
//   bun scripts/site-shots.ts [--demo <dir>] [--keep | --stage-only]
//
// --demo names a Tipjar demo to put on that card (a directory with demo.mp4 and poster.jpg); without
// it the newest ~/demos/tipjar-split-the-bill* is taken, which every render of the hero video leaves
// behind (its agent's demo of splitting the bill). The scratch Obeya runs on port 4740 and is stopped
// at the end; --keep leaves it running for a look, --stage-only stages it and takes nothing. Needs
// Google Chrome.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { writeStage } from './hero-video/stage';

const PORT = 4740;
const ROOT = join(import.meta.dirname, '..');
const IMG = join(ROOT, 'site', 'img');
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};

function newestDemo(): string {
  const demos = join(homedir(), 'demos');
  const found = existsSync(demos)
    ? readdirSync(demos)
        .filter((n) => n.startsWith('tipjar-split-the-bill') && existsSync(join(demos, n, 'demo.mp4')))
        .map((n) => join(demos, n))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];
  if (!found[0]) throw new Error('No Tipjar demo found in ~/demos: render the hero video first, or name one with --demo.');
  return found[0];
}
const demo = arg('--demo') ?? newestDemo();

// the hero video's repository and plan doc, with cards of our own
const dir = mkdtempSync(join(tmpdir(), 'site-shots-'));
const stageFile = join(dir, 'stage.json');
writeStage(stageFile);
const stage = JSON.parse(readFileSync(stageFile, 'utf8'));
stage.port = PORT;
stage.dir = `/tmp/obeya-scratch-${PORT}`;
stage.cards = [
  { key: 'P', project: 'docs/plan/tipjar-2.md', x: 40, y: 100 },
  { key: 'W2', workstream: 'W2', state: 'working', statusLine: 'Reading the receipt photo', branch: 'obeya/scan-receipt' },
  { key: 'W3', workstream: 'W3', queue: { behind: ['W2'], reason: 'The link shares the bill that W2 fills in from the receipt.' } },
  { key: 'S', title: 'Split the bill', body: 'Tipjar shows what each person at the table pays.', state: 'waiting', need: 'demo', x: 780, y: 100,
    branch: 'obeya/split-the-bill',
    events: [
      { kind: 'state', author: 'obeya', text: 'Agent started on obeya/split-the-bill.', ago: '25m' },
      { kind: 'review', author: 'worker', text: 'Below the tip there is a People field now, and the result says what each person pays, rounded up to the cent so the shares always cover the bill.', ago: '3m' },
    ],
    summary: 'Below the tip there is a People field now, and the result says what each person pays, rounded up to the cent so the shares always cover the bill.',
    demo: { dir: demo, chapters: [[0, 'The new field'], [10.2, 'An even split'], [17.2, 'An uneven split'], [29.4, 'Empty or zero'], [34.6, 'Recap']] } },
  { key: 'C', title: 'Run the tests on every push', body: 'A GitHub Actions workflow runs bun test on every push.', state: 'working', statusLine: 'Writing the workflow', branch: 'obeya/ci', x: 1100, y: 100 },
  { key: 'I', title: 'App icon', body: 'An icon for the home screen.', state: 'waiting', need: 'question', x: 780, y: 260,
    branch: 'obeya/app-icon',
    events: [{ kind: 'state', author: 'obeya', text: 'Agent started on obeya/app-icon.', ago: '12m' }],
    question: { text: 'Which of the three drafts should become the icon?', options: ['The jar', 'The coin', 'The receipt'] } },
  { key: 'R', title: 'Round to whole dollars', body: 'A switch rounds each share up to the dollar.', state: 'approved', branch: 'obeya/round-up', x: 1100, y: 260 },
  { key: 'D', title: 'Dark mode', body: 'Tipjar follows the system’s dark mode.', state: 'live', createdAgo: '1d', x: 780, y: 420 },
  { key: 'T', title: 'Settle up after a trip', body: 'Several bills over a weekend, several people: who owes whom at the end.', state: 'idea', x: 1100, y: 420,
    row: { idea: { status: 'open', brief: 'Settle a whole trip, not one bill.', thinking: false, yourTurn: true, questions: [], next: { step: 'planDoc', why: 'Several parts that build on each other.' }, variants: [], mocks: [] } } },
];
stage.groups = [];
writeFileSync(stageFile, JSON.stringify(stage, null, 1));

const staged = JSON.parse(execFileSync('bun', [join(ROOT, 'scripts', 'scratch-obeya.ts'), stageFile], { encoding: 'utf8' }).trim().split('\n').at(-1)!);
const base = `http://127.0.0.1:${PORT}`;
await fetch(`${base}/api/language`, { method: 'PUT', body: JSON.stringify({ language: 'en' }) });
console.log('staged', staged.url);

if (process.argv.includes('--stage-only')) process.exit(0);

// a fake microphone, so that holding Space lights it as it does for the owner
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 813 }, deviceScaleFactor: 1 });
  await page.context().grantPermissions(['microphone'], { origin: base });
  await page.goto(staged.url);
  await page.locator('.card').first().waitFor();
  await page.waitForTimeout(1000);
  await shots(page, staged.cards as Record<string, string>);
} finally {
  await browser.close();
  if (!process.argv.includes('--keep')) execFileSync('bun', [join(ROOT, 'scripts', 'scratch-obeya.ts'), '--stop', String(PORT)]);
}

type Box = { x: number; y: number; width: number; height: number };
function around(boxes: Box[], pad: number, padX = pad): Box {
  const x = Math.min(...boxes.map((b) => b.x)) - padX, y = Math.min(...boxes.map((b) => b.y)) - pad;
  const r = Math.max(...boxes.map((b) => b.x + b.width)) + padX, b = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(r - x), height: Math.round(b - y) };
}
async function boxOf(page: Page, selector: string) {
  return (await page.locator(selector).first().boundingBox())!;
}
function card(id: string | undefined) {
  if (!id) throw new Error('a card the stage names was not staged');
  return `[data-id="${id}"]`;
}

async function shots(page: Page, cards: Record<string, string>) {
  // the whole canvas, for the link preview (og:image)
  await page.screenshot({ path: join(IMG, 'canvas.png') });
  console.log('canvas.png');

  // taller, so that the minimap and the microphone stay below the cards
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.locator('.card').first().waitFor();
  await page.waitForTimeout(1000);

  // the cards in their states
  const all = await Promise.all((await page.locator('.card, .project').all()).map((l) => l.boundingBox()));
  await page.screenshot({ path: join(IMG, 'cards.png'), clip: around(all.filter((b): b is Box => !!b && b.y > 60), 20) });
  console.log('cards.png');

  // the order: the pointer on a queued workstream shows what it waits for
  await page.hover(card(cards.W3));
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(IMG, 'order.png'), clip: around([await boxOf(page, '.project')], 24) });
  await page.mouse.move(5, 500);
  console.log('order.png');

  // a demo to approve: the card unfolded, its video paused on the even split, tall enough for all its chapters
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.click(card(cards.S));
  await page.locator('#panel video').waitFor();
  await page.waitForTimeout(1500);
  await page.locator('#panel video').evaluate(async (v: HTMLVideoElement) => {
    v.pause();
    v.currentTime = 14.5;
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
  });
  await page.hover('#panel video');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(IMG, 'demo.png'), clip: around([await boxOf(page, '#panel')], 0) });
  console.log('demo.png');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(1200);

  // voice: an agent's question, answered by holding Space
  await page.click(card(cards.I));
  await page.waitForTimeout(1500);
  await page.mouse.move(5, 500);
  await page.keyboard.down('Space');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(IMG, 'voice.png'), clip: around([await boxOf(page, '#panel'), (await page.locator('.ptt-row').locator('..').boundingBox())!], 24, 150) });
  await page.keyboard.up('Space');
  console.log('voice.png');
}
