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
export const REFERENCE_RESOURCE_TYPES = ['drug_reference', 'safety_finding', 'drug_class_note'] as const;
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
 * A factory rather than a shared constant, defensively: the answer renderer drives it with
 * `exec`, which parks `lastIndex` mid-string if a caller ever stops early. Nothing does today —
 * `matchAll` clones per spec, and the `exec` loop runs to completion, which resets it — so
 * sharing one instance would currently pass every test. That is why the freshness property is
 * asserted directly rather than left to a behavioural test that cannot see it.
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
export type ClaimDirection = 'trailing' | 'leading';

export function claimTextByCitation(answer: string, direction: ClaimDirection = 'trailing'): Map<number, string> {
  const matches = [...answer.matchAll(citationGroupPattern())];

  const runs: Array<{ start: number; end: number; groups: RegExpMatchArray[] }> = [];
  for (const match of matches) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const open = runs[runs.length - 1];
    // Horizontal whitespace only: `\s` would let a NEWLINE merge two runs, and the second would
    // then take the FIRST marker's line — falsifying the confinement below rather than supporting
    // it.
    if (open && /^[^\S\n]*[,;]?[^\S\n]*$/.test(answer.slice(open.end, start))) {
      open.end = end;
      open.groups.push(match);
    } else {
      runs.push({ start, end, groups: [match] });
    }
  }

  const claims = new Map<number, string>();
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    let claim: string;
    if (direction === 'trailing') {
      // The prose BEFORE the marker, confined to the marker's own line.
      const preceding = answer.slice(runs[i - 1]?.end ?? 0, run.start);
      const lineStart = preceding.lastIndexOf('\n');
      claim = lineStart < 0 ? preceding : preceding.slice(lineStart + 1);
    } else {
      // The prose AFTER the marker, up to the next marker and confined to this line.
      const following = answer.slice(run.end, runs[i + 1]?.start ?? answer.length);
      const lineEnd = following.indexOf('\n');
      claim = lineEnd < 0 ? following : following.slice(0, lineEnd);
      // ...but a marker immediately followed by a sentence terminator CLOSES its claim: nothing
      // after it can be its subject. Without this, an ordinary trailing-marker list self-
      // contested — the leading claim of marker N was sentence N+1, a complete claim about the
      // next candidate, so the leading reading was a clean shift-by-one bijection that disagreed
      // with the correct trailing one and every rating was withheld. Live, four correct ratings
      // were discarded; whether an answer came out fully badged or fully blank turned on whether
      // the model happened to write one more sentence after its last citation.
      if (/^[^\S\n]*[.;:!?]/.test(following)) claim = '';
    }
    for (const group of run.groups) {
      for (const index of parseCitationIndices(group[1])) {
        if (!claims.has(index)) claims.set(index, claim);
      }
    }
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
 * An order display with its dose tokens dropped — `Solu-Medrol 125mg/5ml` → `Solu-Medrol`.
 *
 * The model routinely re-writes a chart order in short form after reproducing the module's own
 * phrase: live, *"Clarithromycin interacts with active order Solu-Medrol [350]"*, where the
 * bridge carries the full display. Without this the two MAJOR findings of that answer refused
 * while a Moderate one beside them resolved, so the reader saw a rating on the finding the
 * answer called least concerning and none on the two graver ones.
 *
 * Empty when there is no dose token to drop, so it never duplicates the full display as a lead.
 */
function shortOrderDisplay(display: string): string {
  const tokens = display.trim().split(/\s+/);
  // Trailing tokens that BEGIN with a digit — `125mg/5ml`, `90mcg`, `400mg`. Not merely tokens
  // CONTAINING one: a digit inside a product's NAME is not a dose, and truncating there yielded
  // the generic prefix `Vitamin` from `Vitamin B12 1000mcg`, which then matched a sentence about
  // `Vitamin D 50000iu` and elected the wrong finding's rating. Every later guard missed it — the
  // prefix is not the finding's own drug, is not shared by all candidates, and matched only one
  // group, so nothing contradicted it and one index elected one candidate.
  let nameEnd = tokens.length;
  while (nameEnd > 0 && /^\d/.test(tokens[nameEnd - 1])) nameEnd -= 1;
  if (nameEnd <= 0 || nameEnd === tokens.length) return '';
  return tokens.slice(0, nameEnd).join(' ');
}

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
  const bridgeLeads = bridges.flatMap((bridge) => {
    const stated = [bridge?.orderDisplay, bridge?.substance].filter(
      (value): value is string => typeof value === 'string',
    );
    const short = typeof bridge?.orderDisplay === 'string' ? shortOrderDisplay(bridge.orderDisplay) : '';
    return short ? [...stated, short] : stated;
  });
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
 * module's phrase is absent this group yields nothing, and the others are read anyway — all
 * three always are.
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
      // A lead with no text carries no evidence to match on. It does NOT "match everything":
      // `namesLead` would not terminate on it, which is why that function refuses an empty lead
      // outright too. An operator's dataset can rate a rule and leave its note empty.
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
export function namesLead(claim: string, lead: string): boolean {
  // An empty lead is not merely uninformative — `indexOf('')` returns `from` for every `from`, so
  // the scan below would never advance and never terminate. It is filtered out upstream, but a
  // guard whose failure mode is a frozen render thread does not get to rely on that.
  if (lead === '') return false;
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
 * The one candidate the answer's sentence identifies, or null to refuse.
 *
 * The whole rule: the lead groups, between them, must name exactly ONE candidate. That subsumes
 * every refusal this used to spell out separately — two groups naming different candidates, and
 * a group that is ambiguous or that excludes another group's winner, all put a second candidate
 * into the union — and it closes the case those checks missed, where an ambiguous group was a
 * strict SUPERSET of the winner. That group then excluded nobody, so it decided nothing, while a
 * group blind to the second candidate decided everything: live, a Moderate Hydrocortisone
 * finding rendered Major because its sentence also mentioned a bridged Methylprednisolone.
 *
 * Order-free by construction — a set union cannot depend on the order of the groups. That is the
 * safety property (a group can corroborate or contradict, never outrank), and it is why nothing
 * anywhere may describe these groups as a precedence ladder.
 */
function electCandidate(perGroupMatches: AiSafetyWarning[][]): AiSafetyWarning | null {
  const named = new Set(perGroupMatches.flat());
  return named.size === 1 ? [...named][0] : null;
}

/** Splits a safety finding's synthetic uuid (`interaction:Clarithromycin`) into type and drug. */
function splitFindingUuid(resourceUuid: string): { type: string; drug: string } | null {
  const colon = resourceUuid?.indexOf(':') ?? -1;
  if (colon <= 0 || colon === resourceUuid.length - 1) return null;
  return { type: resourceUuid.slice(0, colon), drug: resourceUuid.slice(colon + 1) };
}

/** One reading of the answer: which candidate each citation elects, plus the per-set bookkeeping. */
interface ClaimReading {
  resolved: Map<number, string>;
  setOfIndex: Map<number, string>;
  citedIndices: Set<number>;
  electedOf: Map<number, AiSafetyWarning>;
}

function readClaims(
  references: AiReference[],
  safetyWarnings: AiSafetyWarning[],
  unstatedFindingSeverities: number[],
  claims: Map<number, string>,
): ClaimReading {
  const resolved = new Map<number, string>();
  const setOfIndex = new Map<number, string>();
  const citedIndices = new Set<number>();
  const electedOf = new Map<number, AiSafetyWarning>();
  // Array.isArray on `references` too — the last member of this family without the guard its
  // siblings got. Not reachable from this backend, but the panel has no error boundary above it.
  const refByIndex = new Map((Array.isArray(references) ? references : []).map((ref) => [ref.index, ref]));

  for (const index of unstatedFindingSeverities) {
    const ref = refByIndex.get(index);
    if (!ref) continue;
    const finding = splitFindingUuid(ref.resourceUuid);
    if (!finding) continue;

    const candidates = safetyWarnings.filter(
      (warning) =>
        // typeof, not a truthy check: a non-string rating would throw inside a render memo and
        // take the whole answer panel down. This filter also DEFINES the candidate set as the
        // RATED subset of the chips sharing this (type, drug), which is what makes the
        // single-candidate shortcut sound — the backend never lists a finding whose record
        // states no rating.
        typeof warning.severity === 'string' &&
        warning.severity.trim() !== '' &&
        warning.type?.toLowerCase() === finding.type.toLowerCase() &&
        warning.drug?.toLowerCase() === finding.drug.toLowerCase(),
    );
    if (candidates.length === 0) continue;

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

  return { resolved, setOfIndex, citedIndices, electedOf };
}

/** The candidate sets this reading identified COMPLETELY and INJECTIVELY. */
function soundSets(reading: ClaimReading): Set<string> {
  const indicesBySet = new Map<string, number[]>();
  for (const [index, setKey] of reading.setOfIndex) {
    indicesBySet.set(setKey, [...(indicesBySet.get(setKey) ?? []), index]);
  }

  const sound = new Set<string>();
  for (const [setKey, indices] of indicesBySet) {
    // Completeness over the CITED members only — an index the prose never carries renders
    // nothing either way. Injectivity over EVERY member: two citations of one set electing the
    // same finding cannot both be right, and an uncited index still consumes a candidate.
    const complete = indices.filter((i) => reading.citedIndices.has(i)).every((i) => reading.resolved.has(i));
    const elected = indices.map((i) => reading.electedOf.get(i)).filter(Boolean);
    if (complete && new Set(elected).size === elected.length) sound.add(setKey);
  }
  return sound;
}

/**
 * The rating to render beside each citation named in `unstatedFindingSeverities`.
 *
 * The backend states plainly that the rating "cannot be joined to a chip: chips carry no
 * citation index, and `(type, drug)` does not identify one". So this does not attempt that
 * join. It narrows to the candidates sharing the finding's `(type, drug)` and requires the
 * answer's own sentence to single ONE of them out. An index that stays ambiguous renders no
 * rating: attributing "Major" to the wrong sentence is worse than attributing nothing.
 *
 * A marker's subject may sit on EITHER SIDE of it, and one reading cannot tell which. Live, both
 * occur: *"…active order Methylprednisolone [350]"* trails its subject, while *"Apart from
 * Prednisone, the interacting orders are [364] Methylprednisolone, [365] Budesonide, …"* leads
 * it — and that second shape resolved as a clean BIJECTION under the trailing reading, shifted
 * by one, rendering the Major Methylprednisolone interaction as Moderate. Completeness and
 * injectivity cannot see a rotation, because a rotation is both.
 *
 * So both readings are taken, and a set is withheld where both identify it completely and
 * injectively AND they elect different findings — the layout then does not determine the
 * mapping, and neither reading is evidence for the other. Where they agree, orientation never
 * mattered (a single-candidate set resolves the same either way). Where only the leading reading
 * works, the answer is written the way this module does not read, and refusing is safer than
 * adopting an orientation on the strength of one example.
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
  // Array.isArray on both: guarding one member of this family is not guarding the family, and a
  // non-iterable would throw inside a render memo with no error boundary above it.
  if (!Array.isArray(unstatedFindingSeverities) || !Array.isArray(safetyWarnings)) return new Map();
  if (unstatedFindingSeverities.length === 0 || safetyWarnings.length === 0) return new Map();

  const trailing = readClaims(references, safetyWarnings, unstatedFindingSeverities, claimTextByCitation(answer));
  const leading = readClaims(
    references,
    safetyWarnings,
    unstatedFindingSeverities,
    claimTextByCitation(answer, 'leading'),
  );
  const soundTrailing = soundSets(trailing);
  const soundLeading = soundSets(leading);

  // Which findings the trailing reading claims for SOME citation of each set.
  const claimedByTrailing = new Map<string, Set<AiSafetyWarning>>();
  for (const [index, setKey] of trailing.setOfIndex) {
    const elected = trailing.electedOf.get(index);
    if (!elected) continue;
    const claimed = claimedByTrailing.get(setKey) ?? new Set<AiSafetyWarning>();
    claimed.add(elected);
    claimedByTrailing.set(setKey, claimed);
  }

  const contested = new Set<string>();
  for (const [index, setKey] of trailing.setOfIndex) {
    // Both readings identify the set and disagree — a permutation within the same findings.
    if (soundTrailing.has(setKey) && soundLeading.has(setKey)) {
      if (trailing.electedOf.get(index) !== leading.electedOf.get(index)) contested.add(setKey);
    }

    // Or the leading reading names a finding the trailing reading claims for NO citation of this
    // set. That is not a shift artifact; it is a genuine alternative parse, so the layout does
    // not determine the mapping.
    //
    // This is the check that survives a MULTI-LINE answer, and it is why the one above is not
    // enough. Trailing claims are line-confined, so in any multi-line answer a trailing marker
    // sits at end-of-line and its leading claim is empty — the leading reading is then never
    // complete, never sound, and the disagreement rule above is structurally off. Live, a single
    // marker-written-before-its-drug line among trailing ones was read backwards, uncontested:
    // "Hydrocortisone aside, the order that matters most is [350] Solu-Medrol 125mg/5ml…" badged
    // the MAJOR Methylprednisolone finding as Moderate, scavenging Hydrocortisone's rating from
    // the lead-in, next to a correctly-badged Major.
    const led = leading.electedOf.get(index);
    if (led && !claimedByTrailing.get(setKey)?.has(led)) contested.add(setKey);
  }

  const resolved = new Map<number, string>();
  for (const [index, setKey] of trailing.setOfIndex) {
    if (!soundTrailing.has(setKey) || contested.has(setKey)) continue;
    const severity = trailing.resolved.get(index);
    if (severity !== undefined) resolved.set(index, severity);
  }
  return resolved;
}
