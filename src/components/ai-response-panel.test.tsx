import React from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AiResponsePanel from './ai-response-panel.component';
import { highlightReference } from '../utils/highlight-reference';
import { SESSION_EXPIRED_ERROR_CODE } from '../api/chartsearchai';

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
    { index: 2, resourceType: 'drug_order', resourceUuid: 'uuid-202', date: '2025-02-20' },
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
    const obsLink = screen.getByText('[1] Observation — 15-Jan-2025');
    expect(obsLink.tagName).toBe('A');
    expect(obsLink).toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Test%20Results`);

    const orderLink = screen.getByText('[2] Medication — 20-Feb-2025');
    expect(orderLink.tagName).toBe('A');
    expect(orderLink).toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Medications`);

    const allergyLink = screen.getByText('[3] Allergy — 10-Mar-2025');
    expect(allergyLink.tagName).toBe('A');
    expect(allergyLink).toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Allergies`);

    const conditionLink = screen.getByText('[4] Condition — 05-Apr-2025');
    expect(conditionLink.tagName).toBe('A');
    expect(conditionLink).toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Conditions`);

    const diagnosisLink = screen.getByText('[5] Diagnosis — 12-May-2025');
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

    fireEvent.click(screen.getByText('[1] Observation — 15-Jan-2025'));

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
      `/openmrs/spa/patient/${patientUuid}/chart/Test%20Results`,
      `/openmrs/spa/patient/${patientUuid}/chart/Medications`,
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
      { index: 2, resourceType: 'drug_order', resourceUuid: 'uuid-202', date: '2025-02-20' },
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
    expect(link1).toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Test%20Results`);

    const link2 = screen.getByRole('link', { name: '2' });
    expect(link2).toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Medications`);
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

    // An unrecognised type keeps its raw token on purpose — inventing a friendly name for
    // semantics we don't know would be worse — but its date is still localized.
    const tag = screen.getByText('[1] UnknownType — 01-Jun-2025');
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
    // The accessible name states the problem in words. It must NOT rely on the glyph: U+26A0 is
    // commonly silent at default screen-reader verbosity, which would make an unsupported citation
    // announce identically to a verified one.
    const link = screen.getByRole('link', { name: /unsupported/i });
    expect(link).toBeInTheDocument();
    // ...and the glyph is still there visually, marked decorative so it isn't announced twice.
    expect(link.textContent).toMatch(/1\s*⚠/);
    expect(link.querySelector('[aria-hidden="true"]')?.textContent).toContain('⚠');
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

describe('AiResponsePanel reference-group classification', () => {
  // The backend classifies each citation as `chart` (a record from this patient's chart) or
  // `reference` (module-supplied knowledge-base prose). Trusting `group` is what lets a NEW kind of
  // injected record be handled without changing this component — the resourceType allow-list here
  // cannot know about one. Without it such a citation falls through
  // RESOURCE_TYPE_TO_CHART_PAGE to 'Patient Summary' and renders as a navigable chart link,
  // presenting knowledge-base text as the patient's own record.
  it('treats an unknown resourceType as reference material when group says so', () => {
    render(
      <AiResponsePanel
        answer="Per the clinical guideline [9]."
        references={[
          { index: 9, resourceType: 'guideline', resourceUuid: 'kb-9', date: '', group: 'reference' as const },
        ]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.queryByRole('link', { name: '9' })).not.toBeInTheDocument();
    expect(screen.getByText('Reference')).toBeInTheDocument();
  });

  // The chip label must not claim a kind of source the citation isn't. `group: 'reference'` is
  // deliberately broader than drug references, so labelling every reference citation "Drug
  // reference" would put a false provenance in front of a clinician.
  it('does not label a non-drug reference citation as a drug reference', () => {
    render(
      <AiResponsePanel
        answer="Per the clinical guideline [9]."
        references={[
          { index: 9, resourceType: 'guideline', resourceUuid: 'kb-9', date: '', group: 'reference' as const },
        ]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.queryByText('[9] Drug reference')).not.toBeInTheDocument();
    expect(screen.getByText('[9] Reference')).toBeInTheDocument();
  });

  it('still links a chart record whose group is chart', () => {
    render(
      <AiResponsePanel
        answer="Her potassium was low [4]."
        references={[
          { index: 4, resourceType: 'obs', resourceUuid: 'uuid-4', date: '2025-05-12', group: 'chart' as const },
        ]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByRole('link', { name: '4' })).toBeInTheDocument();
  });

  // Every error the module authors itself must reach the user as translated wording, never as the
  // raw code. A code leaking to the panel would show a clinician "chartsearchai:stream-incomplete".
  it.each([
    ['chartsearchai:streaming-unsupported', /cannot stream responses/i],
    ['chartsearchai:response-parse-failed', /could not be read/i],
    ['chartsearchai:stream-incomplete', /ended before it was complete/i],
    ['chartsearchai:unexpected-response', /unexpected response/i],
    ['chartsearchai:unknown-error', /something went wrong/i],
    ['chartsearchai:session-expired', /session has expired/i],
  ])('localizes the %s error code', (code, expected) => {
    render(
      <AiResponsePanel
        answer=""
        references={[]}
        questionId="q"
        error={code}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByRole('alert').textContent).toMatch(expected);
    expect(screen.queryByText(code)).not.toBeInTheDocument();
  });

  // A server or browser message is not ours to translate — its detail is the useful part.
  it('passes a non-code error through untouched', () => {
    render(
      <AiResponsePanel
        answer=""
        references={[]}
        questionId="q"
        error="Server error: 503 Service Unavailable"
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByRole('alert').textContent).toMatch(/503 Service Unavailable/);
  });

  // Accessibility: these were a div of spans, so a screen reader got an unannounced run of links
  // with no count and no indication of what they belonged to. Real list semantics plus an
  // accessible name are what make the section navigable and countable.
  it('exposes the references as a list named by its own label', () => {
    render(
      <AiResponsePanel
        answer="Two sources [1] and [2]."
        references={[
          { index: 1, resourceType: 'obs', resourceUuid: 'u1', date: '2025-01-15', group: 'chart' as const },
          { index: 2, resourceType: 'allergy', resourceUuid: 'u2', date: null, group: 'chart' as const },
        ]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    const list = screen.getByRole('list', { name: /references/i });
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);
    expect(list.tagName).toBe('UL');
  });

  it('exposes the safety checks as a list named by its own label', () => {
    render(
      <AiResponsePanel
        answer="Careful [1]."
        references={[]}
        safetyWarnings={[{ type: 'contraindication', drug: 'Aspirin', detail: 'Recorded allergy to aspirin.' }]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByRole('list', { name: /safety checks/i })).toBeInTheDocument();
  });

  // Accessibility: the chart-vs-reference distinction was conveyed only by hue, and Carbon's
  // blue-60 and purple-60 are luminance-matched (1.00:1 with each other) — so in greyscale or with
  // a colour-vision deficiency an inert knowledge-base marker was indistinguishable from a
  // navigable chart citation, and to a screen reader both were the bare number.
  it('states reference provenance in text, not by colour alone', () => {
    const { container } = render(
      <AiResponsePanel
        answer="Per the reference [231]."
        references={[
          { index: 231, resourceType: 'drug_reference', resourceUuid: '1191', date: null, group: 'reference' as const },
        ]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    const inline = Array.from(container.querySelectorAll('[class*="inlineCitation"]')).find((el) =>
      /^231/.test(el.textContent ?? ''),
    );
    expect(inline?.textContent).toMatch(/not this patient’s record/);
    // The wording must be in a visually-hidden node, so it reaches assistive tech without being
    // painted into the middle of the sentence.
    expect(inline?.querySelector('[class*="visuallyHidden"]')?.textContent).toMatch(/reference data/);
  });

  // The chip and the inline citation must agree. The inline marker is what a clinician reads in the
  // prose, so an off-topic reference flagged "Unsupported" in the chip list cannot appear as a
  // neutral number mid-sentence — that is the copy they would act on.
  it('marks an unsupported reference citation inline, not just in the chip list', () => {
    render(
      <AiResponsePanel
        answer="Per the reference [231]."
        references={[
          {
            index: 231,
            resourceType: 'drug_reference',
            resourceUuid: '1191',
            date: null,
            group: 'reference' as const,
            grounded: false,
          },
        ]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    // Both the chip badge and the inline marker carry this wording now, so pick out the inline one:
    // it is the marker embedded in the prose, distinguished by the inlineCitation class.
    const inline = screen
      .getAllByTitle(/may not support this statement/)
      .find((el) => el.className.includes('inlineCitation'));
    expect(inline).toBeDefined();
    expect(inline?.textContent).toMatch(/231\s*⚠/);
    // ...while KEEPING the reference treatment. Both facts hold, and inlineCitationReference is the
    // only rule overriding inlineCitation's `cursor: pointer` — dropping it would make an inert span
    // look navigable.
    expect(inline?.className).toContain('inlineCitationReference');
    expect(inline?.className).toContain('inlineCitationUngrounded');
  });

  // Demote-only means grounding nulls a TRUE verdict for a reference citation but lets a FALSE
  // through, specifically to flag one that is off-topic. Showing the neutral "Reference" tag over
  // that would hide the only verdict the backend actually computed for it.
  it('surfaces an unsupported verdict on a reference citation instead of the neutral tag', () => {
    render(
      <AiResponsePanel
        answer="Per the reference [231]."
        references={[
          {
            index: 231,
            resourceType: 'drug_reference',
            resourceUuid: '1191',
            date: null,
            group: 'reference' as const,
            grounded: false,
          },
        ]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByText('Unsupported')).toBeInTheDocument();
    expect(screen.queryByText('Reference')).not.toBeInTheDocument();
  });

  // Verified against openmrs-esm-patient-chart's registered dashboard paths and against a live
  // backend response: the wire sends `obs`, `test_order` and `drug_order` (never a plain `order`),
  // and only 'Test Results' / 'Medications' / 'Visits' / 'Encounters' etc. are real dashboards. An
  // unregistered path makes chart-review redirect to Patient Summary, so the citation lands on the
  // wrong tab and highlightReference then scans the wrong DOM until it times out.
  it.each([
    ['obs', 'Test Results'],
    ['test_order', 'Test Results'],
    ['drug_order', 'Medications'],
    ['allergy', 'Allergies'],
    ['condition', 'Conditions'],
    ['program', 'Programs'],
    ['medication_dispense', 'Medications'],
    ['visit', 'Visits'],
    ['encounter', 'Encounters'],
    ['diagnosis', 'Visits'],
    // Unmapped on purpose — no dashboard exists for these, so Patient Summary is correct.
    ['referral_order', 'Patient Summary'],
    ['patient', 'Patient Summary'],
  ])('links a %s citation to the %s dashboard', (resourceType, dashboard) => {
    render(
      <AiResponsePanel
        answer={`See the record [7].`}
        references={[{ index: 7, resourceType, resourceUuid: 'u7', date: '2025-05-12', group: 'chart' as const }]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getByRole('link', { name: '7' })).toHaveAttribute(
      'href',
      `/openmrs/spa/patient/${patientUuid}/chart/${encodeURIComponent(dashboard)}`,
    );
  });

  // `grounded` ABSENT is not the same shape as `grounded: null`, and it is the normal state for
  // every citation while the answer is still streaming (the early references event carries no
  // verdicts). It must render as unverified — showing "Verified" before anything was verified is
  // the one failure this tri-state exists to prevent.
  it('shows no grounding badge when the verdict key is absent entirely', () => {
    render(
      <AiResponsePanel
        answer="Her potassium was low [4]."
        references={[{ index: 4, resourceType: 'obs', resourceUuid: 'uuid-4', date: '2025-05-12' }]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsupported')).not.toBeInTheDocument();
  });

  // The backend orders the array chart-group-first and both READMEs say a client gets the grouping
  // by rendering in order. The component has no sorting of its own, so this is a regression guard
  // against someone ADDING any — it cannot verify the backend's ordering, which is pinned there.
  it('renders the reference chips in the order the backend sent them', () => {
    render(
      <AiResponsePanel
        answer="Severe aspirin allergy [230], per the reference [231]."
        references={[
          { index: 230, resourceType: 'allergy', resourceUuid: 'u230', date: null, group: 'chart' as const },
          { index: 231, resourceType: 'drug_reference', resourceUuid: '1191', date: null, group: 'reference' as const },
        ]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    const chips = screen.getAllByText(/^\[23[01]\]/);
    expect(chips.map((c) => c.textContent)).toEqual(['[230] Allergy', '[231] Drug reference']);
  });

  // The backend sends `date: null` for records whose only date is administrative and deliberately
  // unrendered — allergies, notably, which are exactly what a drug-safety answer cites. The chip
  // must not surface that as the literal text "null".
  it('omits the date from a chart-record chip when the record is undated', () => {
    render(
      <AiResponsePanel
        answer="She has a severe aspirin allergy [230]."
        references={[
          { index: 230, resourceType: 'allergy', resourceUuid: 'u230', date: null, group: 'chart' as const },
        ]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
    expect(screen.getByText('[230] Allergy')).toBeInTheDocument();
  });

  // Backward compatibility: the two repos release independently, so an ESM running against a
  // pre-`group` backend must still classify drug references from resourceType alone.
  it('falls back to resourceType when the backend sends no group at all', () => {
    render(
      <AiResponsePanel
        answer="Reference dosing for ibuprofen [6]."
        references={[{ index: 6, resourceType: 'drug_reference', resourceUuid: 'ibuprofen', date: '' }]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.queryByRole('link', { name: '6' })).not.toBeInTheDocument();
    expect(screen.getByText('Reference')).toBeInTheDocument();
  });
});

describe('AiResponsePanel drug-reference citations', () => {
  const references = [
    { index: 6, resourceType: 'drug_reference', resourceUuid: 'ibuprofen', date: '', group: 'reference' as const },
  ];

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
      `/openmrs/spa/patient/${patientUuid}/chart/Test%20Results`,
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

  it('renders every warning when several share the same type and drug (the common backend shape)', () => {
    // Verbatim from a live backend response (2026-07-10): the rule + ATC-class + curated-group
    // layers routinely emit several warnings of the SAME type for the SAME drug. Every one must
    // render — the list keys are index-suffixed, so duplicates can never collide or drop.
    render(
      <AiResponsePanel
        answer="No. The patient has a documented allergy to Ibuprofen [1]."
        references={[]}
        safetyWarnings={[
          {
            type: 'contraindication',
            drug: 'Ibuprofen',
            detail: 'contraindicated by active allergy: documented ibuprofen allergy',
          },
          {
            type: 'contraindication',
            drug: 'Ibuprofen',
            detail: 'contraindicated by active condition: active gastrointestinal bleeding',
          },
          {
            type: 'contraindication',
            drug: 'Ibuprofen',
            detail: 'contraindicated by active condition: active peptic ulcer disease',
          },
          { type: 'contraindication', drug: 'Ibuprofen', detail: 'the patient has a recorded allergy to Ibuprofen' },
          {
            type: 'interaction',
            drug: 'Ibuprofen',
            detail: 'interacts with active order warfarin — increased risk of GI bleeding',
          },
          {
            type: 'interaction',
            drug: 'Ibuprofen',
            detail:
              'same cross-reactivity group (NSAID) as active order N02BA01 — possible additive or duplicate-class therapy',
          },
        ]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    expect(screen.getAllByText('Contraindication')).toHaveLength(4);
    expect(screen.getAllByText('Interaction')).toHaveLength(2);
    expect(screen.getByText(/cross-reactivity group \(NSAID\)/)).toBeInTheDocument();
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
    { index: 2, resourceType: 'drug_order', resourceUuid: 'uuid-202', date: '2025-02-20' },
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

describe('AiResponsePanel citation rendering invariants (whole state space)', () => {
  const GROUPS: Array<'chart' | 'reference' | undefined> = ['chart', 'reference', undefined];
  const TYPES = ['drug_reference', 'obs', 'guideline'];
  const VERDICTS: Array<boolean | null | undefined> = [true, false, null, undefined];

  // Re-derives the combined behaviour of six separately-added pieces (group classification, the
  // narrow drug-reference label check, the dashboard map, the label ternary, the tag choice, and
  // the inline branch). Each was reviewed when added; none was ever checked against the others
  // across the full input space. These are the properties that must hold jointly.
  const cases: Array<[string, 'chart' | 'reference' | undefined, string, boolean | null | undefined]> = [];
  for (const group of GROUPS) {
    for (const resourceType of TYPES) {
      for (const grounded of VERDICTS) {
        cases.push([`group=${group} type=${resourceType} grounded=${String(grounded)}`, group, resourceType, grounded]);
      }
    }
  }

  it.each(cases)('%s', (_label, group, resourceType, grounded) => {
    const ref = { index: 7, resourceType, resourceUuid: 'u7', date: null, group, grounded };
    const { container } = render(
      <AiResponsePanel
        answer="Statement [7]."
        references={[ref]}
        questionId="q"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    const isReferenceMaterial = group === 'reference' || resourceType === 'drug_reference';
    const link = screen.queryByRole('link', { name: /^7/ });

    // INVARIANT 1: reference material must never be navigable. Navigating means a chart URL plus
    // highlightReference(kbId), i.e. knowledge-base prose presented as the patient's record.
    if (isReferenceMaterial) {
      expect(link).toBeNull();
    } else {
      expect(link).not.toBeNull();
    }

    // INVARIANT 2: "Verified" appears only for an explicitly true verdict.
    if (grounded !== true) {
      expect(screen.queryByText('Verified')).toBeNull();
    }

    // INVARIANT 3: a false verdict is never hidden — it must surface in the chip list...
    if (grounded === false) {
      expect(screen.queryByText('Unsupported')).not.toBeNull();
      expect(screen.queryByText('Reference')).toBeNull();
      // ...and the inline marker must carry the warning too, so prose and chip agree.
      const inline = Array.from(container.querySelectorAll('[class*="inlineCitation"]')).find((el) =>
        /^7/.test(el.textContent ?? ''),
      );
      expect(inline?.textContent).toMatch(/7\s*⚠/);
      // An unsupported verdict must not cost reference material its provenance styling.
      if (isReferenceMaterial) {
        expect(inline?.className).toContain('inlineCitationReference');
      }
    }

    // INVARIANT 4: the label must not claim "Drug reference" for something that isn't one.
    if (resourceType !== 'drug_reference') {
      expect(screen.queryByText(/Drug reference/)).toBeNull();
    }

    // INVARIANT 5: a null date is never rendered as the literal "null".
    expect(container.textContent).not.toMatch(/null/);
  });
});
