import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, InlineLoading, Tag } from '@carbon/react';
import { Copy } from '@carbon/react/icons';
import { formatDate, navigate, parseDate } from '@openmrs/esm-framework';
import {
  type AiReference,
  type AiSafetyWarning,
  RESPONSE_PARSE_ERROR_CODE,
  SESSION_EXPIRED_ERROR_CODE,
  STREAM_INCOMPLETE_ERROR_CODE,
  STREAMING_UNSUPPORTED_ERROR_CODE,
  UNEXPECTED_RESPONSE_ERROR_CODE,
  UNKNOWN_ERROR_CODE,
} from '../api/chartsearchai';
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

/**
 * Backend `resourceType` → O3 chart dashboard path.
 *
 * <p>Values must be paths actually registered by `openmrs-esm-patient-chart`; `chart-review`
 * resolves an unregistered path by redirecting to the default dashboard, so a wrong value here
 * silently lands the clinician on Patient Summary and then `highlightReference` scans that page
 * for a row it cannot contain until it times out. Registered paths at time of writing: Patient
 * Summary, Visits, Encounters, Allergies, Conditions, Programs, Medications, Test Results,
 * Vitals &amp; Biometrics, Immunizations, Attachments, Appointments.
 *
 * <p>Keys are drawn from the types querystore serializes, but the map is deliberately NOT
 * exhaustive over them — it lists only those with a dashboard worth opening. Note the order
 * sub-types are distinct (`drug_order`, `test_order`, `referral_order`); a bare `order` is never
 * sent, so it is absent rather than mapped to a guess, and there is no `Orders` dashboard to map it
 * to in any case.
 *
 * <p>Unlisted types fall back to Patient Summary. That is the right answer, not a gap, for the two
 * that reach it in practice: `patient` (demographics live there) and `referral_order` (O3 registers
 * no referrals dashboard). Adding a key that names a non-existent dashboard would be strictly
 * worse — chart-review would redirect to Patient Summary anyway, but `highlightReference` would
 * then hunt for the row on the wrong page until it times out.
 */
const RESOURCE_TYPE_TO_CHART_PAGE: Record<string, string> = {
  obs: 'Test Results',
  drug_order: 'Medications',
  test_order: 'Test Results',
  allergy: 'Allergies',
  condition: 'Conditions',
  diagnosis: 'Visits',
  visit: 'Visits',
  encounter: 'Encounters',
  program: 'Programs',
  medication_dispense: 'Medications',
};

/**
 * Whether a citation is module-supplied reference material rather than evidence from this
 * patient's chart. Prefers the backend's `group` discriminator, which owns the classification and
 * so covers any future kind of injected record; the `resourceType` check remains as a fallback for
 * an older backend that does not send `group` at all.
 *
 * Deliberately treats EITHER signal as sufficient. Getting this wrong in the reference→chart
 * direction is the harmful one: `buildReferenceUrl` would hand back a real chart URL and
 * `highlightReference` would be called with a knowledge-base id, so knowledge-base prose would be
 * presented to a clinician as a navigable record of their patient's. Erring the other way only
 * costs a citation its navigation.
 */
function isReferenceMaterial(ref: AiReference): boolean {
  return ref.group === 'reference' || isDrugReference(ref);
}

/**
 * Narrower than {@link isReferenceMaterial}: specifically a drug knowledge-base entry, which is
 * the only reference kind we have wording for. Used to decide the chip's label, never to decide
 * whether a citation navigates — that must stay keyed off the broader predicate.
 */
function isDrugReference(ref: AiReference): boolean {
  return ref.resourceType.toLowerCase() === RESOURCE_TYPE_DRUG_REFERENCE;
}

function buildReferenceUrl(ref: AiReference, patientUuid: string): string | null {
  if (!patientUuid || isReferenceMaterial(ref)) {
    // Reference material is not a record about this patient and has no chart tab to open —
    // it does not navigate (a detail side panel is a follow-up).
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

/**
 * Human wording for a backend `resourceType`. The wire values are lower_snake tokens
 * (`medication_dispense`, `drug_order`) and were previously rendered verbatim, so clinicians read
 * the transport format in every locale. Keys are string literals because the i18next parser only
 * extracts static keys — a lookup table of `t(variable)` would silently drop them from en.json.
 *
 * An unrecognised type falls back to the raw token: wrong-looking is recoverable, whereas inventing
 * a friendly name for a type we do not know the semantics of is not.
 */
function resourceTypeLabel(resourceType: string, t: Translate): string {
  switch (resourceType.toLowerCase()) {
    case 'obs':
      return t('resourceTypeObs', 'Observation');
    case 'condition':
      return t('resourceTypeCondition', 'Condition');
    case 'diagnosis':
      return t('resourceTypeDiagnosis', 'Diagnosis');
    case 'allergy':
      return t('resourceTypeAllergy', 'Allergy');
    case 'drug_order':
      return t('resourceTypeDrugOrder', 'Medication');
    case 'test_order':
      return t('resourceTypeTestOrder', 'Test order');
    case 'referral_order':
      return t('resourceTypeReferralOrder', 'Referral');
    case 'program':
      return t('resourceTypeProgram', 'Program enrolment');
    case 'medication_dispense':
      return t('resourceTypeMedicationDispense', 'Medication dispensed');
    case 'visit':
      return t('resourceTypeVisit', 'Visit');
    case 'encounter':
      return t('resourceTypeEncounter', 'Encounter');
    case 'patient':
      return t('resourceTypePatient', 'Patient details');
    default:
      return resourceType;
  }
}

/**
 * The citation date in the user's locale and calendar, via the framework helpers rather than the
 * raw ISO string the backend sends. Returns null when there is no date to show, or when the value
 * will not parse — a citation is still useful without its date, so a bad value degrades to the
 * no-date label instead of throwing out of render.
 *
 * `noToday` because a provenance list wants a stable, explicit date: "Today" is ambiguous the next
 * morning and useless when copied into a note. Default `mode` renders `15-Jan-2025`, which also
 * avoids colliding with the em dash separating the label's own parts.
 */
function formattedCitationDate(date: string | null): string | null {
  if (!date) {
    return null;
  }
  try {
    const parsed = parseDate(date);
    return Number.isNaN(parsed.getTime()) ? null : formatDate(parsed, { time: false, noToday: true });
  } catch {
    return null;
  }
}

/**
 * Translated wording for an error code the API layer raised, or null when the string is not one of
 * our codes (a server or browser message, which the caller should show as-is). String-literal keys
 * so the extractor can find them.
 */
function localizedError(error: string, t: Translate): string | null {
  switch (error) {
    case SESSION_EXPIRED_ERROR_CODE:
      return t('sessionExpired', 'Your session has expired. Please log in again.');
    case STREAMING_UNSUPPORTED_ERROR_CODE:
      return t('streamingUnsupported', 'This browser cannot stream responses. Try a different browser.');
    case RESPONSE_PARSE_ERROR_CODE:
      return t('responseParseFailed', 'The response could not be read. Please try again.');
    case STREAM_INCOMPLETE_ERROR_CODE:
      return t('streamIncomplete', 'The response ended before it was complete. Please try again.');
    case UNEXPECTED_RESPONSE_ERROR_CODE:
      return t('unexpectedResponse', 'The server returned an unexpected response. Please try again.');
    case UNKNOWN_ERROR_CODE:
      return t('unknownError', 'Something went wrong. Please try again.');
    default:
      return null;
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
      const referenceMaterial = ref ? isReferenceMaterial(ref) : false;
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
            {citIndex}
            {ungrounded && (
              <>
                {/* aria-hidden: the glyph is decoration once the text below carries the meaning.
                    U+26A0 is commonly silent at default screen-reader verbosity, so on its own an
                    unsupported citation announced identically to a verified one. */}
                <span aria-hidden="true"> ⚠</span>
                <span className={styles.visuallyHidden}> {t('unsupportedCitationA11y', 'unsupported')}</span>
              </>
            )}
          </a>
        ) : referenceMaterial ? (
          // A reference citation can still carry a FALSE verdict (demote-only suppresses only TRUE),
          // and when it does the inline marker must say so — the chip list already does, and the
          // inline marker is the one embedded in the prose a clinician reads and copies.
          <span
            key={citKey}
            // Both classes when both are true: an unsupported verdict ADDS to the reference
            // treatment, it does not replace it. `.inlineCitationReference` carries `cursor: help`,
            // which is the only thing overriding `.inlineCitation`'s `cursor: pointer` — dropping
            // it makes a non-clickable span look navigable, the very confusion this branch exists
            // to avoid. `.inlineCitationUngrounded` only recolours, so the two compose.
            className={`${styles.inlineCitation} ${styles.inlineCitationReference}${
              ungrounded ? ` ${styles.inlineCitationUngrounded}` : ''
            }`}
            // And the wording keeps the provenance. The chart-record phrasing ("verify against the
            // chart") is unfollowable here: reference prose is by construction not in the chart.
            title={
              ungrounded
                ? t(
                    'referenceNotSupportedTitle',
                    'Clinical reference data — not this patient’s record, and it may not support this statement.',
                  )
                : drugReferenceTitle(t)
            }
          >
            {citIndex}
            {ungrounded && <span aria-hidden="true"> ⚠</span>}
            {/* Without this the marker is a bare number in the accessibility tree — identical to a
                chart-record citation and to an unresolvable one. The purple hue is the only other
                signal, and it is luminance-matched to the chart-record blue. */}
            <span className={styles.visuallyHidden}>
              {' '}
              {ungrounded
                ? t('referenceNotSupportedA11y', 'reference data, unsupported')
                : t('referenceDataA11y', 'reference data, not this patient’s record')}
            </span>
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

  // The API layer emits stable CODES for every error it authors itself, so the wording lives here
  // where the i18next parser can see it. Anything that is not one of those codes is a message from
  // the server or the browser — passed through untouched, because it is not ours to translate and
  // its detail is what makes it useful.
  const displayError = error ? (localizedError(error, t) ?? error) : error;

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
          {/* A real labelled list: a screen reader announces "References, list, 3 items" and can
              jump between them. Previously this was a div of spans, so the citations arrived as an
              unannounced run of links with no count and no indication of what they belonged to. */}
          <span className={styles.referencesLabel} id="chartsearchai-references-label">
            {t('references', 'References')}:
          </span>
          <ul className={styles.referencesList} aria-labelledby="chartsearchai-references-label">
            {references.map((ref) => {
              const url = buildReferenceUrl(ref, patientUuid);
              const referenceMaterial = isReferenceMaterial(ref);
              // "Drug reference" only when it really is one. `group: 'reference'` is broader than
              // drug references, so any other injected kind gets the generic label rather than a
              // provenance claim that is simply untrue.
              // The date is omitted when absent rather than interpolated: the backend sends
              // `date: null` for records whose only timestamp is administrative and deliberately
              // unrendered (an allergy — exactly what a drug-safety answer cites), and template
              // interpolation would put the literal text "null" in front of a clinician.
              // Composed rather than built from one interpolated key. Interpolation would let a
              // translator control the separator and word order (the `[N] type — date` run resolves
              // badly in RTL), but `t(key, fallback, values)` does NOT interpolate in this app's
              // i18n setup — it renders the fallback verbatim, i.e. a literal "{{index}}" on screen.
              // Shipping that would be far worse than the bidi ordering it fixes. Revisit once
              // interpolation is confirmed working at runtime, not just assumed.
              const citationDate = formattedCitationDate(ref.date);
              const label = referenceMaterial
                ? `[${ref.index}] ${isDrugReference(ref) ? t('drugReferenceLabel', 'Drug reference') : t('reference', 'Reference')}`
                : `[${ref.index}] ${resourceTypeLabel(ref.resourceType, t)}${citationDate ? ` — ${citationDate}` : ''}`;
              // Reference material normally shows a neutral "Reference" tag instead of a grounding
              // verdict — but a `false` verdict is not suppressed. Drug-reference citations are
              // demote-only, not exempt: grounding nulls a TRUE verdict for them and lets a FALSE
              // through precisely to flag an off-topic citation, so showing "Reference" over it
              // would hide the one verdict the backend went to the trouble of computing.
              const g = referenceMaterial && ref.grounded !== false ? referenceTag(t) : groundedTag(ref.grounded, t);
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
                <li key={ref.index} className={styles.referenceItem}>
                  {link}
                  {badge}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {safetyWarnings && safetyWarnings.length > 0 && (
        // No live-region role: the panel already sits inside the chat history's
        // role="log" aria-live="polite", which announces this content in order. An
        // assertive role="alert" here would preempt the answer it annotates.
        <div className={styles.safetyWarningsSection}>
          {/* Labelled list for the same reason as the references above: these are the clinically
              consequential rows, so a screen-reader user needs to know how many there are and that
              they are safety checks rather than more of the answer. */}
          <span className={styles.safetyWarningsLabel} id="chartsearchai-safety-label">
            {t('safetyChecks', 'Safety checks')}:
          </span>
          <ul className={styles.safetyWarningsList} aria-labelledby="chartsearchai-safety-label">
            {safetyWarnings.map((warning, i) => {
              const { tagType, label } = safetyWarningTag(warning.type, t);
              return (
                <li key={`${warning.type}-${warning.drug}-${i}`} className={styles.safetyWarningItem}>
                  <Tag type={tagType} size="sm" className={styles.safetyWarningBadge}>
                    {label}
                  </Tag>
                  <span className={styles.safetyWarningText}>
                    {warning.drug}: {warning.detail}
                  </span>
                </li>
              );
            })}
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
