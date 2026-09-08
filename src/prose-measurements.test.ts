import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Guards the two classes of number that this slice has had to correct in four consecutive
 * hardening cycles. Both rot for the same reason: they are measurements written into prose, so
 * nothing fails when the thing they measured moves.
 *
 * The corpus rating count drifted FOUR times (94 where others said 98; then 98 after the
 * canonical figure moved to 85; then 85 after it moved to 80; then 85 again in two more homes).
 * One of those stale figures sat in the paragraph that licensed re-adding a restriction "at no
 * cost", and re-adding it cost a swapped Major/Moderate pair. A test count in a comment went
 * stale twice and carries no information a reader needs.
 *
 * So: the current corpus figure has exactly ONE home, and a test count in a comment has none.
 * Historical measurements are welcome — "the then-98 baseline", "98 -> 74" — because they are
 * dated by their own wording and do not claim to be current.
 */
const CANONICAL = 'src/utils/safety-disclosure.ts';

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(full) ? [full] : [];
  });
}

/** A comment line, with its leading marker stripped. */
function commentLines(text: string): Array<{ line: number; body: string }> {
  return text.split('\n').flatMap((raw, i) => {
    const body = raw.trim();
    if (!body.startsWith('//') && !body.startsWith('*')) return [];
    return [{ line: i + 1, body }];
  });
}

/** "renders 80 ratings today", "unchanged at 80 ratings", "the 46-answer corpus (80 ratings)". */
const CURRENT_CORPUS = /(?:renders|unchanged at|stays at|corpus \()\s*\d+\s*(?:correct\s+)?ratings/i;

/** Three-digit test counts: "288 tests", "all 310 tests". */
const TEST_COUNT = /\b\d{3}\s+tests\b/;

describe('measurements written into prose', () => {
  const files = sourceFiles(path.join(__dirname));

  it('states the corpus’s CURRENT rating count in exactly one place', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const { line, body } of commentLines(text)) {
        if (!CURRENT_CORPUS.test(body)) continue;
        // The canonical note is the one home. Everything else must point at it instead.
        if (path.relative(process.cwd(), file) === path.normalize(CANONICAL)) continue;
        offenders.push(`${path.relative(__dirname, file)}:${line}  ${body.slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never states a test count in a comment', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const { line, body } of commentLines(fs.readFileSync(file, 'utf8'))) {
        if (TEST_COUNT.test(body)) offenders.push(`${path.relative(__dirname, file)}:${line}  ${body.slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('finds the comments it is meant to be scanning', () => {
    // A sweep that discovered nothing would pass both assertions above while examining nothing.
    const total = files.reduce((n, f) => n + commentLines(fs.readFileSync(f, 'utf8')).length, 0);
    expect(total).toBeGreaterThan(500);
    expect(files.length).toBeGreaterThan(10);
  });
});
