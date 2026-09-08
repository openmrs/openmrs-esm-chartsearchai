import { describe, expect, it } from 'vitest';
import type { AiReference, AiSafetyWarning } from '../api/chartsearchai';
import { resolveFindingSeverities } from './safety-disclosure';

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

const WARNINGS: AiSafetyWarning[] = PARTNERS.map((partner) => ({
  type: 'interaction',
  drug: 'Clarithromycin',
  detail: `Clarithromycin interacts with active order ${partner.substance} — ${partner.severity}. Coadministration …`,
  severity: partner.severity,
  chartOrderBridges: partner.bridged ? [{ substance: partner.substance, orderDisplay: partner.order }] : [],
}));

const INDEX_OF = PARTNERS.map((_partner, i) => 350 + i);
const REFS: AiReference[] = INDEX_OF.map((index) => ({
  index,
  resourceType: 'safety_finding',
  resourceUuid: 'interaction:Clarithromycin',
  date: null as unknown as string,
  group: 'reference',
}));

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
];

interface Generated {
  answer: string;
  truth: Map<number, string>;
  unstated: number[];
}

function generateAnswer(random: () => number): Generated {
  // Half the time, build the hazard deliberately: a lead-in naming a partner whose OWN index is
  // then excluded from the citations, plus a first line whose marker precedes its drug. Left to
  // chance that combination is rare, and a fuzzer that never reaches the shape it exists for is
  // a guard that passes while examining nothing — measured: an earlier version of this file
  // missed a removed guard entirely.
  const targeted = random() < 0.5;
  const leadIn = targeted
    ? LEAD_INS.filter((candidate) => candidate.names)[Math.floor(random() * 3)]
    : LEAD_INS[Math.floor(random() * LEAD_INS.length)];

  const eligible = [...PARTNERS.keys()].filter((i) => !leadIn.names || PARTNERS[i].substance !== leadIn.names);
  const pool = targeted ? eligible : [...PARTNERS.keys()];
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
    let orderVocabulary = 0;
    let multiLine = 0;

    for (let seed = 1; seed <= 4000; seed++) {
      const { answer } = generateAnswer(makeRandom(seed));
      if (answer.includes('This interaction differs')) contrast += 1;
      if (/\[\d+\]\s+[A-Z]/.test(answer)) markerFirst += 1;
      if (/\[\d+\]\n/.test(answer)) markerAtLineEnd += 1;
      if (/\[\d+\]:/.test(answer)) colonAfterMarker += 1;
      if (FOREIGN_MARKERS.some((marker) => answer.includes(marker))) foreignMarker += 1;
      if (/\d+(mg|mcg|ml)/.test(answer)) orderVocabulary += 1;
      if (answer.includes('\n')) multiLine += 1;
    }

    expect({
      contrast: contrast > 200,
      markerFirst: markerFirst > 200,
      markerAtLineEnd: markerAtLineEnd > 50,
      colonAfterMarker: colonAfterMarker > 50,
      foreignMarker: foreignMarker > 200,
      orderVocabulary: orderVocabulary > 200,
      multiLine: multiLine > 200,
    }).toEqual({
      contrast: true,
      markerFirst: true,
      markerAtLineEnd: true,
      colonAfterMarker: true,
      foreignMarker: true,
      orderVocabulary: true,
      multiLine: true,
    });
  });
});

describe('resolveFindingSeverities property: it may refuse, but never mis-attribute', () => {
  it('never renders a rating that is not the cited finding’s, over generated answers', () => {
    const violations: string[] = [];
    let resolvedAtLeastOnce = 0;

    for (let seed = 1; seed <= 4000; seed++) {
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
    expect(resolvedAtLeastOnce).toBeGreaterThan(200);
  });
});
