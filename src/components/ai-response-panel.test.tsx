import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AiResponsePanel from './ai-response-panel.component';

const patientUuid = 'test-patient-uuid';

beforeAll(() => {
  window.spaBase = '/openmrs/spa';
});

afterAll(() => {
  delete (window as unknown as Record<string, unknown>).spaBase;
});

describe('AiResponsePanel reference links', () => {
  const references = [
    { index: 1, resourceType: 'obs', resourceId: 101, date: '2025-01-15' },
    { index: 2, resourceType: 'order', resourceId: 202, date: '2025-02-20' },
    { index: 3, resourceType: 'allergy', resourceId: 303, date: '2025-03-10' },
    { index: 4, resourceType: 'condition', resourceId: 404, date: '2025-04-05' },
    { index: 5, resourceType: 'diagnosis', resourceId: 505, date: '2025-05-12' },
  ];

  const answer =
    'The patient has lab results [1] and an active order [2]. They have an allergy [3], a condition [4], and a diagnosis [5].';

  it('renders reference tags as clickable <a> elements with correct href', () => {
    render(
      <AiResponsePanel
        answer={answer}
        disclaimer=""
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

  it('renders inline citations as clickable <a> elements', () => {
    render(
      <AiResponsePanel
        answer={answer}
        disclaimer=""
        references={references}
        questionId="test-question-id"
        error={null}
        isLoading={false}
        patientUuid={patientUuid}
      />,
    );

    // Inline citations [1] through [5] should be links
    const allLinks = screen.getAllByRole('link');
    const inlineCitations = allLinks.filter((link) => /^\[\d+\]$/.test(link.textContent ?? ''));
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

  it('renders unknown resource types as links to Patient Summary', () => {
    const unknownRef = [{ index: 1, resourceType: 'UnknownType', resourceId: 999, date: '2025-06-01' }];

    render(
      <AiResponsePanel
        answer="Some answer [1]."
        disclaimer=""
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
        disclaimer=""
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

  it('shows partial answer with error banner when stream fails mid-response', () => {
    render(
      <AiResponsePanel
        answer="The patient has been taking"
        disclaimer=""
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
