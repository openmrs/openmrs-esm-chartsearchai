import React from 'react';
import { useTranslation } from 'react-i18next';
import { navigate } from '@openmrs/esm-framework';
import { type AiReference } from '../api/chartsearchai';
import { highlightReference } from '../utils/highlight-reference';
import {
  isReferenceData,
  type ReferenceKind,
  referenceKind,
  type SeverityTone,
  severityTone,
} from '../utils/safety-disclosure';
import styles from './ai-response-panel.scss';

const RESOURCE_TYPE_TO_CHART_PAGE: Record<string, string> = {
  obs: 'Results',
  order: 'Orders',
  drug_order: 'Orders',
  // The module injects `active_drug_order` for an active order the retrieved chart carries no
  // record of, but it is the patient's own order with a real Order uuid: chart group, navigable.
  active_drug_order: 'Orders',
  allergy: 'Allergies',
  condition: 'Conditions',
  diagnosis: 'Visits',
  // Without `visit` and `encounter`, a citation of an encounter and a citation of a diagnosis
  // FROM that encounter landed on two different tabs (measured: 51 of 113 chart citations).
  visit: 'Visits',
  encounter: 'Visits',
  program: 'Programs',
  medication_dispense: 'Medications',
};

/** Reference data (drug reference, safety finding, drug-class note): the server's `group`, or the
 *  resource type for a response predating it. One definition, in safety-disclosure. */
export function isDrugReference(ref: AiReference): boolean {
  return isReferenceData(ref);
}

/**
 * Where a citation navigates, or null where it must not. Reference data has no chart page. A
 * MISATTRIBUTED citation has one that would usually mislead: the record exists but is typically
 * not the order the sentence names, so offering it invites the clinician to read an unrelated row
 * as the evidence. Only the link is suppressed; the grounding verdict beside it is untouched.
 */
export function buildReferenceUrl(ref: AiReference, patientUuid: string, misattributed = false): string | null {
  if (!patientUuid || misattributed || isDrugReference(ref)) {
    return null;
  }
  const chartPage = RESOURCE_TYPE_TO_CHART_PAGE[ref.resourceType?.toLowerCase()];
  return `${window.spaBase}/patient/${patientUuid}/chart/${encodeURIComponent(chartPage ?? 'Patient Summary')}`;
}

export function handleReferenceNavigate(e: React.MouseEvent, url: string, ref: AiReference) {
  e.preventDefault();
  navigate({ to: url });
  highlightReference(ref.resourceUuid, ref.date);
}

export type Translate = (key: string, fallback: string) => string;

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
export const REFERENCE_KIND_TITLE: Record<ReferenceKind, (t: Translate) => string> = {
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

export function referenceTitle(ref: AiReference, t: Translate): string {
  return REFERENCE_KIND_TITLE[referenceKind(ref)](t);
}

/**
 * What the answer-limit statements say about the citations of one answer, applied as the prose
 * renders: a struck-through, non-navigating marker for a citation the module reports cannot be
 * the order its sentence names, and the dataset's rating beside a finding whose rating the answer
 * states nowhere. `badged` is per render, so one finding cited several times is rated once.
 */
export interface CitationDecorations {
  misattributed: Set<number>;
  severities: Map<number, string>;
  badged: Set<number>;
}

/** The class carrying a rating's colour; an unrecognised word gets the neutral treatment. */
const SEVERITY_TONE_CLASS: Record<SeverityTone, string> = {
  major: styles.severityMajor,
  moderate: styles.severityModerate,
  minor: styles.severityMinor,
  unknown: styles.severityUnknown,
  unrated: styles.severityUnrated,
};

const SeverityBadge: React.FC<{ severity: string }> = ({ severity }) => {
  const { t } = useTranslation();
  return (
    <span
      className={`${styles.severityTag} ${SEVERITY_TONE_CLASS[severityTone(severity)]}`}
      title={t(
        'unstatedSeverityTitle',
        'Rated by the reference dataset. This answer may not state the rating — it is shown here so the findings can be ranked.',
      )}
    >
      {severity}
    </span>
  );
};

interface CitationChipProps {
  index: number;
  reference?: AiReference;
  patientUuid: string;
  misattributed?: boolean;
}

/**
 * Inline citation chip. Navigating chips link to the patient chart page for the cited
 * record. Reference-group citations are rendered as a non-navigating span with a tooltip
 * indicating they are clinical reference data, not this patient's records.
 * Ungrounded citations (grounded=false) render with a ⚠ glyph and a warning title.
 */
export const CitationChip: React.FC<CitationChipProps> = ({ index, reference, patientUuid, misattributed = false }) => {
  const { t } = useTranslation();
  if (!reference) {
    return <>{index}</>;
  }
  const ungrounded = reference.grounded === false;
  if (misattributed) {
    // Struck through and NOT a link: the number stays readable so the chip below can be found.
    // Amber, not red: unreliable evidence for a sound finding, not a refuted claim. Independent of
    // the grounding verdict, which keeps its glyph so the panel does not contradict itself.
    const misattributedTitle = t(
      'misattributedCitationTitle',
      'The module reports that this citation may not be the medication order this sentence names, so it is not offered as a link. This is a report about the citation, not a verdict on the safety finding.',
    );
    return (
      <span
        className={
          ungrounded
            ? `${styles.inlineCitation} ${styles.inlineCitationMisattributed} ${styles.inlineCitationUngrounded}`
            : `${styles.inlineCitation} ${styles.inlineCitationMisattributed}`
        }
        title={
          ungrounded
            ? `${misattributedTitle} ${t('notGroundedTitle', 'The cited record may not support this statement — verify against the chart.')}`
            : misattributedTitle
        }
      >
        {ungrounded ? `${index} \u26a0` : index}
      </span>
    );
  }
  if (isDrugReference(reference)) {
    return (
      <span className={styles.inlineCitationReference} title={referenceTitle(reference, t)}>
        {index}
      </span>
    );
  }
  const url = buildReferenceUrl(reference, patientUuid);
  if (!url) {
    return <>{index}</>;
  }
  return (
    <a
      className={ungrounded ? `${styles.inlineCitation} ${styles.inlineCitationUngrounded}` : styles.inlineCitation}
      href={url}
      title={
        ungrounded
          ? t('notGroundedTitle', 'The cited record may not support this statement \u2014 verify against the chart.')
          : undefined
      }
      onClick={(e) => handleReferenceNavigate(e, url, reference)}
    >
      {ungrounded ? `${index} \u26a0` : index}
    </a>
  );
};

const CITATION_PATTERN = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * Render text with inline `[N]` or `[N, M]` citation markers replaced by
 * clickable CitationChip elements. Used by both prose answers and table cells.
 */
export function renderTextWithCitations(
  text: string,
  references: AiReference[],
  patientUuid: string,
  keyPrefix = 'cit',
  decorations?: CitationDecorations,
): React.ReactNode[] {
  const refByIndex = new Map(references.map((r) => [r.index, r]));
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const pattern = new RegExp(CITATION_PATTERN.source, CITATION_PATTERN.flags);

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const matchIndex = match.index;
    const citIndices = match[1].split(/\s*,\s*/).map(Number);
    parts.push('[');
    citIndices.forEach((citIndex, i) => {
      parts.push(
        <CitationChip
          key={`${keyPrefix}-${matchIndex}-${citIndex}-${i}`}
          index={citIndex}
          reference={refByIndex.get(citIndex)}
          patientUuid={patientUuid}
          misattributed={decorations?.misattributed.has(citIndex) ?? false}
        />,
      );
      if (i < citIndices.length - 1) {
        parts.push(', ');
      }
    });
    parts.push(']');
    // The rating for any finding cited here that the answer states nowhere, right after the marker
    // group so a flat list of findings can be ranked in one pass. One badge per unbadged index, in
    // the group's own order; equal ratings are not collapsed, because two badges are two findings.
    if (decorations) {
      citIndices.forEach((citIndex, group) => {
        const severity = decorations.severities.get(citIndex);
        if (!severity || decorations.badged.has(citIndex)) return;
        decorations.badged.add(citIndex);
        parts.push(' ');
        parts.push(<SeverityBadge key={`${keyPrefix}-sev-${matchIndex}-${group}`} severity={severity} />);
      });
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}
