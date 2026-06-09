import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, InlineLoading, Tag } from '@carbon/react';
import { Copy } from '@carbon/react/icons';
import { navigate } from '@openmrs/esm-framework';
import { type AiReference, type AiSafetyWarning } from '../api/chartsearchai';
import { highlightReference } from '../utils/highlight-reference';
import AiFeedback from './ai-feedback.component';
import styles from './ai-response-panel.scss';

interface AiResponsePanelProps {
  answer: string;
  references: AiReference[];
  safetyWarnings?: AiSafetyWarning[];
  questionId: string;
  error: string | null;
  isLoading: boolean;
  patientUuid: string;
  onFeedbackComplete?: () => void;
}

/** Reference data, not patient data — cited like a record but it has no chart tab to navigate to. */
const RESOURCE_TYPE_DRUG_REFERENCE = 'drug_reference';

const RESOURCE_TYPE_TO_CHART_PAGE: Record<string, string> = {
  obs: 'Results',
  order: 'Orders',
  allergy: 'Allergies',
  condition: 'Conditions',
  diagnosis: 'Visits',
  program: 'Programs',
  medication_dispense: 'Medications',
};

function isDrugReference(ref: AiReference): boolean {
  return ref.resourceType.toLowerCase() === RESOURCE_TYPE_DRUG_REFERENCE;
}

function buildReferenceUrl(ref: AiReference, patientUuid: string): string | null {
  if (!patientUuid || isDrugReference(ref)) {
    // Drug-reference citations are reference data with no patient chart tab —
    // they do not navigate (a detail side panel is a follow-up).
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

/**
 * Maps a safety-warning type to a Carbon Tag colour and a translated label.
 * Overdose and contraindication are the higher-severity reds; an interaction is
 * magenta. Unknown types fall back to a neutral red so a warning is never dropped.
 */
function safetyWarningTag(type: string, t: Translate): { tagType: 'red' | 'magenta'; label: string } {
  switch (type) {
    case 'overdose':
      return { tagType: 'red', label: t('safetyOverdose', 'Dose') };
    case 'contraindication':
      return { tagType: 'red', label: t('safetyContraindication', 'Contraindication') };
    case 'interaction':
      return { tagType: 'magenta', label: t('safetyInteraction', 'Interaction') };
    default:
      return { tagType: 'red', label: t('safetyWarning', 'Safety') };
  }
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
      const drugReference = ref ? isDrugReference(ref) : false;
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
        ) : drugReference ? (
          <span
            key={`cit-${matchIndex}-${citIndex}`}
            className={`${styles.inlineCitation} ${styles.inlineCitationReference}`}
            title={t('drugReferenceCitation', 'Clinical reference data — not this patient’s record.')}
          >
            {citIndex}
          </span>
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
  safetyWarnings,
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
              const drugReference = isDrugReference(ref);
              const label = drugReference
                ? `[${ref.index}] ${t('drugReferenceLabel', 'Drug reference')}`
                : `[${ref.index}] ${ref.resourceType} — ${ref.date}`;
              const g = drugReference
                ? {
                    type: 'purple' as const,
                    text: t('reference', 'Reference'),
                    title: t('drugReferenceCitation', 'Clinical reference data — not this patient’s record.'),
                  }
                : groundedTag(ref.grounded, t);
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

      {safetyWarnings && safetyWarnings.length > 0 && (
        <div className={styles.safetyWarningsSection} role="alert">
          <span className={styles.safetyWarningsLabel}>{t('safetyChecks', 'Safety checks')}:</span>
          <div className={styles.safetyWarningsList}>
            {safetyWarnings.map((warning, i) => {
              const { tagType, label } = safetyWarningTag(warning.type, t);
              return (
                <span key={`${warning.type}-${warning.drug}-${i}`} className={styles.safetyWarningItem}>
                  <Tag type={tagType} size="sm">
                    {label}
                  </Tag>
                  <span className={styles.safetyWarningText}>
                    {warning.drug}: {warning.detail}
                  </span>
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
