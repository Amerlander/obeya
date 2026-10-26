// Files the owner drops into what they write that are no screenshots (a PDF, a log, a spreadsheet):
// a browser does not tell where the file lies on the owner's machine, so Obeya keeps a copy under
// its home and the field gets that copy's path, for the agent to read the file there.

import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { MAX_FILE_BYTES } from '../core/types';
import { BadRequest } from './board';

/** The file's name as it goes into a path: one word an agent reads as a path, its letters and extension kept. */
export function safeName(name: string): string {
  const s = basename(name.replace(/\\/g, '/'))
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[.-]+/, '')
    .replace(/-+(\.[^.]*)?$/, '$1');
  return s.slice(-120) || 'file';
}

export class Files {
  constructor(readonly dir: string) {}

  /** Stores an uploaded file, each in a directory of its own so its name stays; returns its path. */
  save(bytes: Uint8Array, name: string): string {
    if (bytes.length > MAX_FILE_BYTES) throw new BadRequest('fileTooLarge', `a file may have at most ${MAX_FILE_BYTES} bytes`);
    const dir = join(this.dir, crypto.randomUUID());
    mkdirSync(dir, { recursive: true });
    const path = join(dir, safeName(name));
    writeFileSync(path, bytes);
    return path;
  }
}

/** The stored files `text` names by path, under `root` (Obeya's `files` directory): the directory of each, which holds it alone. */
export function filesIn(text: string, root: string): string[] {
  const at = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dirs = [...text.matchAll(new RegExp(`${at}[\\\\/][^\\\\/\\s]+[\\\\/][0-9a-f-]{36}(?=[\\\\/])`, 'g'))].map((m) => m[0]);
  return [...new Set(dirs)];
}
