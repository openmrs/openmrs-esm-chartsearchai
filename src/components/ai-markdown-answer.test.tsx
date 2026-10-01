/* eslint-disable testing-library/no-container, testing-library/no-node-access */
import React from 'react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MarkdownAnswer from './ai-markdown-answer.component';

const patientUuid = 'test-patient-uuid';

beforeAll(() => {
  window.spaBase = '/openmrs/spa';
});

afterAll(() => {
  delete (window as unknown as Record<string, unknown>).spaBase;
});

describe('MarkdownAnswer', () => {
  const references = [{ index: 4, resourceType: 'order', resourceUuid: 'uuid-404', date: '2006-01-01' }];

  it('renders **bold** as a <strong> element, not literal asterisks', () => {
    const { container } = render(<MarkdownAnswer answer="**Answer**" references={[]} patientUuid={patientUuid} />);
    expect(container.querySelector('strong')?.textContent).toBe('Answer');
    expect(container).not.toHaveTextContent('**');
  });

  it('renders a markdown bullet list as <li> items', () => {
    const { container } = render(
      <MarkdownAnswer answer={'- lamivudine\n- nevirapine\n- stavudine'} references={[]} patientUuid={patientUuid} />,
    );
    const items = container.querySelectorAll('li');
    expect(Array.from(items).map((li) => li.textContent)).toEqual(['lamivudine', 'nevirapine', 'stavudine']);
  });

  it('keeps an inline [N] citation as a clickable chip inside rendered markdown', () => {
    render(<MarkdownAnswer answer="The regimen is outdated [4]." references={references} patientUuid={patientUuid} />);
    const chip = screen.getByRole('link', { name: '4' });
    expect(chip).toHaveAttribute('href', `/openmrs/spa/patient/${patientUuid}/chart/Orders`);
  });

  it('keeps a [N] citation that sits inside a bold span', () => {
    render(<MarkdownAnswer answer="**Key finding: outdated [4]**" references={references} patientUuid={patientUuid} />);
    const chip = screen.getByRole('link', { name: '4' });
    expect(chip.closest('strong')).not.toBeNull();
  });
  it.each([
    ['table body', '| Record |\n| --- |\n| Order [4] |'],
    ['table header', '| Record [4] |\n| --- |\n| Order |'],
    ['level-five heading', '##### Record [4]'],
    ['level-six heading', '###### Record [4]'],
    ['strikethrough', '~~Order [4]~~'],
  ])('keeps citations navigable in a %s', (_kind, answer) => {
    render(<MarkdownAnswer answer={answer} references={references} patientUuid={patientUuid} />);
    expect(screen.getByRole('link', { name: '4' })).toHaveAttribute(
      'href',
      `/openmrs/spa/patient/${patientUuid}/chart/Orders`,
    );
  });

  it('retains upstream severity and significance disclosures once across markdown elements and rerenders', () => {
    const props = {
      answer: '**Finding [4]**\n\nRepeated finding [4].',
      references,
      patientUuid,
      decorations: { misattributed: new Set<number>(), severities: new Map([[4, 'Major']]), qualified: new Set([4]) },
    };
    const { rerender } = render(<MarkdownAnswer {...props} />);
    expect(screen.getAllByText('Major')).toHaveLength(1);
    expect(screen.getAllByText('Clinical significance unknown')).toHaveLength(1);
    rerender(<MarkdownAnswer {...props} answer={'# Finding [4]\n\nRepeated [4].'} />);
    expect(screen.getAllByText('Major')).toHaveLength(1);
    expect(screen.getAllByText('Clinical significance unknown')).toHaveLength(1);
  });
  it('keeps clinical disclosures visible under React StrictMode', () => {
    render(
      <React.StrictMode>
        <MarkdownAnswer
          answer="**Finding [4]**"
          references={references}
          patientUuid={patientUuid}
          decorations={{ misattributed: new Set(), severities: new Map([[4, 'Major']]), qualified: new Set([4]) }}
        />
      </React.StrictMode>,
    );
    expect(screen.getByText('Major')).toBeInTheDocument();
    expect(screen.getByText('Clinical significance unknown')).toBeInTheDocument();
  });
});
