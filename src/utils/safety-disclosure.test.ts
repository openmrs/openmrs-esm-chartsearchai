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
  ANSWER_BY_ORDER_DISPLAY,
  ANSWER_BY_SUBSTANCE,
  interaction,
  REFERENCES,
  SAFETY_WARNINGS,
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

  it('prefers the bridge over the detail lead where they would disagree', () => {
    // Tier order matters, not just tier presence: the bridged candidate is identified by a
    // string the backend publishes as a field, and it wins before any prose is parsed.
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
    const refs: AiReference[] = [
      {
        index: 1,
        resourceType: 'safety_finding',
        resourceUuid: 'INTERACTION:clarithromycin',
        date: '',
        group: 'reference',
      },
    ];
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
