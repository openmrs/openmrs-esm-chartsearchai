import { describe, expect, it } from 'vitest';
import type { AiReference, AiSafetyWarning } from '../api/chartsearchai';
import {
  claimTextByCitation,
  isReferenceData,
  parseCitationIndices,
  referenceKind,
  resolveFindingSeverities,
  severityTone,
} from './safety-disclosure';

import {
  ANSWER_BARE_LIST,
  ANSWER_BY_ORDER_DISPLAY,
  ANSWER_BY_SUBSTANCE,
  interaction,
  REFERENCES,
  SAFETY_WARNINGS,
  safetyFindingRef,
  UNSTATED,
} from '../__fixtures__/clarithromycin-response';

const ANSWER = ANSWER_BY_SUBSTANCE;

describe('isReferenceData', () => {
  it('recognises every reference resource type, not just drug_reference', () => {
    for (const resourceType of ['drug_reference', 'safety_finding', 'drug_class_note']) {
      expect(isReferenceData({ index: 1, resourceType, resourceUuid: 'x', date: '' })).toBe(true);
    }
  });

  it('prefers the response’s own group over the resource type', () => {
    // A reference-group entry whose type this client has never heard of still must not navigate.
    expect(
      isReferenceData({ index: 1, resourceType: 'some_future_type', resourceUuid: 'x', date: '', group: 'reference' }),
    ).toBe(true);
  });

  it('treats chart records as navigable', () => {
    expect(isReferenceData({ index: 1, resourceType: 'allergy', resourceUuid: 'x', date: '', group: 'chart' })).toBe(
      false,
    );
    expect(isReferenceData({ index: 1, resourceType: 'drug_order', resourceUuid: 'x', date: '' })).toBe(false);
  });
});

describe('severityTone', () => {
  it('recognises the bundled knowledge base’s vocabulary, case- and space-insensitively', () => {
    expect(severityTone('Major')).toBe('major');
    expect(severityTone('  moderate ')).toBe('moderate');
    expect(severityTone('MINOR')).toBe('minor');
    expect(severityTone('Unknown')).toBe('unknown');
  });

  it('treats a word it does not recognise as unrated rather than as a tier', () => {
    // An operator's own dataset supplies its own words; colouring one as a tier would assert a
    // ranking the dataset never stated.
    expect(severityTone('Severe')).toBe('unrated');
    expect(severityTone('')).toBe('unrated');
  });
});

describe('claimTextByCitation', () => {
  it('gives adjacent markers the claim that precedes the whole run', () => {
    // [177] and [350] cite ONE sentence between them; keyed per marker, [350] would otherwise
    // see a claim text of just a space.
    const claims = claimTextByCitation(ANSWER);
    expect(claims.get(177)).toContain('interacts with active order Methylprednisolone');
    expect(claims.get(350)).toBe(claims.get(177));
    expect(claims.get(351)).toContain('interacts with active order Budesonide');
    expect(claims.get(351)).not.toContain('Methylprednisolone');
  });

  it('splits a comma-separated group across its indices', () => {
    const claims = claimTextByCitation('Aspirin and warfarin interact [7, 8].');
    expect(claims.get(7)).toBe('Aspirin and warfarin interact ');
    expect(claims.get(8)).toBe(claims.get(7));
  });

  it('keeps the first claim of an index cited more than once', () => {
    // Measured live: the model repeats a finding's marker inside its own statement, so blanking
    // such an index discarded the only evidence there was for it. The first occurrence is the
    // one the renderer badges, so it is the one whose text must justify the badge.
    const claims = claimTextByCitation('First claim [5]. Second, unrelated claim [5].');
    expect(claims.get(5)).toBe('First claim ');
  });
});

describe('resolveFindingSeverities', () => {
  it('resolves each unstated rating from the claim its marker is attached to', () => {
    // The measured failure this exists for: five interaction findings in one clause, two of
    // them Major, and the answer states no rating for any of them.
    const resolved = resolveFindingSeverities(ANSWER, REFERENCES, SAFETY_WARNINGS, UNSTATED);
    expect(Object.fromEntries(resolved)).toEqual({
      350: 'Major',
      351: 'Major',
      352: 'Moderate',
      353: 'Moderate',
      354: 'Moderate',
    });
  });

  it('pairs each rating with its own finding, not merely the right multiset of ratings', () => {
    // The fixture above cannot catch a permutation among same-rated neighbours: swapping 350
    // and 351 (both Major) leaves its assertion green. Distinct ratings make any mis-mapping
    // visible, which is what stops "the ratings are all present" from passing for "each
    // rating is beside the finding it belongs to".
    const distinct: AiSafetyWarning[] = [
      interaction('Methylprednisolone', 'Major'),
      interaction('Budesonide', 'Minor'),
      interaction('Prednisone', 'Moderate'),
      interaction('Dexamethasone', 'Unknown'),
      interaction('Hydrocortisone', 'Contraindicated'),
    ];
    const resolved = resolveFindingSeverities(ANSWER, REFERENCES, distinct, UNSTATED);
    expect(Object.fromEntries(resolved)).toEqual({
      350: 'Major',
      351: 'Minor',
      352: 'Moderate',
      353: 'Unknown',
      354: 'Contraindicated',
    });
  });

  it('refuses a candidate whose detail is empty rather than letting it match everything', () => {
    // leadClause('') is '', and every string contains '' — so a rating-carrying warning with no
    // detail would otherwise match vacuously and win any tie it was part of. An operator's own
    // dataset can rate a rule while leaving its note empty, so this is a reachable shape.
    const warnings: AiSafetyWarning[] = [
      { type: 'interaction', drug: 'Clarithromycin', detail: '', severity: 'Major' },
      interaction('Budesonide', 'Moderate'),
    ];
    const resolved = resolveFindingSeverities('Some claim with no marker text [351].', REFERENCES, warnings, [351]);
    expect(resolved.size).toBe(0);
  });

  it('ignores a bridge that names the finding’s own drug, which cannot discriminate', () => {
    // Candidates are selected on the finding's (type, drug), so every candidate is about that
    // drug and every claim naming the finding names it too. Measured before this guard: one
    // chip bridging its own subject drug took four of five ratings and reported them all as its
    // own Major — a wrong rating shown confidently, in the dangerous direction.
    const warnings: AiSafetyWarning[] = [
      {
        ...interaction('Cortisone', 'Minor'),
        chartOrderBridges: [{ substance: 'Clarithromycin', orderDisplay: 'Biaxin 500mg' }],
      },
      interaction('Hydrocortisone', 'Major'),
    ];
    const refs: AiReference[] = [safetyFindingRef(351)];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Hydrocortisone [351].',
      refs,
      warnings,
      [351],
    );
    expect(resolved.get(351)).toBe('Major');
  });

  it('does not match a bridge inside a longer drug name', () => {
    // "Cortisone" occurs inside "Hydrocortisone". A bare substring test resolved the sentence
    // about the second to the chip bridged to the first, while the anchored prose tier got the
    // same case right — so the bridge tier must be anchored too.
    const warnings: AiSafetyWarning[] = [
      {
        ...interaction('Cortisone', 'Minor'),
        chartOrderBridges: [{ substance: 'Cortisone', orderDisplay: 'Cortone 25mg' }],
      },
      interaction('Hydrocortisone', 'Major'),
    ];
    const refs: AiReference[] = [safetyFindingRef(351)];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Hydrocortisone [351].',
      refs,
      warnings,
      [351],
    );
    expect(resolved.get(351)).toBe('Major');
  });

  it('does not match a bridge against half of a hyphenated brand', () => {
    // The hyphen half of the boundary class: dropping `-` from it left the whole suite green,
    // and this repo's own fixture vocabulary contains the hazard — a chip bridged to `Medrol`
    // must not take the rating of a claim naming `Solu-Medrol 125mg/5ml`.
    const warnings: AiSafetyWarning[] = [
      { ...interaction('Medrol', 'Minor'), chartOrderBridges: [{ substance: 'Medrol', orderDisplay: 'Medrol 4mg' }] },
      interaction('Methylprednisolone', 'Major', 'Solu-Medrol 125mg/5ml'),
    ];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Solu-Medrol 125mg/5ml [351].',
      [safetyFindingRef(351)],
      warnings,
      [351],
    );
    expect(resolved.get(351)).toBe('Major');
  });

  it('does not match a bridge against half of a combination product', () => {
    const warnings: AiSafetyWarning[] = [
      {
        ...interaction('Aspirin', 'Minor'),
        chartOrderBridges: [{ substance: 'Aspirin', orderDisplay: 'Aspirin 75mg' }],
      },
      interaction('Aspirin/Dipyridamole', 'Major'),
    ];
    const refs: AiReference[] = [safetyFindingRef(351)];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Aspirin/Dipyridamole [351].',
      refs,
      warnings,
      [351],
    );
    expect(resolved.get(351)).toBe('Major');
  });

  it('refuses where the bridge and the prose each name a different candidate', () => {
    // Two tiers disagreeing is the strongest available evidence that the sentence identifies no
    // one candidate, so tier order must not be allowed to pick a winner.
    const warnings: AiSafetyWarning[] = [
      {
        ...interaction('Budesonide', 'Minor'),
        chartOrderBridges: [{ substance: 'Budesonide', orderDisplay: 'Pulmicort 90mcg' }],
      },
      interaction('Prednisone', 'Major'),
    ];
    const refs: AiReference[] = [safetyFindingRef(351)];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Prednisone, taken with Pulmicort 90mcg [351].',
      refs,
      warnings,
      [351],
    );
    expect(resolved.size).toBe(0);
  });

  it('refuses a lead the note truncated down to the shared drug name', () => {
    // Truncation is not automatically fail-safe: a note breaking early can shorten the lead to
    // the subject drug, which every claim about the finding names — a false SINGLE match
    // wherever the siblings' longer leads fail.
    const warnings: AiSafetyWarning[] = [
      {
        type: 'interaction',
        drug: 'Clarithromycin',
        detail: 'Clarithromycin — Major. Avoid with strong CYP3A4 substrates.',
        severity: 'Major',
        chartOrderBridges: [],
      },
      interaction('Hydrocortisone', 'Moderate'),
    ];
    const refs: AiReference[] = [safetyFindingRef(354)];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Cortef 100mg [354].',
      refs,
      warnings,
      [354],
    );
    expect(resolved.size).toBe(0);
  });

  it('resolves a bare list that quotes none of the module’s phrasing', () => {
    // Live: "list every interaction, one short line each, name the order only". Only two of the
    // five findings carry a chart-order bridge, so before the partner tier this resolved two of
    // five and the list rendered half-badged.
    const resolved = resolveFindingSeverities(ANSWER_BARE_LIST, REFERENCES, SAFETY_WARNINGS, UNSTATED);
    expect(Object.fromEntries(resolved)).toEqual({
      350: 'Major',
      351: 'Major',
      352: 'Moderate',
      353: 'Moderate',
      354: 'Moderate',
    });
  });

  it('withdraws a candidate set it could only partly resolve', () => {
    // The backend requires a shared-(type, drug) set to be rendered together or not at all: a
    // bare item beside a badged one reads as "no rating exists", not "we declined", so a
    // clinician infers a ranking the module never stated.
    const answer = 'Clarithromycin interacts with active order Methylprednisolone [350], and there are others [352].';
    const resolved = resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350, 352]);
    expect(resolved.size).toBe(0);
  });

  it('treats a comma between adjacent markers as one attachment point', () => {
    // Live: "…possible cross-reactivity [356], [357]." The second marker used to get a claim
    // text of ", " and could never resolve.
    const claims = claimTextByCitation('Clarithromycin interacts with active order Prednisone [350], [352].');
    expect(claims.get(352)).toBe(claims.get(350));
    expect(claims.get(352)).toContain('Prednisone');
  });

  it('refuses a candidate an ambiguous stronger tier rejected', () => {
    // An ambiguous tier must narrow the field, not be discarded: otherwise a weaker tier elects
    // a candidate the stronger tier positively excluded.
    const warnings: AiSafetyWarning[] = [
      {
        ...interaction('Budesonide', 'Major'),
        chartOrderBridges: [{ substance: 'Budesonide', orderDisplay: 'Inhaler' }],
      },
      {
        ...interaction('Prednisone', 'Minor'),
        chartOrderBridges: [{ substance: 'Prednisone', orderDisplay: 'Inhaler' }],
      },
      interaction('Hydrocortisone', 'Unknown'),
    ];
    const refs: AiReference[] = [safetyFindingRef(351)];
    // "Inhaler" matches both bridged candidates (ambiguous); the prose tier singles out the
    // third, which the bridge tier's matches do not include.
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Hydrocortisone via the Inhaler [351].',
      refs,
      warnings,
      [351],
    );
    expect(resolved.size).toBe(0);
  });

  it('withdraws only the candidate set it could not fully resolve', () => {
    // Per-SET isolation, not per-answer: mutating the sweep to clear everything left the whole
    // suite green, because no fixture had ever put two candidate sets in one response.
    const refs: AiReference[] = [
      ...[350, 352].map((index) => safetyFindingRef(index, 'interaction', 'Clarithromycin')),
      ...[360, 361].map((index) => safetyFindingRef(index, 'interaction', 'Ibuprofen')),
    ];
    const warnings: AiSafetyWarning[] = [
      interaction('Methylprednisolone', 'Major'),
      interaction('Prednisone', 'Moderate'),
      {
        type: 'interaction',
        drug: 'Ibuprofen',
        detail: 'Ibuprofen interacts with active order Warfarin — Major. …',
        severity: 'Major',
        chartOrderBridges: [],
      },
      {
        type: 'interaction',
        drug: 'Ibuprofen',
        detail: 'Ibuprofen interacts with active order Aspirin — Minor. …',
        severity: 'Minor',
        chartOrderBridges: [],
      },
    ];
    // The Clarithromycin set is fully identified; the Ibuprofen set has one member the answer
    // does not single out, so that set alone is withdrawn.
    const answer =
      'Clarithromycin interacts with active order Methylprednisolone [350], ' +
      'Clarithromycin interacts with active order Prednisone [352], ' +
      'Ibuprofen interacts with active order Warfarin [360], and there are others [361].';
    const resolved = resolveFindingSeverities(answer, refs, warnings, [350, 352, 360, 361]);
    expect(Object.fromEntries(resolved)).toEqual({ 350: 'Major', 352: 'Moderate' });
  });

  it('is unaffected by an index the measurement lists twice', () => {
    // The list is deduped upstream, but the backend's own javadoc calls that "belt and braces
    // rather than load-bearing" — so this must not depend on it. An earlier sweep counted
    // occurrences against distinct indices and withdrew the whole set on a repeat.
    const once = resolveFindingSeverities(ANSWER_BY_SUBSTANCE, REFERENCES, SAFETY_WARNINGS, UNSTATED);
    const twice = resolveFindingSeverities(ANSWER_BY_SUBSTANCE, REFERENCES, SAFETY_WARNINGS, [...UNSTATED, 350]);
    expect(Object.fromEntries(twice)).toEqual(Object.fromEntries(once));
    expect(twice.get(350)).toBe('Major');
  });

  it('finds a lead that occurs first inside a longer word and again as a whole term', () => {
    // The whole-term scan must RETRY past a substring hit: replacing it with a single indexOf
    // plus one boundary check left the suite green. Both Cortisone and Hydrocortisone are live
    // orders on this chart, so a claim naming both is reachable — and it must refuse, which is
    // only possible if the second occurrence is found.
    const warnings: AiSafetyWarning[] = [
      {
        ...interaction('Cortisone', 'Minor'),
        chartOrderBridges: [{ substance: 'Cortisone', orderDisplay: 'Cortone 25mg' }],
      },
      interaction('Hydrocortisone', 'Major'),
    ];
    const refs: AiReference[] = [safetyFindingRef(351)];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Hydrocortisone and with Cortisone [351].',
      refs,
      warnings,
      [351],
    );
    expect(resolved.size).toBe(0);
  });

  it('survives a malformed warning rather than taking the panel down', () => {
    // These run inside a render memo with no error boundary above them, so a throw here costs
    // the answer, its citations and its safety chips. `severity` was guarded and its siblings
    // were not — one guarded member of a family is not a guarded family.
    const refs: AiReference[] = [safetyFindingRef(351)];
    const malformed = [
      { ...interaction('Budesonide', 'Major'), detail: null as unknown as string },
      { ...interaction('Prednisone', 'Major'), chartOrderBridges: 'nope' as unknown as [] },
      { ...interaction('Dexamethasone', 'Major'), severity: 7 as unknown as string },
    ];
    for (const bad of malformed) {
      expect(() =>
        resolveFindingSeverities(
          'Clarithromycin interacts with active order Hydrocortisone [351].',
          refs,
          [bad, interaction('Hydrocortisone', 'Moderate')],
          [351],
        ),
      ).not.toThrow();
    }
  });

  it('keeps a set’s ratings when one of its indices is never cited in the prose', () => {
    // Measured live: the model wrote "[37]" where reference 367 was published. An index whose
    // marker is absent has no claim to be identified from and renders nothing either way, so
    // counting it as a failed set member threw away every correct rating beside it.
    const withUncited = [...UNSTATED, 999];
    const refs: AiReference[] = [...REFERENCES, safetyFindingRef(999)];
    const resolved = resolveFindingSeverities(ANSWER_BY_SUBSTANCE, refs, SAFETY_WARNINGS, withUncited);
    expect(Object.fromEntries(resolved)).toEqual({
      350: 'Major',
      351: 'Major',
      352: 'Moderate',
      353: 'Moderate',
      354: 'Moderate',
    });
  });

  it('refuses a run that would elect one finding for several citations of its set', () => {
    // Live, and cache-sticky once emitted: the model put every marker on one line —
    // "Solu-Medrol 125mg/5ml [350] [177] [179] [352] [353] [354]" — so the run-merge handed all
    // of them that one claim, four indices elected the Methylprednisolone finding, and three
    // Moderate ratings rendered as Major. Two citations of one set cannot both be one finding.
    const answer = 'Solu-Medrol 125mg/5ml [350] [177] [179] [352] [353] [354]';
    const resolved = resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, UNSTATED);
    expect(resolved.size).toBe(0);
  });

  it('ignores a lead every candidate in the set carries', () => {
    // Live: asked for chart names only, the answer led with the subject order, and every finding
    // bridged that same order — so all seven matched it, the one decisive lead was swamped, and
    // six correct ratings were discarded. A lead the whole set shares is not evidence about any
    // one member, which is what `discriminatingLeads` says but cannot see: it compares a lead
    // against the finding's drug NAME, and this shared lead was that drug's order display.
    const shared = [{ substance: 'Ibuprofen', orderDisplay: 'Advil 400mg' }];
    const warnings: AiSafetyWarning[] = [
      {
        type: 'interaction',
        drug: 'Ibuprofen',
        detail: 'Ibuprofen interacts with active order Methylprednisolone — Moderate. …',
        severity: 'Moderate',
        chartOrderBridges: [...shared, { substance: 'Methylprednisolone', orderDisplay: 'Solu-Medrol 125mg/5ml' }],
      },
      {
        type: 'interaction',
        drug: 'Ibuprofen',
        detail: 'Ibuprofen interacts with active order Prednisone — Minor. …',
        severity: 'Minor',
        chartOrderBridges: [...shared],
      },
    ];
    const refs: AiReference[] = [safetyFindingRef(358, 'interaction', 'Ibuprofen')];
    const resolved = resolveFindingSeverities(
      'Advil 400mg interacts with the following medications: 1. Solu-Medrol 125mg/5ml [358]',
      refs,
      warnings,
      [358],
    );
    expect(resolved.get(358)).toBe('Moderate');
  });

  it('refuses a set whose only rated finding is cited more than once', () => {
    // One rated warning, two citations: attributing it to both is wrong and there is no way to
    // tell which it belongs to, so the single-candidate shortcut must not badge both.
    const refs: AiReference[] = [safetyFindingRef(350), safetyFindingRef(351)];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Methylprednisolone [350] [351].',
      refs,
      [SAFETY_WARNINGS[0], interaction('Methylprednisolone', 'Major', 'Solu-Medrol 125mg/5ml')],
      [350, 351],
    );
    expect(resolved.size).toBe(0);
  });

  it('refuses where the badged sentence names two candidates', () => {
    // The one-candidate requirement is what keeps a resolved rating honest: where the sentence
    // the badge will be drawn against reproduces two candidates' own statements, nothing is
    // singled out and no rating renders.
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Prednisone and Clarithromycin interacts with active order Dexamethasone [350].',
      REFERENCES,
      SAFETY_WARNINGS,
      [350],
    );
    expect(resolved.size).toBe(0);
  });

  it('resolves an answer that names the chart’s order display instead of the substance', () => {
    // The vocabulary the answer uses is not the vocabulary the chip uses: `detail` says
    // "Methylprednisolone", the answer says "Solu-Medrol 125mg/5ml". Both spellings are observed
    // live in the same position, and `chartOrderBridges` is what reconciles them — so this is
    // the case the typed field exists for, and the case detail-parsing alone cannot serve.
    const resolved = resolveFindingSeverities(ANSWER_BY_ORDER_DISPLAY, REFERENCES, SAFETY_WARNINGS, UNSTATED);
    expect(Object.fromEntries(resolved)).toEqual({
      350: 'Major',
      351: 'Major',
      352: 'Moderate',
      353: 'Moderate',
      354: 'Moderate',
    });
  });

  it('resolves from the bridge where the prose names no candidate', () => {
    // Named for what it actually exercises: here the prose groups match nothing and the bridge
    // matches one, so the bridge is the only evidence there is. It is NOT a precedence test —
    // `electCandidate` is order-free, and the disagreement case is covered separately below.
    const warnings: AiSafetyWarning[] = [
      interaction('Methylprednisolone', 'Major', 'Solu-Medrol 125mg/5ml'),
      interaction('Budesonide', 'Minor', 'Pulmicort 90mcg'),
    ];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Pulmicort 90mcg [351].',
      REFERENCES,
      warnings,
      [351],
    );
    expect(resolved.get(351)).toBe('Minor');
  });

  it('renders no rating for a finding the answer already rates', () => {
    // The backend check asks of the WHOLE answer, so an answer stating its ratings anywhere is
    // absent from the list — and must not have them repeated beside the sentence.
    expect(resolveFindingSeverities(ANSWER, REFERENCES, SAFETY_WARNINGS, []).size).toBe(0);
    expect(resolveFindingSeverities(ANSWER, REFERENCES, SAFETY_WARNINGS, null).size).toBe(0);
  });

  it('resolves a lone candidate without needing the prose at all', () => {
    const resolved = resolveFindingSeverities(
      'Ibuprofen interacts with warfarin [40].',
      [
        {
          index: 40,
          resourceType: 'safety_finding',
          resourceUuid: 'interaction:Ibuprofen',
          date: '',
          group: 'reference',
        },
      ],
      [{ type: 'interaction', drug: 'Ibuprofen', detail: 'Reworded entirely by the module.', severity: 'Minor' }],
      [40],
    );
    expect(resolved.get(40)).toBe('Minor');
  });

  it('refuses to guess when the prose singles out no candidate', () => {
    // Two same-drug findings and an answer that reproduces neither one's wording. Attributing
    // "Major" to the wrong sentence is worse for a clinician than attributing nothing, so this
    // resolves to nothing rather than picking the first.
    const resolved = resolveFindingSeverities(
      'Clarithromycin has two interactions worth noting [350] [351].',
      REFERENCES,
      SAFETY_WARNINGS,
      [350, 351],
    );
    expect(resolved.size).toBe(0);
  });

  it('refuses to guess when the claim matches more than one candidate', () => {
    const warnings: AiSafetyWarning[] = [
      { type: 'interaction', drug: 'Clarithromycin', detail: 'Interaction — Major. …', severity: 'Major' },
      { type: 'interaction', drug: 'Clarithromycin', detail: 'Interaction — Minor. …', severity: 'Minor' },
    ];
    const resolved = resolveFindingSeverities('There is an Interaction [350].', REFERENCES, warnings, [350]);
    expect(resolved.size).toBe(0);
  });

  it('skips a finding whose warning carries no rating', () => {
    // An ATC-class or cross-reactivity join has no rule to rate, so there is nothing to show.
    const resolved = resolveFindingSeverities(ANSWER, REFERENCES, SAFETY_WARNINGS, [349]);
    expect(resolved.size).toBe(0);
  });

  it('skips an index with no reference, and a uuid that is not <type>:<drug>', () => {
    expect(resolveFindingSeverities(ANSWER, REFERENCES, SAFETY_WARNINGS, [9999]).size).toBe(0);
    const refs: AiReference[] = [
      { index: 1, resourceType: 'safety_finding', resourceUuid: 'no-colon-here', date: '', group: 'reference' },
    ];
    expect(
      resolveFindingSeverities(
        'A claim [1].',
        refs,
        [{ type: 'interaction', drug: 'x', detail: 'y', severity: 'Major' }],
        [1],
      ).size,
    ).toBe(0);
  });

  it('matches type and drug case-insensitively', () => {
    const refs: AiReference[] = [safetyFindingRef(1, 'INTERACTION', 'clarithromycin')];
    const resolved = resolveFindingSeverities(
      'A claim [1].',
      refs,
      [{ type: 'Interaction', drug: 'Clarithromycin', detail: 'A finding.', severity: 'Major' }],
      [1],
    );
    expect(resolved.get(1)).toBe('Major');
  });

  it('preserves an unrecognised rating verbatim rather than normalising it', () => {
    const refs: AiReference[] = [
      { index: 1, resourceType: 'safety_finding', resourceUuid: 'interaction:Ibuprofen', date: '', group: 'reference' },
    ];
    const resolved = resolveFindingSeverities(
      'A claim [1].',
      refs,
      [{ type: 'interaction', drug: 'Ibuprofen', detail: 'A finding.', severity: '  Contraindicated  ' }],
      [1],
    );
    expect(resolved.get(1)).toBe('Contraindicated');
  });
});

describe('referenceKind', () => {
  it('names each reference type the predicate admits', () => {
    for (const resourceType of ['drug_reference', 'safety_finding', 'drug_class_note']) {
      expect(referenceKind({ index: 1, resourceType, resourceUuid: 'x', date: '' })).toBe(resourceType);
    }
  });

  it('reports a reference-group type it does not know as "other" rather than guessing one', () => {
    // isReferenceData admits any reference-group citation, so labelling the leftovers
    // "Drug reference" would tell a clinician the chip came from a drug's reference entry.
    expect(
      referenceKind({ index: 1, resourceType: 'some_future_type', resourceUuid: 'x', date: '', group: 'reference' }),
    ).toBe('other');
  });
});

describe('parseCitationIndices', () => {
  it('splits a marker group’s index list however it is spaced', () => {
    expect(parseCitationIndices('7')).toEqual([7]);
    expect(parseCitationIndices('7, 8')).toEqual([7, 8]);
    expect(parseCitationIndices('7,8')).toEqual([7, 8]);
  });
});
