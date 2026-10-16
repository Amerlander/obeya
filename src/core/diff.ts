// What a card's work changes in its repository, as `git diff` shows it: the server sums it up for
// the line beside the card's branch, the UI shows it file by file.

/** A card's change: the branch in its workspace so far, or what landed. */
export interface CardDiff {
  /** `branch`: the workspace's branch against the default branch, committed or not; `landed`: what the landing put on the default branch. */
  source: 'branch' | 'landed';
  files: DiffFile[];
  /** The whole diff, when it was asked for; cut off at `PATCH_LIMIT` characters (`truncated`). */
  patch?: string;
  truncated?: true;
}

export interface DiffFile {
  /** The file as it is now (as it was, for a deleted one). */
  file: string;
  /** A renamed file: its name before. */
  from?: string;
  status: 'added' | 'deleted' | 'renamed' | 'modified';
  added: number;
  removed: number;
  binary?: true;
}

/** How much of a diff goes to the page: beyond it, it is cut off at a file's end. */
export const PATCH_LIMIT = 2_000_000;

/** One file's part of a `git diff`: the summary, and its lines from the `diff --git` line on. */
export interface DiffPart extends DiffFile {
  lines: string[];
}

/** A `git diff` split into its files, each with what it adds and removes. */
export function splitDiff(patch: string): DiffPart[] {
  const out: DiffPart[] = [];
  let header = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      // the names as the header line has them; `---`/`+++` or `rename` lines correct them below
      const names = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      out.push({ file: names?.[2] ?? line.slice(11), status: 'modified', added: 0, removed: 0, lines: [line] });
      header = true;
      continue;
    }
    const cur = out.at(-1);
    if (!cur) continue;
    cur.lines.push(line);
    if (header) {
      if (line.startsWith('@@')) header = false;
      else if (line.startsWith('new file mode')) cur.status = 'added';
      else if (line.startsWith('deleted file mode')) cur.status = 'deleted';
      else if (line.startsWith('rename from ')) [cur.status, cur.from] = ['renamed', line.slice(12)];
      else if (line.startsWith('rename to ')) cur.file = line.slice(10);
      // git ends a name with a space in it with a tab here
      else if (line.startsWith('+++ b/')) cur.file = line.slice(6).replace(/\t$/, '');
      else if (line.startsWith('--- a/') && cur.status === 'deleted') cur.file = line.slice(6).replace(/\t$/, '');
      else if (line.startsWith('Binary files ') || line === 'GIT binary patch') cur.binary = true;
      continue;
    }
    if (line.startsWith('+')) cur.added++;
    else if (line.startsWith('-')) cur.removed++;
  }
  return out;
}

/** The files of a diff without their lines. */
export const diffFiles = (patch: string): DiffFile[] => splitDiff(patch).map(({ lines: _, ...f }) => f);

/** Lines added and removed over all files. */
export function diffSize(files: DiffFile[]): { added: number; removed: number } {
  return files.reduce((s, f) => ({ added: s.added + f.added, removed: s.removed + f.removed }), { added: 0, removed: 0 });
}

/** A card's change from its whole diff: the files, and the diff itself when asked for (cut off at a file's end past `PATCH_LIMIT`). */
export function cardDiff(source: CardDiff['source'], patch: string, full: boolean): CardDiff {
  const files = diffFiles(patch);
  if (!full) return { source, files };
  if (patch.length <= PATCH_LIMIT) return { source, files, patch };
  const cut = patch.lastIndexOf('\ndiff --git ', PATCH_LIMIT);
  return { source, files, patch: patch.slice(0, cut > 0 ? cut : PATCH_LIMIT), truncated: true };
}

/** The lines of `before` and `after` as a diff: each kept (` `), gone (`-`) or new (`+`), in order (longest common subsequence). */
export function lineDiff(before: string[], after: string[]): { kind: ' ' | '-' | '+'; line: string }[] {
  const n = before.length;
  const m = after.length;
  // common[i][j]: the longest common subsequence of before[i..] and after[j..]
  const common = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) common[i]![j] = before[i] === after[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
  const out: { kind: ' ' | '-' | '+'; line: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) {
      out.push({ kind: ' ', line: before[i]! });
      i++;
      j++;
    } else if (i < n && (j === m || common[i + 1]![j]! >= common[i]![j + 1]!)) out.push({ kind: '-', line: before[i++]! });
    else out.push({ kind: '+', line: after[j++]! });
  }
  return out;
}
