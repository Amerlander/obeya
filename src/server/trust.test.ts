import { describe, expect, test } from 'bun:test';
import { canonical, commandsOf, heldGroups, trustTakenOver, withoutHeld } from './trust';

const site = { title: 'Demos', url: 'https://demos.example.dev', deploy: 'wrangler pages deploy {dir}', maxFile: 1000 };

describe("a repository's commands", () => {
  test('are its stop and keep, what of its demo site is run and contacted, and its Claude Code settings; what is empty is none', () => {
    expect(commandsOf({ settings: { checks: ['bun test'], app: { run: 'bun dev', stop: 'make stop', keep: ' ' }, demo: { site } }, claude: { '.mcp.json': { id: 'a1', text: '{}' } } })).toEqual({
      app: { stop: 'make stop' },
      site: { url: site.url, deploy: site.deploy },
      claude: { '.mcp.json': { id: 'a1', text: '{}' } },
    });
    expect(commandsOf({ settings: { app: { run: 'bun dev' } } })).toEqual({});
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(canonical({ a: { c: 3, d: 2 }, b: 1 }));
  });

  test("are held where they differ from what the owner trusted, unless this machine's values stand in for all of a group", () => {
    const now = { app: { stop: 'make stop' }, site: { url: site.url, deploy: site.deploy }, claude: { '.mcp.json': { id: 'a1', text: '{}' } } };
    expect(heldGroups(now, null)).toEqual(['app', 'site', 'claude']);
    expect(heldGroups(now, { ...now, app: { stop: 'other' } })).toEqual(['app']);
    expect(heldGroups(now, now)).toEqual([]);
    expect(heldGroups(now, null, { app: { stop: 'x', keep: 'y' }, demo: { site } })).toEqual(['claude']);
    // a stop of this machine's alone leaves the repository's keep held
    expect(heldGroups(now, null, { app: { stop: 'x' } })).toEqual(['app', 'site', 'claude']);
    // a site that starts publishing every approved demo by itself is held, as a new deploy would be
    const published = commandsOf({ settings: { demo: { site: { ...site, publish: 'approved' } } } });
    expect(published.site).toEqual({ url: site.url, deploy: site.deploy, publish: 'approved' });
    expect(heldGroups(published, now)).toEqual(['site']);
  });

  test('held, they go from the settings, the rest of their fields stays', () => {
    const s = { checks: ['bun test'], app: { run: 'bun dev', stop: 'make stop' }, demo: { site } };
    expect(withoutHeld(s, ['app', 'site'])).toEqual({ checks: ['bun test'], app: { run: 'bun dev' } });
    expect(withoutHeld({ app: { stop: 'make stop' } }, ['app'])).toEqual({});
    expect(withoutHeld(s, ['claude'])).toEqual(s);
  });

  test("taken over from this machine's values into the file, they are the owner's own", () => {
    expect(trustTakenOver(null, { app: { stop: 'make stop', run: 'bun dev' } }, { app: { stop: 'make stop' } })).toEqual({ app: { stop: 'make stop' } });
    // a keep the owner trusted before, beside the stop of theirs
    expect(trustTakenOver({ app: { keep: 'k' } }, { app: { stop: 's', keep: 'k' } }, { app: { stop: 's' } })).toEqual({ app: { stop: 's', keep: 'k' } });
    // a trusted keep that went, beside a stop that stays, is not: the stop now stops what it kept
    expect(trustTakenOver({ app: { stop: 's', keep: 'k' } }, { app: { stop: 's' } }, undefined)).toBeNull();
    // someone else's stop that came with it is not
    expect(trustTakenOver(null, { app: { stop: 'evil' }, checks: ['x'] }, { checks: ['x'] })).toBeNull();
    expect(trustTakenOver(null, { demo: { site } }, { demo: { site } })).toEqual({ site: { url: site.url, deploy: site.deploy } });
  });
});
