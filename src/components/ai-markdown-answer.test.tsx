/* eslint-disable testing-library/no-container, testing-library/no-node-access */
import React from 'react';
import * as reactI18next from 'react-i18next';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
    ['inline code', 'The finding `interaction [4]` applies.'],
    ['ordinary link text', 'See [the order [4]](https://example.test/x)'],
  ])('keeps citations navigable in a %s', (_kind, answer) => {
    render(<MarkdownAnswer answer={answer} references={references} patientUuid={patientUuid} />);
    expect(screen.getByRole('link', { name: '4' })).toHaveAttribute(
      'href',
      `/openmrs/spa/patient/${patientUuid}/chart/Orders`,
    );
  });

  it('retains citation disclosures inside inline code and ordinary link text', () => {
    render(
      <MarkdownAnswer
        answer="See `interaction [4]` and [the order [4]](https://example.test/x)."
        references={references}
        patientUuid={patientUuid}
        decorations={{ misattributed: new Set([4]), severities: new Map([[4, 'Major']]), qualified: new Set([4]) }}
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getAllByTitle(/module reports that this citation/)).toHaveLength(2);
    expect(screen.getAllByText('Major')).toHaveLength(1);
    expect(screen.getAllByText('Clinical significance unknown')).toHaveLength(1);
  });

  it('keeps single-tilde dose ranges and leading greater-than thresholds literal', () => {
    const { container } = render(
      <MarkdownAnswer
        answer={'Give 5~10 mg now and 20~30 mg later\n\n>1,000,000 copies/mL'}
        references={[]}
        patientUuid={patientUuid}
      />,
    );
    expect(container.querySelector('del')).toBeNull();
    expect(container.querySelector('blockquote')).toBeNull();
    expect(container).toHaveTextContent('Give 5~10 mg now and 20~30 mg later');
    expect(container).toHaveTextContent('>1,000,000 copies/mL');
  });

  it('preserves rendered DOM nodes and focus across rerenders when inputs are unchanged', () => {
    const stableT = ((_key: string, fallback: string) => fallback) as unknown as ReturnType<
      typeof reactI18next.useTranslation
    >['t'];
    const spy = vi.spyOn(reactI18next, 'useTranslation').mockReturnValue({
      t: stableT,
      i18n: { language: 'en' },
    } as unknown as ReturnType<typeof reactI18next.useTranslation>);
    try {
      const misattributed = new Set<number>();
      const severities = new Map([[4, 'Major']]);
      const qualified = new Set([4]);
      const { rerender } = render(
        <MarkdownAnswer
          answer="The regimen is outdated [4]."
          references={references}
          patientUuid={patientUuid}
          decorations={{ misattributed, severities, qualified }}
        />,
      );
      const chip = screen.getByRole('link', { name: '4' });
      chip.focus();
      expect(chip).toHaveFocus();

      rerender(
        <MarkdownAnswer
          answer="The regimen is outdated [4]."
          references={references}
          patientUuid={patientUuid}
          decorations={{ misattributed, severities, qualified }}
        />,
      );
      expect(screen.getByRole('link', { name: '4' })).toBe(chip);
      expect(chip).toHaveFocus();
    } finally {
      spy.mockRestore();
    }
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
  it('omits model-supplied images, including image links containing patient details', () => {
    render(
      <MarkdownAnswer
        answer="![patient chart](https://example.test/image?patient=test-patient)"
        references={[]}
        patientUuid={patientUuid}
      />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('resolves numeric markdown links through the chart citation contract', () => {
    render(
      <MarkdownAnswer
        answer="Order [4](https://example.test/wrong-source)."
        references={references}
        patientUuid={patientUuid}
      />,
    );
    expect(screen.getByRole('link', { name: '4' })).toHaveAttribute(
      'href',
      `/openmrs/spa/patient/${patientUuid}/chart/Orders`,
    );
  });

  it('does not offer an external link for an unresolved numeric markdown citation', () => {
    render(
      <MarkdownAnswer
        answer="Unknown [99](https://example.test/wrong-source)."
        references={references}
        patientUuid={patientUuid}
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(/Unknown.*99/)).toBeInTheDocument();
  });
  it('keeps a formatted numeric link inside the citation safeguards', () => {
    render(
      <MarkdownAnswer
        answer="Order [**4**](https://example.test/wrong-source)."
        references={references}
        patientUuid={patientUuid}
        decorations={{ misattributed: new Set([4]), severities: new Map([[4, 'Major']]), qualified: new Set([4]) }}
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByTitle(/module reports that this citation/)).toHaveTextContent('4');
    expect(screen.getByText('Major')).toBeInTheDocument();
    expect(screen.getByText('Clinical significance unknown')).toBeInTheDocument();
  });

  it('preserves ordinary non-citation markdown links', () => {
    render(
      <MarkdownAnswer
        answer="[Source website](https://example.test/source)"
        references={references}
        patientUuid={patientUuid}
      />,
    );
    expect(screen.getByRole('link', { name: 'Source website' })).toHaveAttribute('href', 'https://example.test/source');
  });
});
