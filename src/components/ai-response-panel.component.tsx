import React, { useCallback, useMemo } from 'react';
import { navigate } from '@openmrs/esm-framework';
import { useTranslation } from 'react-i18next';
import { IconButton, InlineLoading, Tag } from '@carbon/react';
import { Copy } from '@carbon/react/icons';
import { type AiBlock, type AiReference } from '../api/chartsearchai';
import AiFeedback from './ai-feedback.component';
import AiTableBlockView from './ai-table-block.component';
import { highlightReference } from '../utils/highlight-reference';
import styles from './ai-response-panel.scss';

interface AiResponsePanelProps {
  answer: string;
  references: AiReference[];
  blocks?: AiBlock[];
  questionId: string;
  error: string | null;
  isLoading: boolean;
  patientUuid: string;
  onFeedbackComplete?: () => void;
}

const RESOURCE_TYPE_TO_CHART_PAGE: Record<string, string> = {
  obs: 'Results',
  order: 'Orders',
  allergy: 'Allergies',
  condition: 'Conditions',
  diagnosis: 'Visits',
  program: 'Programs',
  medication_dispense: 'Medications',
};

function buildReferenceUrl(ref: AiReference, patientUuid: string): string | null {
  if (!patientUuid) {
    return null;
  }
  const chartPage = RESOURCE_TYPE_TO_CHART_PAGE[ref.resourceType.toLowerCase()];
  return `${window.spaBase}/patient/${patientUuid}/chart/${encodeURIComponent(chartPage ?? 'Patient Summary')}`;
}

function handleReferenceNavigate(e: React.MouseEvent, url: string, ref: AiReference) {
  e.preventDefault();
  navigate({ to: url });
  highlightReference(ref.resourceUuid, ref.date);
}

type Translate = (key: string, fallback: string) => string;

interface GroundedTag {
  type: 'green' | 'red';
  text: string;
  title: string;
}

/**
 * Maps a citation's grounding verdict to a translated badge, or null when no
 * badge should show. null/undefined (unverified) returns null so an unverified
 * citation is never rendered as "verified".
 *
 * The {@code t(...)} calls use string-literal keys (not variables) so the
 * i18next-parser can statically extract them; a dynamic {@code t(key)} would be
 * dropped from translations/en.json by the `extract-translations` check.
 */
function groundedTag(grounded: boolean | null | undefined, t: Translate): GroundedTag | null {
  if (grounded === true) {
    return {
      type: 'green',
      text: t('grounded', 'Verified'),
      title: t('groundedTitle', 'Supported by the cited record.'),
    };
  }
  if (grounded === false) {
    return {
      type: 'red',
      text: t('notGrounded', 'Unsupported'),
      title: t('notGroundedTitle', 'The cited record may not support this statement — verify against the chart.'),
    };
  }
  return null;
}

function stripCitations(answer: string): string {
  return answer.replace(/\s?\[\d+(?:\s*,\s*\d+)*\]/g, '').trim();
}

function renderAnswerWithCitations(
  answer: string,
  references: AiReference[],
  patientUuid: string,
  t: Translate,
): React.ReactNode[] {
  const refByIndex = new Map(references.map((r) => [r.index, r]));
  const parts: React.ReactNode[] = [];
  const pattern = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(answer)) !== null) {
    if (match.index > lastIndex) {
      parts.push(answer.slice(lastIndex, match.index));
    }
    const matchIndex = match.index;
    const citIndices = match[1].split(/\s*,\s*/).map(Number);
    parts.push('[');
    citIndices.forEach((citIndex, i) => {
      const ref = refByIndex.get(citIndex);
      const url = ref ? buildReferenceUrl(ref, patientUuid) : null;
      const ungrounded = ref?.grounded === false;
      parts.push(
        url && ref ? (
          <a
            key={`cit-${matchIndex}-${citIndex}`}
            className={
              ungrounded ? `${styles.inlineCitation} ${styles.inlineCitationUngrounded}` : styles.inlineCitation
            }
            href={url}
            title={
              ungrounded
                ? t('notGroundedTitle', 'The cited record may not support this statement — verify against the chart.')
                : undefined
            }
            onClick={(e) => handleReferenceNavigate(e, url, ref)}
          >
            {ungrounded ? `${citIndex} ⚠` : citIndex}
          </a>
        ) : (
          `${citIndex}`
        ),
      );
      if (i < citIndices.length - 1) {
        parts.push(', ');
      }
    });
    parts.push(']');
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < answer.length) {
    parts.push(answer.slice(lastIndex));
  }
  return parts;
}

const AiResponsePanel: React.FC<AiResponsePanelProps> = ({
  answer,
  references,
  blocks,
  questionId,
  error,
  isLoading,
  patientUuid,
  onFeedbackComplete,
}) => {
  const { t } = useTranslation();
  const renderedAnswer = useMemo(() => {
    if (!answer) return null;
    if (isLoading) return answer;
    return renderAnswerWithCitations(answer, references, patientUuid, t);
  }, [answer, references, patientUuid, isLoading, t]);

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(stripCitations(answer));
  }, [answer]);

  if (error && !answer) {
    return (
      <div className={styles.errorContainer} role="alert">
        <p className={styles.errorText}>{error}</p>
      </div>
    );
  }

  return (
    <div className={styles.responseContainer}>
      {answer && (
        <div className={styles.answerSection}>
          <p className={styles.answerText}>{renderedAnswer}</p>
          {isLoading && <InlineLoading className={styles.streamingIndicator} />}
        </div>
      )}

      {!isLoading &&
        blocks?.map((block, idx) =>
          block.kind === 'table' ? (
            <AiTableBlockView key={`block-${idx}`} block={block} references={references} patientUuid={patientUuid} />
          ) : null,
        )}

      {error && answer && (
        <div className={styles.errorContainer} role="alert">
          <p className={styles.errorText}>
            {t('streamInterrupted', 'Response interrupted:')} {error}
          </p>
        </div>
      )}

      {references.length > 0 && (
        <div className={styles.referencesSection}>
          <span className={styles.referencesLabel}>{t('references', 'References')}:</span>
          <div className={styles.referencesList}>
            {references.map((ref) => {
              const url = buildReferenceUrl(ref, patientUuid);
              const label = `[${ref.index}] ${ref.resourceType} — ${ref.date}`;
              const g = groundedTag(ref.grounded, t);
              // Tooltip via a native-title wrapper rather than Tag's deprecated `title` prop.
              // Rendered as a sibling of the link (Carbon Tag is a <div>) so the metadata
              // badge is not nested in, or part of, the navigation click target.
              const badge = g ? (
                <span className={styles.groundedTag} title={g.title}>
                  <Tag type={g.type} size="sm">
                    {g.text}
                  </Tag>
                </span>
              ) : null;
              const link = url ? (
                <a className={styles.referenceTag} href={url} onClick={(e) => handleReferenceNavigate(e, url, ref)}>
                  {label}
                </a>
              ) : (
                <span className={styles.referenceTagInert}>{label}</span>
              );
              return (
                <span key={ref.index} className={styles.referenceItem}>
                  {link}
                  {badge}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {answer && !isLoading && (
        <div className={styles.actionsRow}>
          {questionId ? (
            <AiFeedback key={questionId} questionId={questionId} onComplete={onFeedbackComplete} />
          ) : (
            <span />
          )}
          <IconButton kind="ghost" size="sm" label={t('copy', 'Copy')} align="left-bottom" onClick={handleCopy}>
            <Copy />
          </IconButton>
        </div>
      )}
    </div>
  );
};

export default AiResponsePanel;
