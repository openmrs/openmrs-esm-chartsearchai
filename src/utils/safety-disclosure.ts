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
const REFERENCE_RESOURCE_TYPES = ['drug_reference', 'safety_finding', 'drug_class_note'] as const;
const REFERENCE_RESOURCE_TYPE_SET: ReadonlySet<string> = new Set(REFERENCE_RESOURCE_TYPES);

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
  return ref.group === 'reference' || REFERENCE_RESOURCE_TYPE_SET.has(ref.resourceType?.toLowerCase());
}

/**
 * Which kind of reference material a citation is, for labelling. DERIVED from the list above
 * rather than restated, so adding a type there is a compile error at every `ReferenceKind`
 * switch until it is labelled — the previous shape spelled the union out and bridged the two
 * with an `as`, which would have classified a new type and then labelled it "Reference
 * material" with no error anywhere.
 */
export type ReferenceKind = (typeof REFERENCE_RESOURCE_TYPES)[number] | 'other';

/**
 * Classifies a reference-group citation off the same list {@link isReferenceData} uses.
 * `other` is reachable and must be labelled neutrally: the predicate admits any citation whose
 * `group` is `reference`, including a type this client predates.
 */
export function referenceKind(ref: AiReference): ReferenceKind {
  const resourceType = ref.resourceType?.toLowerCase();
  return REFERENCE_RESOURCE_TYPES.find((known) => known === resourceType) ?? 'other';
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

/**
 * A fresh matcher for a citation marker group plus any single space before it, for stripping
 * markers out of prose.
 *
 * Shares {@link citationGroupPattern}'s one source string, so a change to marker syntax cannot
 * reach the renderer and the resolver while leaving the strippers behind — which would leak raw
 * `[350]` markers into the clipboard text and the reasoning preview. The behavioural difference
 * the two call sites DO have is whether they trim the result, and that stays at the call sites.
 */
export function citationStripPattern(): RegExp {
  return new RegExp(`\\s?${CITATION_GROUP_SOURCE}`, 'g');
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
    // A comma or semicolon between two marker groups still leaves them one attachment point:
    // the model writes "[356], [357]" as readily as "[356] [357]", and the first form used to
    // give the second marker a claim text of ", ".
    if (open && /^\s*[,;]?\s*$/.test(answer.slice(open.end, start))) {
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
 * `detail` is clinician-facing prose the module rewords freely and holds out as no contract, so
 * the delimiter split here is not promised. Truncation is NOT automatically harmless: a note
 * whose text breaks early can shorten the clause all the way down to the shared subject drug,
 * and a lead that short matches every claim about that drug — which is a false SINGLE match
 * wherever the sibling candidates' longer leads fail, not the ambiguity that would be refused.
 * {@link discriminatingLeads} is what makes that safe, by discarding a lead that cannot tell
 * this candidate from its siblings.
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
 * rather than a sentence to parse, and carrying both vocabularies — a chip names its substances
 * as the knowledge base does (`Methylprednisolone`) while the answer names the same
 * prescription as the chart does (`Solu-Medrol 125mg/5ml`), and both spellings are observed live
 * in the same position. Tier 1 is the `detail` lead clause, which is longer and therefore
 * harder to collide with, but rests on a delimiter the backend does not promise.
 *
 * Every lead is passed through {@link discriminatingLeads} before it is matched, because a bare
 * name is far easier to confuse than tier 1's anchored phrase.
 */
function candidateLeadTiers(warning: AiSafetyWarning): string[][] {
  const bridges = warning.chartOrderBridges ?? [];
  const lead = leadClause(warning.detail);
  return [bridges.flatMap((bridge) => [bridge.orderDisplay, bridge.substance]), [partnerFromLead(lead)], [lead]];
}

/**
 * The partner substance named at the end of the module's own *"X interacts with active order Y"*
 * lead — `Y`.
 *
 * Needed because the answer often names the finding in a SHORTER form than the module does.
 * Live: asked to list the interactions one line each, the answer wrote just `"Prednisone Co
 * 5mg [352]"`, so the full lead clause appears nowhere and only the two findings carrying a
 * bridge could be identified — leaving the list half-badged, which the backend forbids.
 *
 * A narrower slice of the sentence this already parses, not a new dependency on it: where the
 * module's phrase is absent the tier yields nothing and the next one is tried.
 */
function partnerFromLead(lead: string): string {
  const at = lead.lastIndexOf(' order ');
  return at < 0 ? '' : lead.slice(at + ' order '.length);
}

/**
 * Drops the leads that cannot tell this candidate from its siblings.
 *
 * Candidates are selected on the finding's own `(type, drug)`, so EVERY candidate is about that
 * drug and every claim naming the finding names it too. A lead equal to that drug therefore
 * matches every claim and would single its candidate out for all of them — measured: one chip
 * bridging its own subject drug took four of five ratings and reported them all as its own
 * Major. A lead the whole answer shares is not evidence about one candidate.
 */
function discriminatingLeads(leads: string[], drug: string): string[] {
  const shared = normalize(drug ?? '');
  return (
    leads
      .map((lead) => normalize(lead ?? ''))
      // A lead with no text is contained in every string, so it would match vacuously and win any
      // tie it was part of. An operator's dataset can rate a rule and leave its note empty.
      .filter((lead) => lead !== '' && lead !== shared)
  );
}

/** Word-ish characters, for boundary testing. `/` and `-` count so a lead cannot match half of a
 *  combination product (`aspirin` inside `aspirin/dipyridamole`) or half a hyphenated brand. */
function isWordish(character: string): boolean {
  return character !== '' && /[a-z0-9/-]/.test(character);
}

/**
 * Whether the claim names the lead as a whole term rather than inside a longer one.
 *
 * A bare substring test is what made tier 0 weaker than the tier it preempts: `Cortisone`
 * occurs inside `Hydrocortisone`, so a chip bridged to the first was resolved for a sentence
 * about the second — while tier 1, whose lead is the anchored *"interacts with active order …"*
 * phrase, got the same case right.
 */
function namesLead(claim: string, lead: string): boolean {
  for (let from = 0; ; from += 1) {
    const at = claim.indexOf(lead, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : claim[at - 1];
    const after = at + lead.length >= claim.length ? '' : claim[at + lead.length];
    if (!isWordish(before) && !isWordish(after)) return true;
    from = at;
  }
}

/**
 * Reconciles the per-tier match lists into one candidate, or null to refuse.
 *
 * The tiers are ordered strongest first, but tier order is not allowed to decide anything on
 * its own — three ways to refuse, and each was reached by a real or reproduced payload:
 *
 * - no tier names exactly one candidate: nothing was identified;
 * - two tiers name DIFFERENT candidates: the evidence contradicts itself, which is stronger
 *   evidence of ambiguity than either tier is of its own winner;
 * - a tier was ambiguous and its matches do NOT include the winner: that tier positively
 *   rejected the candidate a weaker tier went on to elect, and an ambiguous strong tier must
 *   narrow the field rather than be discarded.
 */
function electCandidate(perTierMatches: AiSafetyWarning[][]): AiSafetyWarning | null {
  let winner: AiSafetyWarning | null = null;
  for (const matches of perTierMatches) {
    if (matches.length !== 1) continue;
    if (winner && winner !== matches[0]) return null;
    winner = matches[0];
  }
  if (!winner) return null;
  for (const matches of perTierMatches) {
    if (matches.length > 1 && !matches.includes(winner)) return null;
  }
  return winner;
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
  // Which candidate set each resolved index came from, so an incompletely-resolved set can be
  // withdrawn whole below.
  const setOfIndex = new Map<number, string>();
  const setSize = new Map<string, number>();

  for (const index of unstatedFindingSeverities) {
    const ref = refByIndex.get(index);
    if (!ref) continue;
    const finding = splitFindingUuid(ref.resourceUuid);
    if (!finding) continue;

    const candidates = safetyWarnings.filter(
      (warning) =>
        // typeof, not just a truthy check: a non-string rating would throw inside this render
        // memo and take the whole answer panel down with it.
        typeof warning.severity === 'string' &&
        warning.severity.trim() !== '' &&
        warning.type?.toLowerCase() === finding.type.toLowerCase() &&
        warning.drug?.toLowerCase() === finding.drug.toLowerCase(),
    );
    if (candidates.length === 0) continue;

    // Findings sharing one (type, drug) are a candidate SET, and the backend requires a client
    // to "render them together or render none" — so track the set this index belongs to.
    const setKey = `${finding.type.toLowerCase()}:${finding.drug.toLowerCase()}`;
    setOfIndex.set(index, setKey);
    setSize.set(setKey, (setSize.get(setKey) ?? 0) + 1);

    if (candidates.length === 1) {
      resolved.set(index, candidates[0].severity!.trim());
      continue;
    }

    // Several findings share this (type, drug), so the answer's own sentence has to single one
    // out. Each tier is asked of the whole candidate list, and the verdicts are then reconciled
    // — see `electCandidate`, which refuses on every disagreement rather than letting tier
    // order pick a winner.
    const claim = normalize(claims.get(index) ?? '');
    const tiersPerCandidate = candidates.map(candidateLeadTiers);
    const perTierMatches = tiersPerCandidate[0].map((_, tier) =>
      candidates.filter((candidate, i) =>
        discriminatingLeads(tiersPerCandidate[i][tier], candidate.drug).some((lead) => namesLead(claim, lead)),
      ),
    );
    const winner = electCandidate(perTierMatches);
    if (winner) resolved.set(index, winner.severity!.trim());
  }

  // All or none per candidate set. Measured live: an answer listing five findings one line each
  // resolved only the two carrying a chart-order bridge, so a clinician saw two Majors and
  // three bare items — and a bare item reads as "no rating exists", not "we declined". The
  // backend's instruction is to render the set together or not at all, because a partial
  // rendering is how a reader infers a ranking the module never stated.
  for (const [setKey, expected] of setSize) {
    const resolvedInSet = [...setOfIndex].filter(([index, key]) => key === setKey && resolved.has(index));
    if (resolvedInSet.length !== expected) {
      for (const [index] of resolvedInSet) resolved.delete(index);
    }
  }

  return resolved;
}
