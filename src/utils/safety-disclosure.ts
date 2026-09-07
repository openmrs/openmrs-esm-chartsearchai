import type { AiReference, AiSafetyWarning } from '../api/chartsearchai';

/**
 * Resource types the backend classifies as module-supplied reference material rather than as
 * the patient's own record. Either signal suffices in {@link isReferenceData}: a response
 * predating the `group` field is recognised by its type, and a `reference`-group type added
 * later is recognised by its group without this list changing.
 *
 * `active_drug_order` is deliberately absent — the module injects it, but it is the patient's
 * own order carrying a real `Order` uuid, so it groups as `chart` and navigates.
 */
const REFERENCE_RESOURCE_TYPES = new Set(['drug_reference', 'safety_finding', 'drug_class_note']);

/**
 * Whether a citation points at module-supplied reference material (a drug-reference entry, a
 * safety finding, a drug-class note) rather than at a record in this patient's chart.
 *
 * Such a citation has no chart page to navigate to, so it must not be rendered as a link:
 * before this predicate existed only `drug_reference` was recognised, and a `safety_finding`
 * citation linked to Patient Summary and then tried to highlight a row keyed on a synthetic
 * uuid like `interaction:Clarithromycin` — a link that could never land anywhere.
 */
export function isReferenceData(ref: AiReference): boolean {
  return ref.group === 'reference' || REFERENCE_RESOURCE_TYPES.has(ref.resourceType?.toLowerCase());
}

/** Which kind of reference material a citation is, for labelling. */
export type ReferenceKind = 'safety_finding' | 'drug_reference' | 'drug_class_note' | 'other';

/**
 * Classifies a reference-group citation off the same list {@link isReferenceData} uses, so the
 * two cannot disagree. `other` is reachable and must be labelled neutrally: the predicate
 * admits any citation whose `group` is `reference`, including a type this client predates.
 */
export function referenceKind(ref: AiReference): ReferenceKind {
  const resourceType = ref.resourceType?.toLowerCase();
  return resourceType && REFERENCE_RESOURCE_TYPES.has(resourceType) ? (resourceType as ReferenceKind) : 'other';
}

/** The severity words the module itself recognises. Anything else a dataset supplies is *unrated*. */
export type SeverityTone = 'major' | 'moderate' | 'minor' | 'unknown' | 'unrated';

/**
 * Classifies a dataset's rating for styling only.
 *
 * `severity` is not a closed vocabulary — an operator's dataset supplies its own words — so an
 * unrecognised value maps to `unrated`. It must NOT be coerced to a tier: the module ranks its
 * four recognised words `Unknown` < `Minor` < `Moderate` < `Major` and then sorts *unrated
 * above all four*, so `unknown` and `unrated` sit at opposite ends and cannot share a
 * treatment. The rating is always displayed verbatim; only the emphasis comes from this.
 */
export function severityTone(severity: string): SeverityTone {
  switch (severity.trim().toLowerCase()) {
    case 'major':
      return 'major';
    case 'moderate':
      return 'moderate';
    case 'minor':
      return 'minor';
    case 'unknown':
      return 'unknown';
    default:
      return 'unrated';
  }
}

const CITATION_GROUP_SOURCE = String.raw`\[(\d+(?:\s*,\s*\d+)*)\]`;

/**
 * A fresh matcher for one citation marker group (`[3]`, `[1, 2]`), capturing its index list.
 *
 * A factory rather than a shared constant because the answer renderer drives it with
 * `exec`/`lastIndex` and a module-level `/g` instance would carry position state across calls.
 * One source string so the resolver and the renderer cannot recognise different markers — if
 * they diverge, the renderer draws markers the resolver can no longer key a rating to, and
 * ratings vanish from an answer that still looks complete.
 */
export function citationGroupPattern(): RegExp {
  return new RegExp(CITATION_GROUP_SOURCE, 'g');
}

/** Splits a marker group's captured index list (`"1, 2"`) into numbers. */
export function parseCitationIndices(group: string): number[] {
  return group.split(/\s*,\s*/).map(Number);
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The text of the claim each citation marker is attached to.
 *
 * A marker's claim is the prose running back to the previous marker — but adjacent markers
 * (`[177] [350]`) cite ONE claim between them, so a run of marker groups separated by nothing
 * but whitespace is treated as a single attachment point and they all share the text before
 * the run. Without that, `[350]` in `Methylprednisolone [177] [350]` would see a claim text of
 * just `" "` and could never be resolved.
 *
 * An index cited more than once keeps its FIRST claim. Measured live, the model routinely
 * repeats a finding's marker inside its own statement — *"…interacts with active order
 * Solu-Medrol 125mg/5ml [350], a Major problem because … adrenal suppression [350]"* — where
 * the first occurrence is the statement that names the finding and the repeat trails a
 * mechanism clause. An earlier version blanked such an index to avoid attributing a rating to
 * the wrong sentence, which discarded the only evidence there was on every one of those
 * answers.
 *
 * First rather than a union of all of them, because the renderer badges an index at its first
 * marker too: the rating is then read from, and shown beside, the same sentence. A union would
 * let evidence from a later sentence justify a badge drawn against an earlier one.
 */
export function claimTextByCitation(answer: string): Map<number, string> {
  const matches = [...answer.matchAll(citationGroupPattern())];

  // Group the markers into runs first: groups separated by nothing but whitespace are one
  // attachment point, so they all take the prose that precedes the run.
  const runs: Array<{ start: number; end: number; groups: RegExpMatchArray[] }> = [];
  for (const match of matches) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const open = runs[runs.length - 1];
    if (open && /^\s*$/.test(answer.slice(open.end, start))) {
      open.end = end;
      open.groups.push(match);
    } else {
      runs.push({ start, end, groups: [match] });
    }
  }

  const claims = new Map<number, string>();
  let previousRunEnd = 0;
  for (const run of runs) {
    const claim = answer.slice(previousRunEnd, run.start);
    for (const group of run.groups) {
      for (const index of parseCitationIndices(group[1])) {
        if (!Number.isFinite(index)) continue;
        if (!claims.has(index)) claims.set(index, claim);
      }
    }
    previousRunEnd = run.end;
  }

  return claims;
}

/**
 * The leading clause of a safety warning's `detail` — the part that states the finding, before
 * the rating and the mechanism the bundled dataset appends (`… — Major. Coadministration …`).
 *
 * This is the WEAKER of the two ways to identify a warning in the answer's own words, and is
 * only the fallback. `detail` is clinician-facing prose the module rewords freely and holds out
 * as no contract, so the delimiter split here is not promised; a note whose text contains an
 * em-dash or a sentence break early shortens the clause, which makes the containment test in
 * {@link resolveFindingSeverities} match more candidates and therefore resolve nothing — the
 * fail-safe direction. Prefer {@link AiSafetyWarning.chartOrderBridges}, which the backend
 * publishes as typed fields precisely so a client need not parse this sentence.
 */
function leadClause(detail: string): string {
  const dash = detail.indexOf(' — ');
  const stop = detail.indexOf('. ');
  const cut = [dash, stop].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  return cut === undefined ? detail : detail.slice(0, cut);
}

/**
 * The strings that can identify a warning in the answer's own words, strongest tier first.
 *
 * Tier 0 is `chartOrderBridges`: typed fields, published so a client is handed two strings
 * rather than a sentence to parse. It carries BOTH vocabularies, which is what makes it the
 * strong tier — a chip names its substances as the knowledge base does (`Methylprednisolone`)
 * while the answer names the same prescription as the chart does (`Solu-Medrol 125mg/5ml`), and
 * both spellings are observed live in the same position. Tier 1 is the `detail` lead clause,
 * used only for a chip that bridges nothing (an empty array means nothing on that chip was
 * attributed, which is common and not an error).
 */
function candidateLeadTiers(warning: AiSafetyWarning): string[][] {
  const bridges = warning.chartOrderBridges ?? [];
  return [bridges.flatMap((bridge) => [bridge.orderDisplay, bridge.substance]), [leadClause(warning.detail)]];
}

/** Whether any of a tier's strings is a non-empty substring of the (already normalized) claim. */
function tierMatches(leads: string[], claim: string): boolean {
  return leads.some((lead) => {
    const normalized = normalize(lead ?? '');
    // A lead with no text carries no evidence to match on, and `''` is contained in every
    // string — so without this it would match vacuously and win any tie it was part of,
    // attributing a rating to a sentence nothing tied it to. An operator-supplied dataset can
    // leave a rule's note empty while still rating it, so this is reachable.
    return normalized !== '' && claim.includes(normalized);
  });
}

/** Splits a safety finding's synthetic uuid (`interaction:Clarithromycin`) into type and drug. */
function splitFindingUuid(resourceUuid: string): { type: string; drug: string } | null {
  const colon = resourceUuid?.indexOf(':') ?? -1;
  if (colon <= 0 || colon === resourceUuid.length - 1) return null;
  return { type: resourceUuid.slice(0, colon), drug: resourceUuid.slice(colon + 1) };
}

/**
 * The rating to render beside each citation named in `unstatedFindingSeverities`.
 *
 * The backend states plainly that the rating "cannot be joined to a chip: chips carry no
 * citation index, and `(type, drug)` does not identify one — a screening question raises
 * several findings sharing it". So this does not attempt that join. It narrows to the
 * candidates sharing the finding's `(type, drug)` and then requires the answer's own sentence
 * to single ONE of them out, by reproducing something that candidate states about itself. An
 * index that stays ambiguous is left out of the map and renders no rating at all: attributing
 * "Major" to the wrong sentence is worse for a clinician than attributing nothing, and the
 * backend warns that picking arbitrarily from a candidate set is how a client ends up showing
 * one partner's rating beside another partner's citation.
 *
 * Gated on `unstatedFindingSeverities` deliberately, not on `severity` being present — the
 * backend check asks of the whole answer, so an answer that states its ratings somewhere is
 * absent from the list and must not have them repeated.
 */
export function resolveFindingSeverities(
  answer: string,
  references: AiReference[],
  safetyWarnings: AiSafetyWarning[],
  unstatedFindingSeverities: number[] | null | undefined,
): Map<number, string> {
  const resolved = new Map<number, string>();
  if (!unstatedFindingSeverities?.length || !safetyWarnings?.length) return resolved;

  const refByIndex = new Map(references.map((ref) => [ref.index, ref]));
  const claims = claimTextByCitation(answer);

  for (const index of unstatedFindingSeverities) {
    const ref = refByIndex.get(index);
    if (!ref) continue;
    const finding = splitFindingUuid(ref.resourceUuid);
    if (!finding) continue;

    const candidates = safetyWarnings.filter(
      (warning) =>
        warning.severity?.trim() &&
        warning.type?.toLowerCase() === finding.type.toLowerCase() &&
        warning.drug?.toLowerCase() === finding.drug.toLowerCase(),
    );
    if (candidates.length === 0) continue;

    if (candidates.length === 1) {
      resolved.set(index, candidates[0].severity!.trim());
      continue;
    }

    // Several findings share this (type, drug). Try the strong evidence before the weak, and
    // stop at the first tier that identifies exactly one candidate — a tier that matches none
    // says nothing, and a tier that matches several is the ambiguity this must refuse.
    const claim = normalize(claims.get(index) ?? '');
    const tiersPerCandidate = candidates.map(candidateLeadTiers);
    for (let tier = 0; tier < 2; tier++) {
      const matched = candidates.filter((_, i) => tierMatches(tiersPerCandidate[i][tier], claim));
      if (matched.length === 1) {
        resolved.set(index, matched[0].severity!.trim());
        break;
      }
    }
  }

  return resolved;
}
