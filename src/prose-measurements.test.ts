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

/** The shipped README states the same figures, so it is scanned as prose too. */
const EXTRA_PROSE = ['README.md'];

/**
 * This file is exempt from the content patterns, because it has to NAME the shapes it forbids in
 * order to describe them. It is not exempt from the structural checks.
 */
const SELF = 'prose-measurements.test.ts';

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(full) ? [full] : [];
  });
}

/** Whether a trimmed line is inside a comment. `/*` openers count: a splice can land on one. */
function isCommentLine(body: string): boolean {
  return body.startsWith('//') || body.startsWith('*') || body.startsWith('/*');
}

/** A comment line, with its leading marker stripped. */
function commentLines(text: string): Array<{ line: number; body: string }> {
  return text.split('\n').flatMap((raw, i) => (isCommentLine(raw.trim()) ? [{ line: i + 1, body: raw.trim() }] : []));
}

/**
 * Consecutive comment lines JOINED into one string per block.
 *
 * Scanning line by line is a false negative for any claim that wraps, and that is not
 * hypothetical: "288 / tests" split across a line boundary sat live in this repo while the
 * test-count assertion below was green. A claim is a sentence, not a line.
 */
function commentBlocks(text: string): Array<{ line: number; body: string }> {
  const blocks: Array<{ line: number; body: string }> = [];
  let open: { line: number; parts: string[] } | undefined;
  text.split('\n').forEach((raw, i) => {
    const body = raw.trim();
    if (isCommentLine(body)) {
      const stripped = body.replace(/^(?:\/\/+|\/\*+|\*+)\s?/, '');
      if (open) open.parts.push(stripped);
      else open = { line: i + 1, parts: [stripped] };
      return;
    }
    if (open !== undefined) {
      blocks.push({ line: open.line, body: open.parts.join(' ') });
      open = undefined;
    }
  });
  if (open !== undefined) blocks.push({ line: open.line, body: open.parts.join(' ') });
  return blocks;
}

/**
 * A claim about what the corpus renders NOW.
 *
 * Deliberately loose about the noun: the first version required the literal word "ratings" after
 * the number, and "the corpus is unchanged at 80" — no noun — sat live in the repo while the
 * assertion was green. It matches a present-tense verb near "corpus" and a two-or-three digit
 * number anywhere in the same comment block.
 */
const CURRENT_CORPUS =
  /\bcorpus\b[^.]{0,80}?\b(?:is|renders|stays|unchanged|sits)\b[^.]{0,40}?\b\d{2,3}\b|\b(?:renders|unchanged at|stays at)\s+\d{2,3}\b[^.]{0,30}\bratings?\b/i;

/**
 * A test count written into prose: "288 tests", "reddens 35 tests", "all 310 tests".
 *
 * Two digits and up. It was three-digit-only, and that let "reddens 33 tests" sit in a comment
 * through three separate re-measurements of the same mutation — the exact class this forbids,
 * invisible to the check because the number was small. The lesson generalises past this pattern:
 * a guard keyed on the SHAPE of a number will miss the same claim at a different magnitude.
 */
const TEST_COUNT = /\b\d{2,}\s+tests\b/;

describe('measurements written into prose', () => {
  const files = [
    ...sourceFiles(path.join(__dirname)),
    ...EXTRA_PROSE.map((f) => path.join(__dirname, '..', f)).filter((f) => fs.existsSync(f)),
  ];

  it('states the corpus’s CURRENT rating count in exactly one place', () => {
    const offenders: string[] = [];
    for (const file of files) {
      // This file must NAME the shapes it forbids in order to describe them.
      if (file.endsWith(SELF)) continue;
      const text = fs.readFileSync(file, 'utf8');
      const prose = file.endsWith('.md')
        ? text.split('\n').map((b, i) => ({ line: i + 1, body: b }))
        : commentBlocks(text);
      for (const { line, body } of prose) {
        if (!CURRENT_CORPUS.test(body)) continue;
        // The canonical note is the one home. Everything else must point at it instead.
        if (path.relative(process.cwd(), file) === path.normalize(CANONICAL)) continue;
        offenders.push(`${path.relative(__dirname, file)}:${line}  ${body.slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('states the same live-corpus figure in the resolver and the README', () => {
    // The uniqueness check above cannot help here, and this is the gap that let the figure drift
    // in the README while the resolver was right. The README has to state the cost — it is the
    // user-facing disclosure of how many ratings this module declines to render — so a second
    // home is legitimate, and forbidding it would make the README worse. What must not happen is
    // the two disagreeing, which they did: the resolver said 80 while the README said 82, for
    // part of a day, after a rule was reverted in one place and not the other.
    //
    // So this asserts AGREEMENT rather than uniqueness. It reads the canonical sentence in the
    // resolver's THE CORPUS block and every figure the README states about the same quantity, and
    // requires one value between them. It also fails if either side stops matching, because a
    // reworded claim this cannot find is a claim it cannot check.
    const canonical = /renders (\d+) ratings today across (\d+) of those answers/.exec(
      fs.readFileSync(path.join(__dirname, CANONICAL.replace(/^src\//, '')), 'utf8'),
    );
    expect(canonical, 'the resolver no longer states the corpus figure in the shape this reads').not.toBeNull();

    const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
    const stated = [...readme.matchAll(/That leaves (\d+)|every one of the (\d+) has been read/g)].map(
      (match) => match[1] ?? match[2],
    );
    expect(stated.length, 'the README no longer states the corpus figure in the shape this reads').toBeGreaterThan(1);
    expect([...new Set(stated)]).toEqual([canonical![1]]);
  });

  it('never states a test count in a comment', () => {
    const offenders: string[] = [];
    for (const file of files) {
      // This file must NAME the shapes it forbids in order to describe them.
      if (file.endsWith(SELF)) continue;
      const text = fs.readFileSync(file, 'utf8');
      const prose = file.endsWith('.md')
        ? text.split('\n').map((b, i) => ({ line: i + 1, body: b }))
        : commentBlocks(text);
      for (const { line, body } of prose) {
        if (TEST_COUNT.test(body)) offenders.push(`${path.relative(__dirname, file)}:${line}  ${body.slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no comment line long enough to be a mid-sentence splice', () => {
    // The other class this slice has had to repair repeatedly: five comments and one shipped
    // README sentence spliced mid-thought by anchor-replacement batch edits, where new text
    // replacing a fragment left the tail of the old sentence attached to it. A splice almost
    // always shows up as one over-long line, because the editor's own wrapping does not apply to
    // the join — so a width check catches it cheaply. Prettier does not reflow comments and the
    // linter does not police their width, which is why nothing else notices.
    //
    // The bound is deliberately loose: it is a splice detector, not a style rule.
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith('.md')) continue; // markdown prose wraps at the reader's window, not at 108
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((raw, i) => {
          const body = raw.trim();
          if (isCommentLine(body) && raw.length > 108) {
            offenders.push(`${path.relative(__dirname, file)}:${i + 1} (${raw.length} chars)`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('has no javadoc block that documents another javadoc block', () => {
    // The most-repeated repair in this slice: FIVE insertion-orphaned javadocs, every one caused
    // by an edit landing between a doc comment and the declaration it described. The orphan then
    // documents nothing, and the declaration it belonged to is left bare — twice the orphan was a
    // 45-line block carrying the measurements that justified a rule.
    //
    // The tell is mechanical: a `*/` immediately followed by a `/**`. Nothing else in the
    // toolchain looks for it, and it is invisible in review because both blocks read correctly on
    // their own.
    //
    // KNOWN LIMIT: one blank line between the two blocks evades this, and that is deliberate.
    // Two files open with a file-level `/**` overview followed by a blank line and then the first
    // declaration's own javadoc, which is intentional and reads correctly; tightening the check
    // to span blank lines would flag both. So this catches the insertion-orphan shape — an edit
    // landing flush against an existing doc — and not a deliberately spaced overview.
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith('.md')) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((raw, i) => {
        if (raw.trim() !== '*/') return;
        if (lines[i + 1]?.trim().startsWith('/**')) {
          offenders.push(`${path.relative(__dirname, file)}:${i + 1} — doc block followed by another`);
        }
      });
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
