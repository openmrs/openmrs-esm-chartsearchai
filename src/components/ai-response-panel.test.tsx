/* eslint-disable testing-library/no-container */
/* eslint-disable testing-library/no-node-access */
/* eslint-disable testing-library/prefer-presence-queries */
import React from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AiResponsePanel from './ai-response-panel.component';
import { highlightReference } from '../utils/highlight-reference';
import { SESSION_EXPIRED_ERROR_CODE } from '../api/chartsearchai';
import {
  ANSWER_BARE_LIST,
  ANSWER_BY_ORDER_DISPLAY,
  ANSWER_BY_SUBSTANCE,
  interaction,
  MISATTRIBUTED,
  REFERENCES as FIXTURE_REFERENCES,
  SAFETY_WARNINGS,
  safetyFindingRef,
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

  it('keeps raw reference tags in a collapsed detail while inline links stay available', () => {
    render(
      <AiResponsePanel
        answer={answer}
        references={references}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    const details = screen.getByText('Citation details').closest('details');
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Citation details'));
    expect(details).toHaveAttribute('open');
    expect(screen.getAllByRole('link')).toHaveLength(10);

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

  it('renders resolved hub references as evidence tiles with source text', () => {
    render(
      <AiResponsePanel
        answer="The last visit was documented on 2026-01-26 [4]."
        references={[
          {
            index: 4,
            sourceId: 'querystore:encounter:enc-4',
            resourceType: 'encounter',
            resourceUuid: 'enc-4',
            date: '2026-01-26',
            title: 'Adult visit on 2026-01-26',
            sourceText: 'Encounter: Adult Visit at Unknown Location. Provider: Horatio L Hornblower',
            resolutionStatus: 'resolved',
            groundingStatus: 'verified',
            usage: [{ location: 'answer', text: 'The last visit was documented.' }],
          },
        ]}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByText('Evidence Used')).toBeInTheDocument();
    expect(screen.getByText('[4] · encounter · 2026-01-26')).toBeInTheDocument();
    expect(screen.getByText('Adult visit on 2026-01-26')).toBeInTheDocument();
    expect(
      screen.getByText('Encounter: Adult Visit at Unknown Location. Provider: Horatio L Hornblower'),
    ).toBeInTheDocument();
    expect(screen.getByText(/UUID: enc-4/)).toBeInTheDocument();
    expect(screen.getByText('Source found')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('Used in: answer')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Citation details'));
    expect(screen.getByText('[4] · querystore:encounter:enc-4 · resolved · verified')).toBeInTheDocument();
  });

  it('uses the server evidence group and discloses source subset metadata', () => {
    render(
      <AiResponsePanel
        answer="A medication-safety finding was generated [8]."
        references={[
          {
            index: 8,
            group: 'reference',
            source: 'WHO-ATC research package',
            withheldInteractions: 4,
            resourceType: 'safety_finding',
            resourceUuid: 'finding-8',
            date: '',
            sourceText: 'Potential class interaction.',
            resolutionStatus: 'resolved',
            groundingStatus: 'unchecked',
          },
        ]}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByText('Source: WHO-ATC research package')).toBeInTheDocument();
    expect(screen.getByText(/4 additional interactions are not shown/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Potential class interaction.' })).not.toBeInTheDocument();
    expect(
      screen.getAllByTitle(
        'The module’s own safety finding, computed from this patient’s chart — not a chart record to open.',
      ),
    ).toHaveLength(2);
  });

  it('keeps legacy safety findings off patient-chart links when group metadata is absent', () => {
    render(
      <AiResponsePanel
        answer="A medication-safety finding was generated [8]."
        references={[
          {
            index: 8,
            resourceType: 'safety_finding',
            resourceUuid: 'finding-8',
            date: '',
            sourceText: 'Potential class interaction.',
            resolutionStatus: 'resolved',
            groundingStatus: 'unchecked',
          },
        ]}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(
      screen.getAllByTitle(
        'The module’s own safety finding, computed from this patient’s chart — not a chart record to open.',
      ),
    ).toHaveLength(2);
  });

  it('shows an unresolved citation as a missing-source evidence tile', () => {
    render(
      <AiResponsePanel
        answer="Unsupported citation [99]."
        references={[
          {
            index: 99,
            sourceId: 'unresolved:99',
            resourceType: 'unknown',
            resourceUuid: '',
            date: '',
            resolutionStatus: 'unresolved',
            groundingStatus: 'unchecked',
            usage: [{ location: 'answer', text: 'Unsupported citation [99].' }],
          },
        ]}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByText('Evidence Used')).toBeInTheDocument();
    expect(screen.getByText('Source missing')).toBeInTheDocument();
    expect(screen.getByText('unknown 99')).toBeInTheDocument();
  });

  it('shows title-only resolved evidence without duplicating source-derived titles', () => {
    const { rerender } = render(
      <AiResponsePanel
        answer="A supported answer [7]."
        references={[
          {
            index: 7,
            title: 'Medication order',
            sourceText: '',
            resourceType: 'order',
            resourceUuid: 'order-7',
            date: '2026-07-10',
            resolutionStatus: 'resolved',
            groundingStatus: 'verified',
          },
        ]}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByText('Medication order')).toBeInTheDocument();

    rerender(
      <AiResponsePanel
        answer="A supported answer [7]."
        references={[
          {
            index: 7,
            sourceText: '(2026-07-10) Medication order',
            resourceType: 'order',
            resourceUuid: 'order-7',
            date: '2026-07-10',
            resolutionStatus: 'resolved',
            groundingStatus: 'verified',
          },
        ]}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );
    expect(screen.getAllByText('Medication order')).toHaveLength(1);
    expect(screen.queryByText('(2026-07-10) Medication order')).not.toBeInTheDocument();
  });

  it('passes the resource UUID (not a numeric id) to highlightReference when a citation is clicked', () => {
    render(
      <AiResponsePanel
        answer={answer}
        references={references}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    fireEvent.click(screen.getByText('Citation details'));
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
        auditLogId={42}
        error={null}
        phase="complete"
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
        auditLogId={42}
        error={null}
        phase="complete"
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
        auditLogId={42}
        error={null}
        phase="complete"
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
        auditLogId={42}
        error={null}
        phase="complete"
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
        auditLogId={42}
        error="Server error: 500"
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByText('Server error: 500')).toBeInTheDocument();
    expect(screen.queryByText(/Response interrupted/)).not.toBeInTheDocument();
  });

  it('renders a Carbon DataTable below the prose when blocks are present', () => {
    const refs = [
      { index: 1, resourceType: 'order', resourceUuid: 'uuid-100', date: '2024-01-01' },
      { index: 2, resourceType: 'order', resourceUuid: 'uuid-200', date: '2024-02-01' },
    ];
    const blocks = [
      {
        kind: 'table' as const,
        title: 'Medications',
        columns: [
          { key: 'name', label: 'Medication' },
          { key: 'dose', label: 'Dose' },
        ],
        rows: [
          { cells: { name: { text: 'Lisinopril', refs: [1] }, dose: { text: '10 mg' } } },
          { cells: { name: { text: 'Metformin', refs: [2] }, dose: { text: '500 mg' } } },
        ],
      },
    ];

    render(
      <AiResponsePanel
        answer="See table for medications."
        references={refs}
        blocks={blocks}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    // Prose answer still renders
    expect(screen.getByText(/See table for medications/)).toBeInTheDocument();
    // Table title + headers + rows render
    expect(screen.getByText('Medications')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Medication' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Dose' })).toBeInTheDocument();
    expect(screen.getByText('Lisinopril')).toBeInTheDocument();
    expect(screen.getByText('Metformin')).toBeInTheDocument();
    expect(screen.getByText('10 mg')).toBeInTheDocument();
    expect(screen.getByText('500 mg')).toBeInTheDocument();
  });

  it('does NOT render table blocks while answer is still streaming', () => {
    const blocks = [
      {
        kind: 'table' as const,
        title: 'Stale',
        columns: [{ key: 'a', label: 'A' }],
        rows: [{ cells: { a: { text: 'should-not-show' } } }],
      },
    ];
    render(
      <AiResponsePanel
        answer="Still typing"
        references={[]}
        blocks={blocks}
        auditLogId={42}
        error={null}
        phase="answering"
        patientUuid={patientUuid}
      />,
    );
    // The streaming-time render only shows prose; blocks land atomically once done.
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
    expect(screen.queryByText('should-not-show')).not.toBeInTheDocument();
  });

  it('localizes the session-expired error code (does not render the raw code)', () => {
    render(
      <AiResponsePanel
        answer=""
        references={[]}
        auditLogId={42}
        error={SESSION_EXPIRED_ERROR_CODE}
        phase="complete"
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
        auditLogId={42}
        error="Connection lost"
        phase="complete"
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

  function renderWithGrounded(
    grounded: boolean | null,
    groundingStatus?: 'checking' | 'verified' | 'unsupported' | 'unchecked' | 'mixed',
    groundingScope?: 'record' | 'source_set',
  ) {
    render(
      <AiResponsePanel
        answer={answer}
        references={[
          {
            index: 1,
            resourceType: 'obs',
            resourceUuid: 'uuid-101',
            date: '2025-01-15',
            grounded,
            groundingStatus,
            groundingScope,
          },
        ]}
        auditLogId={42}
        error={null}
        phase="complete"
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

  it('labels a collective verdict as source-set support rather than individual-record support', () => {
    renderWithGrounded(true, 'verified', 'source_set');
    expect(screen.getByTitle('Supports this claim together with the other cited records.')).toBeInTheDocument();
  });

  it('labels a negative collective verdict as a source-set result', () => {
    renderWithGrounded(false, 'unsupported', 'source_set');
    expect(
      screen.getByTitle('This cited source set may not support the associated claim — verify against the chart.'),
    ).toBeInTheDocument();
  });

  it('does not collapse mixed claim-level support into a verified or unsupported record', () => {
    renderWithGrounded(null, 'mixed', 'source_set');
    expect(screen.getByText('Mixed support')).toBeInTheDocument();
    expect(
      screen.getByTitle('This record supports some associated claims but not others — inspect the evidence details.'),
    ).toBeInTheDocument();
  });

  it('shows no grounding badge when the verdict is null (unverified)', () => {
    renderWithGrounded(null);
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsupported')).not.toBeInTheDocument();
    // plain inline citation, no warning glyph
    expect(screen.getByRole('link', { name: '1' })).toBeInTheDocument();
  });

  it('shows a checking badge while citation grounding is pending', () => {
    renderWithGrounded(null, 'checking');
    expect(screen.getByText('Checking')).toBeInTheDocument();
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsupported')).not.toBeInTheDocument();
  });
});

describe('AiResponsePanel drug-reference citations', () => {
  const references = [{ index: 6, resourceType: 'drug_reference', resourceUuid: 'ibuprofen', date: '' }];

  it('renders a drug-reference citation as non-navigating, visually distinct', () => {
    render(
      <AiResponsePanel
        answer="Reference dosing for ibuprofen [6]."
        references={references}
        auditLogId={42}
        error={null}
        phase="complete"
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
        auditLogId={42}
        error={null}
        phase="complete"
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
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByText('Answer safety check:')).toBeInTheDocument();
    expect(screen.getByText('Dose')).toBeInTheDocument();
    expect(screen.getByText('Interaction')).toBeInTheDocument();
    expect(screen.getByText(/Ibuprofen: stated dose/)).toBeInTheDocument();
    expect(screen.getByText(/exceeds the 1200 mg\/day maximum/)).toBeInTheDocument();
    expect(screen.getByText(/interacts with active order warfarin/)).toBeInTheDocument();
    expect(screen.queryByText(/overdose:Ibuprofen/)).not.toBeInTheDocument();
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
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByText('Answer safety check:')).toBeInTheDocument();
    expect(screen.getByText('Contraindication')).toBeInTheDocument();
    expect(screen.getByText(/recorded allergy to Ibuprofen/)).toBeInTheDocument();
  });

  it('renders no safety section when there are no warnings', () => {
    render(
      <AiResponsePanel
        answer="The blood pressure is 120/80 [1]."
        references={[]}
        safetyWarnings={[]}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    expect(screen.queryByText('Answer safety check:')).not.toBeInTheDocument();
  });

  it('stays silent for a checked status with nothing flagged (the clean, good case)', () => {
    render(
      <AiResponsePanel
        answer="The blood pressure is 120/80 [1]."
        references={[]}
        safetyWarnings={[]}
        safetyStatus="checked"
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    expect(screen.queryByText('Answer safety check:')).not.toBeInTheDocument();
  });

  it('surfaces an unavailable safety status even with no warnings, so it is never mistaken for checked-clean', () => {
    render(
      <AiResponsePanel
        answer="Ibuprofen could be considered [1]."
        references={[]}
        safetyWarnings={[]}
        safetyStatus="unavailable"
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByText('Answer safety check:')).toBeInTheDocument();
    expect(screen.getByText('Safety check unavailable')).toBeInTheDocument();
  });

  it('surfaces a limited safety status even with no warnings', () => {
    render(
      <AiResponsePanel
        answer="Ibuprofen could be considered [1]."
        references={[]}
        safetyWarnings={[]}
        safetyStatus="limited"
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByText('Answer safety check:')).toBeInTheDocument();
    expect(screen.getByText('Limited safety check')).toBeInTheDocument();
  });

  it('explains a limited check with readable package and coverage details', () => {
    render(
      <AiResponsePanel
        answer="Ibuprofen could be considered [1]."
        references={[]}
        safetyWarnings={[]}
        safetyStatus="limited"
        safetyCheck={{
          schema_version: 'drug_safety.v1',
          status: 'limited',
          package: {
            id: 'chartsearchai-research-seed-v1',
            version: '1',
            review_state: 'proposed',
            cross_reactivity: {
              id: 'chartsearchai-cross-reactivity-research-v1',
              version: '2',
              review_state: 'evidence_curated',
            },
          },
          coverage: {
            mapping_complete: false,
            exposure_complete: true,
            execution_complete: true,
          },
          identity_confidence: 'limited',
          issues: [
            'source_not_clinically_approved',
            'cross_reactivity_not_clinically_approved',
            'mapping_incomplete',
            'named_drug_unresolved:frovatriptan',
          ],
        }}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    const summary = screen.getByTestId('safety-check-summary');
    expect(summary).toHaveTextContent('Medication safety details');
    expect(summary).toHaveTextContent('research source is not clinically approved');
    expect(summary).toHaveTextContent('cross-reactivity rules are not clinically approved');
    expect(summary).toHaveTextContent('Not every active medication could be mapped');
    expect(summary).toHaveTextContent(
      'The medication “frovatriptan” could not be matched to the configured reference source.',
    );
    expect(summary).toHaveTextContent('Medication rules');
    expect(summary).toHaveTextContent('chartsearchai-research-seed-v1 (1) - proposed');
    expect(summary).toHaveTextContent('Cross-reactivity rules');
    expect(summary).toHaveTextContent('chartsearchai-cross-reactivity-research-v1 (2) - evidence curated');
  });

  it('explains malformed primary and relationship reference data in plain language', () => {
    render(
      <AiResponsePanel
        answer="Ibuprofen could be considered [1]."
        references={[]}
        safetyWarnings={[]}
        safetyStatus="limited"
        safetyCheck={{
          status: 'limited',
          issues: [
            'source_data_partially_invalid',
            'source_package_identity_incomplete',
            'cross_reactivity_data_invalid',
            'cross_reactivity_package_identity_incomplete',
            'cross_reactivity_source_retired',
          ],
        }}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    const summary = screen.getByTestId('safety-check-summary');
    expect(summary).toHaveTextContent('Some medication-safety reference records were invalid and ignored.');
    expect(summary).toHaveTextContent(
      'The medication-safety rule package is missing required source identity information.',
    );
    expect(summary).toHaveTextContent('The cross-reactivity reference data could not be read safely.');
    expect(summary).toHaveTextContent(
      'The cross-reactivity rule package is missing required source identity information.',
    );
    expect(summary).toHaveTextContent('The configured cross-reactivity source has been retired.');
  });

  it('surfaces both the status tag and the individual warnings together', () => {
    render(
      <AiResponsePanel
        answer="Ibuprofen 600 mg every 6 hours [6]."
        references={[]}
        safetyWarnings={[
          { type: 'overdose', drug: 'Ibuprofen', detail: 'stated dose ~2400 mg/day exceeds the 1200 mg/day maximum' },
        ]}
        safetyStatus="checked"
        safetyCheck={{
          status: 'checked',
          package: {
            id: 'approved-medication-rules',
            version: '3',
            provenance: { source: 'Local clinical formulary', origin: 'configured package' },
            review_state: 'clinically_approved',
            cross_reactivity: {
              id: 'approved-relationships',
              version: '2',
              provenance: { source: 'Medication review board' },
              review_state: 'clinically_approved',
            },
          },
          issues: [],
        }}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByText('Answer safety check:')).toBeInTheDocument();
    expect(screen.getByText('Dose')).toBeInTheDocument();
    expect(screen.queryByText('Safety check unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('Limited safety check')).not.toBeInTheDocument();
    expect(screen.getByTestId('safety-check-summary')).toHaveTextContent(
      'approved-medication-rules (3) - clinically approved',
    );
    expect(screen.getByTestId('safety-check-summary')).toHaveTextContent(
      'approved-relationships (2) - clinically approved',
    );
    expect(screen.getByTestId('safety-check-summary')).toHaveTextContent(
      'Source: Local clinical formulary / configured package',
    );
    expect(screen.getByTestId('safety-check-summary')).toHaveTextContent('Source: Medication review board');
  });

  it('shows a clean checked result and its source packages without requiring a warning', () => {
    render(
      <AiResponsePanel
        answer="No medication issue was found."
        references={[]}
        safetyWarnings={[]}
        safetyStatus="checked"
        safetyCheck={{
          status: 'checked',
          package: {
            id: 'approved-medication-rules',
            version: '3',
            provenance: { source: 'Local clinical formulary' },
            review_state: 'clinically_approved',
            cross_reactivity: {
              id: 'approved-relationships',
              version: '2',
              provenance: { source: 'Medication review board' },
              review_state: 'clinically_approved',
            },
          },
          issues: [],
        }}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByText('Checked')).toBeInTheDocument();
    const summary = screen.getByTestId('safety-check-summary');
    expect(summary).toHaveTextContent('Medication safety details');
    expect(summary).toHaveTextContent('approved-medication-rules (3) - clinically approved');
    expect(summary).toHaveTextContent('approved-relationships (2) - clinically approved');
  });

  it('does not repeat a drug name already present in a warning detail', () => {
    render(
      <AiResponsePanel
        answer="Ibuprofen should be avoided."
        references={[]}
        safetyWarnings={[
          { type: 'contraindication', drug: 'Ibuprofen', detail: 'Ibuprofen is contraindicated for this patient.' },
        ]}
        safetyStatus="checked"
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByText('Ibuprofen is contraindicated for this patient.')).toBeInTheDocument();
    expect(screen.queryByText(/Ibuprofen: Ibuprofen/)).not.toBeInTheDocument();
  });

  it('surfaces an unrecognised warning type with the fallback label (never drops a warning)', () => {
    render(
      <AiResponsePanel
        answer="Some answer."
        references={[]}
        safetyWarnings={[{ type: 'future-unknown-type', drug: 'Ibuprofen', detail: 'a new advisory kind' }]}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    // A future/unknown warning type must still surface — not silently vanish.
    expect(screen.getByText('Answer safety check:')).toBeInTheDocument();
    expect(screen.getByText('Safety')).toBeInTheDocument();
    expect(screen.getByText(/a new advisory kind/)).toBeInTheDocument();
  });

  it('does not mark the safety section as an assertive alert (it sits inside a polite live region)', () => {
    render(
      <AiResponsePanel
        answer="Ibuprofen 600 mg [1]."
        references={[]}
        safetyWarnings={[{ type: 'overdose', drug: 'Ibuprofen', detail: 'exceeds the maximum' }]}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    // A role="alert" here would preempt the answer announcement in the enclosing role="log".
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // ...but the warning still renders.
    expect(screen.getByText('Answer safety check:')).toBeInTheDocument();
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
        auditLogId={42}
        error={null}
        phase="answering"
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
        auditLogId={42}
        error={null}
        phase="complete"
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
        auditLogId={42}
        error={null}
        phase="complete"
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
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith('Findings are notable.');
  });
});

describe('AiResponsePanel model tag', () => {
  it('renders a subtle tag with the resolved model once the answer is complete', () => {
    render(
      <AiResponsePanel
        answer="Done."
        references={[]}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
        resolvedModel="med-agent-team"
      />,
    );

    expect(screen.getByText('med-agent-team')).toBeInTheDocument();
  });

  it('does not render the model tag while the answer is still streaming', () => {
    render(
      <AiResponsePanel
        answer="Partial"
        references={[]}
        auditLogId={42}
        error={null}
        phase="answering"
        patientUuid={patientUuid}
        resolvedModel="med-agent-team"
      />,
    );

    expect(screen.queryByText('med-agent-team')).not.toBeInTheDocument();
  });

  it('omits the model tag when no resolved model is provided', () => {
    render(
      <AiResponsePanel
        answer="Done."
        references={[]}
        auditLogId={42}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );

    expect(screen.queryByText('med-agent-team')).not.toBeInTheDocument();
  });
});

describe('AiResponsePanel staged in-depth status', () => {
  // Two complementary DOM signals: data-turn-phase (the whole turn's coarse lifecycle) and
  // data-indepth-status (the in-depth outcome). The three in-depth renderings otherwise share one
  // testid, so these attributes are what makes the streaming/complete states distinguishable.
  const stagedBase = {
    answer: 'The patient is on metformin [1].',
    references: [{ index: 1, resourceType: 'order', resourceUuid: 'u-1', date: '2025-01-01' }],
    auditLogId: 42,
    error: null,
    patientUuid,
    answerValidation: { status: 'checked' as const, label: 'Checked' },
  };

  it('exposes phase="in-depth" and data-indepth-status="pending" while the in-depth generates', () => {
    const { container } = render(
      <AiResponsePanel {...stagedBase} phase="in-depth" inDepth={{ status: 'pending', answer: 'generating…' }} />,
    );
    expect(container.querySelector('[data-turn-phase="in-depth"]')).toBeInTheDocument();
    expect(container.querySelector('[data-indepth-status="pending"]')).toBeInTheDocument();
    expect(container.querySelector('[data-indepth-status="complete"]')).not.toBeInTheDocument();
  });

  it('exposes phase="complete" and data-indepth-status="complete" once the in-depth finishes', () => {
    const { container } = render(
      <AiResponsePanel {...stagedBase} phase="complete" inDepth={{ status: 'complete', answer: 'Full detail [1].' }} />,
    );
    expect(container.querySelector('[data-turn-phase="complete"]')).toBeInTheDocument();
    expect(container.querySelector('[data-indepth-status="complete"]')).toBeInTheDocument();
    expect(container.querySelector('[data-indepth-status="pending"]')).not.toBeInTheDocument();
  });

  it('shows when a completed in-depth was updated by its checks', () => {
    render(
      <AiResponsePanel
        {...stagedBase}
        phase="complete"
        inDepth={{
          status: 'complete',
          answer: 'Checked detail [1].',
          validation: { status: 'edited' },
        }}
      />,
    );

    expect(screen.getByTestId('section-in-depth')).toHaveTextContent('Updated after check');
  });

  it('keeps a withheld in-depth visible as needs review', () => {
    const { container } = render(
      <AiResponsePanel
        {...stagedBase}
        phase="complete"
        inDepth={{
          status: 'needs_review',
          answer: '',
          error: 'All claims were withheld.',
          validation: {
            status: 'needs_review',
            summary: 'The appointment claim used a date that is not in the patient record.',
          },
          reviewDraft: 'The model draft claimed a future appointment [1].',
          reviewReferences: stagedBase.references,
        }}
      />,
    );

    expect(container.querySelector('[data-indepth-status="needs_review"]')).toBeInTheDocument();
    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText('Why review is needed')).toBeVisible();
    expect(screen.getByText(/appointment claim used a date that is not in the patient record/i)).toBeVisible();
    expect(screen.getByText('All claims were withheld.')).toBeInTheDocument();
    const removedClaimsSummary = screen.getByText('Removed In-Depth claims');
    const removedClaims = removedClaimsSummary.closest('details');
    expect(removedClaims).not.toHaveAttribute('open');
    expect(screen.getByText(/not part of the final clinical response/i)).toBeInTheDocument();
    fireEvent.click(removedClaimsSummary);
    expect(removedClaims).toHaveAttribute('open');
    expect(screen.getByText(/model draft claimed a future appointment/i)).toBeVisible();
    expect(
      screen
        .getAllByRole('link', { name: '1' })
        .some((link) => link.getAttribute('href') === `/openmrs/spa/patient/${patientUuid}/chart/Orders`),
    ).toBe(true);
  });

  it('exposes phase="settled" (composer already unlocked) after validation, before in-depth begins', () => {
    const { container } = render(
      <AiResponsePanel {...stagedBase} phase="settled" inDepth={{ status: 'pending', answer: '' }} />,
    );
    expect(container.querySelector('[data-turn-phase="settled"]')).toBeInTheDocument();
    expect(container.querySelector('[data-indepth-status="pending"]')).toBeInTheDocument();
  });
});

describe('AiResponsePanel answer-validation lifecycle', () => {
  const baseProps = {
    answer: 'The checked answer.',
    references: [],
    auditLogId: 42,
    error: null,
    phase: 'settled' as const,
    patientUuid,
  };

  it.each([
    ['checking', 'Checking answer'],
    ['checked', 'Checked'],
    ['edited', 'Updated after check'],
    ['needs_review', 'Needs review'],
    ['unavailable', 'Check unavailable'],
  ] as const)('renders the %s lifecycle label', (status, label) => {
    render(<AiResponsePanel {...baseProps} answerValidation={{ status, label }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('renders the answer-check summary as visible content instead of a badge tooltip', () => {
    render(
      <AiResponsePanel
        {...baseProps}
        answerValidation={{
          status: 'edited',
          label: 'Updated after check',
          summary: 'One unsupported date was removed from the answer.',
        }}
      />,
    );

    expect(screen.getByTestId('answer-validation-summary')).toHaveTextContent(
      'One unsupported date was removed from the answer.',
    );
    expect(screen.getByTestId('answer-validation-summary')).toHaveTextContent('What changed');
    expect(screen.getByTestId('answer-validation-summary')).toHaveAttribute('role', 'note');
    expect(screen.getByText('Updated after check')).not.toHaveAttribute('title');
  });

  it.each([
    ['checked', 'Check summary'],
    ['needs_review', 'Why review is needed'],
    ['unavailable', 'Check status'],
  ] as const)('labels the %s summary for scanning', (status, heading) => {
    render(
      <AiResponsePanel
        {...baseProps}
        answerValidation={{
          status,
          label: 'Answer check',
          summary: 'Visible review detail.',
        }}
      />,
    );

    expect(screen.getByTestId('answer-validation-summary')).toHaveTextContent(heading);
    expect(screen.getByText('Visible review detail.')).toBeVisible();
  });

  it('discloses the original answer after a validation edit', () => {
    render(
      <AiResponsePanel
        {...baseProps}
        answer="The corrected answer."
        answerValidation={{
          status: 'edited',
          label: 'Updated after check',
          originalAnswer: 'The original answer.',
        }}
      />,
    );

    const disclosure = screen.getByText('Original model answer').closest('details');
    expect(disclosure).not.toBeNull();
    expect(disclosure).toHaveTextContent('The original answer.');
    expect(disclosure).toHaveAttribute('open');
    expect(disclosure).toHaveTextContent(/changed by the answer check/i);
  });

  it('links an original answer only through its own references', () => {
    render(
      <AiResponsePanel
        {...baseProps}
        answer="The corrected answer [2]."
        references={[{ index: 2, resourceType: 'obs', resourceUuid: 'final-ref', date: '2026-02-02' }]}
        answerValidation={{
          status: 'edited',
          label: 'Updated after check',
          originalAnswer: 'The original answer [1].',
          originalReferences: [{ index: 1, resourceType: 'order', resourceUuid: 'draft-ref', date: '2026-01-01' }],
        }}
      />,
    );

    const disclosure = screen.getByText('Original model answer').closest('details');
    const originalLink = disclosure?.querySelector('a');
    expect(originalLink).toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Orders`);
    expect(originalLink).not.toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Vitals`);
  });

  it('shows citation-only edits even when the answer prose is unchanged', () => {
    render(
      <AiResponsePanel
        {...baseProps}
        answer="The documented result is unchanged [1]."
        references={[{ index: 1, resourceType: 'obs', resourceUuid: 'final-ref', date: '2026-02-02' }]}
        answerValidation={{
          status: 'edited',
          label: 'Updated after check',
          originalAnswer: 'The documented result is unchanged [1].',
          originalReferences: [{ index: 1, resourceType: 'order', resourceUuid: 'draft-ref', date: '2026-01-01' }],
        }}
      />,
    );

    const disclosure = screen.getByText('Original model answer').closest('details');
    expect(disclosure).toHaveAttribute('open');
    expect(disclosure).toHaveTextContent(/answer or its supporting citations was changed/i);
    expect(disclosure?.querySelector('a')).toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Orders`);
  });

  it('keeps pre-check table blocks visible only inside the original-answer review panel', () => {
    render(
      <AiResponsePanel
        {...baseProps}
        answer="The documented weight is shown below [1]."
        answerValidation={{
          status: 'needs_review',
          label: 'Needs review',
          originalAnswer: 'The documented weight is shown below [1].',
          originalReferences: [{ index: 1, resourceType: 'obs', resourceUuid: 'draft-ref', date: '2026-01-01' }],
          originalBlocks: [
            {
              kind: 'table',
              title: 'Pre-check weight table',
              columns: [{ key: 'weight', label: 'Weight' }],
              rows: [{ cells: { weight: { text: '6.2 kg', refs: [1] } } }],
            },
          ],
        }}
      />,
    );

    const disclosure = screen.getByText('Original model answer').closest('details');
    expect(disclosure).toHaveAttribute('open');
    expect(disclosure).toHaveTextContent('Pre-check weight table');
    expect(disclosure).toHaveTextContent('6.2 kg');
    expect(screen.getAllByText('Pre-check weight table')).toHaveLength(1);
  });

  it('discloses a changed original answer when the final result still needs review', () => {
    render(
      <AiResponsePanel
        {...baseProps}
        answer="The current flagged answer."
        answerValidation={{
          status: 'needs_review',
          label: 'Needs review',
          originalAnswer: 'The model answer before checking.',
        }}
      />,
    );

    const disclosure = screen.getByText('Original model answer').closest('details');
    expect(disclosure).not.toBeNull();
    expect(disclosure).toHaveAttribute('open');
    expect(disclosure).toHaveTextContent('The model answer before checking.');
    expect(disclosure).toHaveTextContent(/current answer above remains flagged for review/i);
  });
});

describe('AiResponsePanel per-section confidence', () => {
  const baseProps = {
    answer: '**Answer**\nHgb is 14.0 [1].\n\n**In Depth**\n- within range [1]',
    references: [{ index: 1, resourceType: 'obs', resourceUuid: 'uuid-101', date: '2025-11-24' }],
    auditLogId: 42,
    error: null,
    phase: 'complete' as const,
    patientUuid,
  };

  it('heads each section (Answer / In-Depth) with its confidence chip', () => {
    render(
      <AiResponsePanel
        {...baseProps}
        confidence={{
          answer: { level: 'green', note: '' },
          in_depth: { level: 'yellow', note: 'one claim regenerated' },
        }}
      />,
    );
    expect(screen.getByTestId('section-answer')).toHaveTextContent('High confidence');
    expect(screen.getByTestId('section-in-depth')).toHaveTextContent('Medium confidence');
  });

  it('YELLOW (med): shows the message, collapses the review note behind a reveal', () => {
    render(
      <AiResponsePanel
        {...baseProps}
        confidence={{ answer: { level: 'green' }, in_depth: { level: 'yellow', note: 'one claim regenerated' } }}
      />,
    );
    const inDepth = screen.getByTestId('section-in-depth');
    expect(inDepth).toHaveTextContent('within range'); // the message is shown
    const details = inDepth.querySelector('details');
    expect(details).toBeTruthy();
    expect(details).toHaveTextContent(/show review note/i);
    expect(details).toHaveTextContent('one claim regenerated'); // note is inside the collapse
    expect(details).not.toHaveAttribute('open'); // collapsed by default
  });

  it('RED (low): shows both the caveat and the flagged message for manual review', () => {
    render(
      <AiResponsePanel
        {...baseProps}
        confidence={{ answer: { level: 'green' }, in_depth: { level: 'red', note: 'supporting context unresolved' } }}
      />,
    );
    const inDepth = screen.getByTestId('section-in-depth');
    expect(inDepth).toHaveTextContent('Low confidence');
    expect(inDepth).toHaveTextContent('supporting context unresolved'); // the caveat note is shown
    expect(inDepth).toHaveTextContent('within range');
    expect(inDepth.querySelector('details')).toBeNull();
    // the green Answer section is shown with no collapse
    expect(screen.getByTestId('section-answer').querySelector('details')).toBeNull();
  });

  it('renders no sections / chips when the backend sends no confidence (single model / parity)', () => {
    render(<AiResponsePanel {...baseProps} />);
    expect(screen.queryByTestId('section-answer')).not.toBeInTheDocument();
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
  });

  it('does not split into sections while the answer is still streaming', () => {
    render(<AiResponsePanel {...baseProps} phase="answering" confidence={{ answer: { level: 'red', note: 'x' } }} />);
    expect(screen.queryByTestId('section-answer')).not.toBeInTheDocument();
  });
});

/**
 * The backend fields that state a bounded safety answer's limits (issue #26), rendered
 * against the measured response in `src/__fixtures__/clarithromycin-response.ts` — shared with
 * the resolver's own tests, because the ratings asserted here are that resolver's OUTPUT over
 * the fixture's prose and warnings and so depend on dataset-format details only the fixture
 * states.
 */
describe('activeOrderClaims', () => {
  function renderClaims(activeOrderClaims: unknown, misattributedOrderCitations: number[] | null = []) {
    return render(
      <AiResponsePanel
        answer={ANSWER_BY_SUBSTANCE}
        references={FIXTURE_REFERENCES}
        safetyWarnings={SAFETY_WARNINGS}
        misattributedOrderCitations={misattributedOrderCitations}
        unstatedFindingSeverities={UNSTATED}
        conditionRuleCoverage="published"
        interactionPairs={null}
        activeOrderClaims={activeOrderClaims as never}
        error={null}
        phase="complete"
        patientUuid={patientUuid}
      />,
    );
  }

  it('is what separates the two readings of an empty misattributed list', () => {
    // The reason this field is drawn at all. The backend states that
    // `misattributedOrderCitations: []` is two different responses a client cannot tell apart —
    // every active-order claim cited a chart record and none was rejected, or NO claim cited one —
    // and that both have been recorded on one patient and one question. The `[]` is the same in
    // both halves below; only this field distinguishes them, which is why drawing the other four
    // without it left an ambiguity on screen that their own docs warn about.
    const view = renderClaims({ stated: 5, uncited: 0 }, []);
    expect(screen.getByText(/Every statement about her active orders cites a chart record\./)).toBeInTheDocument();
    view.unmount();

    renderClaims({ stated: 5, uncited: 5 }, []);
    expect(screen.getByText(/Statements about her active orders citing no chart record: 5 of 5\./)).toBeInTheDocument();
  });

  it('says why an uncited claim matters', () => {
    renderClaims({ stated: 4, uncited: 3 });
    expect(screen.getByText(/citing no chart record: 3 of 4\./)).toBeInTheDocument();
    expect(screen.getByText(/cannot be checked against the chart at all/)).toBeInTheDocument();
  });

  it('does not claim the cited records were the RIGHT ones', () => {
    // `uncited: 0` says a record was offered for every claim and stops there. Whether the record
    // was the order the sentence named is the neighbouring check's business, and the backend says
    // that check cannot certify it either — so this must not read as "citations verified", and it
    // must not carry the caveat clause that belongs to the uncited case.
    renderClaims({ stated: 5, uncited: 0 });
    expect(screen.getByText(/Every statement about her active orders cites a chart record\./)).toBeInTheDocument();
    expect(screen.queryByText(/verified|confirmed|sound/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cannot be checked against the chart at all/)).not.toBeInTheDocument();
  });

  it('does not affirm that every claim is cited while a citation is rejected', () => {
    // `uncited: 0` is true of the MARKERS — every active-order sentence carries one — and the
    // sibling test above is right that the sentence stops there. But it leads a block headed
    // "What the safety checks covered", and under that heading, beside citations the
    // neighbouring check has struck through, it reads as a statement about the RECORDS. Live on
    // the #26 reproduction: `{stated: 5, uncited: 0}` with `misattributedOrderCitations`
    // `[177, 166, 155]`, three markers rendered `Not the order named` directly above the
    // affirmation. Silence here is the choice `misattributedOrderCitations: []` already makes
    // one field over — no certificate.
    renderClaims({ stated: 5, uncited: 0 }, [177, 166, 155]);
    expect(
      screen.queryByText(/Every statement about her active orders cites a chart record\./),
    ).not.toBeInTheDocument();
  });

  it('still affirms it where nothing was rejected, and where no measurement was stated', () => {
    // The scope of the refusal above, both directions. `[]` is a stated measurement of none, so
    // the affirmation stands — that is the case the sibling test reasoned about. `null` is NO
    // measurement, and must not suppress it either: absent evidence of a rejection is not a
    // rejection, and treating it as one would silence the sentence on every deployment that
    // does not run the check.
    const view = renderClaims({ stated: 5, uncited: 0 }, []);
    expect(screen.getByText(/Every statement about her active orders cites a chart record\./)).toBeInTheDocument();
    view.unmount();

    renderClaims({ stated: 5, uncited: 0 }, null);
    expect(screen.getByText(/Every statement about her active orders cites a chart record\./)).toBeInTheDocument();
  });

  it('renders nothing for a null measurement or an answer that made no such claim', () => {
    for (const value of [null, undefined, { stated: 0, uncited: 0 }]) {
      const view = renderClaims(value);
      expect(screen.queryByText(/active orders/)).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('survives a malformed measurement rather than taking the panel down', () => {
    // Guarded per FIELD, not just on the object: this renders inside a memo with no error boundary
    // above it, and a non-numeric count would reach the interpolation.
    for (const value of [{ stated: '5', uncited: 2 }, { stated: 5 }, { uncited: 2 }, 'nonsense', 5]) {
      const view = renderClaims(value);
      expect(screen.queryByText(/active orders/)).not.toBeInTheDocument();
      view.unmount();
    }
  });
});

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
        error={null}
        phase="complete"
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
      screen.getByText((_content, element) => Boolean(element?.className?.includes?.('markdownAnswer'))).textContent ??
      ''
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

  it('badges every finding of a bare list the model wrote without the module’s phrasing', () => {
    // Shape C, live: "list them one line each, name the order only". The symptom this fixture
    // documents is a RENDERING one — the list came back half-badged, two Majors beside three
    // bare items — so it has to be asserted here and not only as a resolver map.
    renderPanel({ answer: ANSWER_BARE_LIST, misattributedOrderCitations: [] });
    const text = answerText();
    expect(text).toContain('Solu-Medrol 125mg/5ml [350] Major');
    expect(text).toContain('Pulmicort 90mcg [351] Major');
    expect(text).toContain('Prednisone Co 5mg [352] Moderate');
    expect(text).toContain('Dexamethasone Injection vial 8mg [353] Moderate');
    expect(text).toContain('Hydrocortisone Injection vial 100mg [354] Moderate');
  });

  it('badges a repeated marker once, not once per occurrence', () => {
    renderPanel({ answer: ANSWER_BY_ORDER_DISPLAY, misattributedOrderCitations: [] });
    // [350] is cited twice in its own statement; the rating belongs to the finding, not the marker.
    expect(answerText().match(/Major/g) ?? []).toHaveLength(2);
  });

  it('states nothing where two citations of one set would take the same finding', () => {
    // 350 and 351 are two different findings, and only one rated warning exists — so attributing
    // it to both is wrong, and there is no way to tell which citation it belongs to. Refusing is
    // the whole point of the injectivity rule.
    renderPanel({
      answer: 'Clarithromycin interacts with active order Methylprednisolone [350, 351].',
      misattributedOrderCitations: [],
      unstatedFindingSeverities: [350, 351],
      safetyWarnings: [SAFETY_WARNINGS[0], interaction('Methylprednisolone', 'Major', 'Solu-Medrol 125mg/5ml')],
    });
    expect(answerText().match(/Major/g) ?? []).toHaveLength(0);
  });

  it('badges two findings of one group separately even when their ratings match', () => {
    // Two citations from DIFFERENT candidate sets can both resolve, and then two badges are two
    // real findings — collapsing equal ratings would hide the second. (Two citations of the SAME
    // set can never both resolve; the resolver refuses that outright.)
    renderPanel({
      answer: 'Clarithromycin interacts with Methylprednisolone; Ibuprofen interacts with Warfarin [350, 360].',
      references: [...FIXTURE_REFERENCES, safetyFindingRef(360, 'interaction', 'Ibuprofen')],
      misattributedOrderCitations: [],
      unstatedFindingSeverities: [350, 360],
      safetyWarnings: [
        interaction('Methylprednisolone', 'Major', 'Solu-Medrol 125mg/5ml'),
        interaction('Warfarin', 'Major', undefined, 'Ibuprofen'),
      ],
    });
    expect(answerText().match(/Major/g) ?? []).toHaveLength(2);
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
    // The positive control is the sibling test above, which shows all three tags appear with
    // this same fixture when the check does name citations.
    expect(screen.queryByText('Not the order named')).not.toBeInTheDocument();
    // ...and no marker is struck through or made inert, which is the whole of what `[]` licenses.
    expect(screen.getByText('177', { selector: 'a' })).toBeInTheDocument();
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
    // Also the only assertion that pins `limitsSection`'s selector to the component: six
    // sibling tests assert the block is ABSENT, and renaming the class left all six passing
    // while examining nothing until this line existed.
    expect(limitsSection()).not.toBeNull();
    expect(screen.getByText('Interaction pairs shown: 5 of 5.')).toBeInTheDocument();
    // found === reported means that check withheld nothing; it is not a claim of completeness.
    expect(screen.queryByText(/severe pairs can be among them/i)).not.toBeInTheDocument();
  });

  it('reads grammatically when the screen related a single pair', () => {
    // "1 of 1 drug pairs shown" is ungrammatical, and found: 1 is observed live — so the
    // plural noun is detached from the count and agreement never arises.
    renderPanel({ interactionPairs: { found: 1, reported: 1 } });
    expect(screen.getByText('Interaction pairs shown: 1 of 1.')).toBeInTheDocument();
  });

  it('says so where the interaction list was truncated', () => {
    renderPanel({ interactionPairs: { found: 18, reported: 10 } });
    expect(screen.getByText(/Interaction pairs shown: 10 of 18/)).toBeInTheDocument();
    expect(screen.getByText(/severe pairs can be among them/i)).toBeInTheDocument();
  });

  it('states no interaction extent where the response stated no measurement', () => {
    renderPanel({ interactionPairs: null, conditionRuleCoverage: null });
    expect(screen.queryByText(/Interaction pairs shown/)).not.toBeInTheDocument();
    expect(limitsSection()).toBeNull();
  });

  it('states nothing rather than "undefined of 5" where one half of the measurement is missing', () => {
    // Silent wrong output, not a crash: the interpolation would stringify the missing half, and
    // `reported < found` would be false so the bounded warning would not fire to contradict it.
    renderPanel({ interactionPairs: { found: 5 }, conditionRuleCoverage: null });
    expect(screen.queryByText(/Interaction pairs shown/)).not.toBeInTheDocument();
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

  /** Chart-only citations, so no reference-group record can satisfy the coverage gate for free. */
  const CHART_ONLY_REFS = [{ index: 1, resourceType: 'obs', resourceUuid: 'o-1', date: '2026-01-01', group: 'chart' }];

  it('states the coverage note where an interaction screen ran but raised no chip', () => {
    // A pair measurement is a screen on its own, so its extent is worth stating even with no
    // warnings beside it. Chart-only references, because the default fixture cites five
    // reference-group records that would satisfy the gate on their own — with them, deleting
    // this disjunct from `hasSafetyOutput` left the whole suite green.
    renderPanel({
      safetyWarnings: [],
      interactionPairs: { found: 0, reported: 0 },
      references: CHART_ONLY_REFS,
      misattributedOrderCitations: [],
      unstatedFindingSeverities: [],
    });
    expect(screen.getByText(/publishes no condition rules/)).toBeInTheDocument();
  });

  it('states the coverage note where a chip was raised but no extent was measured', () => {
    // The third way a safety screen shows it produced something. Also chart-only references, for
    // the same reason — this disjunct was unpinned too.
    renderPanel({
      safetyWarnings: [SAFETY_WARNINGS[1]],
      interactionPairs: null,
      references: CHART_ONLY_REFS,
      misattributedOrderCitations: [],
      unstatedFindingSeverities: [],
    });
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
    // the findings beside it — which may come from another check. "Interaction pairs shown:
    // 0 of 0." above a Major interaction chip reads as "no interactions found".
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
      expect(screen.queryByText(/Interaction pairs shown/)).not.toBeInTheDocument();
      expect(limitsSection()).toBeNull();
      unmount();
    }
  });

  it('states no limits while the answer is still streaming', () => {
    // The citations are not annotated at all during streaming, so a limits block would describe
    // annotations the reader cannot see — and closing the panel mid-stream leaves the message
    // loading forever — the panel is gone so nothing re-renders it, while the store keeps the
    // message. NOT because a trailing `grounded` lands on it: the unmount effect aborts the
    // stream unconditionally, so it cannot, and the hook's own comment records that correction.
    renderPanel({ phase: 'answering' });
    expect(limitsSection()).toBeNull();
  });

  it('does not call the module’s own computed finding “reference data”', () => {
    // [349] is `contraindication:Clarithromycin` — the module's deterministic finding about THIS
    // patient's allergy record, not a dataset entry. One wording served every reference-group
    // kind when the predicate matched `drug_reference` alone; widening it carried that sentence
    // onto findings computed from the chart.
    renderPanel();
    const marker = screen.getByText('349');
    expect(marker).toHaveAttribute('title', expect.stringMatching(/computed from this patient’s chart/i));
    expect(marker.getAttribute('title')).not.toMatch(/clinical reference data/i);
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

  it('routes a visit and an encounter to the same tab as a diagnosis', () => {
    // `diagnosis` was mapped and its own encounter was not, so a citation of an encounter and a
    // citation of a diagnosis FROM that encounter landed on two different tabs. Measured on the
    // live server: one question returned 113 chart citations, of which encounter x45 and
    // visit x6 fell through to the default tab.
    renderPanel({
      references: [
        { index: 20, resourceType: 'visit', resourceUuid: 'v-1', date: '2024-09-09', group: 'chart' },
        { index: 21, resourceType: 'encounter', resourceUuid: 'e-1', date: '2024-09-09', group: 'chart' },
        { index: 22, resourceType: 'diagnosis', resourceUuid: 'd-1', date: '2024-09-09', group: 'chart' },
      ],
      misattributedOrderCitations: [],
      unstatedFindingSeverities: [],
    });
    const visits = `/openmrs/spa/patient/${patientUuid}/chart/Visits`;
    expect(screen.getByText('[20] visit — 2024-09-09')).toHaveAttribute('href', visits);
    expect(screen.getByText('[21] encounter — 2024-09-09')).toHaveAttribute('href', visits);
    expect(screen.getByText('[22] diagnosis — 2024-09-09')).toHaveAttribute('href', visits);
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

  it('renders rather than blanking when a measurement arrives in the wrong shape', () => {
    // The panel has no error boundary above it, so a throw in a render memo costs the whole
    // answer. A string is iterable and would silently match nothing; an object throws.
    for (const misattributedOrderCitations of ['177', {} as unknown as number[], 5 as unknown as number[]]) {
      const { unmount } = renderPanel({ misattributedOrderCitations });
      expect(answerText()).toContain('Clarithromycin');
      expect(screen.queryByText('Not the order named')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('says conditions were not screened, and why, on "absent"', () => {
    renderPanel();
    expect(screen.getByText(/publishes no condition rules/)).toBeInTheDocument();
  });

  it('distinguishes "absent" from "unloaded" — a mapping test, not a reachable render', () => {
    // `renderPanel`'s defaults supply chips and a pair extent, which is what lets this reach the
    // `unloaded` branch at all. A real `unloaded` payload cannot: it means no dataset was read,
    // so there are no chips, no pair extent and no reference citations, and the coverage gate
    // never opens. This asserts the two verdicts map to different sentences — which is worth
    // asserting, since collapsing them is what the backend forbids — and not that a stock
    // install ever shows the second one. See the reachability note beside COVERAGE_SENTENCE.
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
