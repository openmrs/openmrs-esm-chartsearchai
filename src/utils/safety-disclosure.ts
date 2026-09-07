import type { AiReference, AiSafetyWarning } from '../api/chartsearchai';

/**
 * Resource types the backend classifies as module-supplied reference material rather than as
 * the patient's own record. Used only as a fallback: {@link isReferenceData} prefers the
 * response's own `group`, and this list covers a response that predates that field.
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

/** The severity words the module itself recognises. Anything else a dataset supplies is *unrated*. */
export type SeverityTone = 'major' | 'moderate' | 'minor' | 'unknown' | 'unrated';

/**
 * Classifies a dataset's rating for styling only.
 *
 * `severity` is not a closed vocabulary — an operator's dataset supplies its own words — so an
 * unrecognised value maps to `unrated` and gets a neutral treatment. It must NOT be coerced to
 * a tier: treating an unknown word as a floor would assert a ranking the dataset never stated.
 * The rating is always displayed verbatim; only the colour comes from this.
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

const CITATION_GROUP_PATTERN = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

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
 */
export function claimTextByCitation(answer: string): Map<number, string> {
  const matches = [...answer.matchAll(CITATION_GROUP_PATTERN)];

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
      for (const raw of group[1].split(/\s*,\s*/)) {
        const index = Number(raw);
        if (!Number.isFinite(index)) continue;
        // One index cited from two different claims has no single claim text. Blank it rather
        // than letting the last one win, so the caller resolves nothing instead of guessing.
        claims.set(index, claims.has(index) ? '' : claim);
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
 * `detail` is clinician-facing prose the module rewords freely and holds out as no contract, and
 * it embeds the patient's own order display unquoted, so an unusual prescription name can put a
 * delimiter into the string early. That only ever SHORTENS the clause, which makes the
 * containment test in {@link resolveFindingSeverities} match more candidates and therefore
 * resolve nothing — the fail-safe direction.
 */
function leadClause(detail: string): string {
  const dash = detail.indexOf(' — ');
  const stop = detail.indexOf('. ');
  const cut = [dash, stop].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  return cut === undefined ? detail : detail.slice(0, cut);
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
 * The response carries no explicit link from a `safety_finding` citation to the
 * `safetyWarnings` entry that holds its rating, so this reconstructs one — and REFUSES to
 * guess. A finding's uuid is `<type>:<drug>`, which narrows the candidates; where that still
 * leaves several (this patient has five `interaction:Clarithromycin` findings) the claim the
 * marker is attached to has to single one out by reproducing that candidate's leading clause.
 * An index that stays ambiguous is left out of the map and renders no rating at all:
 * attributing "Major" to the wrong sentence is worse for a clinician than attributing nothing.
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

    const claim = normalize(claims.get(index) ?? '');
    const matched = candidates.filter((candidate) => {
      const lead = normalize(leadClause(candidate.detail));
      // A candidate with no lead clause carries no evidence to match on, and `''` is contained
      // in every string — so without this it would match vacuously and win any tie it was part
      // of, attributing a rating to a sentence nothing tied it to. An operator-supplied dataset
      // can leave a rule's note empty while still rating it, so this is reachable.
      return lead !== '' && claim.includes(lead);
    });
    if (matched.length === 1) {
      resolved.set(index, matched[0].severity!.trim());
    }
  }

  return resolved;
}
