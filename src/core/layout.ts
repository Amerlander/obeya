// Card sizes and default placement. Cards keep a fixed, readable size; a project wraps its children.

import { finished, finishingUp, type Item } from './types';

export type Shape = 'task' | 'chip' | 'project';

export const CARD_SIZE: Record<Exclude<Shape, 'project'>, readonly [number, number]> = {
  task: [300, 136],
  chip: [196, 64],
};

/** Inside a project: children start below the header, with this margin around them. */
export const PROJECT_PAD = 30;
export const PROJECT_HEAD = 78;
const PROJECT_MIN: readonly [number, number] = [420, 150];
const CHIPS_PER_ROW = 4;
const TASKS_PER_ROW = 3;
export const GAP = 20;
const PROJECT_GAP = 60;

/**
 * A delivered workstream shrinks to a chip once its agent is done; every other card shows at the
 * size of a task, so its state and status line show.
 */
export function shapeOf(i: Pick<Item, 'kind' | 'state' | 'parent' | 'finishing'>): Shape {
  if (i.kind === 'project') return 'project';
  if (i.parent && finished(i.state) && !finishingUp(i)) return 'chip';
  // a Question card has a task's size, and a look of its own
  return i.kind === 'question' ? 'task' : i.kind;
}

export function projectSize(children: Pick<Item, 'kind' | 'state' | 'parent' | 'finishing' | 'x' | 'y'>[]): [number, number] {
  let w = PROJECT_MIN[0];
  let h = PROJECT_MIN[1];
  for (const c of children) {
    const [cw, ch] = CARD_SIZE[shapeOf(c) as Exclude<Shape, 'project'>];
    w = Math.max(w, c.x + cw + PROJECT_PAD);
    h = Math.max(h, c.y + ch + PROJECT_PAD);
  }
  return [w, h];
}

export function sizeOf(i: Item, all: Item[]): [number, number] {
  const shape = shapeOf(i);
  if (shape === 'project') return projectSize(all.filter((c) => c.parent === i.id));
  const [w, h] = CARD_SIZE[shape];
  return [w, h];
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Absolute bounds of an item; children are stored relative to their project. */
export function boundsOf(i: Item, all: Item[]): Bounds {
  const parent = i.parent ? all.find((p) => p.id === i.parent) : undefined;
  const [w, h] = sizeOf(i, all);
  return { x: i.x + (parent?.x ?? 0), y: i.y + (parent?.y ?? 0), w, h };
}

export function unionBounds(bs: Bounds[]): Bounds | null {
  if (!bs.length) return null;
  const x1 = Math.min(...bs.map((b) => b.x));
  const y1 = Math.min(...bs.map((b) => b.y));
  const x2 = Math.max(...bs.map((b) => b.x + b.w));
  const y2 = Math.max(...bs.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Places new workstreams inside a project, below `startY`: delivered ones as rows of chips first,
 * then the open ones as rows of cards, each group in the given order.
 */
export function placeWorkstreams(ws: { done: boolean }[], startY = PROJECT_HEAD): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = new Array(ws.length);
  let y = startY;
  for (const [done, perRow, shape] of [
    [true, CHIPS_PER_ROW, 'chip'],
    [false, TASKS_PER_ROW, 'task'],
  ] as const) {
    const [w, h] = CARD_SIZE[shape];
    const idx = ws.map((_, i) => i).filter((i) => ws[i]!.done === done);
    idx.forEach((i, n) => {
      out[i] = { x: PROJECT_PAD + (n % perRow) * (w + GAP), y: y + Math.floor(n / perRow) * (h + GAP) };
    });
    if (idx.length) y += Math.ceil(idx.length / perRow) * (h + GAP);
  }
  return out;
}

/**
 * The spot nearest `want` where a card of `size` keeps GAP clear of everything in `taken`. Besides
 * `want` itself, the candidates are the positions flush beside the edges of what is taken; right of
 * everything there is always room. With `within` (the part of the canvas the owner has in view),
 * `want` moves inside it first and a free spot wholly inside it wins over a nearer one partly out.
 */
export function freeSpotNear(want: { x: number; y: number }, size: readonly [number, number], taken: Bounds[], within?: Bounds): { x: number; y: number } {
  const [w, h] = size;
  const free = (x: number, y: number) =>
    taken.every((b) => x + w + GAP <= b.x || b.x + b.w + GAP <= x || y + h + GAP <= b.y || b.y + b.h + GAP <= y);
  const view = within && within.w >= w + 2 * GAP && within.h >= h + 2 * GAP ? within : undefined;
  const inside = (x: number, y: number) => !view || (x >= view.x && y >= view.y && x + w <= view.x + view.w && y + h <= view.y + view.h);
  if (view) {
    want = {
      x: Math.min(Math.max(want.x, view.x + GAP), view.x + view.w - w - GAP),
      y: Math.min(Math.max(want.y, view.y + GAP), view.y + view.h - h - GAP),
    };
  }
  const xs = [want.x, ...taken.flatMap((b) => [b.x + b.w + GAP, b.x - w - GAP]), ...(view ? [view.x + GAP, view.x + view.w - w - GAP] : [])];
  const ys = [want.y, ...taken.flatMap((b) => [b.y + b.h + GAP, b.y - h - GAP]), ...(view ? [view.y + GAP, view.y + view.h - h - GAP] : [])];
  let best = want;
  let bestD = Infinity;
  let bestIn = false;
  for (const x of xs)
    for (const y of ys) {
      if (!free(x, y)) continue;
      const d = (x - want.x) ** 2 + (y - want.y) ** 2;
      const isIn = inside(x, y);
      if ((isIn && !bestIn) || (isIn === bestIn && d < bestD)) [best, bestD, bestIn] = [{ x, y }, d, isIn];
    }
  return best;
}

/** Where a new card should go: centred as near this point as there is room, inside `view` (the canvas the owner has in view) if there is room there. */
export interface Place {
  x: number;
  y: number;
  view?: Bounds;
}

/** A place as a request carries it (`?place=`): `x,y`, then the view's `x,y,w,h`. */
export const placeParam = (p: Place) => [p.x, p.y, ...(p.view ? [p.view.x, p.view.y, p.view.w, p.view.h] : [])].map(Math.round).join(',');

/** The place in a request's `?place=`; anything else is none. */
export function parsePlace(s: string | null | undefined): Place | undefined {
  const n = s?.split(',').map(Number) ?? [];
  if ((n.length !== 2 && n.length !== 6) || !n.every(Number.isFinite)) return undefined;
  const [x, y, vx, vy, vw, vh] = n as [number, number, number?, number?, number?, number?];
  return { x, y, ...(vw !== undefined && vw > 0 && vh! > 0 ? { view: { x: vx!, y: vy!, w: vw, h: vh! } } : {}) };
}

/** Places new projects in a roughly square grid of columns below everything already on the canvas. */
export function placeProjects(existing: Bounds | null, sizes: [number, number][]): { x: number; y: number }[] {
  const x0 = existing?.x ?? 0;
  let y = existing ? existing.y + existing.h + PROJECT_GAP * 2 : 0;
  const colW = Math.max(...sizes.map(([w]) => w), 0) + PROJECT_GAP;
  const cols = Math.max(2, Math.ceil(Math.sqrt(sizes.length)));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < sizes.length; i += cols) {
    const row = sizes.slice(i, i + cols);
    row.forEach((_, j) => out.push({ x: x0 + j * colW, y }));
    y += Math.max(...row.map(([, h]) => h)) + PROJECT_GAP;
  }
  return out;
}
