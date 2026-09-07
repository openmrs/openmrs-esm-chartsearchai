import { describe, expect, it } from 'vitest';
import type { AiReference, AiSafetyWarning } from '../api/chartsearchai';
import { claimTextByCitation, isReferenceData, resolveFindingSeverities, severityTone } from './safety-disclosure';

/**
 * The live response this feature was designed against — RefApp 3.7.1 standalone, backend
 * `main` @ 4dd1fea4 with the bundled DDInter knowledge base, patient
 * dc8560c9-6d2b-45bf-861c-8fcf562ec9b1 asked "Is it safe to start her on clarithromycin?".
 *
 * Trimmed to the fields these helpers read. The five interaction findings all share one
 * `resourceUuid` (`interaction:Clarithromycin`), which is exactly why the uuid alone cannot
 * resolve a rating and the answer's own prose has to break the tie.
 */
const ANSWER =
  'No — Clarithromycin should not be started: The patient has a recorded allergy to Clarithromycin [349]. ' +
  'Furthermore, Clarithromycin interacts with active order Methylprednisolone [177] [350], ' +
  'Clarithromycin interacts with active order Budesonide [166] [351], ' +
  'Clarithromycin interacts with active order Prednisone [155] [352], ' +
  'Clarithromycin interacts with active order Dexamethasone [12] [353], and ' +
  'Clarithromycin interacts with active order Hydrocortisone [14] [354].';

const REFERENCES: AiReference[] = [
  { index: 12, resourceType: 'drug_order', resourceUuid: 'h144-109', date: '2026-08-05', group: 'chart' },
  { index: 14, resourceType: 'drug_order', resourceUuid: 'h144-173', date: '2026-08-05', group: 'chart' },
  { index: 166, resourceType: 'visit', resourceUuid: 'uuid-visit', date: '2024-09-09', group: 'chart' },
  { index: 155, resourceType: 'encounter', resourceUuid: 'uuid-enc', date: '2024-09-09', group: 'chart' },
  { index: 177, resourceType: 'condition', resourceUuid: 'uuid-cond', date: '2024-05-13', group: 'chart' },
  {
    index: 3,
    resourceType: 'allergy',
    resourceUuid: 'a172c001-0000-4000-8000-000000000013',
    date: null as unknown as string,
    group: 'chart',
    attachedByTheModule: true,
  },
  {
    index: 349,
    resourceType: 'safety_finding',
    resourceUuid: 'contraindication:Clarithromycin',
    date: null as unknown as string,
    group: 'reference',
  },
  ...[350, 351, 352, 353, 354].map((index) => ({
    index,
    resourceType: 'safety_finding',
    resourceUuid: 'interaction:Clarithromycin',
    date: null as unknown as string,
    group: 'reference',
  })),
];

const interaction = (partner: string, severity: string): AiSafetyWarning => ({
  type: 'interaction',
  drug: 'Clarithromycin',
  detail: `Clarithromycin interacts with active order ${partner} — ${severity}. Coadministration with potent inhibitors of CYP450 3A4 …`,
  severity,
});

const SAFETY_WARNINGS: AiSafetyWarning[] = [
  {
    type: 'contraindication',
    drug: 'Clarithromycin',
    detail: 'The patient has a recorded allergy to Clarithromycin.',
    severity: null,
  },
  interaction('Methylprednisolone', 'Major'),
  interaction('Budesonide', 'Major'),
  interaction('Prednisone', 'Moderate'),
  interaction('Dexamethasone', 'Moderate'),
  interaction('Hydrocortisone', 'Moderate'),
];

const UNSTATED = [350, 351, 352, 353, 354];

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

  it('blanks an index cited from two different claims rather than letting the last win', () => {
    const claims = claimTextByCitation('First claim [5]. Second, unrelated claim [5].');
    expect(claims.get(5)).toBe('');
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
