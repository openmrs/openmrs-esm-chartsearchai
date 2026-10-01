import React from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { type AiReference } from '../api/chartsearchai';
import { type CitationContext, renderTextWithCitations } from './citation-chip.component';
import styles from './ai-response-panel.scss';

interface MarkdownAnswerProps {
  answer: string;
  references: AiReference[];
  patientUuid: string;
  /** Answer-limit statements; per-finding disclosure tracking is recreated on every render. */
  decorations?: Pick<CitationContext, 'misattributed' | 'severities' | 'qualified'>;
}

/**
 * Render the assistant answer as markdown (the synthesizer emits `**Answer**` / `**In
 * Depth**` headers, bold, lists) WHILE keeping inline `[N]` citation chips. react-markdown
 * builds the element tree; for every text leaf we run `renderTextWithCitations`, so a `[N]`
 * inside any element (paragraph, list item, bold span, heading) still becomes a clickable
 * chip. No hand-rolled markdown parsing — markdown structure is react-markdown's job, and
 * the citation logic is reused unchanged from the existing renderer.
 */
const MarkdownAnswer: React.FC<MarkdownAnswerProps> = ({ answer, references, patientUuid, decorations }) => {
  const { t } = useTranslation();
  const applied: CitationContext = {
    references,
    patientUuid,
    t,
    misattributed: decorations?.misattributed ?? new Set<number>(),
    severities: decorations?.severities ?? new Map<number, string>(),
    qualified: decorations?.qualified ?? new Set<number>(),
    badged: new Set<number>(),
    noted: new Set<number>(),
  };
  // React may render a Markdown element more than once. Reuse its already decorated
  // children so the answer-wide deduplication sets do not erase clinical disclosures.
  const renderedNodes = new WeakMap<object, React.ReactNode>();
  const cite = (children: React.ReactNode, node?: object): React.ReactNode => {
    if (node && renderedNodes.has(node)) return renderedNodes.get(node);
    const rendered = React.Children.map(children, (child) =>
      typeof child === 'string' ? renderTextWithCitations(child, applied) : child,
    );
    if (node) renderedNodes.set(node, rendered);
    return rendered;
  };

  // Map every text-bearing element through the citation renderer; headings collapse to a
  // single subtle heading level (the answer's bold **Answer** / **In Depth** become <strong>).
  const components: Components = {
    p: ({ children, node }) => <p className={styles.answerParagraph}>{cite(children, node)}</p>,
    strong: ({ children, node }) => <strong>{cite(children, node)}</strong>,
    em: ({ children, node }) => <em>{cite(children, node)}</em>,
    li: ({ children, node }) => <li>{cite(children, node)}</li>,
    td: ({ children, node }) => <td>{cite(children, node)}</td>,
    th: ({ children, node }) => <th>{cite(children, node)}</th>,
    del: ({ children, node }) => <del>{cite(children, node)}</del>,
    h1: ({ children, node }) => <h4 className={styles.answerHeading}>{cite(children, node)}</h4>,
    h2: ({ children, node }) => <h4 className={styles.answerHeading}>{cite(children, node)}</h4>,
    h3: ({ children, node }) => <h4 className={styles.answerHeading}>{cite(children, node)}</h4>,
    h4: ({ children, node }) => <h4 className={styles.answerHeading}>{cite(children, node)}</h4>,
    h5: ({ children, node }) => <h4 className={styles.answerHeading}>{cite(children, node)}</h4>,
    h6: ({ children, node }) => <h4 className={styles.answerHeading}>{cite(children, node)}</h4>,
  };

  return (
    <div className={styles.markdownAnswer}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {answer}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownAnswer;
