import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, InlineLoading, Tag } from '@carbon/react';
import { Copy, Information } from '@carbon/react/icons';
import { navigate } from '@openmrs/esm-framework';
import {
  type AiInteractionPairs,
  type AiReference,
  type AiSafetyWarning,
  SESSION_EXPIRED_ERROR_CODE,
} from '../api/chartsearchai';
import { highlightReference } from '../utils/highlight-reference';
import { isReferenceData, resolveFindingSeverities, type SeverityTone, severityTone } from '../utils/safety-disclosure';
import AiFeedback from './ai-feedback.component';
import styles from './ai-response-panel.scss';

interface AiResponsePanelProps {
  answer: string;
  references: AiReference[];
  safetyWarnings?: AiSafetyWarning[];
  /**
   * Citations the answer offered as evidence of an active drug order that cannot be one.
   *
   * These are rendered as unreliable EVIDENCE, never as an unsupported CLAIM: the finding
   * behind such a sentence is deterministic and typically correct, and a red "Unsupported"
   * badge here would repeat a miscarriage the backend has already had to undo once.
   *
   * An empty array is deliberately not rendered as anything. The check sees only answers that
   * reproduce the module's own phrasing and cannot spot a citation of the wrong in-force
   * order, so `[]` means "the check named none", not "these citations are sound" — nothing in
   * this panel may read as a clean bill of health for the rest.
   */
  misattributedOrderCitations?: number[] | null;
  /** Citations of safety findings whose rating the answer states nowhere. */
  unstatedFindingSeverities?: number[] | null;
  /** Whether the loaded dataset could run the condition arm of the contraindication screen. */
  conditionRuleCoverage?: string | null;
  /** How bounded the interaction check that stated it was. */
  interactionPairs?: AiInteractionPairs | null;
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

/**
 * Where a citation's chip and inline marker navigate to, or null where they must not navigate.
 *
 * Two kinds of citation get no link. Reference data (a drug-reference entry, a safety finding,
 * a drug-class note) has no chart page at all. And a MISATTRIBUTED citation has one that would
 * mislead: the record exists, but it is not the medication order the sentence names, so
 * following the link lands the clinician on an unrelated row and invites them to read it as
 * the evidence for the claim.
 */
function buildReferenceUrl(ref: AiReference, patientUuid: string, misattributed: boolean): string | null {
  if (!patientUuid || misattributed || isReferenceData(ref)) {
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

/** The tooltip shared by the reference-data chip and its inline citation: one wording, one i18n key. */
function drugReferenceTitle(t: Translate): string {
  return t('drugReferenceCitation', 'Clinical reference data — not this patient’s record.');
}

/**
 * The wording for a citation that cannot be the drug order its sentence names.
 *
 * Says the EVIDENCE is wrong, not the finding — the interaction itself came from a
 * deterministic check and is typically sound. Shared by the inline marker and the chip.
 */
function misattributedTitle(t: Translate): string {
  return t(
    'misattributedCitationTitle',
    'This citation cannot be the medication order this sentence names — following it lands on an unrelated record. The safety finding itself is unaffected.',
  );
}

/**
 * Badge for a reference-data citation: reference data, not a grounded/ungrounded patient
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

/**
 * The class carrying a rating's colour. An unrecognised word a dataset supplied gets the
 * neutral treatment — colouring it as a tier would assert a ranking the dataset never stated.
 */
const SEVERITY_TONE_CLASS: Record<SeverityTone, string> = {
  major: styles.severityMajor,
  moderate: styles.severityModerate,
  minor: styles.severityMinor,
  unknown: styles.severityUnrated,
  unrated: styles.severityUnrated,
};

function stripCitations(answer: string): string {
  return answer.replace(/\s?\[\d+(?:\s*,\s*\d+)*\]/g, '').trim();
}

interface CitationContext {
  references: AiReference[];
  misattributed: Set<number>;
  /** Citation index → the rating the answer never stated, for the ones that could be resolved. */
  severities: Map<number, string>;
  patientUuid: string;
  t: Translate;
}

function renderAnswerWithCitations(answer: string, ctx: CitationContext): React.ReactNode[] {
  const { references, misattributed, severities, patientUuid, t } = ctx;
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
      const isMisattributed = misattributed.has(citIndex);
      const url = ref ? buildReferenceUrl(ref, patientUuid, isMisattributed) : null;
      const ungrounded = ref?.grounded === false;
      const referenceData = ref ? isReferenceData(ref) : false;
      const citKey = `cit-${matchIndex}-${i}-${citIndex}`;
      parts.push(
        isMisattributed ? (
          // Struck through and NOT a link: the number stays readable so the chip below can be
          // found, but there is nowhere useful to go. Amber rather than red — this is unreliable
          // evidence, not a refuted claim.
          <span
            key={citKey}
            className={`${styles.inlineCitation} ${styles.inlineCitationMisattributed}`}
            title={misattributedTitle(t)}
          >
            {citIndex}
          </span>
        ) : url && ref ? (
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
        ) : referenceData ? (
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

    // The rating for any finding cited here that the answer states nowhere, immediately after
    // the marker group — beside the sentence it belongs to, so a flat list of five findings can
    // be ranked in one pass instead of reading as five equals.
    citIndices.forEach((citIndex) => {
      const severity = severities.get(citIndex);
      if (!severity) return;
      parts.push(
        <span
          key={`sev-${matchIndex}-${citIndex}`}
          className={`${styles.severityTag} ${SEVERITY_TONE_CLASS[severityTone(severity)]}`}
          title={t(
            'unstatedSeverityTitle',
            'Rated by the reference dataset. This answer does not state the rating — it is shown here so the findings can be ranked.',
          )}
        >
          {severity}
        </span>,
      );
    });

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
  misattributedOrderCitations,
  unstatedFindingSeverities,
  conditionRuleCoverage,
  interactionPairs,
  questionId,
  error,
  isLoading,
  patientUuid,
  onFeedbackComplete,
}) => {
  const { t } = useTranslation();

  const misattributed = useMemo(() => new Set(misattributedOrderCitations ?? []), [misattributedOrderCitations]);

  const severities = useMemo(
    () => resolveFindingSeverities(answer, references, safetyWarnings ?? [], unstatedFindingSeverities),
    [answer, references, safetyWarnings, unstatedFindingSeverities],
  );

  const renderedAnswer = useMemo(() => {
    if (!answer) return null;
    if (isLoading) return answer;
    return renderAnswerWithCitations(answer, { references, misattributed, severities, patientUuid, t });
  }, [answer, references, misattributed, severities, patientUuid, isLoading, t]);

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(stripCitations(answer));
  }, [answer]);

  // "N of M drug pairs shown" — the backend's own recommended rendering. Rendered whenever a
  // measurement exists, because the count is the only thing that tells a bounded interaction
  // list from a complete one; withheld pairs are always the least severe ones.
  //
  // Not derived from the number of chips: this counts drug PAIRS, and the chip list also
  // carries contraindication and class findings that were never pairs.
  const pairsSentence = useMemo(() => {
    if (!interactionPairs || typeof interactionPairs.found !== 'number') return null;
    const { found, reported } = interactionPairs;
    return {
      bounded: reported < found,
      text: t('interactionPairsShown', 'Interactions: {{reported}} of {{found}} drug pairs shown.', {
        reported,
        found,
      }),
    };
  }, [interactionPairs, t]);

  // Condition coverage. "absent" and "unloaded" must not collapse into one sentence — "we
  // looked and there is none" is not "nobody looked" — and `published` states only that the
  // DATASET can run the arm, never that any recorded condition was screened, so it renders
  // nothing rather than an affordance that would overclaim.
  const coverageSentence = useMemo(() => {
    switch (conditionRuleCoverage) {
      case 'absent':
        return t(
          'conditionRulesAbsent',
          'Conditions were not screened. The loaded drug-reference dataset publishes no condition rules, so this patient’s recorded conditions were not checked.',
        );
      case 'unloaded':
        return t(
          'conditionRulesUnloaded',
          'Conditions were not screened. No drug-reference dataset was loaded, so nothing is known about condition coverage.',
        );
      default:
        return null;
    }
  }, [conditionRuleCoverage, t]);

  // The API layer emits a code (not display text) for session expiry so the wording can be localized
  // here; every other error is already a human-readable string from the server or browser.
  const displayError =
    error === SESSION_EXPIRED_ERROR_CODE
      ? t('sessionExpired', 'Your session has expired. Please log in again.')
      : error;

  if (error && !answer) {
    return (
      <div className={styles.errorContainer} role="alert">
        <p className={styles.errorText}>{displayError}</p>
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
            {t('streamInterrupted', 'Response interrupted:')} {displayError}
          </p>
        </div>
      )}

      {references.length > 0 && (
        <div className={styles.referencesSection}>
          <span className={styles.referencesLabel}>{t('references', 'References')}:</span>
          <div className={styles.referencesList}>
            {references.map((ref) => {
              const isMisattributed = misattributed.has(ref.index);
              const url = buildReferenceUrl(ref, patientUuid, isMisattributed);
              const referenceData = isReferenceData(ref);
              const typeLabel = referenceData
                ? ref.resourceType.toLowerCase() === 'safety_finding'
                  ? t('safetyFindingLabel', 'Safety finding')
                  : t('drugReferenceLabel', 'Drug reference')
                : ref.resourceType;
              // Only append the date when there is one — an allergy and a safety finding carry
              // none, and "— null" was reaching the screen.
              const label = `[${ref.index}] ${typeLabel}${ref.date ? ` — ${ref.date}` : ''}`;
              const g = referenceData ? referenceTag(t) : groundedTag(ref.grounded, t);
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
                <span className={isMisattributed ? styles.referenceTagMisattributed : styles.referenceTagInert}>
                  {label}
                </span>
              );
              return (
                <span key={ref.index} className={styles.referenceItem}>
                  {link}
                  {isMisattributed && (
                    <span className={styles.misattributedTag} title={misattributedTitle(t)}>
                      {t('notTheOrderNamed', 'Not the order named')}
                    </span>
                  )}
                  {/* The module attached this citation from the safety finding it fired on, so the
                      answer's prose carries no [N] marker for it. Saying so is the only way a
                      clinician can tell why the number appears nowhere above — and the chip is the
                      only place it appears at all. */}
                  {ref.attachedByTheModule === true && (
                    <span
                      className={styles.attachedTag}
                      title={t(
                        'attachedByTheModuleTitle',
                        'The module supplied this citation from the safety finding it fired on, so the answer’s text carries no marker for it. Opening it scrolls to the record.',
                      )}
                    >
                      {t('attachedByTheModule', 'Added by the module')}
                    </span>
                  )}
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

      {/* What the safety screen did and did not cover. Deliberately neutral rather than a
          caution: an arm the loaded dataset cannot run is a limit of the dataset, not a finding
          about this patient, and styling it as a warning would read as the latter. */}
      {(pairsSentence || coverageSentence) && (
        <div className={styles.limitsSection}>
          <span className={styles.limitsLabel}>{t('checkCoverage', 'What this check covered')}</span>
          <ul className={styles.limitsList}>
            {pairsSentence && (
              <li className={pairsSentence.bounded ? styles.limitItemBounded : styles.limitItem}>
                <Information size={16} className={styles.limitIcon} />
                <span>
                  {pairsSentence.text}
                  {pairsSentence.bounded && ` ${t('interactionPairsWithheld', 'The least severe were withheld.')}`}
                </span>
              </li>
            )}
            {coverageSentence && (
              <li className={styles.limitItem}>
                <Information size={16} className={styles.limitIcon} />
                <span>{coverageSentence}</span>
              </li>
            )}
          </ul>
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
