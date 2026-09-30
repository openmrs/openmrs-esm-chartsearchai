import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JsxLexer } from 'i18next-parser';
import en from '../translations/en.json';

/**
 * `t('key', 'default')` reads its value from `translations/en.json` whenever the key is present
 * there, and `yarn extract-translations` only ADDS missing keys — it never rewrites an existing
 * value. So correcting a user-facing string in code does nothing on its own: the old wording
 * keeps shipping, silently and with a passing build.
 *
 * That is not hypothetical. Four wording corrections across two review passes — a severity
 * caveat, a navigation promise the code could not keep, a heading that implied one check spoke
 * for the whole answer, and a citation warning that claimed more than the backend does — were
 * all written in the component, all extracted clean, and all still rendered with their old text
 * in a browser, because the keys already existed.
 *
 * Uses `i18next-parser`'s own `JsxLexer` — the lexer `yarn extract-translations` runs — rather
 * than a private regex, so it cannot recognise a different SHAPE of call than the extractor
 * does. The file SET is deliberately wider: the extractor globs only `*.component.tsx` files
 * under `src`, and this sweeps every non-test `.ts` and `.tsx` there. One consequence worth knowing: a
 * `t()` default outside a `*.component.tsx` fails the catalogue assertion below and no run of
 * `yarn extract-translations` can add its key — it has to be added to `en.json` by hand.
 *
 * It also reports every OCCURRENCE rather than one per key, which a hand-rolled
 * last-wins scan could not: three call sites shared one key here, and a correction that reached
 * two of them plus the catalogue would have left the third stale and this file green.
 */
interface Occurrence {
  file: string;
  text: string;
}

/**
 * The catalogue keys a call reads, each with the text it should hold. A call passing `count` never
 * reads its bare key: i18next resolves `key_one` / `key_other` (English's two plural categories),
 * and `yarn extract-translations` writes exactly those — `_one` from `defaultValue`, `_other` from
 * `defaultValue_other` where the call gives one and from `defaultValue` where it does not. So
 * requiring the bare key here would contradict CI's "Verify translations" step.
 */
function catalogueEntries(entry: {
  key: string;
  defaultValue: string;
  count?: unknown;
  defaultValue_other?: string;
}): Array<[string, string]> {
  if (entry.count === undefined) return [[entry.key, entry.defaultValue]];
  return [
    [`${entry.key}_one`, entry.defaultValue],
    [`${entry.key}_other`, entry.defaultValue_other ?? entry.defaultValue],
  ];
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!entry.isFile() || /\.test\.tsx?$/.test(full)) return [];
    // `.ts` as well as `.tsx`: a `t()` default in a util or the config schema would otherwise
    // drift undetected. (None today — the omission is the hazard, not a current bug.)
    return /\.tsx?$/.test(full) ? [full] : [];
  });
}

const occurrences = new Map<string, Occurrence[]>();
const pluralKeys = new Set<string>();
for (const file of sourceFiles(__dirname)) {
  const source = fs.readFileSync(file, 'utf8');
  for (const entry of new JsxLexer().extract(source, file) as Array<{
    key: string;
    defaultValue?: string;
    count?: unknown;
    defaultValue_other?: string;
  }>) {
    if (entry.defaultValue === undefined) continue;
    if (entry.count !== undefined) pluralKeys.add(entry.key);
    for (const [catalogueKey, text] of catalogueEntries({ ...entry, defaultValue: entry.defaultValue })) {
      const found = occurrences.get(catalogueKey) ?? [];
      found.push({ file: path.basename(file), text });
      occurrences.set(catalogueKey, found);
    }
  }
}

describe('translations/en.json', () => {
  const catalogue = en as Record<string, string>;

  it('finds the in-code defaults it is meant to be checking', () => {
    // A sweep that discovered nothing would make every assertion below pass while examining
    // nothing — the failure mode this whole file exists to catch, one level up.
    expect(occurrences.size).toBeGreaterThan(20);
    expect(occurrences.get('aboutAnEndedOrder')?.length).toBe(1);
  });

  it('states one default per key, however many call sites use it', () => {
    // Two call sites disagreeing is a bug on its own: the same citation would be described two
    // ways depending on which surface the clinician hovered.
    const disagreeing = [...occurrences]
      .filter(([, found]) => new Set(found.map((entry) => entry.text)).size > 1)
      .map(([key, found]) => `${key}: ${found.map((entry) => `${entry.file} → ${entry.text}`).join(' | ')}`);
    expect(disagreeing).toEqual([]);
  });

  it('ships the same wording the code states as its default', () => {
    const drift = [...occurrences]
      .filter(([key, found]) => key in catalogue && found.some((entry) => catalogue[key] !== entry.text))
      .map(([key, found]) => `${key} (${found[0].file})\n  en.json: ${catalogue[key]}\n  code:    ${found[0].text}`);
    expect(drift).toEqual([]);
  });

  it('has a catalogue entry for every key the UI asks for', () => {
    expect([...occurrences.keys()].filter((key) => !(key in catalogue))).toEqual([]);
  });

  it('recognises a counted call as plural, so the keys above are the ones it reads', () => {
    // Without this, a lexer that stopped reporting `count` would make every plural call look
    // singular and send the two checks above back to asking for a key i18next never reads.
    expect(pluralKeys.has('withheldInteractions')).toBe(true);
  });

  it("reads a counted call's own plural default into its _other key", () => {
    // Without this, a lexer that stopped reporting `defaultValue_other` would compare the plural
    // wording against the singular and pass only while the two happen to be equal.
    expect(occurrences.get('safetyChecksCitedInTheAnswer_other')?.[0]?.text).toBe(
      '{{count}} findings, each cited in the answer',
    );
  });
});
