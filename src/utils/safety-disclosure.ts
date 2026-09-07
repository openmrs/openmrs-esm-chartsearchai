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
        // No finiteness check: the pattern captures only digit groups, so `Number` cannot
        // produce NaN here, and a clause the suite cannot discriminate is one the next change
        // removes for free.
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
  // Guarded like `severity` beside it, and for the same reason: this runs inside a render memo
  // with no error boundary above it, so a non-string here would take the answer, its citations
  // and its safety chips off the screen. Guarding one member of the family and not the others
  // is how the panel stayed one malformed field away from blanking.
  if (typeof detail !== 'string') return '';
  const dash = detail.indexOf(' — ');
  const stop = detail.indexOf('. ');
  const cut = [dash, stop].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  return cut === undefined ? detail : detail.slice(0, cut);
}

/**
 * The three groups of leads, as a fixed tuple. Fixed is what lets the caller take the group
 * count from any one candidate: a conditionally-present group would have to change this type,
 * so the compiler carries the invariant rather than a runtime guard nothing could discriminate.
 */
type LeadGroups = [bridges: string[], partner: string[], leadClause: string[]];

/**
 * The groups of strings that can identify a warning in the answer's own words.
 *
 * Three groups, and their ORDER carries no precedence — {@link electCandidate} is deliberately
 * order-free, so a group can only ever corroborate or contradict, never outrank. Reversing this
 * array changes no behaviour, and nothing here should be read as a ladder:
 *
 * - `bridges` — `chartOrderBridges`, typed fields published so a client is handed two strings
 *   rather than a sentence to parse, and carrying both vocabularies: a chip names its substances
 *   as the knowledge base does (`Methylprednisolone`) while the answer names the same
 *   prescription as the chart does (`Solu-Medrol 125mg/5ml`), both observed live in the same
 *   position.
 * - `partner` — the partner substance alone (see {@link partnerFromLead}), for an answer that
 *   names the finding more briefly than the module does.
 * - `leadClause` — the module's whole *"X interacts with active order Y"* sentence, which is the
 *   longest and hardest to collide with, but rests on a delimiter the backend does not promise.
 *
 * Every lead is passed through {@link discriminatingLeads} first, because a bare name is far
 * easier to confuse than the anchored sentence.
 */
function candidateLeadTiers(warning: AiSafetyWarning): LeadGroups {
  // Guarded at the element level, not just the array: a null entry or a non-string member would
  // reach `normalize` and throw inside a render memo. An Array.isArray on the outside alone was
  // the same partial guard this file has now been caught making twice.
  const bridges = Array.isArray(warning.chartOrderBridges) ? warning.chartOrderBridges : [];
  const bridgeLeads = bridges.flatMap((bridge) =>
    [bridge?.orderDisplay, bridge?.substance].filter((value): value is string => typeof value === 'string'),
  );
  const lead = leadClause(warning.detail);
  return [bridgeLeads, [partnerFromLead(lead)], [lead]];
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
 * The candidates a group's leads single out, after removing the leads every candidate shares.
 *
 * A lead the whole set carries cannot tell its members apart, and it does worse than nothing:
 * measured live, every finding of one set bridged the SUBJECT's own order, so all seven matched
 * that order's display, the one decisive lead was swamped, the group went ambiguous and six
 * correct ratings were discarded. `discriminatingLeads` cannot see this on its own — it compares
 * a lead against the finding's drug NAME, and the shared lead here was that drug's order display.
 */
function matchesInGroup(
  candidates: AiSafetyWarning[],
  leadsPerCandidate: string[][],
  claim: string,
): AiSafetyWarning[] {
  const shared = leadsPerCandidate.reduce<string[]>(
    (common, leads) => common.filter((lead) => leads.includes(lead)),
    leadsPerCandidate[0] ?? [],
  );
  return candidates.filter((_candidate, i) =>
    leadsPerCandidate[i].some((lead) => !shared.includes(lead) && namesLead(claim, lead)),
  );
}

/**
 * Whether the claim names the lead as a whole term rather than inside a longer one.
 *
 * A bare substring test is what made the bridge group unsafe: `Cortisone` occurs inside
 * `Hydrocortisone`, so a chip bridged to the first was resolved for a sentence about the second
 * — while the `leadClause` group, anchored by the *"interacts with active order …"* phrase, got
 * the same case right.
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
 * ORDER-FREE by construction: both loops below are set predicates, so permuting the groups
 * cannot change the outcome. That is the safety property — a lead group can corroborate or
 * contradict, never outrank — and it is why nothing may describe these as a precedence ladder.
 * Three ways to refuse, each reached by a real or reproduced payload:
 *
 * - no tier names exactly one candidate: nothing was identified;
 * - two tiers name DIFFERENT candidates: the evidence contradicts itself, which is stronger
 *   evidence of ambiguity than either tier is of its own winner;
 * - a group was ambiguous and its matches do NOT include the winner: that group positively
 *   rejected the candidate another group elected, so an ambiguous group narrows the field rather
 *   than being discarded.
 */
function electCandidate(perGroupMatches: AiSafetyWarning[][]): AiSafetyWarning | null {
  let winner: AiSafetyWarning | null = null;
  for (const matches of perGroupMatches) {
    if (matches.length !== 1) continue;
    if (winner && winner !== matches[0]) return null;
    winner = matches[0];
  }
  if (!winner) return null;
  for (const matches of perGroupMatches) {
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
  // Array.isArray on both: `misattributedOrderCitations` got this guard for exactly this reason
  // one round earlier, and guarding one member of a family is not guarding the family. A
  // non-iterable here would throw inside a render memo with no error boundary above it.
  if (!Array.isArray(unstatedFindingSeverities) || !Array.isArray(safetyWarnings)) return resolved;
  if (unstatedFindingSeverities.length === 0 || safetyWarnings.length === 0) return resolved;

  const refByIndex = new Map(references.map((ref) => [ref.index, ref]));
  const claims = claimTextByCitation(answer);
  // Which candidate set each index belongs to, so an incompletely-resolved set can be withdrawn
  // whole below. One map, keyed by index: an earlier version counted set members in a second map
  // as it looped, which counted OCCURRENCES while this counts distinct indices — so a list that
  // named one index twice reported a set larger than could ever resolve, and withdrew it. The
  // backend does not repeat an index today, and its own javadoc calls that dedup "belt and
  // braces rather than load-bearing", so deriving both numbers from one map is what keeps this
  // from depending on that.
  const setOfIndex = new Map<number, string>();
  // Those whose marker the prose actually carries. Completeness is judged over these only; the
  // injectivity check below deliberately spans the whole set, including the uncited ones.
  const citedIndices = new Set<number>();
  // Which candidate each index elected, so the sweep can check the elections are INJECTIVE.
  const electedOf = new Map<number, AiSafetyWarning>();

  for (const index of unstatedFindingSeverities) {
    const ref = refByIndex.get(index);
    if (!ref) continue;
    const finding = splitFindingUuid(ref.resourceUuid);
    if (!finding) continue;

    const candidates = safetyWarnings.filter(
      (warning) =>
        // typeof, not just a truthy check: a non-string rating would throw inside this render
        // memo and take the whole answer panel down with it.
        //
        // This filter also DEFINES the candidate set as the rated subset of the chips sharing
        // this (type, drug) — the backend's set includes unrated ones. That is what makes the
        // single-candidate shortcut below sound, and it is only correct because the backend
        // never lists a finding whose record states no rating.
        typeof warning.severity === 'string' &&
        warning.severity.trim() !== '' &&
        warning.type?.toLowerCase() === finding.type.toLowerCase() &&
        warning.drug?.toLowerCase() === finding.drug.toLowerCase(),
    );
    if (candidates.length === 0) continue;

    // Findings sharing one (type, drug) are a candidate SET, and the backend requires a client
    // to "render them together or render none" — so track the set this index belongs to.
    // An index the prose never carries has no claim to be identified from, and nothing renders
    // for it either way — so it is not a member the all-or-none sweep can fail on. Measured
    // live: the model wrote `[37]` where reference `367` was published, and counting the
    // uncited `367` as a failed member withdrew every correct rating in its set.
    const setKey = `${finding.type.toLowerCase()}:${finding.drug.toLowerCase()}`;
    setOfIndex.set(index, setKey);
    if (claims.has(index)) citedIndices.add(index);

    if (candidates.length === 1) {
      resolved.set(index, candidates[0].severity!.trim());
      electedOf.set(index, candidates[0]);
      continue;
    }

    // Several findings share this (type, drug), so the answer's own sentence has to single one
    // out. Each lead group is asked of the whole candidate list and the verdicts are reconciled
    // by `electCandidate`, which refuses on every disagreement — group order decides nothing.
    const claim = normalize(claims.get(index) ?? '');
    const leadsPerCandidate = candidates.map(candidateLeadTiers);
    // Every candidate yields the same three groups — `LeadGroups` is a fixed tuple, so the
    // compiler holds that rather than a runtime guard the suite could not discriminate.
    const perGroupMatches = leadsPerCandidate[0].map((_unused, group) =>
      matchesInGroup(
        candidates,
        candidates.map((candidate, i) => discriminatingLeads(leadsPerCandidate[i][group], candidate.drug)),
        claim,
      ),
    );
    const winner = electCandidate(perGroupMatches);
    if (winner) {
      resolved.set(index, winner.severity!.trim());
      electedOf.set(index, winner);
    }
  }

  // All or none per candidate set. Measured live: an answer listing five findings one line each
  // resolved only the two carrying a chart-order bridge, so a clinician saw two Majors and
  // three bare items — and a bare item reads as "no rating exists", not "we declined". The
  // backend's instruction is to render the set together or not at all, because a partial
  // rendering is how a reader infers a ranking the module never stated.
  const indicesBySet = new Map<string, number[]>();
  for (const [index, setKey] of setOfIndex) {
    indicesBySet.set(setKey, [...(indicesBySet.get(setKey) ?? []), index]);
  }
  for (const indices of indicesBySet.values()) {
    // Completeness over the CITED members only: an index the prose never carries renders nothing
    // either way, so it cannot be a member the set fails on.
    const complete = indices.filter((index) => citedIndices.has(index)).every((index) => resolved.has(index));
    // And INJECTIVE. Two distinct citations of one set electing the same finding cannot both be
    // right, so at most one badge is correct and there is no way to tell which. Measured live:
    // the model put every marker on one line — "Solu-Medrol 125mg/5ml [350] [177] [179] [352]
    // [353] [354]" — so the run-merge handed all of them that one claim, four indices elected
    // the Methylprednisolone finding, and three Moderate ratings rendered as Major. The answer
    // cache then replayed it byte-for-byte on every retry.
    // Injectivity over EVERY member, cited or not. An uncited index still consumes a candidate,
    // and excluding it here let one rated finding be elected by two citations while only the
    // cited one showed a badge — a guess dressed as a resolution.
    const elected = indices.map((index) => electedOf.get(index)).filter(Boolean);
    const injective = new Set(elected).size === elected.length;
    if (!complete || !injective) {
      for (const index of indices) resolved.delete(index);
    }
  }

  return resolved;
}
