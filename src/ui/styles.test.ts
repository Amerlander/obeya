import { expect, test } from 'bun:test';

// The app's webview is WebKit (macOS, WebKitGTK on Linux), which knows `user-select` only by its
// prefix: without it, dragging a card selects some of its text there.
test('every user-select in the stylesheet also carries its -webkit- prefix', async () => {
  const css = await Bun.file(new URL('./styles.css', import.meta.url)).text();
  const rules = css.split('}').filter((r) => /(^|[^-])user-select:/.test(r));
  expect(rules.length).toBeGreaterThan(0);
  for (const r of rules) {
    const plain = [...r.matchAll(/(?:^|[^-])user-select:\s*(\w+)/g)].map((m) => m[1]);
    const prefixed = [...r.matchAll(/-webkit-user-select:\s*(\w+)/g)].map((m) => m[1]);
    expect({ rule: r.trim(), prefixed }).toEqual({ rule: r.trim(), prefixed: plain });
  }
});
