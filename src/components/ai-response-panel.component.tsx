import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, InlineLoading, Tag } from '@carbon/react';
import { Copy } from '@carbon/react/icons';
import {
  type AiAnswerLimits,
  type AiReference,
  type AiSafetyWarning,
  SESSION_EXPIRED_ERROR_CODE,
} from '../api/chartsearchai';
import { compactChips } from '../utils/compact-chips';
import {
  citationStripPattern,
  isReferenceData,
  type ReferenceKind,
  referenceKind,
  resolveFindingSeverities,
} from '../utils/safety-disclosure';
import AiFeedback from './ai-feedback.component';
import MarkdownAnswer from './ai-markdown-answer.component';
import {
  buildReferenceUrl,
  handleReferenceNavigate,
  type Translate,
  notGroundedTitle,
  misattributedTitle,
  referenceTitle,
} from './citation-chip.component';
import styles from './ai-response-panel.scss';

/**
 * The answer-limit measurements come in as {@link AiAnswerLimits}, so their semantics are
 * stated once on the wire type rather than restated here. Two readings this panel implements
 * and must keep: an empty array renders NOTHING (the check named none, which is not a
 * certificate that the other citations are sound), and a null renders nothing either (no
 * measurement was stated, which is not a completeness claim).
 */
interface AiResponsePanelProps extends AiAnswerLimits {
  answer: string;
  references: AiReference[];
  safetyWarnings?: AiSafetyWarning[];
  questionId: string;
  error: string | null;
  isLoading: boolean;
  patientUuid: string;
  onFeedbackComplete?: () => void;
}

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An ended order's date as the panel may show it, or null where it must show none.
 *
 * The backend converts every date in UTC, so its `yyyy-MM-dd` can be a day off the local one, and
 * the panel shows it verbatim: never parsed into a `Date`, which would shift it again by the
 * viewer's own offset. Anything but that one shape is withheld rather than trimmed, so nothing more
 * exact than a calendar day reaches the screen.
 */
function calendarDay(value: unknown): string | null {
  return typeof value === 'string' && CALENDAR_DAY.test(value) ? value : null;
}

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
      title: notGroundedTitle(t),
    };
  }
  return null;
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

function stripCitations(answer: string): string {
  return answer.replace(citationStripPattern(), '').trim();
}

/** Whether a chip is drawn apart from the findings about the drug asked about — the box's split. */
function isApartFromTheDrugAsked(warning: AiSafetyWarning): boolean {
  return warning.aboutAnotherOfHerMedications === true || warning.aboutADrugOtherThanTheOneProposed === true;
}

/**
 * The cited findings a record the module attached is the source of, from `attachedFor` — only
 * where the module says it attached the record, and only indexes naming a `safety_finding` among
 * this answer's citations, so a malformed or dangling value draws no tag rather than one pointing
 * at a finding the clinician cannot find.
 */
function attachedForOf(ref: AiReference, citedFindings: ReadonlySet<number>): number[] {
  if (ref.attachedByTheModule !== true || !Array.isArray(ref.attachedFor)) return [];
  return ref.attachedFor.filter((index): index is number => Number.isInteger(index) && citedFindings.has(index));
}

const AiResponsePanel: React.FC<AiResponsePanelProps> = ({
  answer,
  references,
  safetyWarnings,
  misattributedOrderCitations,
  unstatedFindingSeverities,
  orderStopDates,
  unfoundedFindingSeverities,
  unfaithfullyRenderedCitations,
  cautionLedOverWithholding,
  interactionClaimPairs,
  unsupportedEndedOrderClaims,
  unstatedSignificanceQualifiers,
  questionId,
  error,
  isLoading,
  patientUuid,
  onFeedbackComplete,
}) => {
  const { t } = useTranslation();

  // Array.isArray, not `?? []`: a non-iterable value here would throw inside this memo, and a
  // string would iterate its characters and silently match nothing.
  const misattributed = useMemo(
    () => new Set(Array.isArray(misattributedOrderCitations) ? misattributedOrderCitations : []),
    [misattributedOrderCitations],
  );

  // Citation index → the day that cited prescription stopped. Array.isArray for the reason
  // `misattributed` gives; an entry is kept only where its date reads as one calendar day.
  const stopDates = useMemo(() => {
    const byCitation = new Map<number, string>();
    for (const entry of Array.isArray(orderStopDates) ? orderStopDates : []) {
      const day = calendarDay(entry?.stopDate);
      if (typeof entry?.citation === 'number' && day) byCitation.set(entry.citation, day);
    }
    return byCitation;
  }, [orderStopDates]);

  // The indexes of this answer's safety-finding citations: what an attached record's `attachedFor`
  // may name, and the only findings a "source of" tag may point a clinician at.
  const citedFindings = useMemo(
    () =>
      new Set(
        (Array.isArray(references) ? references : [])
          .filter((ref) => ref && referenceKind(ref) === 'safety_finding')
          .map((ref) => ref.index),
      ),
    [references],
  );

  const severities = useMemo(
    () => resolveFindingSeverities(answer, references, safetyWarnings ?? [], unstatedFindingSeverities),
    [answer, references, safetyWarnings, unstatedFindingSeverities],
  );

  const qualified = useMemo(
    () =>
      new Set<number>(
        (Array.isArray(unstatedSignificanceQualifiers) ? unstatedSignificanceQualifiers : []).filter((index) =>
          Number.isInteger(index),
        ),
      ),
    [unstatedSignificanceQualifiers],
  );

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(stripCitations(answer));
  }, [answer]);

  // The chips drawn in the safety box: every one but those the answer already states (backend ADR
  // Decision 124 — on a question asking only for her allergies the answer names the conflicting order and
  // quotes the chip). A chip stated there is not drawn again beside the list the clinician asked for.
  // The full list still feeds everything that reads a finding rather than draws one.
  const shownSafetyWarnings = useMemo(
    () => (safetyWarnings ?? []).filter((warning) => warning.statedInTheAnswer !== true),
    [safetyWarnings],
  );

  // The chips the answer cites and every fidelity check clears, drawn on one line with their detail
  // behind a toggle rather than repeating the answer's paragraph beside it — see compactChips for
  // what qualifies. Computed over EVERY chip, drawn or not, so a chip the safety box leaves out still
  // counts against a shared key. Never while streaming: the checks have not run yet.
  const compactWarnings = useMemo(() => {
    if (isLoading) return new Map<AiSafetyWarning, number[]>();
    const all = safetyWarnings ?? [];
    const positions = compactChips(answer, references, all, {
      misattributedOrderCitations,
      unstatedFindingSeverities,
      unfoundedFindingSeverities,
      unfaithfullyRenderedCitations,
      cautionLedOverWithholding,
      interactionClaimPairs,
    });
    return new Map([...positions].map(([position, indexes]) => [all[position], indexes]));
  }, [
    isLoading,
    answer,
    references,
    safetyWarnings,
    misattributedOrderCitations,
    unstatedFindingSeverities,
    unfoundedFindingSeverities,
    unfaithfullyRenderedCitations,
    cautionLedOverWithholding,
    interactionClaimPairs,
  ]);
  const [expandedWarnings, setExpandedWarnings] = useState<Set<AiSafetyWarning>>(() => new Set());

  // The whole safety box collapses to a summary line only where EVERY chip it draws qualifies for the
  // one-line form. One chip that does not keeps the box open: that is the finding a clinician must not
  // have to go looking for, and the box is where an answer that dropped or softened one still shows it.
  //
  // A chip about another of her medications than the drug the answer is about (backend
  // aboutAnotherOfHerMedications), or about any drug other than the one the question proposes (backend
  // aboutADrugOtherThanTheOneProposed), is drawn apart from those, behind a line of its own: still in the
  // box and one click away, but it neither keeps the box open nor sits among the findings about that drug.
  // Only `true` moves a chip; `false` is no claim it is about the drug in question.
  const mainWarnings = useMemo(
    () => shownSafetyWarnings.filter((warning) => !isApartFromTheDrugAsked(warning)),
    [shownSafetyWarnings],
  );
  const otherWarnings = useMemo(
    () => shownSafetyWarnings.filter((warning) => isApartFromTheDrugAsked(warning)),
    [shownSafetyWarnings],
  );
  // The line says the patient takes them only where every chip behind it is one of her own prescriptions.
  const otherWarningsAreHerMedications = otherWarnings.every(
    (warning) => warning.aboutAnotherOfHerMedications === true,
  );
  const safetyBoxCollapsible = mainWarnings.length > 0 && mainWarnings.every((warning) => compactWarnings.has(warning));
  const [safetyBoxOpen, setSafetyBoxOpen] = useState(false);
  const [otherMedicationsOpen, setOtherMedicationsOpen] = useState(false);
  const toggleWarning = useCallback((warning: AiSafetyWarning) => {
    setExpandedWarnings((previous) => {
      const next = new Set(previous);
      if (next.has(warning)) next.delete(warning);
      else next.add(warning);
      return next;
    });
  }, []);

  // What a chip about an ended order is about. The backend asks for exactly this reading: such a
  // chip is about giving the drug again, not about two medications the patient takes now.
  const endedOrderTitle = t(
    'aboutAnEndedOrderTitle',
    'The chart records this drug only as an order no longer in force, so the finding is about what giving it again would mean — not about a medication the patient is taking now.',
  );
  // Said of both ended-order dates: the backend converts them in UTC.
  const utcDayTitle = t(
    'utcCalendarDayTitle',
    'The date is a calendar day in UTC, so it can be a day off the local date.',
  );

  // The API layer emits a code (not display text) for session expiry so the wording can be localized
  // here; every other error is already a human-readable string from the server or browser.
  const displayError =
    error === SESSION_EXPIRED_ERROR_CODE
      ? t('sessionExpired', 'Your session has expired. Please log in again.')
      : error;

  // One chip as the safety box draws it, in either of its two lists.
  const renderWarning = (warning: AiSafetyWarning, i: number) => {
    const { tagType, label } = safetyWarningTag(warning.type, t);
    const endedOn = calendarDay(warning.endedOrderStopDate);
    const compact = compactWarnings.has(warning);
    const collapsed = compact && !expandedWarnings.has(warning);
    const partners = Array.isArray(warning.namedPartners)
      ? warning.namedPartners.filter((partner) => typeof partner === 'string' && partner.trim())
      : [];
    const severity = typeof warning.severity === 'string' && warning.severity.trim() ? warning.severity : null;
    // The one-line form names the partner from namedPartners. A chip carrying none — a finding relating two
    // drugs the question names — says who it is with only in its detail's lead, "<drug> interacts with
    // <partner>, also named in the question — <note>", so the line takes that lead rather than dropping it.
    const dash = typeof warning.detail === 'string' ? warning.detail.indexOf(' — ') : -1;
    const oneLineSubject = partners.length === 0 && dash > 0 ? warning.detail.slice(0, dash) : warning.drug;
    return (
      <span key={`${warning.type}-${warning.drug}-${i}`} className={styles.safetyWarningItem}>
        <Tag type={tagType} size="sm" className={styles.safetyWarningBadge}>
          {label}
        </Tag>
        <span className={styles.safetyWarningText}>
          {collapsed ? (
            <>
              {oneLineSubject}
              {partners.length > 0 && ` — ${partners.join(', ')}`}
              {severity && ` (${severity})`}
            </>
          ) : (
            <>
              {warning.drug}: {warning.detail}
            </>
          )}
          {compact && (
            <>
              {' '}
              <span
                className={styles.statedInAnswerTag}
                title={t(
                  'seeMarkerInTheAnswerTitle',
                  'The answer cites this finding at that marker, and the module’s checks of how it was rendered found nothing, so its detail is collapsed rather than repeated. The answer may still word it differently or leave part of it out; open the detail to read the finding in full.',
                )}
              >
                {t('seeMarkerInTheAnswer', 'See {{markers}} in the answer', {
                  markers: (compactWarnings.get(warning) ?? []).map((index) => `[${index}]`).join(', '),
                })}
              </span>{' '}
              <button
                type="button"
                className={styles.detailsToggle}
                aria-expanded={!collapsed}
                onClick={() => toggleWarning(warning)}
              >
                {collapsed ? t('showDetails', 'Show details') : t('hideDetails', 'Hide details')}
              </button>
            </>
          )}
          {/* A contraindication's words are the same whether the patient takes this drug or a
            question proposed it ("The patient has a recorded allergy to Lidocaine."), so this key is
            the only thing saying she is already on a drug her records contraindicate — named by her
            own order, never by `drug`. Not on an interaction chip, whose words already say "active
            order", and not behind the other-medications line, which already says it. Only `true` is
            drawn: `false` does not say the patient is off the drug. */}
          {(() => {
            if (
              warning.aboutACurrentMedication !== true ||
              warning.type !== 'contraindication' ||
              warning.aboutAnotherOfHerMedications === true
            ) {
              return null;
            }
            const orders = (Array.isArray(warning.currentMedicationOrders) ? warning.currentMedicationOrders : [])
              .map((order) => (typeof order?.orderDisplay === 'string' ? order.orderDisplay.trim() : ''))
              .filter(Boolean);
            return (
              <>
                {' '}
                <span
                  className={styles.currentMedicationTag}
                  title={t(
                    'alreadyPrescribedTitle',
                    'The patient has an active order for this drug, so this finding is about a medication already prescribed, not one being proposed. The drug shown is the substance the module matched that order to, which the order itself may name differently — a brand name, for example.',
                  )}
                >
                  {orders.length > 0
                    ? t('alreadyPrescribedOrders', 'Already prescribed: {{orders}}', { orders: orders.join(', ') })
                    : t('alreadyPrescribed', 'Already prescribed')}
                </span>
              </>
            );
          })()}
          {/* The chip's words are also the same whether the chart holds this drug only as
            an ended order or a question proposed it. A mark of its own, not the tag
            above: the backend keeps the two referents apart. Only `true` is drawn —
            `false` does not say the drug is current. */}
          {warning.aboutAnEndedOrder === true && (
            <>
              {' '}
              <span
                className={styles.endedOrderTag}
                title={endedOn ? `${endedOrderTitle} ${utcDayTitle}` : endedOrderTitle}
              >
                {endedOn
                  ? t('aboutAnEndedOrderOn', 'About an order no longer in force, ended {{stopDate}}', {
                      stopDate: endedOn,
                    })
                  : t('aboutAnEndedOrder', 'About an order no longer in force')}
              </span>
            </>
          )}
        </span>
      </span>
    );
  };

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
          {isLoading ? (
            <p className={styles.answerText}>{answer}</p>
          ) : (
            <MarkdownAnswer
              answer={answer}
              references={references}
              patientUuid={patientUuid}
              decorations={{ misattributed, severities, qualified }}
            />
          )}
          {/* An order the answer says has ended that no record it was built from says so (backend ADR
              Decision 135). Said under the answer rather than inside it: the key names drugs, not the
              sentence, and a second reading of which sentence claims which drug is the backend's to make.
              Only a non-empty list of names is drawn, and never while streaming. */}
          {(() => {
            if (isLoading || !Array.isArray(unsupportedEndedOrderClaims)) return null;
            const drugs = unsupportedEndedOrderClaims.filter(
              (name): name is string => typeof name === 'string' && name.trim().length > 0,
            );
            if (drugs.length === 0) return null;
            return (
              <p
                className={styles.unsupportedClaimNote}
                title={t(
                  'unsupportedEndedOrderClaimTitle',
                  'The answer says this order is no longer in force, but none of the records the answer was built from marks it that way. Check the patient’s medication list before relying on it.',
                )}
              >
                {t(
                  'unsupportedEndedOrderClaim',
                  'No record says the {{drugs}} order has ended — the answer states it without one.',
                  {
                    drugs: drugs.join(', '),
                    count: drugs.length,
                    defaultValue_other:
                      'No record says the {{drugs}} orders have ended — the answer states it without one.',
                  },
                )}
              </p>
            );
          })()}
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
              const typeLabel = referenceData ? referenceLabel(ref, t) : ref.resourceType;
              // Only append the date when there is one — an allergy and a safety finding carry
              // none, and "— null" was reaching the screen.
              const label = `[${ref.index}] ${typeLabel}${ref.date ? ` — ${ref.date}` : ''}`;
              const g = referenceData ? referenceTag(ref, t) : groundedTag(ref.grounded, t);
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
              // Where the cited record's content came from, on hover over the citation itself: provenance
              // a clinician may want, not a line every drug-reference citation needs. Keyed on the value,
              // never the group: a reference-group record may carry none, and the module's own finding
              // does not.
              const source = typeof ref.source === 'string' && ref.source.trim() ? ref.source.trim() : null;
              const sourceTitle = source ? t('referenceSourceHover', 'Source: {{source}}', { source }) : undefined;
              const link = url ? (
                <a
                  className={styles.referenceTag}
                  href={url}
                  title={sourceTitle}
                  onClick={(e) => handleReferenceNavigate(e, url, ref)}
                >
                  {label}
                </a>
              ) : (
                <span
                  className={isMisattributed ? styles.referenceTagMisattributed : styles.referenceTagInert}
                  title={sourceTitle}
                >
                  {label}
                </span>
              );
              const stopDate = stopDates.get(ref.index);
              const sourceOf = attachedForOf(ref, citedFindings);
              return (
                <span key={ref.index} className={styles.referenceItem}>
                  {link}
                  {/* When this cited prescription stopped: the answer can say an order ended
                      without saying when. Beside the record's own date, never in its place — the
                      two are different facts. No entry draws nothing, and is no claim the order
                      is current. */}
                  {stopDate && (
                    <span
                      className={styles.orderStopDateTag}
                      title={`${t('orderStopDateTitle', 'The date this prescription stopped being in force — not the record’s own date shown beside it.')} ${utcDayTitle}`}
                    >
                      {t('orderStopDate', 'Stopped {{stopDate}}', { stopDate })}
                    </span>
                  )}
                  {/* withheldInteractions is not drawn: the partners a drug-reference record leaves out
                      are mostly drugs this patient is not on, and the safety check reads every one of
                      them regardless, so a count here read as an incomplete check that was not. */}
                  {isMisattributed && (
                    <span className={styles.misattributedTag} title={misattributedTitle(t)}>
                      {t('notTheOrderNamed', 'Not the order named')}
                    </span>
                  )}
                  {/* An attached citation IS the chart record a cited safety finding fired on — the
                      recorded allergy or condition whose match raised it — so the answer's prose
                      carries no [N] marker for it, and this chip is the only place it appears. The
                      tag says what the record is to the answer: the source of the cited findings it
                      backs (`attachedFor`), never who attached it, which a clinician cannot act on.
                      Nothing where the response names no finding for it. */}
                  {sourceOf.length > 0 && (
                    <span
                      className={styles.attachedTag}
                      title={t(
                        'sourceOfFindingsTitle',
                        'The chart record the cited safety finding is based on. The answer has no marker for it, since it cites the finding; opening it goes to the record.',
                      )}
                    >
                      {t('sourceOfFindings', 'source of {{citations}}', {
                        citations: sourceOf.map((index) => `[${index}]`).join(', '),
                      })}
                    </span>
                  )}
                  {badge}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {shownSafetyWarnings.length > 0 && (
        // No live-region role: the panel already sits inside the chat history's
        // role="log" aria-live="polite", which announces this content in order. An
        // assertive role="alert" here would preempt the answer it annotates.
        // Red only where the box holds a finding about the drug in question. A box holding nothing
        // but chips about her OTHER medications (backend aboutAnotherOfHerMedications) is drawn
        // neutral: those findings are real, and one click away, but not a warning about what was asked.
        <div
          className={
            mainWarnings.length === 0
              ? `${styles.safetyWarningsSection} ${styles.safetyWarningsSectionNeutral}`
              : styles.safetyWarningsSection
          }
        >
          <span className={styles.safetyWarningsLabel}>
            {t('safetyChecks', 'Safety checks')}:
            {safetyBoxCollapsible && (
              <>
                {' '}
                <span className={styles.safetyWarningsSummary}>
                  {t('safetyChecksCitedInTheAnswer', '{{count}} finding, cited in the answer', {
                    count: mainWarnings.length,
                    defaultValue_other: '{{count}} findings, each cited in the answer',
                  })}
                </span>{' '}
                <button
                  type="button"
                  className={styles.detailsToggle}
                  aria-expanded={safetyBoxOpen}
                  onClick={() => setSafetyBoxOpen((open) => !open)}
                >
                  {safetyBoxOpen
                    ? t('hideSafetyChecks', 'Hide safety checks')
                    : t('showSafetyChecks', 'Show safety checks')}
                </button>
              </>
            )}
          </span>
          {mainWarnings.length > 0 && (!safetyBoxCollapsible || safetyBoxOpen) && (
            <div className={styles.safetyWarningsList}>{mainWarnings.map(renderWarning)}</div>
          )}
          {otherWarnings.length > 0 && (
            <>
              <span className={styles.otherMedicationsLine}>
                {otherWarningsAreHerMedications
                  ? t('otherMedicationFindings', '{{count}} finding about another of this patient’s medications', {
                      count: otherWarnings.length,
                      defaultValue_other: '{{count}} findings about other medications this patient takes',
                    })
                  : t('notAboutTheDrugAsked', '{{count}} finding not about the drug asked about', {
                      count: otherWarnings.length,
                      defaultValue_other: '{{count}} findings not about the drug asked about',
                    })}{' '}
                <button
                  type="button"
                  className={styles.detailsToggle}
                  aria-expanded={otherMedicationsOpen}
                  onClick={() => setOtherMedicationsOpen((open) => !open)}
                >
                  {otherMedicationsOpen ? t('hideDetails', 'Hide details') : t('showDetails', 'Show details')}
                </button>
              </span>
              {otherMedicationsOpen && (
                <div className={styles.safetyWarningsList}>{otherWarnings.map(renderWarning)}</div>
              )}
            </>
          )}
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
