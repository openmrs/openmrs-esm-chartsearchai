import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { type AiReference } from '../api/chartsearchai';
import { type CitationDecorations, renderTextWithCitations } from './citation-chip.component';
import styles from './ai-response-panel.scss';

interface MarkdownAnswerProps {
  answer: string;
  references: AiReference[];
  patientUuid: string;
  /** Answer-limit statements to apply to the citations; `badged` is recreated on every render. */
  decorations?: Omit<CitationDecorations, 'badged'>;
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
  const applied: CitationDecorations | undefined = decorations
    ? { ...decorations, badged: new Set<number>() }
    : undefined;
  const cite = (children: React.ReactNode): React.ReactNode =>
    React.Children.map(children, (child) =>
      typeof child === 'string' ? renderTextWithCitations(child, references, patientUuid, 'cit', applied) : child,
    );

  // Map every text-bearing element through the citation renderer; headings collapse to a
  // single subtle heading level (the answer's bold **Answer** / **In Depth** become <strong>).
  const components: Components = {
    p: ({ children }) => <p className={styles.answerParagraph}>{cite(children)}</p>,
    strong: ({ children }) => <strong>{cite(children)}</strong>,
    em: ({ children }) => <em>{cite(children)}</em>,
    li: ({ children }) => <li>{cite(children)}</li>,
    h1: ({ children }) => <h4 className={styles.answerHeading}>{cite(children)}</h4>,
    h2: ({ children }) => <h4 className={styles.answerHeading}>{cite(children)}</h4>,
    h3: ({ children }) => <h4 className={styles.answerHeading}>{cite(children)}</h4>,
    h4: ({ children }) => <h4 className={styles.answerHeading}>{cite(children)}</h4>,
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
