// The note on a repository's plan directory, beside the projects on the canvas: the docs there
// that are not projects, each with its reason and "Als Projekt aufbereiten", or, while the
// repository has no plan doc yet, where the first one goes.

import { type Bounds, unionBounds } from '../core/layout';
import type { Item, PlanDir } from '../core/types';
import { t } from './strings';

const NOTE_W = 380;
/** Between the note and the projects below it. */
const NOTE_GAP = 40;

/** How tall the note is, about: the camera keeps it in sight as it does the cards. It stands on the bottom of its box. */
function noteHeight(d: PlanDir): number {
  const mixed = new Set(d.others.map((o) => o.reason)).size > 1;
  return d.empty ? 92 : 64 + d.others.length * (mixed ? 48 : 34);
}

/**
 * Where each note stands: side by side above the top left of the projects (of all cards, while
 * there are none), so that a card started from a note, which goes right of everything, leaves it where it was.
 */
export function planDirBoxes(dirs: PlanDir[], placed: { item: Item; b: Bounds }[]): Bounds[] {
  const top = placed.filter(({ item }) => !item.parent);
  const projects = top.filter(({ item }) => item.kind === 'project');
  const at = unionBounds((projects.length ? projects : top).map((p) => p.b)) ?? { x: 0, y: 0, w: 0, h: 0 };
  const h = Math.max(...dirs.map(noteHeight));
  return dirs.map((_, n) => ({ x: at.x + n * (NOTE_W + NOTE_GAP), y: at.y - NOTE_GAP - h, w: NOTE_W, h }));
}

export function PlanDirNote({
  dir,
  b,
  repo,
  onPrepare,
  onOpen,
  onChange,
}: {
  dir: PlanDir;
  b: Bounds;
  /** The repository's name, when the canvas has several. */
  repo?: string;
  onPrepare: (dir: PlanDir, file: string) => void;
  onOpen: (cardId: string) => void;
  onChange: () => void;
}) {
  const where = repo ? `${repo}: ${dir.dir}` : dir.dir;
  const reasons = new Set(dir.others.map((o) => o.reason));
  const one = reasons.size === 1 ? t.planDir.reason[dir.others[0]!.reason] : null;
  return (
    // the canvas would take a press here as the start of a pan
    <div className={dir.empty ? 'plan-dir empty-dir' : 'plan-dir'} style={{ left: b.x, top: b.y + b.h, width: b.w }} onPointerDown={(e) => e.stopPropagation()}>
      {dir.empty ? (
        <p>
          {t.planDir.empty(where)}{' '}
          <button className="link" title={t.planDir.changeHint} onClick={onChange}>
            {t.planDir.change}
          </button>
        </p>
      ) : (
        <>
          <div className="pd-head">{t.planDir.notProjects(where, dir.others.length)}</div>
          {one && <div className="pd-why">{one}</div>}
          {dir.others.map((o) => (
            <div key={o.file} className="pd-doc">
              <span className="pd-file" title={o.file}>
                <span className="pd-name">{o.file.slice(o.file.lastIndexOf('/') + 1)}</span>
                {!one && <span className="pd-why">{t.planDir.reason[o.reason]}</span>}
              </span>
              {o.preparing ? (
                <button className="link" onClick={() => onOpen(o.preparing!)}>
                  {t.planDir.preparing}
                </button>
              ) : (
                <button className="btn small" title={t.planDir.prepareHint} onClick={() => onPrepare(dir, o.file)}>
                  {t.planDir.prepare}
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
