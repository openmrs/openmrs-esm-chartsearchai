import React from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AiResponsePanel from './ai-response-panel.component';
import { highlightReference } from '../utils/highlight-reference';
import { SESSION_EXPIRED_ERROR_CODE } from '../api/chartsearchai';
import {
  ANSWER_BY_ORDER_DISPLAY,
  ANSWER_BY_SUBSTANCE,
  interaction,
  MISATTRIBUTED,
  REFERENCES as FIXTURE_REFERENCES,
  SAFETY_WARNINGS,
  UNSTATED,
} from '../__fixtures__/clarithromycin-response';

vi.mock('../utils/highlight-reference', () => ({ highlightReference: vi.fn() }));
const mockHighlightReference = highlightReference as Mock;

const patientUuid = 'test-patient-uuid';

beforeAll(() => {
  window.spaBase = '/openmrs/spa';
});

afterAll(() => {
  delete (window as unknown as Record<string, unknown>).spaBase;
});

describe('AiResponsePanel reference links', () => {
  const references = [
    { index: 1, resourceType: 'obs', resourceUuid: 'uuid-101', date: '2025-01-15' },
    { index: 2, resourceType: 'order', resourceUuid: 'uuid-202', date: '2025-02-20' },
    { index: 3, resourceType: 'allergy', resourceUuid: 'uuid-303', date: '2025-03-10' },
    { index: 4, resourceType: 'condition', resourceUuid: 'uuid-404', date: '2025-04-05' },
    { index: 5, resourceType: 'diagnosis', resourceUuid: 'uuid-505', date: '2025-05-12' },
  ];

  const answer =
    'The patient has lab results [1] and an active order [2]. They have an allergy [3], a condition [4], and a diagnosis [5].';

  it('renders reference tags as clickable <a> elements with correct href', () => {
    render(
      <AiResponsePanel
        answer={answer}
        references={references}
        questionId="test-question-id"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    const refLinks = screen.getAllByRole('link');
    // 5 inline citations + 5 reference tags = 10 links
    expect(refLinks.length).toBe(10);

    // Check reference tag links (the ones with label text like "[1] obs — 2025-01-15")
    const obsLink = screen.getByText('[1] obs — 2025-01-15');
    expect(obsLink.tagName).toBe('A');
    expect(obsLink).toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Results`);

    const orderLink = screen.getByText('[2] order — 2025-02-20');
    expect(orderLink.tagName).toBe('A');
    expect(orderLink).toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Orders`);

    const allergyLink = screen.getByText('[3] allergy — 2025-03-10');
    expect(allergyLink.tagName).toBe('A');
    expect(allergyLink).toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Allergies`);

    const conditionLink = screen.getByText('[4] condition — 2025-04-05');
    expect(conditionLink.tagName).toBe('A');
    expect(conditionLink).toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Conditions`);

    const diagnosisLink = screen.getByText('[5] diagnosis — 2025-05-12');
    expect(diagnosisLink.tagName).toBe('A');
    expect(diagnosisLink).toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Visits`);
  });

  it('passes the resource UUID (not a numeric id) to highlightReference when a citation is clicked', () => {
    render(
      <AiResponsePanel
        answer={answer}
        references={references}
        questionId="test-question-id"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    fireEvent.click(screen.getByText('[1] obs — 2025-01-15'));

    // The cited record's UUID must reach highlightReference so it can locate the chart row.
    // Before the fix the panel read `ref.resourceId` (undefined, since the backend sends
    // `resourceUuid`), so id-based row matching silently never fired.
    expect(mockHighlightReference).toHaveBeenCalledWith('uuid-101', '2025-01-15');
  });

  it('renders inline citations as clickable <a> elements', () => {
    render(
      <AiResponsePanel
        answer={answer}
        references={references}
        questionId="test-question-id"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    // Inline citations render as plain numbers inside brackets: [ <a>1</a> ]
    const allLinks = screen.getAllByRole('link');
    const inlineCitations = allLinks.filter((link) => /^\d+$/.test(link.textContent ?? ''));
    expect(inlineCitations.length).toBe(5);

    // Each inline citation should have a valid href
    const expectedHrefs = [
      `/openmrs/spa/patient/${patientUuid}/chart/Results`,
      `/openmrs/spa/patient/${patientUuid}/chart/Orders`,
      `/openmrs/spa/patient/${patientUuid}/chart/Allergies`,
      `/openmrs/spa/patient/${patientUuid}/chart/Conditions`,
      `/openmrs/spa/patient/${patientUuid}/chart/Visits`,
    ];
    inlineCitations.forEach((citation) => {
      expect(expectedHrefs).toContain(citation.getAttribute('href'));
    });
  });

  it('renders comma-separated inline citations as individual clickable links', () => {
    const refs = [
      { index: 1, resourceType: 'obs', resourceUuid: 'uuid-101', date: '2025-01-15' },
      { index: 2, resourceType: 'order', resourceUuid: 'uuid-202', date: '2025-02-20' },
    ];

    render(
      <AiResponsePanel
        answer="The patient has findings [1, 2]."
        references={refs}
        questionId="test-question-id"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    // Numbers are individually linked; brackets and comma are plain text
    const link1 = screen.getByRole('link', { name: '1' });
    expect(link1).toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Results`);

    const link2 = screen.getByRole('link', { name: '2' });
    expect(link2).toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Orders`);
  });

  it('renders a duplicated citation index ([n, n]) without a React key collision', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refs = [{ index: 3, resourceType: 'obs', resourceUuid: 'uuid-303', date: '2025-03-10' }];

    render(
      <AiResponsePanel
        answer="The same finding is cited twice [3, 3]."
        references={refs}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    // Both inline citations render (one per position in the bracket group)...
    expect(screen.getAllByRole('link', { name: '3' })).toHaveLength(2);
    // ...and React logs no duplicate-key warning, because the key includes the group position.
    const dupKeyWarning = errorSpy.mock.calls.some(
      (args) => typeof args[0] === 'string' && args[0].includes('same key'),
    );
    expect(dupKeyWarning).toBe(false);
    errorSpy.mockRestore();
  });

  it('renders unknown resource types as links to Patient Summary', () => {
    const unknownRef = [{ index: 1, resourceType: 'UnknownType', resourceUuid: 'uuid-999', date: '2025-06-01' }];

    render(
      <AiResponsePanel
        answer="Some answer [1]."
        references={unknownRef}
        questionId="test-question-id"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    const tag = screen.getByText('[1] UnknownType — 2025-06-01');
    expect(tag.tagName).toBe('A');
    expect(tag).toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Patient%20Summary`);
  });

  it('shows only the error when there is no partial answer', () => {
    render(
      <AiResponsePanel
        answer=""
        references={[]}
        questionId="test-question-id"
        error="Server error: 500"
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByText('Server error: 500')).toBeInTheDocument();
    expect(screen.queryByText(/Response interrupted/)).not.toBeInTheDocument();
  });

  it('localizes the session-expired error code (does not render the raw code)', () => {
    render(
      <AiResponsePanel
        answer=""
        references={[]}
        questionId="test-question-id"
        error={SESSION_EXPIRED_ERROR_CODE}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    // The API emits a code; the panel must render the (localizable) message, never the raw code.
    expect(screen.getByText('Your session has expired. Please log in again.')).toBeInTheDocument();
    expect(screen.queryByText(SESSION_EXPIRED_ERROR_CODE)).not.toBeInTheDocument();
  });

  it('shows partial answer with error banner when stream fails mid-response', () => {
    render(
      <AiResponsePanel
        answer="The patient has been taking"
        references={[]}
        questionId="test-question-id"
        error="Connection lost"
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByText('The patient has been taking')).toBeInTheDocument();
    expect(screen.getByText(/Response interrupted:/)).toBeInTheDocument();
    expect(screen.getByText(/Connection lost/)).toBeInTheDocument();
  });
});

describe('AiResponsePanel citation grounding', () => {
  const answer = 'The patient has a finding [1].';

  function renderWithGrounded(grounded: boolean | null) {
    render(
      <AiResponsePanel
        answer={answer}
        references={[{ index: 1, resourceType: 'obs', resourceUuid: 'uuid-101', date: '2025-01-15', grounded }]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );
  }

  it('flags an unsupported citation (grounded=false) in the list and inline', () => {
    renderWithGrounded(false);
    expect(screen.getByText('Unsupported')).toBeInTheDocument();
    // inline citation carries the warning glyph
    expect(screen.getByRole('link', { name: /1\s*⚠/ })).toBeInTheDocument();
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
  });

  it('marks a supported citation (grounded=true) verified with no inline warning', () => {
    renderWithGrounded(true);
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '1' })).toBeInTheDocument();
    expect(screen.queryByText('Unsupported')).not.toBeInTheDocument();
  });

  it('shows no grounding badge when the verdict is null (unverified)', () => {
    renderWithGrounded(null);
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsupported')).not.toBeInTheDocument();
    // plain inline citation, no warning glyph
    expect(screen.getByRole('link', { name: '1' })).toBeInTheDocument();
  });
});

describe('AiResponsePanel drug-reference citations', () => {
  const references = [{ index: 6, resourceType: 'drug_reference', resourceUuid: 'ibuprofen', date: '' }];

  it('renders a drug-reference citation as non-navigating, visually distinct', () => {
    render(
      <AiResponsePanel
        answer="Reference dosing for ibuprofen [6]."
        references={references}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    // The reference chip reads "Drug reference" (not the raw resourceType + date).
    const chip = screen.getByText('[6] Drug reference');
    expect(chip.tagName).not.toBe('A');
    // A distinct "Reference" badge is shown.
    expect(screen.getByText('Reference')).toBeInTheDocument();
    // The inline citation does not navigate (it is a span, not a link).
    expect(screen.queryByRole('link', { name: '6' })).not.toBeInTheDocument();
  });

  it('renders a mixed [drug_reference, chart-record] citation: reference non-navigating, record linked', () => {
    const refs = [
      { index: 3, resourceType: 'drug_reference', resourceUuid: 'ibuprofen', date: '' },
      { index: 5, resourceType: 'obs', resourceUuid: 'uuid-505', date: '2025-05-12' },
    ];
    render(
      <AiResponsePanel
        answer="Per the reference and the patient's labs [3, 5]."
        references={refs}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    // The chart-record index stays a navigable inline link...
    expect(screen.getByRole('link', { name: '5' })).toHaveAttribute(
      'href',
      `/openmrs/spa/patient/${patientUuid}/chart/Results`,
    );
    // ...while the drug_reference index in the same bracket does NOT navigate (rendered as a span).
    expect(screen.queryByRole('link', { name: '3' })).not.toBeInTheDocument();
  });
});

describe('AiResponsePanel safety warnings', () => {
  it('renders safety warnings as chips below the answer', () => {
    render(
      <AiResponsePanel
        answer="Ibuprofen 600 mg every 6 hours [6]."
        references={[]}
        safetyWarnings={[
          { type: 'overdose', drug: 'Ibuprofen', detail: 'stated dose ~2400 mg/day exceeds the 1200 mg/day maximum' },
          { type: 'interaction', drug: 'Ibuprofen', detail: 'interacts with active order warfarin' },
        ]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByText('Safety checks:')).toBeInTheDocument();
    expect(screen.getByText('Dose')).toBeInTheDocument();
    expect(screen.getByText('Interaction')).toBeInTheDocument();
    expect(screen.getByText(/exceeds the 1200 mg\/day maximum/)).toBeInTheDocument();
    expect(screen.getByText(/interacts with active order warfarin/)).toBeInTheDocument();
  });

  it('renders a contraindication warning with the Contraindication label', () => {
    // Contraindication is the highest-stakes warning type (and the one the backend's
    // question-driven validator most often produces); its switch case must render, not fall
    // through to the generic fallback.
    render(
      <AiResponsePanel
        answer="Ibuprofen is an option [1]."
        references={[]}
        safetyWarnings={[
          { type: 'contraindication', drug: 'Ibuprofen', detail: 'the patient has a recorded allergy to Ibuprofen' },
        ]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByText('Safety checks:')).toBeInTheDocument();
    expect(screen.getByText('Contraindication')).toBeInTheDocument();
    expect(screen.getByText(/recorded allergy to Ibuprofen/)).toBeInTheDocument();
  });

  it('renders no safety section when there are no warnings', () => {
    render(
      <AiResponsePanel
        answer="The blood pressure is 120/80 [1]."
        references={[]}
        safetyWarnings={[]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.queryByText('Safety checks:')).not.toBeInTheDocument();
  });

  it('surfaces an unrecognised warning type with the fallback label (never drops a warning)', () => {
    render(
      <AiResponsePanel
        answer="Some answer."
        references={[]}
        safetyWarnings={[{ type: 'future-unknown-type', drug: 'Ibuprofen', detail: 'a new advisory kind' }]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    // A future/unknown warning type must still surface — not silently vanish.
    expect(screen.getByText('Safety checks:')).toBeInTheDocument();
    expect(screen.getByText('Safety')).toBeInTheDocument();
    expect(screen.getByText(/a new advisory kind/)).toBeInTheDocument();
  });

  it('does not mark the safety section as an assertive alert (it sits inside a polite live region)', () => {
    render(
      <AiResponsePanel
        answer="Ibuprofen 600 mg [1]."
        references={[]}
        safetyWarnings={[{ type: 'overdose', drug: 'Ibuprofen', detail: 'exceeds the maximum' }]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    // A role="alert" here would preempt the answer announcement in the enclosing role="log".
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // ...but the warning still renders.
    expect(screen.getByText('Safety checks:')).toBeInTheDocument();
  });
});

describe('AiResponsePanel copy-to-clipboard', () => {
  const references = [
    { index: 1, resourceType: 'obs', resourceUuid: 'uuid-101', date: '2025-01-15' },
    { index: 2, resourceType: 'order', resourceUuid: 'uuid-202', date: '2025-02-20' },
  ];

  let writeText: Mock;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  it('does not render copy button while answer is streaming', () => {
    render(
      <AiResponsePanel
        answer="The patient has lab results [1]"
        references={references}
        questionId="q1"
        error={null}
        isLoading={true}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
  });

  it('renders a copy button once the answer is fully received', () => {
    render(
      <AiResponsePanel
        answer="The patient has lab results [1] and an active order [2]."
        references={references}
        questionId="q1"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('copies the answer text without citation markers when clicked', async () => {
    render(
      <AiResponsePanel
        answer="The patient has lab results [1] and an active order [2]."
        references={references}
        questionId="q1"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('The patient has lab results and an active order.');
  });

  it('strips comma-separated citation groups when copying', async () => {
    render(
      <AiResponsePanel
        answer="Findings [1, 2] are notable."
        references={references}
        questionId="q1"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith('Findings are notable.');
  });
});

/**
 * The five backend fields that state a bounded safety answer's limits (issue #26), rendered
 * against the measured response in `src/__fixtures__/clarithromycin-response.ts` — shared with
 * the resolver's own tests, because the ratings asserted here are that resolver's OUTPUT over
 * the fixture's prose and warnings and so depend on dataset-format details only the fixture
 * states.
 */
describe('AiResponsePanel answer-limit disclosure', () => {
  function renderPanel(overrides: Record<string, unknown> = {}) {
    return render(
      <AiResponsePanel
        answer={ANSWER_BY_SUBSTANCE}
        references={FIXTURE_REFERENCES}
        safetyWarnings={SAFETY_WARNINGS}
        misattributedOrderCitations={MISATTRIBUTED}
        unstatedFindingSeverities={UNSTATED}
        conditionRuleCoverage="absent"
        interactionPairs={{ found: 5, reported: 5 }}
        questionId="q-26"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
        {...overrides}
      />,
    );
  }

  /**
   * The rendered sentence text, markers and severity badges included, with whitespace collapsed.
   * Found by class rather than by a text fragment so it works across the fixture's two answer
   * shapes; `identity-obj-proxy` maps the CSS-module class to its own name in tests.
   */
  const answerText = () =>
    (
      screen.getByText((_content, element) => Boolean(element?.className?.includes?.('answerText'))).textContent ?? ''
    ).replace(/\s+/g, ' ');

  /**
   * The limits block, or null. Queried by class rather than by its heading text: four
   * assertions in this file used to name the heading and went dead the moment it was reworded,
   * passing while examining nothing.
   */
  const limitsSection = () =>
    screen.queryByText((_content, element) => Boolean(element?.className?.includes?.('limitsLabel')));

  it('renders each unstated rating immediately after the marker of the finding it rates', () => {
    renderPanel();
    // Adjacency, not merely sequence: an earlier version of this test asserted the list of
    // badge texts, which would have passed with every badge appended at the end of the answer.
    const text = answerText();
    expect(text).toContain('active order Methylprednisolone [177] [350] Major');
    expect(text).toContain('active order Budesonide [166] [351] Major');
    expect(text).toContain('active order Prednisone [155] [352] Moderate');
    expect(text).toContain('active order Dexamethasone [12] [353] Moderate');
    expect(text).toContain('active order Hydrocortisone [14] [354] Moderate');
  });

  it('pairs each rating with its own finding rather than the right multiset of ratings', () => {
    // Two Majors then three Moderates cannot see a permutation within either run, so give the
    // five findings five distinct ratings and assert each lands on its own sentence.
    const distinct = [
      SAFETY_WARNINGS[0],
      interaction('Methylprednisolone', 'Major', 'Solu-Medrol 125mg/5ml'),
      interaction('Budesonide', 'Minor', 'Pulmicort 90mcg'),
      interaction('Prednisone', 'Moderate'),
      interaction('Dexamethasone', 'Unknown'),
      interaction('Hydrocortisone', 'Catastrophic'),
    ];
    renderPanel({ safetyWarnings: distinct });
    const text = answerText();
    expect(text).toContain('Methylprednisolone [177] [350] Major');
    expect(text).toContain('Budesonide [166] [351] Minor');
    expect(text).toContain('Prednisone [155] [352] Moderate');
    expect(text).toContain('Dexamethasone [12] [353] Unknown');
    expect(text).toContain('Hydrocortisone [14] [354] Catastrophic');
  });

  it('resolves ratings on an answer that names the chart’s order display', () => {
    // The other live answer shape: the answer says "Solu-Medrol 125mg/5ml" where the chip says
    // "Methylprednisolone", and repeats every marker inside its own statement.
    renderPanel({ answer: ANSWER_BY_ORDER_DISPLAY, misattributedOrderCitations: [] });
    const text = answerText();
    expect(text).toContain('active order Solu-Medrol 125mg/5ml [350] Major');
    expect(text).toContain('active order Pulmicort 90mcg [351] Major');
    expect(text).toContain('active order Prednisone Co 5mg [352] Moderate');
  });

  it('badges a repeated marker once, not once per occurrence', () => {
    renderPanel({ answer: ANSWER_BY_ORDER_DISPLAY, misattributedOrderCitations: [] });
    // [350] is cited twice in its own statement; the rating belongs to the finding, not the marker.
    expect(answerText().match(/Major/g) ?? []).toHaveLength(2);
  });

  it('renders one rating for a comma-grouped pair that resolves to one finding', () => {
    // "[350, 351] Major Major" would read as two findings where there is one.
    renderPanel({
      answer: 'Clarithromycin interacts with active order Methylprednisolone [350, 351].',
      misattributedOrderCitations: [],
      unstatedFindingSeverities: [350, 351],
      safetyWarnings: [SAFETY_WARNINGS[0], interaction('Methylprednisolone', 'Major', 'Solu-Medrol 125mg/5ml')],
    });
    expect(answerText().match(/Major/g) ?? []).toHaveLength(1);
  });

  it('gives an unrecognised rating a treatment distinct from the module’s lowest tier', () => {
    // `Unknown` is the lowest of the four recognised ratings; unrated sorts ABOVE all four, so
    // one grey for both would tell a clinician they rank equally.
    renderPanel({
      unstatedFindingSeverities: [350, 351],
      safetyWarnings: [
        SAFETY_WARNINGS[0],
        interaction('Methylprednisolone', 'Unknown', 'Solu-Medrol 125mg/5ml'),
        interaction('Budesonide', 'Catastrophic', 'Pulmicort 90mcg'),
      ],
    });
    const unknown = screen.getByText('Unknown').className;
    const unrated = screen.getByText('Catastrophic').className;
    expect(unknown).not.toEqual(unrated);
  });

  it('states no rating where the answer already states them', () => {
    renderPanel({ unstatedFindingSeverities: [] });
    expect(screen.queryAllByTitle(/may not state the rating/i)).toHaveLength(0);
    expect(answerText()).not.toContain('Major');
  });

  it('renders the rating as a caveat, not a verdict', () => {
    // The backend documents three measured cells where this key over-reports — a rating stated
    // by synonym among them — so the wording must not assert that the answer omitted it.
    renderPanel();
    expect(screen.getAllByTitle(/may not state the rating/i).length).toBeGreaterThan(0);
  });

  it('does not make a misattributed citation navigate, in the prose or on its chip', () => {
    renderPanel();
    // The record is real but is not the order the sentence names, so following either the
    // inline marker or the chip would land the clinician on an unrelated row.
    for (const index of ['177', '166', '155']) {
      const marker = screen.getByText(index, { selector: 'span' });
      expect(marker.tagName).toBe('SPAN');
      expect(marker).toHaveAttribute('title', expect.stringContaining('may not be the medication order'));
    }
    const chip = screen.getByText('[177] condition — 2024-05-13');
    expect(chip.tagName).toBe('SPAN');
  });

  it('marks a misattributed citation as bad evidence, never as an unsupported claim', () => {
    renderPanel();
    // A red "Unsupported" badge here is the miscarriage the backend field exists to prevent:
    // the finding is deterministic and correct; only the chart evidence attached to it is wrong.
    expect(screen.queryByText('Unsupported')).not.toBeInTheDocument();
    expect(screen.getAllByText('Not the order named')).toHaveLength(3);
  });

  it('leaves correctly-cited chart citations navigable', () => {
    renderPanel();
    const stillLinked = screen.getByText('12', { selector: 'a' });
    expect(stillLinked.tagName).toBe('A');
  });

  it('renders nothing extra when the check named no misattributed citation', () => {
    // An empty array says the check ran and named none — it is NOT a certificate that the
    // remaining citations are sound, so nothing here may read as a clean bill of health.
    renderPanel({ misattributedOrderCitations: [] });
    expect(screen.queryByText('Not the order named')).not.toBeInTheDocument();
    expect(screen.queryByText(/citations verified/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/all citations/i)).not.toBeInTheDocument();
  });

  it('gives a module-attached citation somewhere to appear and says who supplied it', () => {
    renderPanel();
    // The trap: this citation has NO [N] marker in the prose, so a reference list built by
    // scanning the answer text drops it silently — here it is the recorded-allergy record
    // behind the answer's load-bearing claim.
    expect(ANSWER_BY_SUBSTANCE).not.toContain('[3]');
    expect(screen.getByText('[3] allergy')).toBeInTheDocument();
    expect(screen.getByText('Added by the module')).toBeInTheDocument();
  });

  it('omits the date separator for a record that carries no date', () => {
    renderPanel();
    expect(screen.queryByText(/— null/)).not.toBeInTheDocument();
    expect(screen.getByText('[349] Safety finding')).toBeInTheDocument();
  });

  it('does not navigate a reference-group citation to a chart page', () => {
    renderPanel();
    // A safety finding's resourceUuid is synthetic (`interaction:Clarithromycin`); a link to
    // Patient Summary could never land anywhere.
    expect(screen.getByText('[350] Safety finding').tagName).toBe('SPAN');
  });

  it('says how much of the interaction screen is shown', () => {
    renderPanel();
    expect(screen.getByText('Interactions: 5 of 5 drug pairs shown.')).toBeInTheDocument();
    // found === reported means that check withheld nothing; it is not a claim of completeness.
    expect(screen.queryByText(/least severe were withheld/i)).not.toBeInTheDocument();
  });

  it('says so where the interaction list was truncated', () => {
    renderPanel({ interactionPairs: { found: 18, reported: 10 } });
    expect(screen.getByText(/Interactions: 10 of 18 drug pairs shown/)).toBeInTheDocument();
    expect(screen.getByText(/least severe were withheld/i)).toBeInTheDocument();
  });

  it('states no interaction extent where the response stated no measurement', () => {
    renderPanel({ interactionPairs: null, conditionRuleCoverage: null });
    expect(screen.queryByText(/drug pairs shown/)).not.toBeInTheDocument();
    expect(limitsSection()).toBeNull();
  });

  it('states nothing rather than "undefined of 5" where one half of the measurement is missing', () => {
    // Silent wrong output, not a crash: the interpolation would stringify the missing half, and
    // `reported < found` would be false so the bounded warning would not fire to contradict it.
    renderPanel({ interactionPairs: { found: 5 }, conditionRuleCoverage: null });
    expect(screen.queryByText(/drug pairs shown/)).not.toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    expect(limitsSection()).toBeNull();
  });

  it('states no coverage note on an answer no safety screen produced anything for', () => {
    // Measured on a live server: "What is her blood pressure trend?" comes back
    // conditionRuleCoverage "absent" with no warnings and no pair measurement — "absent" is the
    // verdict the shipped knowledge base yields, so an ungated note would sit under every
    // answer on every install and imply a contraindication screen fell short where none ran.
    renderPanel({
      safetyWarnings: [],
      interactionPairs: null,
      conditionRuleCoverage: 'absent',
      // The real payload: 22 obs citations and not one reference-group record, so nothing says a
      // drug-safety screen produced anything.
      references: [{ index: 1, resourceType: 'obs', resourceUuid: 'o-1', date: '2026-01-01', group: 'chart' }],
      misattributedOrderCitations: [],
      unstatedFindingSeverities: [],
    });
    expect(limitsSection()).toBeNull();
    expect(screen.queryByText(/were not screened/)).not.toBeInTheDocument();
  });

  it('states the coverage note where a screen cited a reference record but raised no chip', () => {
    // The load-bearing case: a prescribing question against a chart with conditions and no
    // active orders runs the contraindication screen, raises no chip and states no pair extent.
    // The backend says of exactly that — "Render it. That is what the key is for."
    renderPanel({ safetyWarnings: [], interactionPairs: null, conditionRuleCoverage: 'absent' });
    expect(screen.getByText(/publishes no condition rules/)).toBeInTheDocument();
  });

  it('states the coverage note where an interaction screen ran but raised no chip', () => {
    // A pair measurement is a screen on its own, so its extent is worth stating even with no
    // warnings beside it.
    renderPanel({ safetyWarnings: [], interactionPairs: { found: 0, reported: 0 } });
    expect(screen.getByText(/publishes no condition rules/)).toBeInTheDocument();
  });

  it('keeps the ungrounded warning on a citation that is also misattributed', () => {
    // The two checks are independent and both can fire on one citation. The backend is explicit
    // that this key must render BESIDE the other statements about a citation, never over them:
    // a marker that hid the verdict would disagree with the chip below, which shows the red
    // "Unsupported" badge either way.
    const refs = FIXTURE_REFERENCES.map((ref) => (ref.index === 177 ? { ...ref, grounded: false } : ref));
    renderPanel({ references: refs });
    const marker = screen.getByText('177 ⚠', { selector: 'span' });
    expect(marker).toHaveAttribute('title', expect.stringContaining('may not be the medication order'));
    expect(marker).toHaveAttribute('title', expect.stringContaining('may not support this statement'));
    // ...and the chip's own verdict is still published.
    expect(screen.getByText('Unsupported')).toBeInTheDocument();
  });

  it('does not state a pair ratio where the screen related no pairs', () => {
    // `found: 0` is a real measurement, but it is about the check that reported it and NOT about
    // the findings beside it — which may come from another check. "0 of 0 drug pairs shown"
    // above a Major interaction chip reads as "no interactions found".
    renderPanel({ interactionPairs: { found: 0, reported: 0 } });
    expect(screen.queryByText(/0 of 0/)).not.toBeInTheDocument();
    expect(screen.getByText(/related no drug pairs/)).toBeInTheDocument();
  });

  it('states nothing where the measurement is not a sane pair of counts', () => {
    for (const interactionPairs of [
      { found: 5, reported: 8 },
      { found: -1, reported: 0 },
      { found: 5.5, reported: 1 },
    ]) {
      const { unmount } = renderPanel({ interactionPairs, conditionRuleCoverage: null });
      expect(screen.queryByText(/drug pairs/)).not.toBeInTheDocument();
      expect(limitsSection()).toBeNull();
      unmount();
    }
  });

  it('states no limits while the answer is still streaming', () => {
    // The citations are not annotated at all during streaming, so a limits block would describe
    // annotations the reader cannot see — and closing the panel mid-stream leaves the message
    // loading forever while a trailing grounded event still lands its measurements.
    renderPanel({ isLoading: true });
    expect(limitsSection()).toBeNull();
  });

  it('labels each kind of reference material, and never guesses at one it does not know', () => {
    renderPanel({
      references: [
        { index: 8, resourceType: 'drug_class_note', resourceUuid: 'class:H02AB', date: null, group: 'reference' },
        { index: 9, resourceType: 'some_future_type', resourceUuid: 'x', date: null, group: 'reference' },
      ],
      misattributedOrderCitations: [],
      unstatedFindingSeverities: [],
    });
    // Calling a class note a "Drug reference" would tell a clinician it came from a drug's
    // reference entry when it came from an ATC-class or cross-reactivity join.
    expect(screen.getByText('[8] Drug class note')).toBeInTheDocument();
    expect(screen.getByText('[9] Reference material')).toBeInTheDocument();
  });

  it('navigates a drug order to Orders rather than the default tab', () => {
    renderPanel();
    expect(screen.getByText('[12] drug_order — 2026-08-05')).toHaveAttribute(
      'href',
      `/openmrs/spa/patient/${patientUuid}/chart/Orders`,
    );
  });

  it('navigates a module-injected active order like any other chart citation', () => {
    // It is injected but is the patient's own order with a real Order uuid, so it groups as
    // chart and must not land on the default tab under its raw wire type.
    renderPanel({
      references: [
        { index: 20, resourceType: 'active_drug_order', resourceUuid: 'o-1', date: '2026-01-01', group: 'chart' },
      ],
      misattributedOrderCitations: [],
      unstatedFindingSeverities: [],
    });
    expect(screen.getByText('[20] active_drug_order — 2026-01-01')).toHaveAttribute(
      'href',
      `/openmrs/spa/patient/${patientUuid}/chart/Orders`,
    );
  });

  it('says conditions were not screened, and why, on "absent"', () => {
    renderPanel();
    expect(screen.getByText(/publishes no condition rules/)).toBeInTheDocument();
  });

  it('distinguishes "absent" from "unloaded"', () => {
    // "We looked and there is none" is not "nobody looked".
    renderPanel({ conditionRuleCoverage: 'unloaded' });
    expect(screen.getByText(/No drug-reference dataset was loaded/)).toBeInTheDocument();
    expect(screen.queryByText(/publishes no condition rules/)).not.toBeInTheDocument();
  });

  it('claims nothing about conditions on "published"', () => {
    // `published` says the DATASET can run the arm, never that any recorded condition was
    // screened — so it must not produce a "conditions screened" affordance.
    renderPanel({ conditionRuleCoverage: 'published', interactionPairs: null });
    expect(limitsSection()).toBeNull();
    expect(screen.queryByText(/conditions/i)).not.toBeInTheDocument();
  });
});
