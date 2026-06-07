import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, InlineLoading, Tag } from '@carbon/react';
import { Copy } from '@carbon/react/icons';
import { navigate } from '@openmrs/esm-framework';
import { type AiReference, type AiSafetyWarning } from '../api/chartsearchai';
import { highlightReference } from '../utils/highlight-reference';
import { type AiBlock, type AiReference } from '../api/chartsearchai';
import { type AiBlock, type AiConfidence, type AiReference } from '../api/chartsearchai';
import AiFeedback from './ai-feedback.component';
import AiTableBlockView from './ai-table-block.component';
import MarkdownAnswer from './ai-markdown-answer.component';
import { buildReferenceUrl, handleReferenceNavigate } from './citation-chip.component';
import styles from './ai-response-panel.scss';

interface AiResponsePanelProps {
  answer: string;
  references: AiReference[];
  safetyWarnings?: AiSafetyWarning[];
  blocks?: AiBlock[];
  questionId: string;
  error: string | null;
  isLoading: boolean;
  patientUuid: string;
  /** The backend model that produced this answer; shown as a subtle faded tag. */
  resolvedModel?: string;
  /** Per-section validator confidence (validated hub tiers); rendered as green/yellow/red chips. */
  confidence?: AiConfidence;
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
  type: 'green' | 'red' | 'purple';
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

/** The tooltip shared by the drug-reference chip and its inline citation: one wording, one i18n key. */
function drugReferenceTitle(t: Translate): string {
  return t('drugReferenceCitation', 'Clinical reference data — not this patient’s record.');
}

/**
 * Badge for a drug-reference citation: reference data, not a grounded/ungrounded patient
 * record, so it gets its own neutral purple "Reference" tag rather than a grounding verdict.
 * Returns the shared {@link GroundedTag} shape so the badge renderer treats it uniformly.
 */
function referenceTag(t: Translate): GroundedTag {
  return {
    type: 'purple',
    text: t('reference', 'Reference'),
    title: drugReferenceTitle(t),
  };
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
      const citKey = `cit-${matchIndex}-${i}-${citIndex}`;
      parts.push(
        url && ref ? (
          <a
            key={citKey}
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
            key={citKey}
            className={`${styles.inlineCitation} ${styles.inlineCitationReference}`}
            title={drugReferenceTitle(t)}
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
/** Confidence level → label, mirroring the validation dashboard's tag wording. */
const CONFIDENCE_LABEL: Record<string, string> = {
  green: 'High confidence',
  yellow: 'Medium confidence',
  red: 'Low confidence',
};
const AiResponsePanel: React.FC<AiResponsePanelProps> = ({
  answer,
  references,
  safetyWarnings,
  blocks,
  questionId,
  error,
  isLoading,
  patientUuid,
  resolvedModel,
  confidence,
  onFeedbackComplete,
}) => {
  const { t } = useTranslation();
  const renderedAnswer = useMemo(() => {
    if (!answer) return null;
    if (isLoading) return answer;
    return renderAnswerWithCitations(answer, references, patientUuid, t);
  }, [answer, references, patientUuid, isLoading, t]);
    return renderTextWithCitations(answer, references, patientUuid);
  }, [answer, references, patientUuid, isLoading]);

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
      {!isLoading && confidence && (
        <div className={styles.confidenceRow} data-testid="confidence-row">
          {(
            [
              ['Answer', confidence.answer],
              ['In Depth', confidence.in_depth],
            ] as const
          )
            .filter(([, section]) => section?.level)
            .map(([label, section]) => (
              <span
                key={label}
                className={styles.confidenceChip}
                data-level={section!.level}
                title={section!.note || undefined}
              >
                <strong>{label}:</strong> {CONFIDENCE_LABEL[section!.level] ?? section!.level}
              </span>
            ))}
        </div>
      )}
      {answer && (
        <div className={styles.answerSection}>
          {isLoading ? (
            <p className={styles.answerText}>{answer}</p>
          ) : (
            <MarkdownAnswer answer={answer} references={references} patientUuid={patientUuid} />
          )}
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
              const drugReference = isDrugReference(ref);
              const label = drugReference
                ? `[${ref.index}] ${t('drugReferenceLabel', 'Drug reference')}`
                : `[${ref.index}] ${ref.resourceType} — ${ref.date}`;
              const g = drugReference ? referenceTag(t) : groundedTag(ref.grounded, t);
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
        // No live-region role: the panel already sits inside the chat history's
        // role="log" aria-live="polite", which announces this content in order. An
        // assertive role="alert" here would preempt the answer it annotates.
        <div className={styles.safetyWarningsSection}>
          <span className={styles.safetyWarningsLabel}>{t('safetyChecks', 'Safety checks')}:</span>
          <div className={styles.safetyWarningsList}>
            {safetyWarnings.map((warning, i) => {
              const { tagType, label } = safetyWarningTag(warning.type, t);
              return (
                <span key={`${warning.type}-${warning.drug}-${i}`} className={styles.safetyWarningItem}>
                  <Tag type={tagType} size="sm" className={styles.safetyWarningBadge}>
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
          <div className={styles.actionsLeft}>
            {questionId ? (
              <AiFeedback key={questionId} questionId={questionId} onComplete={onFeedbackComplete} />
            ) : (
              <span />
            )}
            {resolvedModel && (
              <span
                className={styles.modelTag}
                title={t('answeredByModel', 'Answered by {{model}}', { model: resolvedModel })}
              >
                {resolvedModel}
              </span>
            )}
          </div>
          <IconButton kind="ghost" size="sm" label={t('copy', 'Copy')} align="left-bottom" onClick={handleCopy}>
            <Copy />
          </IconButton>
        </div>
      )}
    </div>
  );
};

export default AiResponsePanel;
