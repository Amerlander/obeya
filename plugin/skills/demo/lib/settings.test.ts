import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeDemoSettings, narrationPerson, readDemoSettings, tidyDemoSettings, withVoice, writeDemoSettings } from './settings.ts';

let home: string;
beforeEach(() => (home = mkdtempSync(join(tmpdir(), 'obeya-demo-settings-'))));
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('demo settings', () => {
  test('without a file, a demo is narrated by Piper in the language Obeya speaks to the owner', () => {
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ language: 'de' }));
    expect(readDemoSettings(home)).toEqual({ language: 'de', voice: 'piper' });
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ language: 'en' }));
    expect(readDemoSettings(home)).toEqual({ language: 'en', voice: 'piper' });
    // a file without a language takes it from there too
    writeFileSync(join(home, 'demo.json'), JSON.stringify({ voice: 'say' }));
    expect(readDemoSettings(home)).toEqual({ language: 'en', voice: 'say' });
  });

  test('keep what is valid and fall back to the defaults for the rest', () => {
    expect(tidyDemoSettings({ language: 'fr', voice: 'command', command: '  ', url: ' x ', extra: 1 })).toEqual({ language: 'de', voice: 'command', url: 'x' });
    expect(tidyDemoSettings({ voice: 'nope', ownVoice: 'yes' })).toEqual({ language: 'de', voice: 'piper' });
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ language: 'de' }));
    writeFileSync(join(home, 'demo.json'), 'not json');
    expect(readDemoSettings(home)).toEqual({ language: 'de', voice: 'piper' });
  });

  test('are written to and read from the home', () => {
    writeDemoSettings({ language: 'en', voice: 'command', command: 'speak', ownVoice: true }, home);
    expect(readDemoSettings(home)).toEqual({ language: 'en', voice: 'command', command: 'speak', ownVoice: true });
  });

  test('take the voice of one render from DEMO_VOICE: a provider, or a clip to clone', () => {
    const saved = { language: 'en', voice: 'command', command: 'speak', ownVoice: true } as const;
    expect(withVoice(saved, undefined)).toBe(saved);
    expect(withVoice(saved, 'gemini')).toEqual({ language: 'en', voice: 'gemini', command: 'speak' });
    expect(withVoice(saved, '/tmp/someone.wav')).toEqual({ language: 'en', voice: 'qwen3', reference: '/tmp/someone.wav' });
    expect(() => withVoice(saved, 'robot')).toThrow('unknown voice');
  });

  test("speak in the first person only in the owner's own voice", () => {
    expect(narrationPerson({ ownVoice: true })).toBe('first');
    expect(narrationPerson({})).toBe('third');
    expect(describeDemoSettings({ language: 'en', voice: 'piper' }, undefined)).toContain('in English');
    expect(describeDemoSettings({ language: 'de', voice: 'command', ownVoice: true }, undefined)).toContain('person: first');
    // another voice for one render is nobody's own, unless the settings say so
    expect(describeDemoSettings({ language: 'de', voice: 'command', ownVoice: true }, '/tmp/x.wav')).toContain('person: third');
  });
});
