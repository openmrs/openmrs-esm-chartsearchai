import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { type AiReference } from '../api/chartsearchai';
import { type CitationContext, renderTextWithCitations } from './citation-chip.component';
import { citationGroupPattern } from '../utils/safety-disclosure';
import styles from './ai-response-panel.scss';

interface MarkdownAnswerProps {
  answer: string;
  references: AiReference[];
  patientUuid: string;
  /** Answer-limit statements; per-finding disclosure tracking is recreated on every render. */
  decorations?: Pick<CitationContext, 'misattributed' | 'severities' | 'qualified'>;
}

const REMARK_PLUGINS: React.ComponentProps<typeof ReactMarkdown>['remarkPlugins'] = [
  [remarkGfm, { singleTilde: false }],
  remarkBreaks,
  function disableBlockQuote(this: { data: () => { micromarkExtensions?: Array<Record<string, unknown>> } }) {
    const data = this.data();
    data.micromarkExtensions ??= [];
    data.micromarkExtensions.push({ disable: { null: ['blockQuote'] } });
  } as never,
];

/** The few hast shapes the citation walk reads; other node types pass through untouched. */
interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** Stands in for a decorated text run; the component below renders the decoration it carries. */
const CITED_TEXT = 'chartsearchai-cited-text';

function hastText(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(hastText).join('');
}

/**
 * A citation group the model wrapped across a line (`[4,\n5]`) is one marker group, but
 * remark-breaks would split it at the newline before the per-text-node matcher sees it, so the
 * group's whitespace is collapsed before parsing.
 */
function joinWrappedCitationGroups(text: string): string {
  return text.replace(citationGroupPattern(), (group) => group.replace(/\s+/g, ' '));
}

function hasCitation(text: string): boolean {
  return citationGroupPattern().test(text);
}

/**
 * Render the assistant answer as markdown (the synthesizer emits `**Answer**` / `**In
 * Depth**` headers, bold, lists) WHILE keeping inline `[N]` citation chips. react-markdown
 * builds the tree; a rehype step then walks it once in document order and replaces every text
 * run that carries a `[N]` marker with that run already decorated by `renderTextWithCitations`,
 * so a marker inside any element (paragraph, list item, bold span, heading, table cell) is a
 * clickable chip. The walk, not React's render order, decides which marker carries a finding's
 * once-per-answer rating and caveat: React renders a paragraph's own text before descending into
 * a bold span inside it, which would move the badge to a later repeat of the marker.
 */
const MarkdownAnswer: React.FC<MarkdownAnswerProps> = ({ answer, references, patientUuid, decorations }) => {
  const { t } = useTranslation();
  const misattributed = decorations?.misattributed;
  const severities = decorations?.severities;
  const qualified = decorations?.qualified;
  const rendered = useMemo(() => {
    const decorated = new WeakMap<object, React.ReactNode>();

    // Runs on every parse. React may render the Markdown component more than once (StrictMode
    // does), and each parse is a fresh tree, so the answer-wide deduplication sets start empty
    // on each walk rather than carrying over and erasing the disclosures from the second tree.
    const decorateInDocumentOrder = () => (tree: HastNode) => {
      const applied: CitationContext = {
        references,
        patientUuid,
        t,
        misattributed: misattributed ?? new Set<number>(),
        severities: severities ?? new Map<number, string>(),
        qualified: qualified ?? new Set<number>(),
        badged: new Set<number>(),
        noted: new Set<number>(),
      };
      const placeholder = (text: string): HastNode => {
        const node: HastNode = { type: 'element', tagName: CITED_TEXT, properties: {}, children: [] };
        decorated.set(node, renderTextWithCitations(text, applied));
        return node;
      };
      const visit = (parent: HastNode) => {
        parent.children = (parent.children ?? []).flatMap((child): HastNode[] => {
          if (child.type === 'text') {
            return hasCitation(child.value ?? '') ? [placeholder(child.value ?? '')] : [child];
          }
          if (child.type !== 'element') return [child];
          if (child.tagName === 'a') {
            const label = hastText(child);
            const citation = `[${label}]`;
            // A numeric link is a citation: it goes through the chart citation contract, never
            // to the model-supplied URL.
            if (citationGroupPattern().exec(citation)?.[0] === citation) return [placeholder(citation)];
            // A marker inside link text keeps its chip and disclosures; the model-supplied URL is dropped.
            if (hasCitation(label)) {
              visit(child);
              return child.children ?? [];
            }
          }
          visit(child);
          return [child];
        });
      };
      visit(tree);
    };

    // Headings collapse to a single subtle heading level (the answer's bold **Answer** /
    // **In Depth** become <strong>).
    const components = {
      [CITED_TEXT]: ({ node }: { node?: object }) => <>{node ? decorated.get(node) : null}</>,
      // Model output must not load images, including URLs that disclose patient context.
      img: () => null,
      // A model-supplied link leaves the chart in a new tab and does not send the chart URL along.
      a: ({ children, href }) => (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ),
      p: ({ children }) => <p className={styles.answerParagraph}>{children}</p>,
      h1: ({ children }) => <h4 className={styles.answerHeading}>{children}</h4>,
      h2: ({ children }) => <h4 className={styles.answerHeading}>{children}</h4>,
      h3: ({ children }) => <h4 className={styles.answerHeading}>{children}</h4>,
      h4: ({ children }) => <h4 className={styles.answerHeading}>{children}</h4>,
      h5: ({ children }) => <h4 className={styles.answerHeading}>{children}</h4>,
      h6: ({ children }) => <h4 className={styles.answerHeading}>{children}</h4>,
    } as Components;

    return (
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={[decorateInDocumentOrder as never]}
        components={components}
      >
        {joinWrappedCitationGroups(answer)}
      </ReactMarkdown>
    );
  }, [answer, references, patientUuid, misattributed, severities, qualified, t]);

  return <div className={styles.markdownAnswer}>{rendered}</div>;
};

export default MarkdownAnswer;
