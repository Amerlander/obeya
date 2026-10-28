import { describe, expect, test } from 'bun:test';
import { missedChanges, type PageChange, PAGE_CHANGES, pagesVersion } from './page-changes';

describe('the changes a shared page lacks', () => {
  const changes: PageChange[] = [
    { id: '2026-01-01-a', kinds: ['video', 'html'] },
    { id: '2026-02-01-b', kinds: ['html'] },
    { id: '2026-03-01-c', kinds: ['video'] },
  ];
  const ids = (version: string | undefined, kind: 'video' | 'html') => missedChanges(version, kind, changes).map((c) => c.id);

  test('those after the one it was published after, that show on its kind of page', () => {
    expect(ids('2026-01-01-a', 'video')).toEqual(['2026-03-01-c']);
    expect(ids('2026-01-01-a', 'html')).toEqual(['2026-02-01-b']);
    expect(ids('2026-03-01-c', 'html')).toEqual([]);
  });

  test('a page from before them all, or with a version no change has, lacks every one of its kind', () => {
    expect(ids('', 'html')).toEqual(['2026-01-01-a', '2026-02-01-b']);
    expect(ids(undefined, 'video')).toEqual(['2026-01-01-a', '2026-03-01-c']);
    expect(ids('9aef9b8395b7', 'video')).toEqual(['2026-01-01-a', '2026-03-01-c']);
  });

  test('a change that shows only on pages with tags leaves none outdated: pages from before it had none', () => {
    const tagged: PageChange[] = [...changes, { id: '2026-04-01-tags', kinds: ['video', 'html'], tagged: true }];
    expect(missedChanges('2026-03-01-c', 'video', tagged)).toEqual([]);
    expect(pagesVersion(tagged)).toBe('2026-04-01-tags');
  });

  test('a page published now lacks none', () => {
    expect(pagesVersion(changes)).toBe('2026-03-01-c');
    expect(pagesVersion([])).toBe('');
    expect(missedChanges(pagesVersion(), 'video', PAGE_CHANGES)).toEqual([]);
    expect(missedChanges(pagesVersion(), 'html', PAGE_CHANGES)).toEqual([]);
  });
});
