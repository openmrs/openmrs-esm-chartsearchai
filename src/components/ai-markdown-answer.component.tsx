import React, { useId, useMemo } from 'react';
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

/** Every heading level as one subtle heading; the id stays, which the footnote list's label needs. */
const heading = ({ children, id }: { children?: React.ReactNode; id?: string }) => (
  <h4 id={id} className={styles.answerHeading}>
    {children}
  </h4>
);

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
  // Footnote ids are document-wide, and every answer numbers its notes from one, so each answer
  // prefixes its own: without that a later answer's [^1] would jump to the first answer's note.
  const footnotePrefix = `answer-${useId().replace(/:/g, '')}-`;
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
          // Raw HTML is printed as text, so a marker inside an HTML block is decorated like any other.
          if (child.type === 'text' || child.type === 'raw') {
            return hasCitation(child.value ?? '') ? [placeholder(child.value ?? '')] : [child];
          }
          if (child.type !== 'element') return [child];
          // A footnote reference is numbered by the parser, not cited by the model: its number names
          // no chart record.
          if (child.tagName === 'a' && child.properties?.dataFootnoteRef) return [child];
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

    const source = joinWrappedCitationGroups(answer);

    // Headings collapse to a single subtle heading level (the answer's bold **Answer** /
    // **In Depth** become <strong>).
    const components = {
      [CITED_TEXT]: ({ node }: { node?: object }) => <>{node ? decorated.get(node) : null}</>,
      // Model output must not load images, including URLs that disclose patient context.
      img: () => null,
      em: ({ children, node }) => {
        const start = node?.position?.start.offset ?? 0;
        const end = node?.position?.end.offset ?? 0;
        // A `*` between two letters or digits is notation (UGT1A1*28, pg*h/mL), not emphasis. The
        // offsets index the string ReactMarkdown parsed, which joining wrapped groups can shorten.
        const notation =
          source[start] === '*' &&
          /[\p{L}\p{N}]/u.test(source[start - 1] ?? '') &&
          /[\p{L}\p{N}]/u.test(source[end] ?? '');
        return notation ? <>*{children}*</> : <em>{children}</em>;
      },
      // A model-supplied link shows its label only: the model wrote its destination, which can carry
      // chart details off the page. The parser's own footnote links stay in-page with their ids.
      a: ({ node, children, ...link }) => {
        const properties = (node as HastNode | undefined)?.properties;
        return properties?.dataFootnoteRef != null || properties?.dataFootnoteBackref != null ? (
          <a {...link}>{children}</a>
        ) : (
          <>{children}</>
        );
      },
      p: ({ children }) => <p className={styles.answerParagraph}>{children}</p>,
      // A table wider than the bubble scrolls inside its own wrapper instead of pushing the
      // whole chat sideways; the narrow floating panel is where that happens first.
      table: ({ children }) => (
        <div className={styles.tableScroll} data-testid="answer-table-scroll">
          <table>{children}</table>
        </div>
      ),
      h1: heading,
      h2: heading,
      h3: heading,
      h4: heading,
      h5: heading,
      h6: heading,
    } as Components;

    return (
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={[decorateInDocumentOrder as never]}
        remarkRehypeOptions={{ clobberPrefix: footnotePrefix }}
        components={components}
      >
        {source}
      </ReactMarkdown>
    );
  }, [answer, references, patientUuid, misattributed, severities, qualified, footnotePrefix, t]);

  return <div className={styles.markdownAnswer}>{rendered}</div>;
};

export default MarkdownAnswer;
