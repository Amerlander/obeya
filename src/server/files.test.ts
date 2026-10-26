import { expect, test } from 'bun:test';
import { filesIn, safeName } from './files';

test("a file's name goes into a path as one word, its extension kept", () => {
  expect(safeName('Rechnung März 2026.pdf')).toBe('Rechnung-März-2026.pdf');
  expect(safeName('../../etc/passwd')).toBe('passwd');
  expect(safeName('C:\\Users\\me\\log (1).txt')).toBe('log-1.txt');
  expect(safeName('.env')).toBe('env');
  expect(safeName('')).toBe('file');
});

test('the stored files a text names are found by their directories, each once', () => {
  const root = '/home/o/.obeya/files';
  const a = `${root}/shop/0b8e1c1e-2f4a-4e8e-9d3c-1f2e3d4c5b6a`;
  const b = `${root}/shop/9f8e7d6c-5b4a-4321-8765-0a1b2c3d4e5f`;
  const text = `Schau dir ${a}/Rechnung.pdf an und ${b}/log.txt, nochmal ${a}/Rechnung.pdf. Nicht /tmp/x/${a.slice(-36)}/y`;
  expect(filesIn(text, root)).toEqual([a, b]);
  expect(filesIn('nichts', root)).toEqual([]);
});
