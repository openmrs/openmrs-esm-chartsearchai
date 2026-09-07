import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import en from '../translations/en.json';

/**
 * `t('key', 'default')` reads its value from `translations/en.json` whenever the key is present
 * there, and `yarn extract-translations` only ADDS missing keys — it never rewrites an existing
 * value. So correcting a user-facing string in code does nothing on its own: the old wording
 * keeps shipping, silently and with a passing build.
 *
 * That is not hypothetical. Three wording corrections in one review pass — a severity caveat, a
 * navigation promise the code could not keep, and a heading that implied one check spoke for the
 * whole answer — were all written in the component, all extracted clean, and all still rendered
 * with their old text in a browser, because the keys already existed.
 */
const CALL = /\bt\(\s*'([A-Za-z0-9_]+)'\s*,\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/gs;

function unquote(raw: string): string {
  return raw.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"');
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && full.endsWith('.tsx') && !full.endsWith('.test.tsx') ? [full] : [];
  });
}

describe('translations/en.json', () => {
  const catalogue = en as Record<string, string>;
  const defaults = new Map<string, { file: string; text: string }>();

  for (const file of sourceFiles(path.join(__dirname))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, key, raw] of source.matchAll(CALL)) {
      defaults.set(key, { file: path.basename(file), text: unquote(raw) });
    }
  }

  it('finds the in-code defaults it is meant to be checking', () => {
    // An empty sweep would make every assertion below pass while examining nothing.
    expect(defaults.size).toBeGreaterThan(20);
    expect(defaults.has('checkCoverage')).toBe(true);
  });

  it('ships the same wording the code states as its default', () => {
    const drift = [...defaults]
      .filter(([key, { text }]) => key in catalogue && catalogue[key] !== text)
      .map(([key, { file, text }]) => `${key} (${file})\n  en.json: ${catalogue[key]}\n  code:    ${text}`);
    expect(drift).toEqual([]);
  });

  it('has a catalogue entry for every key the UI asks for', () => {
    expect([...defaults.keys()].filter((key) => !(key in catalogue))).toEqual([]);
  });
});
