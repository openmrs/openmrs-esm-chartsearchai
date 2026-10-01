import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, InlineLoading, Tag } from '@carbon/react';
import { Copy } from '@carbon/react/icons';
import { navigate } from '@openmrs/esm-framework';
import {
  type AiAnswerLimits,
  type AiReference,
  type AiSafetyWarning,
  SESSION_EXPIRED_ERROR_CODE,
} from '../api/chartsearchai';
import { compactChips } from '../utils/compact-chips';
import { highlightReference } from '../utils/highlight-reference';
import {
  citationGroupPattern,
  citationStripPattern,
  isReferenceData,
  parseCitationIndices,
  type ReferenceKind,
  referenceKind,
  resolveFindingSeverities,
  type SeverityTone,
  severityTone,
} from '../utils/safety-disclosure';
import AiFeedback from './ai-feedback.component';
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

const RESOURCE_TYPE_TO_CHART_PAGE: Record<string, string> = {
  obs: 'Results',
  order: 'Orders',
  drug_order: 'Orders',
  // The module injects `active_drug_order` for an active order the retrieved chart carries no
  // record of, but it is the patient's own order with a real Order uuid — chart group, and
  // navigable. Without this row it lands on the default tab; the backend README names this
  // client specifically as the one missing it.
  active_drug_order: 'Orders',
  allergy: 'Allergies',
  condition: 'Conditions',
  diagnosis: 'Visits',
  // `visit` and `encounter` alongside `diagnosis`, which was already here. Without them a
  // citation of an encounter and a citation of a diagnosis FROM that encounter landed on two
  // different tabs. Measured on the live server: "Summarise her recent visits and encounters
  // and any diagnoses" returned 113 chart citations, of which encounter x45 and visit x6 fell
  // through to the default tab — 51 of 113.
  visit: 'Visits',
  encounter: 'Visits',
  program: 'Programs',
  medication_dispense: 'Medications',
};

/**
 * Where a citation's chip and inline marker navigate to, or null where they must not navigate.
 *
 * Two kinds of citation get no link. Reference data (a drug-reference entry, a safety finding,
 * a drug-class note) has no chart page at all. And a MISATTRIBUTED citation has one that would
 * usually mislead: the record exists but is typically not the medication order the sentence
 * names, so offering it invites the clinician to read an unrelated row as the evidence.
 *
 * "Typically", not "always" — the backend documents arrangements where such a citation "is
 * correct where it sits" (one captured by a bare *and* from a neighbouring clause), which is
 * why the marker and the tag are worded as a report rather than a verdict. Suppressing only the
 * link is deliberate and is what issue #26 asks for; the grounding verdict is left untouched
 * beside it, because this key must not override the other statements about a citation.
 */
function buildReferenceUrl(ref: AiReference, patientUuid: string, misattributed: boolean): string | null {
  if (!patientUuid || misattributed || isReferenceData(ref)) {
    return null;
  }
  // Optional-chained to match `isReferenceData`, which guards the same field one call earlier:
  // a reference missing it would otherwise throw here and unmount the whole answer panel.
  const chartPage = RESOURCE_TYPE_TO_CHART_PAGE[ref.resourceType?.toLowerCase()];
  return `${window.spaBase}/patient/${patientUuid}/chart/${encodeURIComponent(chartPage ?? 'Patient Summary')}`;
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
      title: notGroundedTitle(t),
    };
  }
  return null;
}

/**
 * The wording for a citation whose cited record does not support the claim. One home, because
 * it is shown on two surfaces — the chip's badge and the inline marker's tooltip — and a
 * clinician hovering the same citation in both places must not be told two different things.
 */
function notGroundedTitle(t: Translate): string {
  return t('notGroundedTitle', 'The cited record may not support this statement — verify against the chart.');
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
 * What each kind of module-supplied citation IS, shown on both surfaces that carry it — the
 * chip's badge and the inline marker — so a clinician hovering the same citation in two places
 * is never told two different things.
 *
 * Split per kind for the same reason {@link REFERENCE_KIND_LABEL} is. One wording used to serve
 * all of them, and it was written when the predicate above matched `drug_reference` alone:
 * *"Clinical reference data — not this patient’s record."* Widening the predicate to the whole
 * `reference` group carried that sentence onto the other two unchanged, and on the measured
 * payload it lands on `[349]` — a `contraindication:Clarithromycin` finding whose text is *"The
 * patient has a recorded allergy to Clarithromycin."*, computed from her own allergy record.
 * The backend is explicit that such a finding is "computed rather than quoted from a dataset",
 * so calling it reference data is wrong about the one citation in that answer that is entirely
 * about this patient.
 *
 * This is a difference in WORDING only. Every kind still gets the same treatment the backend
 * requires of the group: no grounding verdict, no navigation target, the same neutral tag. The
 * README's "must not treat the `reference`-group types differently" is aimed at a client that
 * keys the badge, the label or the navigation on `resourceType` and drops a type into a default
 * branch — which is why this, like the label map, is a total `Record` with an explicit `other`.
 */
const REFERENCE_KIND_TITLE: Record<ReferenceKind, (t: Translate) => string> = {
  safety_finding: (t) =>
    t(
      'safetyFindingCitation',
      'The module’s own safety finding, computed from this patient’s chart — not a chart record to open.',
    ),
  drug_reference: (t) => t('drugReferenceCitation', 'Clinical reference data — not this patient’s record.'),
  drug_class_note: (t) =>
    t('drugClassNoteCitation', 'A note about a drug class the question named — not this patient’s record.'),
  // A `reference`-group type this client predates: say only what the group guarantees.
  other: (t) => t('referenceMaterialCitation', 'Module-supplied reference material — not this patient’s record.'),
};

function referenceTitle(ref: AiReference, t: Translate): string {
  return REFERENCE_KIND_TITLE[referenceKind(ref)](t);
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
  // `Unknown` is the LOWEST of the four ratings the module recognises; *unrated* it sorts ABOVE
  // all four. They are opposite ends of one ranking, so they cannot share a treatment — one
  // grey for both would tell a clinician an operator's unrated rule and a DDInter `Unknown`
  // rank equally.
  unknown: styles.severityUnknown,
  unrated: styles.severityUnrated,
};

function stripCitations(answer: string): string {
  return answer.replace(citationStripPattern(), '').trim();
}

interface CitationContext {
  references: AiReference[];
  misattributed: Set<number>;
  /** Citation index → the rating the answer never stated, for the ones that could be resolved. */
  severities: Map<number, string>;
  /** The citation indexes whose finding's unknown-significance caveat the answer left out. */
  qualified: Set<number>;
  patientUuid: string;
  t: Translate;
}

function renderAnswerWithCitations(answer: string, ctx: CitationContext): React.ReactNode[] {
  const { references, misattributed, severities, qualified, patientUuid, t } = ctx;
  const refByIndex = new Map(references.map((r) => [r.index, r]));
  const parts: React.ReactNode[] = [];
  const pattern = citationGroupPattern();
  // A rating belongs to a finding, not to a marker, and the model routinely repeats a finding's
  // marker within one statement — so badge each index at most once per answer.
  const badged = new Set<number>();
  const noted = new Set<number>();
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(answer)) !== null) {
    if (match.index > lastIndex) {
      parts.push(answer.slice(lastIndex, match.index));
    }
    const matchIndex = match.index;
    const citIndices = parseCitationIndices(match[1]);
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
          //
          // The two checks are independent and both can fire on one citation, so this must sit
          // BESIDE the grounding verdict rather than over it: the ⚠ is kept for an ungrounded
          // one, because the reference chip below shows its "Unsupported" badge either way and
          // a marker that hid it would make the panel contradict itself.
          <span
            key={citKey}
            className={
              ungrounded
                ? `${styles.inlineCitation} ${styles.inlineCitationMisattributed} ${styles.inlineCitationUngrounded}`
                : `${styles.inlineCitation} ${styles.inlineCitationMisattributed}`
            }
            title={ungrounded ? `${misattributedTitle(t)} ${notGroundedTitle(t)}` : misattributedTitle(t)}
          >
            {ungrounded ? `${citIndex} ⚠` : citIndex}
          </span>
        ) : url && ref ? (
          <a
            key={citKey}
            className={
              ungrounded ? `${styles.inlineCitation} ${styles.inlineCitationUngrounded}` : styles.inlineCitation
            }
            href={url}
            title={ungrounded ? notGroundedTitle(t) : undefined}
            onClick={(e) => handleReferenceNavigate(e, url, ref)}
          >
            {ungrounded ? `${citIndex} ⚠` : citIndex}
          </a>
        ) : referenceData ? (
          <span
            key={citKey}
            className={`${styles.inlineCitation} ${styles.inlineCitationReference}`}
            title={ref ? referenceTitle(ref, t) : undefined}
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
    //
    // One badge per unbadged index, in the group's own index order. No de-duplication by rating:
    // the resolver refuses to elect one finding for two citations of the same set, so two badges
    // in one group are two DIFFERENT findings — and collapsing equal ratings would then hide
    // that there are two. (The "Major Major" case that once motivated a dedupe is now refused
    // outright, one level down.)
    const groupRatings: string[] = [];
    citIndices.forEach((citIndex) => {
      const severity = severities.get(citIndex);
      if (!severity || badged.has(citIndex)) return;
      badged.add(citIndex);
      groupRatings.push(severity);
    });
    groupRatings.forEach((severity, group) => {
      // A real space, not just the tag's margin: without it the paragraph's text content reads
      // "[350]Major", which is what a screen reader announces and what any text extraction gets.
      parts.push(' ');
      parts.push(
        <span
          key={`sev-${matchIndex}-${group}`}
          className={`${styles.severityTag} ${SEVERITY_TONE_CLASS[severityTone(severity)]}`}
          title={t(
            'unstatedSeverityTitle',
            'Rated by the reference dataset. This answer may not state the rating — it is shown here so the findings can be ranked.',
          )}
        >
          {severity}
        </span>,
      );
    });

    // And the finding's own caveat the answer dropped (backend ADR Decision 136), after its rating: one per
    // finding per answer, for the reason a rating is.
    citIndices.forEach((citIndex) => {
      if (!qualified.has(citIndex) || noted.has(citIndex)) return;
      noted.add(citIndex);
      parts.push(' ');
      parts.push(
        <span
          key={`sig-${matchIndex}-${citIndex}`}
          className={styles.significanceTag}
          title={t(
            'significanceUnknownTitle',
            'The finding this cites says the clinical significance of the interaction is unknown. The answer leaves that out.',
          )}
        >
          {t('significanceUnknown', 'Clinical significance unknown')}
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

  const renderedAnswer = useMemo(() => {
    if (!answer) return null;
    if (isLoading) return answer;
    const qualified = new Set<number>(
      (Array.isArray(unstatedSignificanceQualifiers) ? unstatedSignificanceQualifiers : []).filter((index) =>
        Number.isInteger(index),
      ),
    );
    return renderAnswerWithCitations(answer, { references, misattributed, severities, qualified, patientUuid, t });
  }, [answer, references, misattributed, severities, unstatedSignificanceQualifiers, patientUuid, isLoading, t]);

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
          <p className={styles.answerText}>{renderedAnswer}</p>
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
