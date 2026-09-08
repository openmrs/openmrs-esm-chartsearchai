import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, InlineLoading, Tag } from '@carbon/react';
import { Copy, Information } from '@carbon/react/icons';
import {
  type AiAnswerLimits,
  type AiAnswerValidation,
  type AiBlock,
  type AiConfidence,
  type AiConfidenceSection,
  type AiInDepth,
  type AiReference,
  type AiSafetyCheck,
  type AiSafetyReferencePackage,
  type AiSafetyStatus,
  type AiSafetyWarning,
  type ConditionRuleCoverage,
  SESSION_EXPIRED_ERROR_CODE,
} from '../api/chartsearchai';
import {
  citationStripPattern,
  isReferenceData,
  type ReferenceKind,
  referenceKind,
  resolveFindingSeverities,
} from '../utils/safety-disclosure';
import AiFeedback from './ai-feedback.component';
import AiTableBlockView from './ai-table-block.component';
import MarkdownAnswer from './ai-markdown-answer.component';
import { buildReferenceUrl, handleReferenceNavigate, referenceTitle, type Translate } from './citation-chip.component';
import { isAwaitingAnswer, isTerminal, type TurnPhase } from '../hooks/turn-phase';
import styles from './ai-response-panel.scss';

/**
 * The four answer-limit measurements come in as {@link AiAnswerLimits}, so their semantics are
 * stated once on the wire type rather than restated here. Two readings this panel implements
 * and must keep: an empty array renders NOTHING (the check named none, which is not a
 * certificate that the other citations are sound), and a null renders nothing either (no
 * measurement was stated, which is not a completeness claim).
 */
interface AiResponsePanelProps extends AiAnswerLimits {
  answer: string;
  /** Live reasoning scratchpad, present only while the turn is still answering. */
  reasoning?: string;
  references: AiReference[];
  safetyWarnings?: AiSafetyWarning[];
  /** checked/limited/unavailable — surfaced even when safetyWarnings is empty, so a clean check
   *  is never visually indistinguishable from one that could not run. */
  safetyStatus?: AiSafetyStatus;
  /** Canonical safety result; explains package approval and coverage limitations. */
  safetyCheck?: AiSafetyCheck;
  blocks?: AiBlock[];
  auditLogId?: number;
  error: string | null;
  /** The turn's lifecycle phase — drives which parts of the answer render (see {@link TurnPhase}). */
  phase: TurnPhase;
  patientUuid: string;
  /** Hub product profile that produced this answer; shown as a subtle faded tag. */
  resolvedModel?: string;
  /** Per-section check confidence (checked hub profiles); rendered as green/yellow/red chips. */
  confidence?: AiConfidence;
  /** Staged answer check lifecycle; rendered as the primary Answer badge when present. */
  answerValidation?: AiAnswerValidation;
  /** Staged team In-Depth state. */
  inDepth?: AiInDepth;
  onFeedbackComplete?: () => void;
}

interface GroundedTag {
  type: 'green' | 'red' | 'purple' | 'blue';
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
function groundedTag(ref: AiReference, t: Translate): GroundedTag | null {
  if (ref.groundingStatus === 'checking') {
    return {
      type: 'blue',
      text: t('groundingChecking', 'Checking'),
      title: t('groundingCheckingTitle', 'Source resolved; support check is still running.'),
    };
  }
  if (ref.grounded === true || ref.groundingStatus === 'verified') {
    const sourceSet = ref.groundingScope === 'source_set';
    return {
      type: 'green',
      text: t('grounded', 'Verified'),
      title: sourceSet
        ? t('groundedSourceSetTitle', 'Supports this claim together with the other cited records.')
        : t('groundedTitle', 'Supported by the cited record.'),
    };
  }
  if (ref.grounded === false || ref.groundingStatus === 'unsupported') {
    const sourceSet = ref.groundingScope === 'source_set';
    return {
      type: 'red',
      text: t('notGrounded', 'Unsupported'),
      title: sourceSet
        ? t(
            'notGroundedSourceSetTitle',
            'This cited source set may not support the associated claim — verify against the chart.',
          )
        : t('notGroundedTitle', 'The cited record may not support this statement — verify against the chart.'),
    };
  }
  if (ref.groundingStatus === 'mixed') {
    return {
      type: 'red',
      text: t('groundingMixed', 'Mixed support'),
      title: t(
        'groundingMixedTitle',
        'This record supports some associated claims but not others — inspect the evidence details.',
      ),
    };
  }
  return null;
}

/**
 * The wording for a citation that cannot be the drug order its sentence names.
 *
 * Says the EVIDENCE is in doubt, and stops there. It must not read as a verdict on the finding
 * in EITHER direction: not "this warning is bogus", which the backend calls a miscarriage of
 * the same kind as badging a correct citation Unsupported; and not "the finding is unaffected",
 * which this said until it was checked against the whole contract rather than half of it.
 *
 * Both halves are in the README. The finding "is deterministic and, on the reported answer,
 * clinically correct — it is the chart evidence attached to it that is wrong". But also:
 * "Responses are reachable in which this key and its neighbours disagree, and in each the
 * neighbour may be the one that is right" — the order-currency arm fires on the chart's
 * out-of-force mark, while the chip's own `OrderService` read is taken at a different instant,
 * so a chip can say "active order X" about an order this key says the citation cannot be. The
 * backend leaves that unresolved; a tooltip that resolves it is overclaiming whichever side it
 * picks. Shared by the inline marker and the chip.
 */
function misattributedTitle(t: Translate): string {
  return t(
    'misattributedCitationTitle',
    'The module reports that this citation may not be the medication order this sentence names, so it is not offered as a link. This is a report about the citation, not a verdict on the safety finding.',
  );
}

/**
 * Badge for a reference-data citation: reference data, not a grounded/ungrounded patient
 * record, so it gets its own neutral purple "Reference" tag rather than a grounding verdict.
 * Returns the shared {@link GroundedTag} shape so the badge renderer treats it uniformly.
 */
function referenceTag(ref: AiReference, t: Translate): GroundedTag {
  return {
    type: 'purple',
    text: t('reference', 'Reference'),
    title: referenceTitle(ref, t),
  };
}

/**
 * What each coverage verdict says, or `null` where it must say nothing.
 *
 * A total `Record` over the closed union, deliberately, and for the same reason as
 * {@link REFERENCE_KIND_LABEL} below: a `switch` with a `default` arm collapses two different
 * things — the decision that `published` renders nothing, and the fallback for a word this
 * client predates — so a fourth verdict someone HAS taught the type system about would fall
 * into the fallback and render silently. Measured: adding `'partial'` to the union type
 * typechecked clean and passed the whole suite, rendering silently. Here it is a compile error.
 *
 * `absent` and `unloaded` must not collapse into one sentence — "we looked and there is none"
 * is not "nobody looked". `published` states only that the DATASET can run the arm, never that
 * any recorded condition was screened, so it renders nothing rather than an affordance that
 * would overclaim.
 *
 * The wire type is wider than this union (`string & {}`), which is why the lookup is cast and
 * `?? null`-ed: an unrecognised word still renders nothing, as it must.
 */
const COVERAGE_SENTENCE: Record<ConditionRuleCoverage, ((t: Translate) => string) | null> = {
  absent: (t) =>
    t(
      'conditionRulesAbsent',
      'Conditions were not screened. The loaded drug-reference dataset publishes no condition rules, so this patient’s recorded conditions were not checked.',
    ),
  unloaded: (t) =>
    t(
      'conditionRulesUnloaded',
      'Conditions were not screened. No drug-reference dataset was loaded, so nothing is known about condition coverage.',
    ),
  published: null,
};
// A note on reachability, because one of these arms is dead in production and it should not look
// like an oversight. `unloaded` means no drug-reference dataset was read, which on a stock
// install is `chartsearchai.drugReference.enabled=false` — and that produces no safety findings,
// no pair extent and no reference-group citations, so `hasSafetyOutput` below can never be true
// and this sentence can never render. The arm stays because a backend reporting `unloaded`
// ALONGSIDE safety output would be contradicting itself, and rendering the note is the right
// response to that; but it is defensive, not a path any conforming server takes.

/**
 * The label for a reference-group citation, keyed on the same classification the predicate uses
 * so the two cannot disagree. `other` is reachable and deliberately neutral: a citation whose
 * `group` is `reference` but whose type this client predates must not be called a drug
 * reference, which would tell a clinician it came from a drug's reference entry.
 */
const REFERENCE_KIND_LABEL: Record<ReferenceKind, (t: Translate) => string> = {
  safety_finding: (t) => t('safetyFindingLabel', 'Safety finding'),
  drug_reference: (t) => t('drugReferenceLabel', 'Drug reference'),
  drug_class_note: (t) => t('drugClassNoteLabel', 'Drug class note'),
  // Only for a `reference`-group type this client predates — never for one the module knows.
  other: (t) => t('referenceMaterialLabel', 'Reference material'),
};

function referenceLabel(ref: AiReference, t: Translate): string {
  return REFERENCE_KIND_LABEL[referenceKind(ref)](t);
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
 * Maps a safety status to a Carbon Tag. Every completed status stays visible so a clean check is
 * distinguishable from a missing check, and limited/unavailable results cannot look complete.
 */
function safetyStatusTag(status: AiSafetyStatus, t: Translate): { tagType: 'green' | 'gray'; label: string } {
  switch (status) {
    case 'checked':
      return { tagType: 'green', label: t('safetyChecked', 'Checked') };
    case 'limited':
      return { tagType: 'gray', label: t('safetyLimited', 'Limited safety check') };
    case 'unavailable':
      return { tagType: 'gray', label: t('safetyUnavailable', 'Safety check unavailable') };
  }
}

function safetyIssueText(issue: string, t: Translate): string {
  if (issue.startsWith('named_drug_unresolved:')) {
    const medication = issue.slice('named_drug_unresolved:'.length).trim();
    if (medication && medication !== 'resolution_failed') {
      return t(
        'safetyNamedDrugUnresolved',
        'The medication “{{medication}}” could not be matched to the configured reference source.',
      ).replace('{{medication}}', medication);
    }
    return t(
      'safetyDrugResolutionFailed',
      'A named medication could not be matched to the configured reference source.',
    );
  }
  switch (issue) {
    case 'source_not_clinically_approved':
      return t(
        'safetySourceNotApproved',
        'The configured research source is not clinically approved for deterministic warnings.',
      );
    case 'cross_reactivity_not_clinically_approved':
      return t('safetyCrossReactivityNotApproved', 'The cross-reactivity rules are not clinically approved.');
    case 'source_unavailable':
      return t('safetySourceUnavailable', 'No medication-safety reference source was available.');
    case 'source_data_invalid':
      return t('safetySourceDataInvalid', 'The medication-safety reference data could not be read safely.');
    case 'source_data_partially_invalid':
      return t(
        'safetySourceDataPartiallyInvalid',
        'Some medication-safety reference records were invalid and ignored.',
      );
    case 'source_package_identity_incomplete':
      return t(
        'safetySourcePackageIdentityIncomplete',
        'The medication-safety rule package is missing required source identity information.',
      );
    case 'source_retired':
      return t('safetySourceRetired', 'The configured medication-safety source has been retired.');
    case 'cross_reactivity_source_unavailable':
      return t('safetyCrossReactivitySourceUnavailable', 'No cross-reactivity reference source was available.');
    case 'cross_reactivity_data_invalid':
      return t('safetyCrossReactivityDataInvalid', 'The cross-reactivity reference data could not be read safely.');
    case 'cross_reactivity_data_partially_invalid':
      return t(
        'safetyCrossReactivityDataPartiallyInvalid',
        'Some cross-reactivity reference records were invalid and ignored.',
      );
    case 'cross_reactivity_package_identity_incomplete':
      return t(
        'safetyCrossReactivityPackageIdentityIncomplete',
        'The cross-reactivity rule package is missing required source identity information.',
      );
    case 'cross_reactivity_source_retired':
      return t('safetyCrossReactivitySourceRetired', 'The configured cross-reactivity source has been retired.');
    case 'patient_context_unavailable':
      return t('safetyPatientContextUnavailable', 'The patient context needed for this check was unavailable.');
    case 'mapping_incomplete':
      return t('safetyMappingIncomplete', 'Not every active medication could be mapped to the reference source.');
    case 'exposure_incomplete':
      return t(
        'safetyExposureIncomplete',
        'Medication, allergy, or condition context may be incomplete for this check.',
      );
    case 'check_scope_limited':
      return t('safetyScopeLimited', 'Only part of the configured medication-safety check ran.');
    case 'execution_failed':
      return t('safetyExecutionFailed', 'The medication-safety check did not complete.');
    default:
      return issue.replaceAll('_', ' ');
  }
}

function safetyPackageProvenance(source?: AiSafetyReferencePackage): string | undefined {
  const provenance = source?.provenance;
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    return undefined;
  }
  const record = provenance as Record<string, unknown>;
  const values = ['source', 'dataset', 'origin']
    .map((key) => record[key])
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.trim());
  const unique = Array.from(new Set(values));
  return unique.length > 0 ? unique.join(' / ') : undefined;
}

function stripCitations(answer: string): string {
  return answer.replace(citationStripPattern(), '').trim();
}

function evidenceTitle(ref: AiReference): string {
  if ((ref.title ?? '').trim()) {
    return ref.title!.trim();
  }
  const text = (ref.sourceText ?? '').replace(/^\s*\(\d{4}-\d{2}-\d{2}\)\s*/, '').trim();
  if (text) {
    return text.length > 88 ? `${text.slice(0, 85)}...` : text;
  }
  return `${ref.resourceType || 'Record'} ${ref.index}`;
}

const EvidenceCard: React.FC<{ refItem: AiReference; patientUuid: string; t: Translate }> = ({
  refItem,
  patientUuid,
  t,
}) => {
  const url = buildReferenceUrl(refItem, patientUuid);
  const title = evidenceTitle(refItem);
  const meta = [`[${refItem.index}]`, refItem.resourceType, refItem.date].filter(Boolean).join(' · ');
  const source = (refItem.sourceText ?? '').trim();
  const sourceWithoutDate = source.replace(/^\s*\(\d{4}-\d{2}-\d{2}\)\s*/, '').trim();
  const showSource = Boolean(source && source !== title && sourceWithoutDate !== title);
  const grounding = isReferenceData(refItem) ? referenceTag(refItem, t) : groundedTag(refItem, t);
  return (
    <div className={styles.evidenceCard}>
      <div className={styles.evidenceMeta}>{meta}</div>
      <div className={styles.evidenceBadges}>
        {refItem.resolutionStatus === 'resolved' && (
          <span title={t('sourceFoundTitle', 'Citation resolved to this source record.')}>
            <Tag type="blue" size="sm">
              {t('sourceFound', 'Source found')}
            </Tag>
          </span>
        )}
        {refItem.resolutionStatus === 'unresolved' && (
          <span title={t('sourceMissingTitle', 'Citation did not resolve to a source record.')}>
            <Tag type="red" size="sm">
              {t('sourceMissing', 'Source missing')}
            </Tag>
          </span>
        )}
        {grounding && (
          <span title={grounding.title}>
            <Tag type={grounding.type} size="sm">
              {grounding.text}
            </Tag>
          </span>
        )}
      </div>
      {url ? (
        <a className={styles.evidenceLink} href={url} onClick={(e) => handleReferenceNavigate(e, url, refItem)}>
          {title}
        </a>
      ) : (
        <div className={styles.evidenceTitleText}>{title}</div>
      )}
      {showSource && <div className={styles.evidenceSource}>{source}</div>}
      {refItem.source && (
        <div className={styles.evidenceUuid}>
          {t('sourceDataset', 'Source')}: {refItem.source}
        </div>
      )}
      {(refItem.withheldInteractions ?? 0) > 0 && (
        <div className={styles.evidenceUuid}>
          {t(
            'sourceSubset',
            'This source shows a relevant subset; {{count}} additional interactions are not shown.',
          ).replace('{{count}}', String(refItem.withheldInteractions))}
        </div>
      )}
      {refItem.resourceUuid && (
        <div className={styles.evidenceUuid}>
          {t('sourceUuid', 'UUID')}: {refItem.resourceUuid}
        </div>
      )}
      {refItem.usage && refItem.usage.length > 0 && (
        <div className={styles.evidenceUuid}>
          {t('usedIn', 'Used in')}: {[...new Set(refItem.usage.map((item) => item.location))].join(', ')}
        </div>
      )}
    </div>
  );
};

/** Solid confidence pill matching the validate dashboard's chip (label + color per level). */
const CONF: Record<string, [string, string]> = {
  green: ['High confidence', '#196c2e'],
  yellow: ['Medium confidence', '#9e6a03'],
  red: ['Low confidence', '#8b1a1a'],
};

const IN_DEPTH_RE = /\*\*In ?Depth\*\*/i;

/**
 * Split the hub's combined answer body (`**Answer**` … `**In Depth**` …) into its two
 * sections, stripping the redundant markdown header from each — the confidence chip is the
 * section heading now. If there's no In-Depth marker, the whole body is the Answer section.
 */
function splitSections(answer: string): { answerBody: string; inDepthBody: string | null } {
  const stripAnswerHeader = (s: string) => s.replace(/^\s*\*\*Answer\*\*\s*/i, '').trim();
  const m = answer.match(IN_DEPTH_RE);
  if (!m || m.index === undefined) {
    return { answerBody: stripAnswerHeader(answer), inDepthBody: null };
  }
  return {
    answerBody: stripAnswerHeader(answer.slice(0, m.index)),
    inDepthBody:
      answer
        .slice(m.index + m[0].length)
        .replace(/^\s*/, '')
        .trim() || null,
  };
}

const ConfidenceChip: React.FC<{ level: string }> = ({ level }) => {
  const [label, color] = CONF[level] ?? ['Unrated', '#30363d'];
  return (
    <span className={styles.cchip} style={{ background: color }}>
      {label}
    </span>
  );
};

const validationLabelFallback: Record<string, string> = {
  checking: 'Checking answer',
  checked: 'Checked',
  edited: 'Updated after check',
  needs_review: 'Needs review',
  unavailable: 'Check unavailable',
};

const inDepthValidation = (validation: AiInDepth['validation']): AiAnswerValidation | undefined => {
  const status = validation?.status;
  if (!status || !validationLabelFallback[status]) {
    return undefined;
  }
  return {
    status,
    label: validationLabelFallback[status],
    summary: typeof validation.summary === 'string' ? validation.summary : undefined,
  };
};

const AnswerValidationBadge: React.FC<{ validation: AiAnswerValidation }> = ({ validation }) => {
  const className = styles[`answerValidation_${validation.status}`] ?? styles.answerValidation_unavailable;
  return (
    <span className={`${styles.answerValidation} ${className}`}>
      {validation.label || validationLabelFallback[validation.status] || 'Check unavailable'}
    </span>
  );
};

const AnswerValidationSummary: React.FC<{ validation?: AiAnswerValidation }> = ({ validation }) => {
  const { t } = useTranslation();
  const summary = validation?.summary?.trim();
  const status = validation?.status;
  if (!summary || !status) {
    return null;
  }
  const className = styles[`answerValidationSummary_${status}`] ?? styles.answerValidationSummary_unavailable;
  const heading =
    status === 'edited'
      ? t('answerCheckChanges', 'What changed')
      : status === 'needs_review'
        ? t('answerCheckReviewReason', 'Why review is needed')
        : status === 'checking' || status === 'unavailable'
          ? t('answerCheckStatus', 'Check status')
          : t('answerCheckSummary', 'Check summary');
  return (
    <div
      className={`${styles.answerValidationSummary} ${className}`}
      data-testid="answer-validation-summary"
      role="note"
    >
      <div className={styles.answerValidationSummaryHeading}>{heading}</div>
      <div className={styles.answerValidationSummaryBody}>{summary}</div>
    </div>
  );
};

/** One answer section. A low-confidence flag adds a prominent warning but never hides reviewable output. */
const ConfidenceSection: React.FC<{
  label: string;
  body: string;
  section?: AiConfidenceSection;
  answerValidation?: AiAnswerValidation;
  references: AiReference[];
  patientUuid: string;
}> = ({ label, body, section, answerValidation, references, patientUuid }) => {
  const { t } = useTranslation();
  if (!body) {
    return null;
  }
  const level = section?.level ?? 'green';
  const note = section?.note ?? '';
  const rendered = <MarkdownAnswer answer={body} references={references} patientUuid={patientUuid} />;
  const originalAnswer = answerValidation?.originalAnswer?.trim();
  const originalReferences = answerValidation?.originalReferences ?? [];
  const originalBlocks = answerValidation?.originalBlocks ?? [];
  const hasOriginalReferenceArtifact = answerValidation?.originalReferences !== undefined;
  const showOriginalAnswer = Boolean(
    originalAnswer && (originalAnswer !== body.trim() || originalBlocks.length > 0 || hasOriginalReferenceArtifact),
  );
  const originalWasEdited = answerValidation?.status === 'edited';
  return (
    <div className={styles.csec} data-testid={`section-${label.replace(/\s+/g, '-').toLowerCase()}`}>
      <div className={styles.ctitle}>
        {label} {answerValidation && <AnswerValidationBadge validation={answerValidation} />}{' '}
        {section && <ConfidenceChip level={level} />}
      </div>
      <AnswerValidationSummary validation={answerValidation} />
      {level === 'red' ? (
        <>
          {note && <div className={`${styles.caveat} ${styles.caveatRed}`}>{note}</div>}
          <div className={styles.ans}>{rendered}</div>
        </>
      ) : level === 'yellow' ? (
        <>
          <div className={styles.ans}>{rendered}</div>
          {note && (
            <details className={styles.collapse}>
              <summary>{t('showReviewNote', 'Show review note')}</summary>
              <div className={`${styles.caveat} ${styles.caveatYellow}`}>{note}</div>
            </details>
          )}
        </>
      ) : (
        <div className={styles.ans}>{rendered}</div>
      )}
      {showOriginalAnswer && (
        <details open className={`${styles.reviewDraft} ${originalWasEdited ? styles.reviewDraftEdited : ''}`.trim()}>
          <summary>{t('originalModelAnswer', 'Original model answer')}</summary>
          <div
            className={`${styles.reviewDraftNotice} ${
              originalWasEdited ? styles.reviewDraftNoticeEdited : styles.reviewDraftNoticeRejected
            }`}
          >
            {originalWasEdited
              ? t(
                  'originalModelAnswerNotice',
                  'This answer or its supporting citations was changed by the answer check. The checked answer above is the current result.',
                )
              : t(
                  'originalModelAnswerNeedsReviewNotice',
                  'This was the model output before checking. The current answer above remains flagged for review.',
                )}
          </div>
          <div className={styles.reviewDraftBody}>
            <MarkdownAnswer answer={originalAnswer ?? ''} references={originalReferences} patientUuid={patientUuid} />
            {originalBlocks.map((block, idx) =>
              block.kind === 'table' ? (
                <AiTableBlockView
                  key={`original-block-${idx}`}
                  block={block}
                  references={originalReferences}
                  patientUuid={patientUuid}
                />
              ) : null,
            )}
          </div>
        </details>
      )}
    </div>
  );
};

const InDepthReviewDraft: React.FC<{
  draft?: string;
  references?: AiReference[];
  patientUuid: string;
}> = ({ draft, references, patientUuid }) => {
  const { t } = useTranslation();
  if (!draft?.trim()) {
    return null;
  }
  return (
    <details className={styles.reviewDraft}>
      <summary>{t('removedInDepthClaims', 'Removed In-Depth claims')}</summary>
      <div className={`${styles.reviewDraftNotice} ${styles.reviewDraftNoticeRejected}`}>
        {t(
          'removedInDepthClaimsNotice',
          'These model-generated claims were removed or withheld by checks. They are shown only for manual review and are not part of the final clinical response.',
        )}
      </div>
      <div className={styles.reviewDraftBody}>
        <MarkdownAnswer answer={draft} references={references ?? []} patientUuid={patientUuid} />
      </div>
    </details>
  );
};
const AiResponsePanel: React.FC<AiResponsePanelProps> = ({
  answer,
  reasoning,
  references,
  safetyWarnings,
  safetyStatus,
  safetyCheck,
  blocks,
  auditLogId,
  misattributedOrderCitations,
  unstatedFindingSeverities,
  conditionRuleCoverage,
  interactionPairs,
  activeOrderClaims,
  error,
  phase,
  patientUuid,
  resolvedModel,
  confidence,
  answerValidation,
  inDepth,
  onFeedbackComplete,
}) => {
  const { t } = useTranslation();
  // Upstream's citation rendering keys off a loading flag; in the phase model the answer is
  // still arriving while the turn awaits its answer.
  const isLoading = isAwaitingAnswer(phase);

  // Array.isArray, not `?? []`: a non-iterable value here would throw inside this memo, and a
  // string would iterate its characters and silently match nothing.
  const misattributed = useMemo(
    () => new Set(Array.isArray(misattributedOrderCitations) ? misattributedOrderCitations : []),
    [misattributedOrderCitations],
  );

  const severities = useMemo(
    () => resolveFindingSeverities(answer, references, safetyWarnings ?? [], unstatedFindingSeverities),
    [answer, references, safetyWarnings, unstatedFindingSeverities],
  );

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(stripCitations(answer));
  }, [answer]);

  // The bounded-ness of the interaction screen, in this panel's own phrasing rather than the
  // backend's suggested "N of M shown" (see the count-of-one note below). Rendered wherever the
  // measurement is sane — not "whenever it exists": a half-stated or nonsensical pair is
  // refused below, and nothing renders while the answer is still streaming.
  //
  // The count tells a TRUNCATED list from an untruncated one. It does not tell a complete
  // answer from an incomplete one, and must not be worded as if it did: `found === reported`
  // says only that THIS check withheld nothing, which the wire-type doc states outright and
  // which the count-of-one note below turns on.
  //
  // What is dropped is the LOWEST-RATED FIRST — an order, not a
  // description of what ends up withheld, and the backend records its own counter-example in
  // the same sentence: a 16-drug question shows 10 of 72 pairs and withholds
  // `[Major x13, Moderate x40, Minor x9]`. So this must not say the withheld ones were mild.
  //
  // Not derived from the number of chips: this counts drug PAIRS, and the chip list also
  // carries contraindication and class findings that were never pairs.
  const pairsSentence = useMemo(() => {
    const found = interactionPairs?.found;
    const reported = interactionPairs?.reported;
    // Both halves must be sane, not just present. A payload carrying only one would render
    // "Interaction pairs shown: undefined of 5.", and `reported > found` would render
    // "8 of 5" while leaving `bounded` false so nothing contradicted it — silent nonsense in
    // both cases. The backend contract is non-negative integers with reported <= found.
    if (typeof found !== 'number' || typeof reported !== 'number') return null;
    if (!Number.isInteger(found) || !Number.isInteger(reported)) return null;
    if (found < 0 || reported < 0 || reported > found) return null;

    // `found: 0` is MEANT as a real measurement — a check that ran and related no pairs —
    // though the backend notes it is not always that (a chart whose only medication the
    // reference data cannot resolve was never a population to screen). Either way it is a
    // statement about the check that reported it and NOT about the findings listed beside it,
    // which may come from another check entirely. "Interaction pairs shown: 0 of 0." above a Major
    // interaction chip reads as "no interactions found", so that cell gets its own sentence.
    if (found === 0) {
      return {
        bounded: false,
        text: t('interactionPairsNone', 'The interaction screen that reported here related no drug pairs.'),
      };
    }
    return {
      bounded: reported < found,
      // The plural noun is DETACHED from the count, so agreement never arises (NOT "the number
      // leads" — it does not; the noun phrase does): "1 of 1 drug pairs shown"
      // is ungrammatical, and `found: 1` is observed live. Number-agnostic beats a plural rule
      // here — i18next plurals would split this into per-language keys for one clause.
      text: t('interactionPairsShown', 'Interaction pairs shown: {{reported}} of {{found}}.', {
        reported,
        found,
      }),
    };
  }, [interactionPairs, t]);

  const coverageSentence = useMemo(
    () => COVERAGE_SENTENCE[conditionRuleCoverage as ConditionRuleCoverage]?.(t) ?? null,
    [conditionRuleCoverage, t],
  );

  /**
   * What the answer's claims about her active orders offered as evidence.
   *
   * Rendered because it is what makes the struck-through markers above readable. The backend is
   * explicit that `misattributedOrderCitations: []` is two different responses a client cannot
   * tell apart — every active-order claim cited a chart record and none was rejected, or NO claim
   * cited a chart record at all — and that both have been recorded on one patient and one
   * question. Drawing the first four fields without this one left that ambiguity on the screen.
   *
   * `bounded` is the uncited case, so it takes the same amber treatment as a withheld pair count.
   * The zero-uncited sentence deliberately says a record was OFFERED and stops there: whether the
   * record was the right one is the neighbouring check's business, and the backend says that check
   * cannot certify it either. Nothing renders when the answer made no such claim (`stated: 0`) or
   * when no measurement was stated (`null`) — a count of zero claims is not a limit, and a null is
   * not a completeness claim.
   */
  const orderClaimsSentence = useMemo(() => {
    // typeof on both, not a truthy check: a non-numeric value here would reach `toLocaleString`
    // inside this memo and take the whole panel down, and `0` is a meaningful value for each.
    if (typeof activeOrderClaims?.stated !== 'number' || typeof activeOrderClaims?.uncited !== 'number') return null;
    const { stated, uncited } = activeOrderClaims;
    if (stated <= 0) return null;
    if (uncited <= 0) {
      // Withheld while the neighbouring check has REJECTED a citation in this same answer.
      // `uncited: 0` is a true statement about the markers, and the sibling test is right that it
      // stops there — but it leads a block headed "What the safety checks covered", and under that
      // heading, beside markers rendered `Not the order named`, it reads as a statement about the
      // records. Silence is the choice `misattributedOrderCitations: []` already makes one field
      // over: no certificate.
      //
      // `Array.isArray` and a length test, not truthiness, for the reason the two `typeof` guards
      // above exist. `null` is NO measurement — absent evidence of a rejection is not a rejection,
      // and suppressing on it would silence the sentence on every deployment that does not state
      // the field. `[]` is a measurement of none and leaves the affirmation standing.
      if (Array.isArray(misattributedOrderCitations) && misattributedOrderCitations.length > 0) return null;
      return {
        bounded: false,
        text: t('activeOrderClaimsAllCited', 'Every statement about her active orders cites a chart record.'),
      };
    }
    return {
      bounded: true,
      text: t(
        'activeOrderClaimsUncited',
        'Statements about her active orders citing no chart record: {{uncited}} of {{stated}}.',
        { uncited, stated },
      ),
    };
  }, [activeOrderClaims, misattributedOrderCitations, t]);

  /**
   * Whether this answer carries any drug-safety output at all — a warning, a stated pair
   * extent, or a cited reference record. Named for what it measures rather than for "a screen
   * ran", which is more than any of the three establish. (It said "these two fields" until the
   * third disjunct landed with its own test and the summary was left behind.)
   *
   * `conditionRuleCoverage` describes the loaded DATASET, and the backend states it on every
   * answer — deliberately ungated, so it answers even where nothing was screened — with
   * `absent` being the verdict the shipped knowledge base yields. So rendering the coverage
   * note unconditionally puts "conditions were not screened" under every answer on every
   * install, including questions that never asked for a contraindication screen, where it
   * implies a screen was attempted and fell short. Measured on this server: "What is her blood
   * pressure trend?" comes back `absent` with no warnings and no pair measurement.
   *
   * A pair extent counts on its own: it is stated by a check that RAN, whatever it related, so
   * it is safety output even where that check raised no chip. And be clear what this gate is: a
   * DEPARTURE from the backend's "Render it.", not an application of it. That sentence is said of
   * `absent` unconditionally, and reinforced with "a statement about what the module did must not
   * depend on the wording of a generated answer" — which is exactly what gating on the answer's
   * own output does. The departure is taken because an ungated note puts "conditions were not
   * screened" under every answer on every install, and its cost is stated with it: an answer with
   * no chip, no pair extent and no cited reference record says nothing about condition screening,
   * and `unloaded` becomes unreachable entirely.
   *
   * A cited reference record counts too,
   * which is what reaches the one answer type this note is most load-bearing for: a prescribing
   * question against a chart with conditions and no active orders runs the contraindication
   * screen, raises no chip and states no pair extent, and the backend says of exactly that case
   * "Render it. That is what the key is for — a screen that cannot ask reads exactly like one
   * that asked and found nothing." Measured: the blood-pressure answer that motivated this gate
   * cites 22 records and not one is reference-group, so widening it this far does not reopen the
   * case it was added for.
   */
  const hasSafetyOutput =
    (safetyWarnings?.length ?? 0) > 0 || pairsSentence !== null || references.some(isReferenceData);
  const coverageNote = hasSafetyOutput ? coverageSentence : null;

  // While the answer is still streaming its citations are not annotated at all (see
  // `renderedAnswer`), so a limits block here would describe annotations the reader cannot see.
  // It also keeps a measurement off a message the hook never completed: closing the panel
  // mid-stream leaves `isLoading` true forever — the panel is gone, so nothing re-renders it,
  // but the message stays in the store and comes back on reopen. (Not because a trailing
  // `grounded` lands on it: the unmount effect aborts the stream unconditionally, so it cannot.)
  const showLimits = !isLoading && (pairsSentence !== null || coverageNote !== null || orderClaimsSentence !== null);

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

  // Older combined responses split after completion. Product-profile responses split as soon
  // as the direct answer is complete, while the In-Depth section remains pending.
  const showSections =
    Boolean(answer) && (Boolean(inDepth) || Boolean(answerValidation) || (isTerminal(phase) && Boolean(confidence)));
  const sections = showSections ? splitSections(answer) : null;
  const evidence = references.filter(
    (ref) =>
      Boolean((ref.title ?? '').trim()) ||
      Boolean((ref.sourceText ?? '').trim()) ||
      ref.resolutionStatus === 'unresolved',
  );
  const shownEvidence = evidence.slice(0, 5);
  const overflowEvidence = evidence.slice(5);

  return (
    // data-turn-phase exposes the whole turn's lifecycle to the DOM so behavior is observable
    // (cheap verification / e2e) rather than inferred from timing.
    <div className={styles.responseContainer} data-turn-phase={phase}>
      {answer && !showSections && (
        <div className={styles.answerSection}>
          {phase === 'answering' ? (
            <>
              {reasoning && (
                <p className={styles.reasoningText} data-testid="ai-response-reasoning">
                  {reasoning}
                </p>
              )}
              <p className={styles.answerText}>{answer}</p>
            </>
          ) : (
            <MarkdownAnswer
              answer={answer}
              references={references}
              patientUuid={patientUuid}
              decorations={{ misattributed, severities }}
            />
          )}
          {phase === 'answering' && <InlineLoading className={styles.streamingIndicator} />}
        </div>
      )}
      {sections && (
        <div className={styles.answerSection}>
          <ConfidenceSection
            label="Answer"
            body={sections.answerBody}
            section={confidence?.answer}
            answerValidation={answerValidation}
            references={references}
            patientUuid={patientUuid}
          />
          {/* Wrapper exposes the staged in-depth status to the DOM (pending | complete | failed |
              needs_review) so
              it is observable — the three inner renderings otherwise share one testid and can't be
              told apart. display:contents keeps layout identical. */}
          {inDepth && (
            <div style={{ display: 'contents' }} data-indepth-status={inDepth.status}>
              {inDepth.status === 'pending' && (
                <div className={styles.csec} data-testid="section-in-depth">
                  <div className={styles.ctitle}>In Depth</div>
                  {inDepth.answer ? (
                    <div className={styles.ans}>
                      <MarkdownAnswer answer={inDepth.answer} references={references} patientUuid={patientUuid} />
                    </div>
                  ) : (
                    <InlineLoading className={styles.streamingIndicator} description="Preparing in-depth..." />
                  )}
                </div>
              )}
              {(inDepth.status === 'failed' || inDepth.status === 'needs_review') && (
                <div className={styles.csec} data-testid="section-in-depth">
                  <div className={styles.ctitle}>
                    In Depth{' '}
                    {inDepth.status === 'needs_review' && (
                      <span className={`${styles.answerValidation} ${styles.answerValidation_needs_review}`}>
                        {t('inDepthNeedsReview', 'Needs review')}
                      </span>
                    )}
                  </div>
                  {inDepth.status === 'needs_review' && (
                    <AnswerValidationSummary validation={inDepthValidation(inDepth.validation)} />
                  )}
                  <div
                    className={`${styles.caveat} ${
                      inDepth.status === 'needs_review' ? styles.caveatRed : styles.caveatYellow
                    }`}
                  >
                    {inDepth.error ??
                      (inDepth.status === 'needs_review'
                        ? t(
                            'inDepthWithheld',
                            'In-Depth was withheld because its claims did not pass the chart and temporal checks.',
                          )
                        : t('inDepthFailed', 'In-Depth could not be completed.'))}
                  </div>
                  <InDepthReviewDraft
                    draft={inDepth.reviewDraft}
                    references={inDepth.reviewReferences}
                    patientUuid={patientUuid}
                  />
                </div>
              )}
              {inDepth.status === 'complete' && inDepth.answer && (
                <>
                  <ConfidenceSection
                    label="In Depth"
                    body={inDepth.answer}
                    section={confidence?.in_depth}
                    answerValidation={inDepthValidation(inDepth.validation)}
                    references={references}
                    patientUuid={patientUuid}
                  />
                  <InDepthReviewDraft
                    draft={inDepth.reviewDraft}
                    references={inDepth.reviewReferences}
                    patientUuid={patientUuid}
                  />
                </>
              )}
            </div>
          )}
          {!inDepth && sections.inDepthBody && (
            <ConfidenceSection
              label="In Depth"
              body={sections.inDepthBody}
              section={confidence?.in_depth}
              references={references}
              patientUuid={patientUuid}
            />
          )}
        </div>
      )}

      {(isTerminal(phase) || Boolean(inDepth)) &&
        blocks?.map((block, idx) =>
          block.kind === 'table' ? (
            <AiTableBlockView key={`block-${idx}`} block={block} references={references} patientUuid={patientUuid} />
          ) : null,
        )}

      {error && answer && (
        <div className={styles.errorContainer} role="alert">
          <p className={styles.errorText}>
            {t('streamInterrupted', 'Response interrupted:')} {displayError}
          </p>
        </div>
      )}

      {references.length > 0 && (
        <details className={styles.referencesSection}>
          <summary className={styles.referencesLabel}>{t('citationDetails', 'Citation details')}</summary>
          <div className={styles.referencesList}>
            {references.map((ref) => {
              if ((ref.sourceText ?? '').trim()) {
                const diagnostics = [`[${ref.index}]`, ref.sourceId, ref.resolutionStatus, ref.groundingStatus]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <code key={ref.index} className={styles.referenceTagInert}>
                    {diagnostics}
                  </code>
                );
              }
              const isMisattributed = misattributed.has(ref.index);
              const url = buildReferenceUrl(ref, patientUuid, isMisattributed);
              const referenceData = isReferenceData(ref);
              const typeLabel = referenceData ? referenceLabel(ref, t) : ref.resourceType;
              // Only append the date when there is one — an allergy and a safety finding carry
              // none, and "— null" was reaching the screen.
              const label = `[${ref.index}] ${typeLabel}${ref.date ? ` — ${ref.date}` : ''}`;
              const g = referenceData ? referenceTag(ref, t) : groundedTag(ref, t);
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
                  {/* This citation IS the chart record the cited safety finding fired on — the
                      recorded allergy or condition whose match raised it — so the answer's prose
                      carries no [N] marker for it. (Not "attached from the finding": the finding
                      fires on the record, and the wording said it the other way round until the
                      README's own sentence was read against it.) Saying so is the only way a
                      clinician can tell why the number appears nowhere above, and the chip is the
                      only place it appears at all. */}
                  {ref.attachedByTheModule === true && (
                    <span
                      className={styles.attachedTag}
                      title={t(
                        'attachedByTheModuleTitle',
                        'The module supplied this citation — it is the chart record the cited safety finding fired on, so the answer’s text carries no marker for it. Opening it goes to the record.',
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
        </details>
      )}

      {evidence.length > 0 && (
        <div className={styles.evidenceSection}>
          <div className={styles.evidenceSectionTitle}>{t('evidenceUsed', 'Evidence Used')}</div>
          <div className={styles.evidenceGrid}>
            {shownEvidence.map((ref) => (
              <EvidenceCard key={`evidence-${ref.index}`} refItem={ref} patientUuid={patientUuid} t={t} />
            ))}
          </div>
          {overflowEvidence.length > 0 && (
            <details className={styles.evidenceMore}>
              <summary>{t('showAllEvidence', 'show all evidence')}</summary>
              <div className={styles.evidenceGrid}>
                {overflowEvidence.map((ref) => (
                  <EvidenceCard key={`evidence-more-${ref.index}`} refItem={ref} patientUuid={patientUuid} t={t} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {(() => {
        const effectiveStatus = safetyCheck?.status ?? safetyStatus;
        const statusTag = effectiveStatus ? safetyStatusTag(effectiveStatus, t) : null;
        const hasWarnings = Boolean(safetyWarnings && safetyWarnings.length > 0);
        const issues = Array.from(new Set(safetyCheck?.issues ?? [])).map((issue) => safetyIssueText(issue, t));
        const medicationPackage = safetyCheck?.package;
        const relationshipPackage = medicationPackage?.cross_reactivity;
        const sourceRows = [
          {
            label: t('safetyMedicationRulesSource', 'Medication rules'),
            source: medicationPackage,
          },
          {
            label: t('safetyCrossReactivityRulesSource', 'Cross-reactivity rules'),
            source: relationshipPackage,
          },
        ].filter(({ source }) => Boolean(source?.id?.trim()));
        const hasSafetyDetails = issues.length > 0 || sourceRows.length > 0;
        if (effectiveStatus === 'checked' && !hasWarnings && !hasSafetyDetails) {
          return null;
        }
        if (!statusTag && !hasWarnings && !hasSafetyDetails) {
          return null;
        }
        return (
          // No live-region role: the panel already sits inside the chat history's
          // role="log" aria-live="polite", which announces this content in order. An
          // assertive role="alert" here would preempt the answer it annotates.
          <div
            className={`${styles.safetyWarningsSection} ${
              hasWarnings
                ? styles.safetyWarnings_flagged
                : effectiveStatus === 'checked'
                  ? styles.safetyWarnings_checked
                  : effectiveStatus === 'limited'
                    ? styles.safetyWarnings_limited
                    : styles.safetyWarnings_unavailable
            }`}
            data-testid="ai-response-safety"
            role="note"
          >
            <span className={styles.safetyWarningsLabel}>{t('safetyChecks', 'Answer safety check')}:</span>
            <div className={styles.safetyWarningsList}>
              {statusTag && (
                <span className={styles.safetyWarningItem}>
                  <Tag type={statusTag.tagType} size="sm" className={styles.safetyWarningBadge}>
                    {statusTag.label}
                  </Tag>
                </span>
              )}
              {safetyWarnings?.map((warning, i) => {
                const { tagType, label } = safetyWarningTag(warning.type, t);
                const detail = warning.detail.trim();
                const drug = warning.drug.trim();
                const warningText =
                  drug && !detail.toLocaleLowerCase().startsWith(drug.toLocaleLowerCase())
                    ? `${drug}: ${detail}`
                    : detail;
                return (
                  <span key={`${warning.type}-${warning.drug}-${i}`} className={styles.safetyWarningItem}>
                    <Tag type={tagType} size="sm" className={styles.safetyWarningBadge}>
                      {label}
                    </Tag>
                    <span className={styles.safetyWarningText}>{warningText}</span>
                  </span>
                );
              })}
            </div>
            {hasSafetyDetails && (
              <div className={styles.safetyCheckSummary} data-testid="safety-check-summary">
                <div className={styles.safetyCheckSummaryHeading}>
                  {t('safetyCheckDetails', 'Medication safety details')}
                </div>
                {issues.length > 0 && (
                  <ul className={styles.safetyCheckIssueList}>
                    {issues.map((issue, index) => (
                      <li key={`${issue}-${index}`}>{issue}</li>
                    ))}
                  </ul>
                )}
                {sourceRows.length > 0 && (
                  <dl className={styles.safetyCheckSources}>
                    {sourceRows.map(({ label, source }) => {
                      const sourceId = source?.id?.trim();
                      const sourceVersion = source?.version?.trim();
                      const reviewState = source?.review_state?.trim();
                      const provenance = safetyPackageProvenance(source);
                      return (
                        <div className={styles.safetyCheckSourceRow} key={label}>
                          <dt>{label}</dt>
                          <dd>
                            {sourceId}
                            {sourceVersion ? ` (${sourceVersion})` : ''}
                            {reviewState ? ` - ${reviewState.replaceAll('_', ' ')}` : ''}
                            {provenance && (
                              <span className={styles.safetyCheckProvenance}>
                                {t('safetyRulesSource', 'Source')}: {provenance}
                              </span>
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* What the safety screen did and did not cover. Deliberately neutral rather than a
          caution: an arm the loaded dataset cannot run is a limit of the dataset, not a finding
          about this patient, and styling it as a warning would read as the latter. */}
      {showLimits && (
        <div className={styles.limitsSection}>
          <span className={styles.limitsLabel}>{t('checkCoverage', 'What the safety checks covered')}</span>
          <ul className={styles.limitsList}>
            {orderClaimsSentence && (
              <li className={orderClaimsSentence.bounded ? styles.limitItemBounded : styles.limitItem}>
                <Information size={16} className={styles.limitIcon} />
                <span>
                  {orderClaimsSentence.text}
                  {orderClaimsSentence.bounded &&
                    ` ${t('activeOrderClaimsUncitedWhy', 'A statement with no chart record behind it cannot be checked against the chart at all.')}`}
                </span>
              </li>
            )}
            {pairsSentence && (
              <li className={pairsSentence.bounded ? styles.limitItemBounded : styles.limitItem}>
                <Information size={16} className={styles.limitIcon} />
                <span>
                  {pairsSentence.text}
                  {pairsSentence.bounded &&
                    ` ${t('interactionPairsWithheld', 'Withheld pairs were dropped lowest-rated first — where many were found, severe pairs can be among them.')}`}
                </span>
              </li>
            )}
            {coverageNote && (
              <li className={styles.limitItem}>
                <Information size={16} className={styles.limitIcon} />
                <span>{coverageNote}</span>
              </li>
            )}
          </ul>
        </div>
      )}

      {answer && isTerminal(phase) && (
        <div className={styles.actionsRow}>
          <div className={styles.actionsLeft}>
            {auditLogId ? (
              <AiFeedback key={auditLogId} auditLogId={auditLogId} onComplete={onFeedbackComplete} />
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
