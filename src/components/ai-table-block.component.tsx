import React from 'react';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@carbon/react';
import { type AiCell, type AiReference, type AiTableBlock } from '../api/chartsearchai';
import { type CitationContext, renderTextWithCitations } from './citation-chip.component';
import { citationGroupPattern, parseCitationIndices } from '../utils/safety-disclosure';
import styles from './ai-table-block.scss';

interface AiTableBlockProps {
  block: AiTableBlock;
  references: AiReference[];
  patientUuid: string;
  decorations?: Pick<CitationContext, 'misattributed' | 'severities' | 'qualified'>;
}

function renderCellContent(cell: AiCell | undefined, context: CitationContext): React.ReactNode {
  if (!cell) {
    return null;
  }
  const text = cell.text ?? '';
  const inTextRefs = new Set<number>();
  for (const match of text.matchAll(citationGroupPattern())) {
    for (const n of parseCitationIndices(match[1])) {
      inTextRefs.add(n);
    }
  }
  const extraRefs = (cell.refs ?? []).filter((idx) => !inTextRefs.has(idx));
  const rendered = renderTextWithCitations(text, context);

  if (extraRefs.length === 0) {
    return <>{rendered}</>;
  }

  return (
    <>
      {rendered}
      {text.length > 0 ? ' ' : null}
      <span className={styles.cellRefs}>{renderTextWithCitations(`[${extraRefs.join(', ')}]`, context)}</span>
    </>
  );
}

const AiTableBlockView: React.FC<AiTableBlockProps> = ({ block, references, patientUuid, decorations }) => {
  const { t } = useTranslation();
  const context: CitationContext = {
    references,
    patientUuid,
    t,
    misattributed: decorations?.misattributed ?? new Set<number>(),
    severities: decorations?.severities ?? new Map<number, string>(),
    qualified: decorations?.qualified ?? new Set<number>(),
    badged: new Set<number>(),
    noted: new Set<number>(),
  };
  const columns = block.columns ?? [];
  const rows = block.rows ?? [];

  if (columns.length === 0 || rows.length === 0) {
    return null;
  }

  return (
    <div className={styles.tableContainer}>
      {block.title ? <div className={styles.tableTitle}>{block.title}</div> : null}
      <Table size="sm" useZebraStyles={false} aria-label={block.title ?? t('aiTable', 'AI result table')}>
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <TableHeader key={col.key} id={`col-${col.key}`}>
                {col.label}
              </TableHeader>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, rowIdx) => (
            <TableRow key={`row-${rowIdx}`}>
              {columns.map((col) => (
                <TableCell key={`cell-${rowIdx}-${col.key}`}>
                  {renderCellContent(row.cells?.[col.key], context)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default AiTableBlockView;
