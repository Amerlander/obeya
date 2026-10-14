import { describe, expect, test } from 'bun:test';
import { CLONES, type Item, openPerGroup, type ResolvedCanvas, withClones } from './types';

const card = (over: Partial<Item>): Item => ({ id: 'x', kind: 'task', state: 'planned', title: '', body: '', x: 0, y: 0, source: 'manual', repo: 'r', ...over });

describe('openPerGroup', () => {
  test('counts the cards still to be done, a project by its workstreams', () => {
    const open = openPerGroup([
      card({ group: 'a', state: 'working' }),
      card({ group: 'a', state: 'waiting' }),
      card({ group: 'a', state: 'live' }),
      card({ group: 'a', state: 'done' }),
      card({ group: 'a', archivedAt: '2026-10-01' }),
      card({ group: 'a', state: 'idea', idea: { status: 'dropped', brief: '', thinking: false, yourTurn: false, questions: [], variants: [], mocks: [] } }),
      card({ group: 'b', kind: 'project' }),
      card({ group: 'b', parent: 'p', state: 'planned' }),
      card({ group: 'c', state: 'live' }),
      card({ state: 'working' }),
    ]);
    expect([...open]).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
    // a group whose cards are all done has none open
    expect(open.get('c')).toBeUndefined();
  });
});

describe('withClones', () => {
  const at = (...workspaces: ('clones' | 'worktrees')[]): ResolvedCanvas => ({ id: 'c', name: 'c', repos: workspaces.map((w) => ({ id: 'r', adapter: 'generic', workspaces: w, values: {} as never, shareTo: 'main' })) });

  test('fills in a repository added in clones, once per path', () => {
    const saved = [{ repos: [{ path: '/a' }] }];
    const filled = new Set<string>();
    const draft = [{ repos: [{ path: '/a' }, { path: '/b' }] }];
    const next = withClones(draft, saved, [at('clones', 'clones')], filled);
    expect(next).toEqual([{ repos: [{ path: '/a' }, { path: '/b', clones: CLONES }] }]);
    // emptied again, it stays empty
    expect(withClones(draft, saved, [at('clones', 'clones')], filled)).toBeNull();
  });

  test('leaves worktrees, counts of its own and repositories not checked yet', () => {
    const draft = [{ repos: [{ path: '/w' }, { path: '/n', clones: 0 }, { path: '/l', workspaces: ['/x'] }, { path: '' }] }, { repos: [{ path: '/u' }] }];
    expect(withClones(draft, [], [at('worktrees', 'clones', 'clones', 'clones'), null], new Set())).toBeNull();
  });
});
