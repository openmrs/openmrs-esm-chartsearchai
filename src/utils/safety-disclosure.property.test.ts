import { describe, expect, it } from 'vitest';
import type { AiReference, AiSafetyWarning } from '../api/chartsearchai';
import { claimTextByCitation, resolveFindingSeverities, stripExclusions } from './safety-disclosure';
import { interaction, safetyFindingRef } from '../__fixtures__/clarithromycin-response';

/**
 * The one property this module must never violate: **it may refuse, but it must never render a
 * rating against a citation that is not that finding's.**
 *
 * Every round of review so far has found a new answer shape that broke it — a marker-first
 * table, a lead-in naming an excluded partner, a bridge naming the subject drug, a claim naming
 * two candidates, a single marker written before its drug among trailing ones. Each was found by
 * a reviewer generating shapes by hand or, latterly, by a throwaway fuzzer that hit five
 * instances in ~20,000 shapes and was then discarded with its worktree.
 *
 * So the fuzzer lives here instead. It builds answers FROM a known index→finding mapping, which
 * is what makes the property checkable: anything the resolver returns can be compared against
 * the mapping that generated the prose. A refusal is always acceptable — silence is the safe
 * direction this module is built around — and a disagreement is a defect.
 *
 * Deterministic by construction (a seeded PRNG), so a failure is reproducible from the seed
 * printed in the assertion rather than being a flake.
 */

/** xorshift32 — small, seeded, and good enough to shuffle sentence shapes. */
function makeRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
}

/**
 * The five interactions of the measured chart, with the two bridges it really carries — but with
 * DISTINCT ratings, deliberately.
 *
 * The real chart rates three of these Moderate, and a mis-attribution between two same-rated
 * findings is then invisible to a check that compares ratings: measured, this file missed a
 * removed guard entirely for exactly that reason. Giving every partner its own rating makes any
 * mis-attribution observable. The values span the module's recognised vocabulary plus one word
 * it does not recognise, which is rendered verbatim.
 */
const PARTNERS = [
  { substance: 'Methylprednisolone', order: 'Solu-Medrol 125mg/5ml', severity: 'Major', bridged: true },
  { substance: 'Budesonide', order: 'Pulmicort 90mcg', severity: 'Moderate', bridged: true },
  { substance: 'Prednisone', order: 'Prednisone Co 5mg', severity: 'Minor', bridged: false },
  { substance: 'Dexamethasone', order: 'Dexamethasone Injection vial 8mg', severity: 'Unknown', bridged: false },
  {
    substance: 'Hydrocortisone',
    order: 'Hydrocortisone Injection vial 100mg',
    severity: 'Contraindicated',
    bridged: false,
  },
];

/**
 * Built through the shared fixture builders, not hand-written here.
 *
 * This file used to keep its own copies of both literals, and that made it the one test in the
 * repo still asserting against a dataset shape the others had moved off — the guard the whole
 * module is built around went on proving the safety property about a note format nothing else
 * expected, and said nothing. A fuzzer that cannot see the input change is not a fuzzer of the
 * input.
 *
 * The measurement behind that is stated once, on `interaction()` in the fixture, which owns the
 * separator. It used to be restated here too, with counts that had gone stale in both homes.
 */
const WARNINGS: AiSafetyWarning[] = PARTNERS.map((partner) =>
  interaction(partner.substance, partner.severity, partner.bridged ? partner.order : undefined),
);

const INDEX_OF = PARTNERS.map((_partner, i) => 350 + i);
const REFS: AiReference[] = INDEX_OF.map((index) => safetyFindingRef(index));

/** How one finding may be written. Each returns prose containing exactly that finding's marker. */
const MARKER_FIRST_SHAPES: Array<(name: string, marker: string) => string> = [
  (name, marker) => `${marker} ${name}`,
  (name, marker) => `${marker}: ${name}`,
  (name, marker) => `${marker}\n${name}`,
];

/**
 * A two-line entry: the subject on a header line, the citation on a CONTRAST line that names a
 * DIFFERENT candidate. The marker still belongs to the header's finding.
 *
 * The generator could not previously produce this, and it is the whole hazard: it maintained an
 * unstated invariant that the cited finding's own name always appears on the marker's own line,
 * so a window containing ONLY a foreign candidate was unreachable — and that is precisely the
 * window the confined reading mishandles. Live, this layout deranged an entire five-finding
 * answer with both Majors badged Moderate.
 */
const CONTRAST = (name: string, marker: string, other: string) =>
  `${name}\n  This interaction differs from the one for ${other} ${marker}.`;

const SENTENCE_SHAPES: Array<(name: string, marker: string) => string> = [
  (name, marker) => `Clarithromycin interacts with active order ${name} ${marker}.`,
  (name, marker) => `${name} ${marker}`,
  (name, marker) => `${marker} ${name}`,
  (name, marker) => `| ${marker} | ${name} |`,
  (name, marker) => `- ${name} is affected by the same mechanism ${marker}.`,
  (name, marker) => `Clarithromycin interacts with ${name}, a CYP450 3A4 substrate ${marker}.`,
  (name, marker) => `${name} — see ${marker}`,
  (name, marker) => `Consider ${name} carefully ${marker}; the exposure rises.`,
];

/**
 * Markers that cite something OUTSIDE this measurement — a chart order, another finding.
 *
 * The generator had no vocabulary for these, which made a TRUNCATED claim window unreachable:
 * a foreign citation between a finding's subject and its own marker cuts the subject out. Live
 * answers interleave them routinely — 7 times across 4 of 62 cached payloads.
 */
const FOREIGN_MARKERS = ['[12]', '[14]', '[16]', '[17]', '[18]'];

/**
 * Lead-ins. Several name a partner, which is the escape condition every rotation defect used:
 * the preamble names a real candidate, so a marker written before its drug elects the preamble's
 * partner instead and the whole mapping shifts.
 */
const LEAD_INS: Array<{ text: string; names: string | null }> = [
  { text: '', names: null },
  { text: 'The interacting orders are:', names: null },
  { text: 'Her active orders interact as follows.', names: null },
  { text: 'Apart from Prednisone, the interacting orders are', names: 'Prednisone' },
  { text: 'Hydrocortisone aside, the order that matters most is', names: 'Hydrocortisone' },
  { text: 'Unlike Methylprednisolone, the following carry a lesser risk:', names: 'Methylprednisolone' },
  // NON-EXCLUSION lead-ins, and they are the load-bearing half now. Every named entry above uses
  // a word `stripExclusions` removes, so from the cycle that added that strip until this one the
  // ENTIRE shifted population resolved nothing: 0 of 20,000 measured. A generator whose hazard
  // shape cannot resolve cannot catch a mis-attribution in it, and "150,000 seeds clean" was
  // being reported against it for three cycles. These name a partner without excluding it.
  { text: 'Besides Prednisone, the interacting orders are', names: 'Prednisone' },
  { text: 'In addition to Hydrocortisone, the order that matters most is', names: 'Hydrocortisone' },
  { text: 'Methylprednisolone is the lesser worry, but the greater one is', names: 'Methylprednisolone' },
  { text: 'Compared with Budesonide, the bigger problem is', names: 'Budesonide' },
];

interface Generated {
  answer: string;
  truth: Map<number, string>;
  unstated: number[];
}

/**
 * A SHIFTED list: every marker sits at end-of-line and the name it belongs to leads the NEXT
 * line, with the lead-in naming the last partner so the shift closes into a permutation.
 *
 * This shape, not the marker-first one, is what defeats both forward contests at once. Trailing
 * claims are line-confined, so each marker's own line carries the PREVIOUS partner's name and
 * the whole answer resolves rotated by one — every rating wrong, and every finding the forward
 * reading names still claimed by the trailing reading for some other index, which is what makes
 * the NAMED contest blind to it. Measured on the shipped fixture before the fix: a Major
 * interaction badged Moderate and a Moderate one badged Major in the same answer.
 *
 * `MARKER_FIRST_SHAPES` cannot produce it — those put the marker before its drug on ONE line,
 * where the confined window still contains the right subject. This puts the line break between
 * them.
 */
function shiftedAnswer(random: () => number, chosen: number[]): Generated {
  const nameOf = (i: number) => (random() < 0.5 ? PARTNERS[i].substance : PARTNERS[i].order);
  const last = chosen[chosen.length - 1];
  // NOT "X aside,": that is an exclusion clause and `stripExclusions` deletes it, which is what
  // made this whole shape resolve nothing for three cycles. The lead must name the last partner
  // WITHOUT excluding it, or the rotation never closes and the generator tests nothing.
  const LEADS = [
    (n: string) => `${n} is the lesser worry, but the greater one is`,
    (n: string) => `Besides ${n}, the one that matters most is`,
    (n: string) => `In addition to ${n}, the greater worry is`,
    (n: string) => `Compared with ${n}, the bigger problem is`,
  ];
  const lead = LEADS[Math.floor(random() * LEADS.length)](PARTNERS[last].substance);

  const truth = new Map<number, string>();
  for (const i of chosen) truth.set(INDEX_OF[i], PARTNERS[i].severity);

  // A second partner named on a line, which is what makes the forward reading elect NOBODY
  // there. Load-bearing on the DANGLING line above all: the forward reading's completeness is
  // the whole tell for a shift, and an ambiguous last line was measured to destroy it — the
  // rotation then resolved, complete and injective and wrong in all five positions. Without
  // this clause the generator produces only shifts whose tell is intact, which is the easy half.
  const extra = () => {
    if (random() < 0.55) return '';
    const other = [...PARTNERS.keys()][Math.floor(random() * PARTNERS.length)];
    const joiner = ['and also', 'as well as', 'plus', 'alongside', 'rather than'][Math.floor(random() * 5)];
    return ` ${joiner} ${nameOf(other)}`;
  };

  const lines = [`${lead} [${INDEX_OF[chosen[0]]}]`];
  for (let j = 1; j < chosen.length; j++) {
    lines.push(`${nameOf(chosen[j - 1])}${extra()} [${INDEX_OF[chosen[j]]}]`);
  }
  lines.push(`${nameOf(last)}${extra()}`);

  return { answer: lines.join('\n'), truth, unstated: chosen.map((i) => INDEX_OF[i]) };
}

function generateAnswer(random: () => number): Generated {
  // One in five answers is the shifted shape above. `count` starts at 2 because the rotation
  // needs at least two findings to exist — it is a floor, not a filter, and there was an
  // `if (count >= 2)` here reading as one. It could never be false (`2 + floor(r * 4)` is 2..5,
  // confirmed over 200,000 seeds: 40,031 taken, 0 fell through), so it looked like live
  // protection while protecting nothing. The hazard is real if it stays: an edit lowering the
  // floor to match the sibling draw below would be made believing one-element draws were still
  // routed away, and `shiftedAnswer` with a single finding emits a lead-in and a bare name with
  // no rotation at all — silently diluting the 20% population the coverage bound rests on.
  if (random() < 0.2) {
    const pool = [...PARTNERS.keys()].sort(() => random() - 0.5);
    const count = 2 + Math.floor(random() * (pool.length - 1));
    return shiftedAnswer(random, pool.slice(0, count));
  }

  // Half the time, build the hazard deliberately: a lead-in naming a partner whose OWN index is
  // then excluded from the citations, plus a first line whose marker precedes its drug. Left to
  // chance that combination is rare, and a fuzzer that never reaches the shape it exists for is
  // a guard that passes while examining nothing — measured: an earlier version of this file
  // missed a removed guard entirely.
  const targeted = random() < 0.5;
  // Indexed by the filtered array's own length, not by a hand-copied 3: a fourth named lead-in
  // would otherwise be unreachable in the targeted half of the generator, silently, which is the
  // coverage loss this file warns about twice elsewhere.
  const named = LEAD_INS.filter((candidate) => candidate.names);
  const leadIn = targeted
    ? named[Math.floor(random() * named.length)]
    : LEAD_INS[Math.floor(random() * LEAD_INS.length)];

  // Half of the targeted answers now CITE the lead-in's partner as well, and that half is the
  // whole point of this line. Excluding it unconditionally — which is what this did — made the
  // generator unable to express the shape the strongest hazard turns on: where the lead-in names
  // a finding that is itself cited, every finding a forward reading names is also claimed by the
  // trailing reading, just for a different index, so the NAMED contest is blind to it by
  // construction and the answer resolves as a PERMUTATION. Measured on the shipped fixture: a
  // Major interaction badged Moderate and a Moderate one badged Major, in the same answer.
  // Ten review rounds ran against this filter and none of them could have found that.
  const permuting = targeted && random() < 0.5;
  const eligible = [...PARTNERS.keys()].filter((i) => !leadIn.names || PARTNERS[i].substance !== leadIn.names);
  const pool = targeted && !permuting ? eligible : [...PARTNERS.keys()];
  const count = 1 + Math.floor(random() * pool.length);
  const chosen = [...pool].sort(() => random() - 0.5).slice(0, count);

  const separator = random() < 0.5 ? '\n' : ' ';
  const truth = new Map<number, string>();

  const lines = chosen.map((partnerIndex, position) => {
    const partner = PARTNERS[partnerIndex];
    const index = INDEX_OF[partnerIndex];
    truth.set(index, partner.severity);
    const name = random() < 0.5 ? partner.substance : partner.order;
    // In a targeted answer the first line always leads with its marker; the rest vary, which is
    // what mixes marker-first and marker-last in one answer.
    // A foreign citation dropped between the subject and the finding's marker, in a fragment
    // rather than across a sentence break — which is the shape that truncates the window.
    if (random() < 0.2) {
      const foreign = FOREIGN_MARKERS[Math.floor(random() * FOREIGN_MARKERS.length)];
      const other = PARTNERS[(partnerIndex + 1) % PARTNERS.length];
      return `${name} ${foreign} carries more risk than ${other.substance} does [${index}].`;
    }
    // The mirror of that, and the one structural dimension this generator lacked: a foreign
    // marker AFTER the subject, on a line whose own marker comes FIRST. It is what leaves the
    // shift-consistency rule as the sole objection — the trailing foreign marker shortens the
    // unconfined backward window so the block rule falls silent, and a terminator closing the
    // next line's claim bars the disagreement rule. Measured: with that rule disabled, 288
    // tests and a 200,000-seed sweep of this file stayed green while a Major interaction
    // rendered Moderate. Every objection has to be reachable from here or it is one refactor
    // from deletion.
    if (random() < 0.2) {
      const foreign = FOREIGN_MARKERS[Math.floor(random() * FOREIGN_MARKERS.length)];
      const other = PARTNERS[(partnerIndex + 1) % PARTNERS.length];
      return `${other.substance} aside, the worry is [${index}] ${name} ${foreign}`;
    }
    // A contrast entry names another partner beside the marker and its own on the header line.
    if (random() < 0.25) {
      const other = PARTNERS[(partnerIndex + 1 + Math.floor(random() * (PARTNERS.length - 1))) % PARTNERS.length];
      return CONTRAST(name, `[${index}]`, random() < 0.5 ? other.substance : other.order);
    }
    const shape =
      targeted && position === 0
        ? MARKER_FIRST_SHAPES[Math.floor(random() * MARKER_FIRST_SHAPES.length)]
        : SENTENCE_SHAPES[Math.floor(random() * SENTENCE_SHAPES.length)];
    return shape(name, `[${index}]`);
  });

  // In a targeted answer the lead-in is GLUED to the first (marker-first) line and the rest go on
  // their own lines. That is the live shape: line confinement makes a lead-in on its own line
  // harmless, so the hazard needs the preamble and the leading marker sharing one line while the
  // remaining markers trail on others — which one separator for every join cannot produce.
  const answer = targeted
    ? [[leadIn.text, lines[0]].filter(Boolean).join(' '), ...lines.slice(1)].join('\n')
    : [leadIn.text, ...lines].filter(Boolean).join(separator);

  return {
    answer,
    truth,
    unstated: chosen.map((partnerIndex) => INDEX_OF[partnerIndex]),
  };
}

describe('the generator reaches the shapes it exists for', () => {
  it('produces every structural dimension a defect has used', () => {
    // A generator is an input source, not a guard: weakening it costs coverage silently, and
    // removing its contrast entries leaves the property test green while it stops examining the
    // shape that deranged a whole live answer. So the coverage is asserted, not assumed — an
    // empty discovery has to fail.
    let contrast = 0;
    let markerFirst = 0;
    let markerAtLineEnd = 0;
    let colonAfterMarker = 0;
    let foreignMarker = 0;
    let foreignAfterSubject = 0;
    let orderVocabulary = 0;
    let multiLine = 0;
    let shifted = 0;
    let shiftedAmbiguousTail = 0;
    // The guard against the regression that made three cycles of sweeps meaningless: a shifted
    // answer whose FIRST claim no longer names a candidate cannot close a rotation, so the whole
    // hazard shape becomes unreachable and the property test passes while examining nothing. This
    // counts shifted answers whose first claim still names a partner AFTER stripping.
    let shiftedClosable = 0;
    let leadInPartnerCited = 0;

    for (let seed = 1; seed <= 4000; seed++) {
      const { answer } = generateAnswer(makeRandom(seed));
      if (answer.includes('This interaction differs')) contrast += 1;
      if (/\[\d+\]\s+[A-Z]/.test(answer)) markerFirst += 1;
      if (/\[\d+\]\n/.test(answer)) markerAtLineEnd += 1;
      if (/\[\d+\]:/.test(answer)) colonAfterMarker += 1;
      if (FOREIGN_MARKERS.some((marker) => answer.includes(marker))) foreignMarker += 1;
      // A foreign marker at end-of-line on a marker-first line: the shape that leaves the
      // shift-consistency rule as the only objection available.
      if (/aside, the worry is \[\d+\][^\n]*\[1[2-8]\]/.test(answer)) foreignAfterSubject += 1;
      if (/\d+(mg|mcg|ml)/.test(answer)) orderVocabulary += 1;
      if (answer.includes('\n')) multiLine += 1;
      // The shifted list: a marker ending the FIRST line with the lead-in, and a final line
      // carrying a name and no marker at all.
      if (
        /(?:the greater one is|matters most is|greater worry is|bigger problem is) \[\d+\]\n/.test(answer) &&
        !/\[\d+\]\s*$/.test(answer)
      ) {
        shifted += 1;
        const firstClaim = claimTextByCitation(answer, 'trailing', new Set(INDEX_OF)).get(
          Number(/\[(\d+)\]/.exec(answer)?.[1]),
        );
        const stripped = stripExclusions((firstClaim ?? '').toLowerCase());
        if (PARTNERS.some((p) => stripped.includes(p.substance.toLowerCase()))) {
          shiftedClosable += 1;
        }
        // And the harder half: a shift whose DANGLING last line names two partners, so the
        // forward reading's completeness — the only tell a shift leaves — is destroyed.
        if (/(and also|as well as|plus|alongside|rather than)[^\n[]*$/.test(answer)) shiftedAmbiguousTail += 1;
      }
      // And, separately, that a lead-in's own partner reaches the citations — the filter that
      // forbade this is why ten rounds ran without reaching the permutation class.
      const named = LEAD_INS.map((l) => l.names).find((n) => n && answer.startsWith(n));
      if (named) {
        const i = PARTNERS.findIndex((p) => p.substance === named);
        if (i >= 0 && answer.includes(`[${INDEX_OF[i]}]`)) leadInPartnerCited += 1;
      }
    }

    expect({
      contrast: contrast > 200,
      markerFirst: markerFirst > 200,
      markerAtLineEnd: markerAtLineEnd > 50,
      colonAfterMarker: colonAfterMarker > 50,
      foreignMarker: foreignMarker > 200,
      foreignAfterSubject: foreignAfterSubject > 200,
      orderVocabulary: orderVocabulary > 200,
      multiLine: multiLine > 200,
      shifted: shifted > 200,
      shiftedAmbiguousTail: shiftedAmbiguousTail > 100,
      shiftedClosable: shiftedClosable > 200,
      leadInPartnerCited: leadInPartnerCited > 200,
    }).toEqual({
      contrast: true,
      markerFirst: true,
      markerAtLineEnd: true,
      colonAfterMarker: true,
      foreignMarker: true,
      foreignAfterSubject: true,
      orderVocabulary: true,
      multiLine: true,
      shifted: true,
      shiftedAmbiguousTail: true,
      shiftedClosable: true,
      leadInPartnerCited: true,
    });
  });
});

describe('resolveFindingSeverities property: it may refuse, but never mis-attribute', () => {
  it('never renders a rating that is not the cited finding’s, over generated answers', () => {
    const violations: string[] = [];
    let resolvedAtLeastOnce = 0;

    for (let seed = 1; seed <= 9000; seed++) {
      const random = makeRandom(seed);
      const { answer, truth, unstated } = generateAnswer(random);
      const resolved = resolveFindingSeverities(answer, REFS, WARNINGS, unstated);
      if (resolved.size > 0) resolvedAtLeastOnce += 1;

      for (const [index, severity] of resolved) {
        if (truth.get(index) !== severity) {
          violations.push(
            `seed ${seed}: [${index}] rendered ${severity}, truth ${truth.get(index)}\n  answer: ${JSON.stringify(answer)}`,
          );
        }
      }
    }

    // Reported rather than counted: a violation is a wrong clinical rating, so the message has to
    // carry the seed and the prose that produced it.
    expect(violations.slice(0, 5)).toEqual([]);
    // And the sweep must not be vacuous — a resolver that refused everything would satisfy the
    // property while rendering nothing, which is the fail-open this whole file exists to catch.
    //
    // The seed count went 4000 -> 6000 rather than this bound coming DOWN when the shifted shape
    // was added. A fifth of the population now refuses by design (correctly — a rotated list
    // does not determine its own mapping), so the ratio fell; lowering the bound to match would
    // have quietly weakened the one assertion standing between this file and a vacuous pass.
    expect(resolvedAtLeastOnce).toBeGreaterThan(200);
  });
});
