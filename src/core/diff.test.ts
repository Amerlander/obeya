import { describe, expect, test } from 'bun:test';
import { cardDiff, diffFiles, diffSize, PATCH_LIMIT, splitDiff } from './diff';

const patch = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@ export function a',
  ' const x = 1;',
  '-const y = 2;',
  '+const y = 3;',
  '+const z = 4;',
  ' // --- not a header',
  'diff --git a/old name.md b/new name.md',
  'similarity index 90%',
  'rename from old name.md',
  'rename to new name.md',
  '--- a/old name.md',
  '+++ b/new name.md\t',
  '@@ -1 +1 @@',
  '-Hallo',
  '+Hallo Welt',
  'diff --git a/gone.txt b/gone.txt',
  'deleted file mode 100644',
  'index 3333333..0000000',
  '--- a/gone.txt',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-eins',
  '-zwei',
  'diff --git a/logo.png b/logo.png',
  'new file mode 100644',
  'index 0000000..4444444',
  'Binary files /dev/null and b/logo.png differ',
].join('\n');

describe('a card’s diff', () => {
  test('splits into files with what each adds and removes, new, deleted, renamed and binary ones told apart', () => {
    expect(diffFiles(patch)).toEqual([
      { file: 'src/a.ts', status: 'modified', added: 2, removed: 1 },
      { file: 'new name.md', from: 'old name.md', status: 'renamed', added: 1, removed: 1 },
      { file: 'gone.txt', status: 'deleted', added: 0, removed: 2 },
      { file: 'logo.png', status: 'added', added: 0, removed: 0, binary: true },
    ]);
    expect(diffSize(diffFiles(patch))).toEqual({ added: 3, removed: 4 });
    // each file keeps its lines, from its `diff --git` line on
    expect(splitDiff(patch)[0]!.lines).toHaveLength(10);
  });

  test('an empty diff has no files', () => {
    expect(diffFiles('')).toEqual([]);
  });

  test('the whole diff only when asked for, cut off at a file’s end past the limit', () => {
    expect(cardDiff('branch', patch, false)).toEqual({ source: 'branch', files: diffFiles(patch) });
    expect(cardDiff('landed', patch, true).patch).toBe(patch);
    const big = `${patch}\n${`diff --git a/big.txt b/big.txt\n@@ -0,0 +1 @@\n+${'x'.repeat(PATCH_LIMIT)}`}`;
    const cut = cardDiff('branch', big, true);
    expect(cut.truncated).toBe(true);
    expect(cut.patch).toBe(patch);
    // the list still names every file
    expect(cut.files.map((f) => f.file)).toContain('big.txt');
  });
});
