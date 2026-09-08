import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, InlineLoading, Tag } from '@carbon/react';
import { Copy, Information } from '@carbon/react/icons';
import { navigate } from '@openmrs/esm-framework';
import {
  type AiAnswerLimits,
  type AiReference,
  type AiSafetyWarning,
  type ConditionRuleCoverage,
  SESSION_EXPIRED_ERROR_CODE,
} from '../api/chartsearchai';
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
 * The four answer-limit measurements come in as {@link AiAnswerLimits}, so their semantics are
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
 * Says the EVIDENCE is wrong, not the finding — the interaction itself came from a
 * deterministic check and is typically sound. Shared by the inline marker and the chip.
 */
function misattributedTitle(t: Translate): string {
  return t(
    'misattributedCitationTitle',
    'The module reports that this citation may not be the medication order this sentence names, so it is not offered as a link. The safety finding itself is unaffected.',
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
/**
 * What each coverage verdict says, or `null` where it must say nothing.
 *
 * A total `Record` over the closed union, deliberately, and for the same reason as
 * {@link REFERENCE_KIND_LABEL} below: a `switch` with a `default` arm collapses two different
 * things — the decision that `published` renders nothing, and the fallback for a word this
 * client predates — so a fourth verdict someone HAS taught the type system about would fall
 * into the fallback and render silently. Measured: adding `'partial'` to the union type
 * typechecked clean and passed all 279 tests. Here it is a compile error.
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
  patientUuid: string;
  t: Translate;
}

function renderAnswerWithCitations(answer: string, ctx: CitationContext): React.ReactNode[] {
  const { references, misattributed, severities, patientUuid, t } = ctx;
  const refByIndex = new Map(references.map((r) => [r.index, r]));
  const parts: React.ReactNode[] = [];
  const pattern = citationGroupPattern();
  // A rating belongs to a finding, not to a marker, and the model routinely repeats a finding's
  // marker within one statement — so badge each index at most once per answer.
  const badged = new Set<number>();
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

  const renderedAnswer = useMemo(() => {
    if (!answer) return null;
    if (isLoading) return answer;
    return renderAnswerWithCitations(answer, { references, misattributed, severities, patientUuid, t });
  }, [answer, references, misattributed, severities, patientUuid, isLoading, t]);

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
  // which the count-of-one note below turns on. What is dropped is the LOWEST-RATED FIRST — an order, not a
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
   * it is safety output even where that check raised no chip. So does a cited reference record,
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
  const showLimits = !isLoading && (pairsSentence !== null || coverageNote !== null);

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
                        'The module supplied this citation from the safety finding it fired on, so the answer’s text carries no marker for it. Opening it goes to the record.',
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
      {showLimits && (
        <div className={styles.limitsSection}>
          <span className={styles.limitsLabel}>{t('checkCoverage', 'What the safety checks covered')}</span>
          <ul className={styles.limitsList}>
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
