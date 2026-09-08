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
  return (
    ref.group === 'reference' ||
    (typeof ref.resourceType === 'string' && REFERENCE_RESOURCE_TYPE_SET.has(ref.resourceType.toLowerCase()))
  );
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
  const resourceType = typeof ref.resourceType === 'string' ? ref.resourceType.toLowerCase() : undefined;
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
  // `severity` is documented as null for a contraindication, an overdose and a class join, so a
  // second call site would crash on the value the wire states most often. The one call site today
  // feeds a value the resolver already type-guarded; this makes that not a precondition.
  if (typeof severity !== 'string') return 'unrated';
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

/**
 * THE CORPUS, named once because five notes in this file quoted it and two of them had drifted
 * (94 where the others said 98, with nothing to say whether that was an older measurement or a
 * mistake).
 *
 * "The live corpus" below always means the same thing: 46 answers captured from a running
 * server against the demo chart, of which 22 carry an `unstatedFindingSeverities` measurement
 * this module resolves, for 98 ratings in total. It is replayed on every change and a
 * byte-identical result is the regression bar. It is NOT in the repo — it lives in a scratch
 * directory — so a measurement quoted against it cannot be re-run from a clean checkout. Where
 * one of its answers turned out to decide a design choice, that answer is committed as a fixture
 * instead ({@link ANSWER_TWO_FAMILIES} is the case in point).
 */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * A clause that names a drug in order to EXCLUDE it, removed from an already-normalised claim.
 *
 * "Apart from Prednisone, the interacting orders are …" names Prednisone and says it is not one
 * of them. Reading that name as the claim's subject is not a near-miss: it elects the one
 * candidate the sentence rules out.
 *
 * Found by the fuzzer the moment it could write a foreign marker after the subject on a
 * marker-first line. Singly such an answer already refused — the forward reading disagreed —
 * but TWO exclusion lines in one answer scavenge from each other's preambles and produce a
 * complete, injective, wholly wrong bijection that nothing objects to:
 *
 *   "Apart from Prednisone, the interacting orders are [353] Dexamethasone
 *    Dexamethasone aside, the worry is [352] Prednisone Co 5mg [17]
 *    Consider Budesonide carefully [351]; the exposure rises."
 *
 * rendered [353] with Prednisone's rating and [352] with Dexamethasone's — a swapped pair.
 *
 * This is not a heuristic about which candidate is likelier; it is removing text that states
 * the opposite of what it was being read as. Where a claim's only candidate was named in such a
 * clause it now names none and the set refuses, and where the real subject sits outside the
 * clause the answer resolves that subject instead of refusing on a two-candidate window — so
 * this both removes wrong ratings and recovers correct ones.
 *
 * Operates on the lowercased output of {@link normalize}, which is why the patterns carry no
 * case flag.
 *
 * TWO CORRECTIONS, both of which had turned this into a source of wrong ratings rather than a
 * cure for them:
 *
 * `besides` was in the list and is not exclusive — in ordinary English "besides X" means IN
 * ADDITION TO X. "Clarithromycin will raise her Solu-Medrol levels, besides those of Prednisone
 * Co 5mg … [352]" had Prednisone stripped out, leaving Solu-Medrol as the only candidate named,
 * and rendered a Major rating where the truth was Moderate. Written with "as well as" instead
 * the same sentence correctly REFUSES, so the strip was turning a refusal into a wrong rating.
 *
 * And the span was bounded by CHARACTERS (60) rather than by tokens, with a lazy quantifier
 * that backtracks — so leftmost-match consumed the longest run it could before " aside,". Only
 * the noun immediately before "aside" is what a writer excluded. "…active order Prednisone Co
 * 5mg though dose timing aside, Solu-Medrol … [352]" had the module's own anchoring phrase for
 * Prednisone deleted, and rendered Major against a truth of Moderate. Both patterns now allow at
 * most FOUR tokens for the name, which a drug display fits ("Hydrocortisone Injection vial
 * 100mg") and a clause does not: "except Prednisone Co 5mg at her current dose," no longer
 * matches at all, so the claim keeps both names and refuses.
 */
/** At most four whitespace-separated tokens — a drug name, not a clause. See below. */
const EXCLUDED_NAME = String.raw`[^\s,;:.]+(?:[^\S\n]+[^\s,;:.]+){0,3}`;

const EXCLUSION_CLAUSES = [
  // "apart from X," / "unlike X," / "other than X," — the excluded name FOLLOWS the marker word.
  new RegExp(
    String.raw`\b(?:apart from|aside from|other than|unlike|except for|except)[^\S\n]+${EXCLUDED_NAME}[^\S\n]*[,;:]`,
    'g',
  ),
  // "X aside," — the excluded name PRECEDES it.
  new RegExp(String.raw`\b${EXCLUDED_NAME}[^\S\n]+aside[^\S\n]*[,;:]`, 'g'),
];

/**
 * Words that mark a tail as a CLAUSE rather than a dangling subject — see the use site.
 *
 * Determiners, auxiliaries, copulas, prepositions and conjunctions. Deliberately not a stop-word
 * list: a word belongs here only if a drug name or dose could never contain it, because a false
 * entry would make a rotation resolve.
 *
 * No verbs. Nine were here ('known', 'interacts', 'affected', 'raise', 'watch'…) and removing all
 * nine changed nothing — suite green, live corpus unchanged — because an English clause that
 * carries a verb carries a determiner or a preposition too. They were nine more chances to be
 * wrong in the direction that resolves a rotation, for no coverage.
 *
 * No individual entry is pinned by a test and none can be: a clause contains several of these, so
 * dropping one changes no verdict. What IS pinned is the test as a whole — removing the clause
 * check reddens two of the rotation tests.
 */
const CLAUSE_WORDS = new Set([
  'a',
  'an',
  'the',
  'this',
  'that',
  'these',
  'those',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'has',
  'have',
  'had',
  'do',
  'does',
  'did',
  'may',
  'might',
  'can',
  'could',
  'will',
  'would',
  'shall',
  'should',
  'must',
  'and',
  'but',
  'or',
  'nor',
  'so',
  'because',
  'if',
  'when',
  'while',
  'though',
  'although',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'from',
  'by',
  'about',
  'into',
  'than',
  'as',
  'her',
  'his',
  'their',
  'its',
  'they',
  'it',
  'she',
  'he',
  'also',
  'not',
  'no',
  'more',
  'most',
  'other',
  'others',
  'several',
  'both',
  'each',
  'any',
]);

function stripExclusions(claim: string): string {
  let stripped = claim;
  for (const pattern of EXCLUSION_CLAUSES) stripped = stripped.replace(pattern, ' ');
  return stripped;
}

/**
 * Which way {@link claimTextByCitation} reads a marker's claim: back to the previous marker,
 * line-confined (`trailing`) or not (`block`), or forward to the next, unconfined
 * (`block-leading`).
 *
 * There is no confined-forward member. `'leading'` was one until the reading itself was proved
 * redundant — see the note beside `objectingBlockLeading` — and leaving it in the union would
 * offer a caller a reading this module has established says nothing the unconfined one does not.
 */
export type ClaimDirection = 'trailing' | 'block' | 'block-leading';

/**
 * A sentence terminator that is not a decimal point inside a dose.
 *
 * `Digoxin Elixir 0.125mg` must not read as a sentence end: it does, the window-widening below
 * stops at it, and the very truncation it exists to prevent comes back. Measured — 183
 * mis-attributions survived until this exclusion was added. Same class as the digit-inside-a-name
 * note on {@link shortOrderDisplay}.
 */
const SENTENCE_END = /(?<!\d)[.;!?]|[.;!?](?!\d)/;

/**
 * The same terminator, global, for finding the LAST break in a span rather than asking whether
 * one exists. Declared from {@link SENTENCE_END} rather than retyped so the two cannot drift —
 * a decimal-point exclusion present in one and missing in the other would show up only as a
 * window that disagrees with itself depending on which question was asked of it.
 */
const SENTENCE_END_GLOBAL = new RegExp(SENTENCE_END.source, 'g');

/**
 * Where every sentence break in the answer ENDS, ascending — computed once per reading rather
 * than per marker.
 *
 * Scanning the whole answer is equivalent to scanning each claim window on its own, and only
 * because of where the windows are cut. {@link SENTENCE_END} looks one character to each side,
 * so a window computed from a slice could see different context at its edges than the same
 * position sees in the whole string — but a trailing window starts at 0 or just past a `]` and
 * ends at a `[`, and neither is a digit, so the one exclusion those lookarounds encode cannot
 * turn on the difference. Cutting a window anywhere else would break that and this would have
 * to go back to slicing.
 */
function sentenceBreaks(answer: string): number[] {
  const breaks: number[] = [];
  for (const match of answer.matchAll(SENTENCE_END_GLOBAL)) breaks.push((match.index ?? 0) + match[0].length);
  return breaks;
}

/**
 * Where a trailing claim's window begins.
 *
 * Two things bound it, and a marker citing something OUTSIDE this measurement is neither.
 * Letting a foreign marker bound the window cuts the subject out — live, in 4 of 62 cached
 * answers and 7 times in all: *"Solu-Medrol 125mg/5ml [17] carries more risk than Prednisone
 * does [350]"* left only the contrast partner in the window, and `[350]` elected it. The block
 * reading cannot help; on one line its window is the same one.
 *
 * What does bound it:
 *
 * 1. The nearest earlier marker that cites an index of THIS measurement (`ownEnd`, carried
 *    forward by the caller). Past that marker the text is another finding's claim, and the
 *    renderer badges each index at its own first marker, so borrowing across one would show a
 *    rating beside a sentence it was not read from.
 * 2. The last sentence break after that — a claim cannot begin before its own sentence does.
 *
 * The break is a TIGHTER bound than the marker that was previously returned in its place, and
 * that mattered: bounding at the marker left the tail of the previous sentence in the window, so
 * a partner named there was read as a second candidate for this claim and the set was refused.
 * *"Clarithromycin was reviewed [12] against Prednisone. It also interacts with Solu-Medrol
 * [350]."* resolved nothing, because Prednisone leaked across the full stop. Whichever bound
 * sits later wins, so neither can widen the window the other narrowed.
 */
function trailingWindowStart(breaks: number[], ownEnd: number, markerStart: number): number {
  // Last, not first: with several sentences in between, only the one this marker sits in is
  // this claim. `breaks` is ascending, so the last one inside `(ownEnd, markerStart]` is found by
  // bisection rather than by re-scanning the window — which is what made this quadratic in the
  // number of markers preceding the first finding citation.
  let low = 0;
  let high = breaks.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (breaks[mid] <= markerStart) low = mid + 1;
    else high = mid;
  }
  const last = breaks[low - 1];
  return last === undefined || last <= ownEnd ? ownEnd : last;
}

/**
 * The text of the claim each citation marker is attached to.
 *
 * EXPORTED FOR TESTS, and it must not become production API. Its output is ONE reading, and the
 * whole finding of this module is that one reading cannot be trusted: for any list the forward
 * reading is a rotation of the backward one, both internally consistent, and only the contest
 * between them plus {@link resolveFindingSeverities}' refusals separates them. A caller that
 * used a claim from here to attribute a rating would be doing the exact thing eleven review
 * rounds were spent stopping. `resolveFindingSeverities` is the only entry point that renders.
 *
 * A marker's claim is the prose running back to the previous marker — but adjacent markers
 * (`[177] [350]`) cite ONE claim between them, so a run of marker groups separated by nothing
 * but whitespace, a comma or a semicolon is treated as a single attachment point and they all
 * share the text before
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
export function claimTextByCitation(
  answer: string,
  direction: ClaimDirection = 'trailing',
  // Undefined means "every marker bounds the window" — the conservative reading. Only
  // `resolveFindingSeverities` knows which indices this measurement is about, and only it opts
  // into widening past the others.
  ownIndices?: ReadonlySet<number>,
): Map<number, string> {
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
  const breaks = direction === 'trailing' && ownIndices ? sentenceBreaks(answer) : [];
  // The end of the nearest earlier run citing an index of THIS measurement, carried forward so
  // it is not re-derived by scanning back over every earlier run.
  let lastOwnEnd = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    let claim: string;
    if (direction === 'trailing' || direction === 'block') {
      // The prose BEFORE the marker: confined to the marker's own line for `trailing`, and
      // unconfined back to the previous marker for `block`.
      //
      // The block reading exists because the line-confined one asks only whether exactly one
      // candidate is NAMED in its window, never whether the window is a statement ABOUT that
      // candidate. Where a marker's true subject sits on the item's header line and a CONTRAST
      // partner sits on the citation's own line, the confined window names only the contrast
      // partner and elects it. Live, that produced a derangement — a bijection, so completeness
      // and injectivity both held — with both Major findings badged Moderate.
      // Only the confined `trailing` window widens past a foreign marker. `block` is
      // back-to-the-previous-marker by design, and widening it or the forward windows was
      // measured to regress the live corpus hard (94 correct ratings down to 74).
      const from =
        direction === 'trailing' && ownIndices
          ? trailingWindowStart(breaks, lastOwnEnd, run.start)
          : (runs[i - 1]?.end ?? 0);
      const preceding = answer.slice(from, run.start);
      const lineStart = direction === 'block' ? -1 : preceding.lastIndexOf('\n');
      claim = lineStart < 0 ? preceding : preceding.slice(lineStart + 1);
    } else {
      // The prose AFTER the marker, up to the next marker, and never line-confined. Unconfined
      // is what survives a marker written at the END of its line with its subject on the next:
      // there a confined forward window is empty and the confined backward window holds only the
      // preamble, so nothing contests an election made from the preamble's partner.
      //
      // It used to be confined for `'leading'`, whose removal took the only branch that could
      // reach the confinement with it.
      claim = answer.slice(run.end, runs[i + 1]?.start ?? answer.length);
      const following = claim;
      // ...but a marker immediately followed by a sentence terminator CLOSES its claim: nothing
      // after it can be its subject. Without this, an ordinary trailing-marker list self-
      // contested — the forward claim of marker N was sentence N+1, a complete claim about the
      // next candidate, so the forward reading was a clean shift-by-one bijection that disagreed
      // with the correct trailing one and every rating was withheld. Live, four correct ratings
      // were discarded; whether an answer came out fully badged or fully blank turned on whether
      // the model happened to write one more sentence after its last citation.
      // `:` is deliberately NOT in this set: a colon after a marker is a LABEL separator, not a
      // sentence close, so zeroing the forward claim there silenced the contest on
      // "…the one to watch is [350]: Solu-Medrol 125mg/5ml". Removing `.` as well was measured
      // and regresses — it loses four correct ratings on a live answer — so the rest is
      // load-bearing.
      if (/^[^\S\n]*[.;!?]/.test(following)) claim = '';
    }
    for (const group of run.groups) {
      for (const index of parseCitationIndices(group[1])) {
        if (!claims.has(index)) claims.set(index, claim);
        if (ownIndices?.has(index)) lastOwnEnd = run.end;
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
  if (nameEnd === tokens.length) return '';
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
  return /[a-z0-9/-]/.test(character);
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
  shared: ReadonlySet<string>,
  claim: string,
): AiSafetyWarning[] {
  return candidates.filter((_candidate, i) =>
    leadsPerCandidate[i].some((lead) => !shared.has(lead) && namesLead(claim, lead)),
  );
}

/** One group's leads per candidate, plus the leads every candidate in the set carries. */
interface CandidateGroup {
  leadsPerCandidate: string[][];
  shared: ReadonlySet<string>;
}

/** A `(type, drug)` set's candidates with their leads already normalised and filtered. */
interface CandidateSet {
  candidates: AiSafetyWarning[];
  groups: CandidateGroup[];
}

/**
 * Everything about a candidate set that does NOT depend on the claim being read.
 *
 * Split out because it was being rebuilt for every citation of the set and again for each of the
 * readings — the same leads re-derived and re-`normalize`d once per reading per citation of the set,
 * which is quadratic in the size of the set. Measured on a 12-member `(interaction, drug)` family
 * — the size the live corpus reaches — `resolveFindingSeverities` ran 2.50 ms and dropped to
 * 0.18 ms once this was computed once per set; a 20-member family went 4.80 ms to 0.40 ms.
 *
 * Nothing here may be given a claim: the moment this depends on which sentence is being read it
 * stops being shareable across the readings, and the readings must stay independent.
 */
function buildCandidateSet(candidates: AiSafetyWarning[]): CandidateSet {
  // A single candidate resolves by the shortcut in `readClaims` and its leads are never asked
  // for, so building them would be the only work this function ever wasted.
  if (candidates.length <= 1) return { candidates, groups: [] };
  const leadsPerCandidate = candidates.map(candidateLeadTiers);
  const groups = leadsPerCandidate[0].map((_unused, group) => {
    const leads = candidates.map((candidate, i) => discriminatingLeads(leadsPerCandidate[i][group], candidate.drug));
    const shared = leads.reduce<string[]>((common, own) => common.filter((lead) => own.includes(lead)), leads[0] ?? []);
    return { leadsPerCandidate: leads, shared: new Set(shared) };
  });
  return { candidates, groups };
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
  if (typeof resourceUuid !== 'string') return null;
  const colon = resourceUuid.indexOf(':');
  if (colon <= 0 || colon === resourceUuid.length - 1) return null;
  return { type: resourceUuid.slice(0, colon), drug: resourceUuid.slice(colon + 1) };
}

/** One reading of the answer: which candidate each citation elects, plus the per-set bookkeeping. */
interface ClaimReading {
  resolved: Map<number, string>;
  setOfIndex: Map<number, string>;
  citedIndices: Set<number>;
  electedOf: Map<number, AiSafetyWarning>;
  /** Every candidate this reading's window NAMED, not just the one it elected. */
  namedOf: Map<number, Set<AiSafetyWarning>>;
}

/**
 * The candidate set for one finding, built at most once per `(type, drug)` per resolve.
 *
 * Keyed on the same `setKey` the readings and {@link soundSets} use, so a cache hit is by
 * construction the same set the uncached path would have selected. The cache spans all three
 * readings deliberately: which chips share a finding's `(type, drug)`, and what they can be
 * named by, is a fact about the payload, not about the direction the answer is being read in.
 */
function candidateSetFor(
  safetyWarnings: AiSafetyWarning[],
  finding: { type: string; drug: string },
  setKey: string,
  setCache: Map<string, CandidateSet>,
): CandidateSet {
  const cached = setCache.get(setKey);
  if (cached) return cached;

  const candidates = safetyWarnings.filter(
    (warning) =>
      // typeof, not a truthy check: a non-string rating would throw inside a render memo and
      // take the whole answer panel down. This filter also DEFINES the candidate set as the
      // RATED subset of the chips sharing this (type, drug), which is what makes the
      // single-candidate shortcut sound — the backend never lists a finding whose record
      // states no rating.
      typeof warning.severity === 'string' &&
      warning.severity.trim() !== '' &&
      // typeof on these too. Optional chaining guards null, not TYPE — a numeric `type` reaches
      // `.toLowerCase()` and throws, one line below the guard that exists for exactly that.
      typeof warning.type === 'string' &&
      typeof warning.drug === 'string' &&
      warning.type.toLowerCase() === finding.type.toLowerCase() &&
      warning.drug.toLowerCase() === finding.drug.toLowerCase(),
  );

  const set = buildCandidateSet(candidates);
  setCache.set(setKey, set);
  return set;
}

function readClaims(
  references: AiReference[],
  safetyWarnings: AiSafetyWarning[],
  unstatedFindingSeverities: number[],
  claims: Map<number, string>,
  setCache: Map<string, CandidateSet>,
): ClaimReading {
  const resolved = new Map<number, string>();
  const setOfIndex = new Map<number, string>();
  const citedIndices = new Set<number>();
  const electedOf = new Map<number, AiSafetyWarning>();
  const namedOf = new Map<number, Set<AiSafetyWarning>>();
  // Array.isArray on `references` too — the last member of this family without the guard its
  // siblings got. Not reachable from this backend, but the panel has no error boundary above it.
  const refByIndex = new Map((Array.isArray(references) ? references : []).map((ref) => [ref.index, ref]));

  for (const index of unstatedFindingSeverities) {
    const ref = refByIndex.get(index);
    if (!ref) continue;
    const finding = splitFindingUuid(ref.resourceUuid);
    if (!finding) continue;

    const setKey = `${finding.type.toLowerCase()}:${finding.drug.toLowerCase()}`;
    const set = candidateSetFor(safetyWarnings, finding, setKey, setCache);
    const candidates = set.candidates;
    if (candidates.length === 0) continue;

    setOfIndex.set(index, setKey);
    if (claims.has(index)) citedIndices.add(index);

    if (candidates.length === 1) {
      resolved.set(index, candidates[0].severity!.trim());
      electedOf.set(index, candidates[0]);
      namedOf.set(index, new Set(candidates));
      continue;
    }

    // Several findings share this (type, drug), so the answer's own sentence has to single one
    // out. Each lead group is asked of the whole candidate list and the verdicts are reconciled
    // by `electCandidate`, which refuses on every disagreement — group order decides nothing.
    const claim = stripExclusions(normalize(claims.get(index) ?? ''));
    const perGroupMatches = set.groups.map((group) =>
      matchesInGroup(candidates, group.leadsPerCandidate, group.shared, claim),
    );
    namedOf.set(index, new Set(perGroupMatches.flat()));
    const winner = electCandidate(perGroupMatches);
    if (winner) {
      resolved.set(index, winner.severity!.trim());
      electedOf.set(index, winner);
    }
  }

  return { resolved, setOfIndex, citedIndices, electedOf, namedOf };
}

/**
 * Each candidate set's citation indices, in one place.
 *
 * The two bars below — the right to RESOLVE and the right to OBJECT — are meant to differ by
 * one word, and each kept its own copy of this grouping and its own `citedIndices` filter. That
 * is one word plus two hand-copied preambles: a change to how an index is assigned to a set, or
 * to which indices count as cited, made once would silently give the two bars different
 * POPULATIONS, so a set could qualify to object under one grouping while being judged sound
 * under another. (Also drops the quadratic array copy the grouping loops both used.)
 */
function indicesBySet(reading: ClaimReading): Map<string, number[]> {
  const grouped = new Map<string, number[]>();
  for (const [index, setKey] of reading.setOfIndex) {
    const own = grouped.get(setKey);
    if (own) own.push(index);
    else grouped.set(setKey, [index]);
  }
  return grouped;
}

/** The candidate sets this reading identified COMPLETELY and INJECTIVELY. */
function soundSets(reading: ClaimReading): Set<string> {
  const sound = new Set<string>();
  for (const [setKey, indices] of indicesBySet(reading)) {
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
 * The sets for which this reading found a candidate NAMED at every cited citation, and whose
 * elections — so far as it made any — are pairwise distinct.
 *
 * This is the qualification to OBJECT, and it is deliberately weaker than {@link soundSets},
 * which is the qualification to RESOLVE. The difference is one word, and getting it wrong
 * shipped every rating of an answer wrong.
 *
 * Why completeness has to be measured on NAMED rather than ELECTED. For any list of findings,
 * the forward reading is a ROTATION of the trailing one and vice versa — so a bare disagreement
 * between them is the norm and carries no information at all. What actually separates the two
 * orientations is whether a subject DANGLES past the last marker: written trailing, the text
 * after the final marker names no candidate, so the forward reading has nothing there and is
 * incomplete; written shifted, there is a name left over, and the forward reading reaches every
 * citation. That is the signal, and requiring an ELECTION for it threw it away wherever the
 * dangling text was ambiguous.
 *
 * Measured — a five-item shifted list whose last line read "Budesonide rather than Prednisone
 * Co 5mg". The forward reading elected the CORRECT finding for four of the five citations and
 * named two candidates on the fifth, so it elected nobody there, lost completeness, and was
 * barred from objecting at all. Meanwhile the trailing reading resolved the set as a clean
 * rotation — complete, injective, and wrong in all five positions. Every rating rendered was
 * the neighbouring finding's.
 *
 * This gate is all-or-nothing over the set: one cited index whose forward window names nobody
 * disqualifies the whole set from objecting anywhere, so a rotation used to ship wherever the
 * LAST citation's forward window could be emptied — by a marker citing something outside the
 * measurement, or by a full stop. That was a WRONG RATING and not a refusal, and it is closed
 * now, but NOT here: it is closed by the leftover-subject rule in `resolveFindingSeverities`,
 * which asks the same "does a subject dangle past the last marker" question of the answer's
 * TAIL, where no claim window can hide it. Two local repairs to this gate were implemented and
 * measured first, and both cost correct live ratings — widening the forward window past a
 * foreign marker (98 -> 95) and removing the `.` from the terminator rule (98 -> 82). Neither
 * was shipped. That is why the answer to a bad proxy here was a different question elsewhere
 * rather than a better proxy.
 *
 * Named-completeness is the WHOLE test, and two further restrictions were tried and dropped:
 * requiring the forward elections to be injective, and requiring an election at the index being
 * contested. Both make an objection fire LESS often, which is the unsafe direction for a rule
 * whose only output is a refusal — and neither is justified by anything measurable. With both
 * removed the suite, the live corpus and a 150,000-seed sweep
 * (269 resolving answers) are byte-identical to with them. So they were noise in the direction
 * of resolving more, and are gone rather than left for the next change to delete for free.
 */
function objectingSets(reading: ClaimReading): Set<string> {
  const qualified = new Set<string>();
  for (const [setKey, indices] of indicesBySet(reading)) {
    const named = indices
      .filter((i) => reading.citedIndices.has(i))
      .every((i) => (reading.namedOf.get(i)?.size ?? 0) > 0);
    if (named) qualified.add(setKey);
  }
  return qualified;
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
 * So the answer is read THREE ways — backward line-confined (`trailing`), backward unconfined
 * (`block`), and forward unconfined (`block-leading`) — and only the trailing reading may ever
 * resolve a set, which it must identify completely and injectively ({@link soundSets}). The
 * other two exist to CONTEST it, and the bar to contest
 * is deliberately lower than the bar to resolve ({@link objectingSets}): a reading barred from
 * objecting until it is decisive everywhere would fall silent on exactly the ambiguous answers
 * that need it, which is measured, not hypothetical — it shipped five rotated ratings.
 *
 * A set is withheld on any of FIVE objections: a forward reading that identified a candidate at
 * every cited citation and elects a different one here; a forward reading that NAMES a finding
 * the trailing reading claims for no citation of the set; a candidate named past the answer's
 * last marker that no citation of the set claims; the unconfined backward window no longer
 * singling out what the confined one elected; or the trailing reading not being sound in the
 * first place. Where nothing objects, orientation never mattered — and a single-candidate set
 * resolves the same either way, by the shortcut in `readClaims`.
 *
 * Their weights are very unequal and it is worth knowing which, because the shape of this thing
 * is not what its rule list suggests. Measured on the live corpus:
 *
 *   - Rule 1 is nearly INERT on real answers. Forcing its gate open drops the corpus from 98
 *     ratings to ONE, which says the forward reading disagrees somewhere almost always and the
 *     gate closing is what allows any rating at all.
 *   - Rule 2 changes NOTHING measurable. Disabling it leaves the suite green and the corpus at
 *     98, and a 400,000-shape adversarial search found no answer where it prevents a wrong
 *     rating rather than only withholding a correct one. Its original justification — a
 *     lead-in's partner scavenged by a marker-first line — is now handled earlier by
 *     {@link stripExclusions}. It is kept because "no case was found" is not "no case exists",
 *     and an objection can only ever refuse; but it is pinned by exactly one constructed test
 *     and nothing else, and that is the honest description of it.
 *   - Rules 3 and 4 are what actually protect a real answer, and rule 3 exists because 1 and 2
 *     are both blind to a ROTATION: a permutation is invisible to a per-finding check, and rule
 *     1's gate closes on exactly the answers a rotation needs.
 *
 * What no rule here can do is prefer one orientation on its merits. For any list the forward
 * reading is a rotation of the trailing one, so disagreement between them is the ordinary case
 * and says nothing on its own; the only structural signal is whether a subject dangles past the
 * last marker. Refusing is therefore the answer wherever that signal is absent or contradicted,
 * rather than adopting an orientation on the strength of one example.
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
  if (typeof answer !== 'string') return new Map();
  if (!Array.isArray(unstatedFindingSeverities) || !Array.isArray(safetyWarnings)) return new Map();
  if (unstatedFindingSeverities.length === 0 || safetyWarnings.length === 0) return new Map();

  const ownIndices = new Set(unstatedFindingSeverities);
  // Shared across all three readings on purpose: see {@link candidateSetFor}.
  const setCache = new Map<string, CandidateSet>();
  const trailing = readClaims(
    references,
    safetyWarnings,
    unstatedFindingSeverities,
    claimTextByCitation(answer, 'trailing', ownIndices),
    setCache,
  );
  const block = readClaims(
    references,
    safetyWarnings,
    unstatedFindingSeverities,
    claimTextByCitation(answer, 'block'),
    setCache,
  );
  const blockLeading = readClaims(
    references,
    safetyWarnings,
    unstatedFindingSeverities,
    claimTextByCitation(answer, 'block-leading'),
    setCache,
  );
  const soundTrailing = soundSets(trailing);
  // Qualified to OBJECT, which is a weaker test than qualified to RESOLVE — see
  // {@link objectingSets} for the answer that made the difference.
  //
  // Only the UNCONFINED forward reading is taken. The line-confined one used to sit beside it in
  // both contests below and is provably redundant, which is why the answer is read three ways
  // rather than four: its window is a SUBSET of this one's, so (a) everything it names, this
  // names — which settles the NAMED contest — and (b) wherever it would object here, this one
  // does too. Take the only case that looks like an exception: the confined window names exactly
  // one candidate and disagrees with trailing, while the wider window names two and so elects
  // nobody. Electing nobody is `undefined`, which is not what trailing elected either, so the
  // objection still lands. That equivalence needs the `forwardElected` guard to be absent — it
  // was removed in the same cycle for its own reasons, and this fell out.
  //
  // Measured alongside the proof, before removal: dropping the confined reading from either
  // contest left the suite, the live corpus, a 150,000-seed sweep and a
  // 60,000-answer rotation search all unchanged.
  const objectingBlockLeading = objectingSets(blockLeading);

  // Which findings the trailing reading claims for SOME citation of each set.
  const claimedByTrailing = new Map<string, Set<AiSafetyWarning>>();
  for (const [index, setKey] of trailing.setOfIndex) {
    const elected = trailing.electedOf.get(index);
    if (!elected) continue;
    const claimed = claimedByTrailing.get(setKey) ?? new Set<AiSafetyWarning>();
    claimed.add(elected);
    claimedByTrailing.set(setKey, claimed);
  }

  // A candidate the ANSWER names that no citation of its set claims.
  //
  // The shift signature, and the only signal measured to separate a rotation from the
  // interleaved lists that must keep resolving. A trailing-written answer names one subject per
  // citation; a shifted one leaves one over — that is the same "dangling subject" the gate above
  // is a proxy for, asked of the whole answer text instead of a single window, so a foreign
  // marker or a full stop cannot hide it.
  // The answer's TAIL: everything after the LAST citation marker in it. A candidate named here
  // has no citation left to claim it, which is what makes it a leftover subject rather than
  // simply another drug the answer talks about.
  //
  // Two narrower tails were measured and are both wrong. The WHOLE answer costs 11 live
  // ratings — an ordinary answer names other drugs in its mechanism clauses ("various CYP450
  // 3A4 inhibitors including…") and each read as a leftover. The text after the SET's last
  // marker costs 6, because an answer may cite other members of the same set with markers this
  // measurement does not list: `n5_worst_first` is a numbered list of five items of which only
  // two are unstated, so items 4 and 5 sat in that tail naming candidates they had their own
  // markers for.
  const markerRuns = [...answer.matchAll(citationGroupPattern())];
  const lastRun = markerRuns[markerRuns.length - 1];
  const tail = lastRun === undefined ? '' : answer.slice((lastRun.index ?? 0) + lastRun[0].length);
  const tailText = stripExclusions(normalize(tail));

  // Which index of each set its LAST marker cites. A tail that restates the last citation's own
  // subject is an ordinary flourish; a tail naming a candidate an EARLIER citation claimed is a
  // rotation closing on itself.
  const lastIndexOfSet = new Map<string, number>();
  {
    const seen = new Set<number>();
    for (const run of markerRuns) {
      for (const index of parseCitationIndices(run[1])) {
        if (seen.has(index)) continue;
        seen.add(index);
        const setKey = trailing.setOfIndex.get(index);
        if (setKey !== undefined) lastIndexOfSet.set(setKey, index);
      }
    }
  }

  const namedInTail = new Map<string, Set<AiSafetyWarning>>();
  for (const setKey of new Set(trailing.setOfIndex.values())) {
    const set = setCache.get(setKey);
    if (!set) continue;
    const found = new Set<AiSafetyWarning>();
    let residual = tailText;
    for (const group of set.groups) {
      for (const candidate of matchesInGroup(set.candidates, group.leadsPerCandidate, group.shared, tailText)) {
        found.add(candidate);
        const i = set.candidates.indexOf(candidate);
        for (const lead of group.leadsPerCandidate[i] ?? []) {
          if (lead) residual = residual.split(lead).join(' ');
        }
      }
    }
    // A dangling SUBJECT is a NOUN PHRASE. A tail that goes on to say something about the drug
    // is a clause, and a live answer really does end with one: "…Hydrocortisone [354].
    // Methylprednisolone is also known to interact with several of her other active orders." Its
    // five ratings are correct, and contesting it discards them.
    //
    // A token COUNT was tried first and is not enough: an unbridged candidate's only lead is its
    // substance, so a tail carrying its ORDER DISPLAY leaves "injection vial 100mg" behind and
    // any threshold low enough to catch that also catches real clauses.
    //
    // So what is looked for is a FUNCTION WORD — a determiner, auxiliary, preposition or
    // conjunction. A drug's name and dose carry none ("hydrocortisone injection vial 100mg",
    // "prednisone co 5mg", "solu-medrol 125mg/5ml"); an English clause cannot avoid them
    // ("IS also known TO interact WITH several OF HER other…", "WOULD BE THE safer choice").
    // A word list is crude, and it is here because the alternative is parsing: this is the one
    // distinction the readings cannot make, and every measured wrong rating of this class turns
    // on it. It errs toward RESOLVING — an unlisted function word means a clause is read as a
    // dangling subject and the set refuses, which is the safe direction.
    const isClause = residual.split(/\s+/).some((word) => CLAUSE_WORDS.has(word.replace(/[^a-z]/g, '')));
    namedInTail.set(setKey, isClause ? new Set() : found);
  }

  const contested = new Set<string>();
  for (const [index, setKey] of trailing.setOfIndex) {
    // The forward reading disagrees about THIS index — a permutation within the same findings.
    //
    // It has to be the UNCONFINED forward reading, and this rule has to exist separately from
    // the NAMED one below, because on a multi-line answer nothing else can object. A trailing
    // marker there sits at end-of-line, so a line-confined forward window is empty; and a
    // permutation is invisible to the NAMED rule by construction, since every finding the
    // forward reading names IS claimed by trailing, merely for a different index. `block` reads
    // the same direction as trailing and agrees with it.
    //
    // Two answers were measured resolving wrong with this rule missing or too strict, both
    // against the shipped fixture and both a SWAPPED PAIR or worse — never a missing badge:
    //
    //   "Hydrocortisone aside, the order that matters most is [350]
    //    Solu-Medrol 125mg/5ml [354]
    //    Hydrocortisone Injection vial 100mg"
    //     -> {350: Moderate, 354: Major}, truth {350: Major, 354: Moderate}
    //
    //   the same shape at five items with a dangling last line naming two partners
    //     -> all five ratings the neighbouring finding's
    //
    // The first needed the rule to consult the unconfined reading at all; the second needed
    // {@link objectingSets}, because the forward reading elected correctly for four of five
    // citations and losing completeness on the fifth had been barring it from objecting.
    if (soundTrailing.has(setKey) && objectingBlockLeading.has(setKey)) {
      // No `forwardElected` guard: on a reading that named a candidate at every cited citation,
      // an index that still elected NOBODY named two, and that ambiguity is itself a reason to
      // doubt the confined reading's confidence rather than something to pass over.
      if (trailing.electedOf.get(index) !== blockLeading.electedOf.get(index)) contested.add(setKey);
    }

    // Or the forward reading NAMES a finding the trailing reading claims for no citation of this
    // set. That is not a shift artifact; it is a genuine alternative parse, so the layout does
    // not determine the mapping. Live: a single marker-written-before-its-drug line among
    // trailing ones was read backwards, uncontested — "Hydrocortisone aside, the order that
    // matters most is [350] Solu-Medrol 125mg/5ml…" badged the MAJOR Methylprednisolone finding
    // as Moderate, scavenging Hydrocortisone's rating from the lead-in, next to a correctly-
    // badged Major.
    //
    // NAMED, not elected. `electCandidate` returns null both for "this window named nobody" and
    // for "this window named two candidates", so keying the contest on an ELECTION silenced it
    // in exactly the second case — and the trailing reading's election, scavenged from a
    // lead-in, then stood. Measured: one extra clause naming a second candidate flipped a
    // correct refusal into a wrong rating.
    for (const named of blockLeading.namedOf.get(index) ?? []) {
      if (!claimedByTrailing.get(setKey)?.has(named)) contested.add(setKey);
    }

    // Or a candidate of this set is named PAST THE ANSWER'S LAST MARKER and claimed by no
    // citation of it. That is a subject left over with nothing to cite it — the shift
    // signature — and asking it of the tail rather than of a claim window is what makes it
    // proof against the two things that hid it before: a foreign marker truncating a forward
    // window, and a full stop closing one.
    //
    // A candidate in the tail objects unless it is the LAST citation's own subject restated.
    //
    // Testing only "claimed by nobody" was not enough, and the gap is the same one that defeats
    // rule 2: a rotation CLOSED by a lead-in naming the last partner claims every candidate, so
    // the leftover is claimed — at the wrong index — and the rule fell silent. Measured, that
    // shipped a swapped pair off an answer one character away from refusing:
    //
    //   "Hydrocortisone Injection vial 100mg is the lesser worry, but the greater one is [350].
    //    Solu-Medrol 125mg/5ml [354]
    //    Hydrocortisone Injection vial 100mg"
    //
    // rendered {350: Moderate, 354: Major} against {350: Major, 354: Moderate}; delete the full
    // stop and it refuses. Across 26,766 resolving answers of that family EVERY one carried a
    // wrong rating — the class has no correct resolutions at all.
    //
    // Nor is "any candidate in the tail" right: a live answer restates its own subject there
    // ("Methylprednisolone [350]\n  Solu-Medrol 125mg/5ml"), and contesting that costs a real
    // rating. So the test is: anything but the LAST citation's own election objects — which
    // covers a candidate no citation claimed at all, since that is not the last one's either.
    const lastClaim = trailing.electedOf.get(lastIndexOfSet.get(setKey) ?? -1);
    for (const named of namedInTail.get(setKey) ?? []) {
      if (named !== lastClaim) contested.add(setKey);
    }

    // Or the wider, unconfined BACKWARD window no longer singles out what the line-confined one
    // elected. This is the check that survives a forward reading with nothing to say, and it has
    // nothing to say in exactly the layouts that break the confined backward one: across 40 live
    // answers a finding marker sits at end-of-line 54 times and is followed by a sentence
    // terminator 151 times, and a marker closed by a terminator has its forward claim zeroed
    // outright a few hundred lines up.
    const confined = trailing.electedOf.get(index);
    if (block.electedOf.get(index) !== confined) contested.add(setKey);
  }

  const resolved = new Map<number, string>();
  for (const [index, setKey] of trailing.setOfIndex) {
    if (!soundTrailing.has(setKey) || contested.has(setKey)) continue;
    const severity = trailing.resolved.get(index);
    if (severity !== undefined) resolved.set(index, severity);
  }
  return resolved;
}
