import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS, NewerDatabase, Store } from './db';

test('a database a newer Obeya wrote is left alone, not opened', () => {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-db-'));
  try {
    const path = join(dir, 'obeya.db');
    new Store(path).db.close();
    const newer = new Database(path);
    newer.run(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    newer.close();
    expect(() => new Store(path)).toThrow(NewerDatabase);
    const after = new Database(path);
    expect((after.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(MIGRATIONS.length + 1);
    after.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an idea decided as a project keeps the mark, and a card still being cut is planned again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-db-'));
  try {
    const path = join(dir, 'obeya.db');
    const s = new Store(path);
    s.ensureCanvas('c', 'C');
    const [idea, cut] = s.insert([
      { canvas_id: 'c', kind: 'task', state: 'planned', idea: JSON.stringify({ status: 'open', brief: 'B', project: true }), x: 0, y: 0 },
      { canvas_id: 'c', kind: 'task', state: 'planned', x: 0, y: 1 },
    ]);
    s.update(cut!.id, { queue: JSON.stringify({ cutting: true }) });
    s.db.close();
    // the store as it stood before the migration: without the columns and tables it and the later ones add
    const at = MIGRATIONS.findIndex((m) => m.includes('ADD COLUMN becomes_project'));
    const before = new Database(path);
    for (const [, table, column] of MIGRATIONS.slice(at).join('\n').matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)) before.run(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    for (const [, table] of MIGRATIONS.slice(at).join('\n').matchAll(/CREATE TABLE (\w+)/g)) before.run(`DROP TABLE ${table}`);
    before.run(`PRAGMA user_version = ${at}`);
    before.close();
    const after = new Store(path);
    expect(after.card(idea!.id)).toMatchObject({ becomes_project: 1, idea: JSON.stringify({ status: 'open', brief: 'B' }) });
    expect(after.card(cut!.id)).toMatchObject({ becomes_project: 0, queue: null });
    after.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
