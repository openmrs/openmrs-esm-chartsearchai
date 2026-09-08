import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';

const BASE_PATH = `${restBaseUrl}/chartsearchai`;

/**
 * Error code emitted via {@code onError} for every way an expired session surfaces on the SSE
 * endpoint: the 302 opaque redirect, a bare 401/403, and the committed-redirect 500. It is a stable
 * code, NOT a display string — user-facing text must be localized in a component (the translation
 * extractor only scans {@code *.component.tsx}). {@code AiResponsePanel} maps this to a translated message.
 */
export const SESSION_EXPIRED_ERROR_CODE = 'chartsearchai:session-expired';

export interface AiReference {
  index: number;
  /**
   * Server-authoritative provenance class; do not infer this from resourceType. `chart` = the
   * patient's own record, `reference` = module-supplied reference material (a drug-reference entry,
   * a safety finding, a drug-class note), which has no chart page to navigate to. Optional so a
   * response predating the field still parses; a group this client predates is carried as-is and
   * `isReferenceData` accepts either signal.
   */
  group?: 'chart' | 'reference' | (string & {}) | null;
  /** Source dataset for non-chart evidence, such as WHO-ATC. */
  source?: string;
  /** Related records not shown in this compact reference. */
  withheldInteractions?: number;
  /** Stable evidence-ledger id supplied by med-agent-hub. */
  sourceId?: string;
  resourceType: string;
  /**
   * OpenMRS UUID of the cited record (the backend serializes this field as `resourceUuid`).
   * Used to locate and highlight the record's row after navigating to its chart page.
   */
  resourceUuid: string;
  date: string;
  /** Resolved source record text, when supplied by the hub staged path. */
  sourceText?: string;
  /** Human-readable source title supplied by the evidence ledger. */
  title?: string;
  /** Whether the citation index resolved to a record in this turn's evidence ledger. */
  resolutionStatus?: 'resolved' | 'unresolved';
  /** Answer, In-Depth, or table locations that used this source. */
  usage?: Array<{ location: string; text: string; path?: string }>;
  /**
   * Citation grounding verdict from the backend: true = the cited record
   * supports the claim, false = it does not, null/absent = unverified.
   * Never render null as "verified".
   *
   * This client renders NO badge for it, and was drawing none at the base commit either. The harm
   * the backend names — mislabelling an unverified citation as verified — is avoided that way.
   *
   * What the backend asks is narrower than this doc used to claim, and it differs by GROUP, which
   * the single sentence here flattened. For a **chart**-group citation it asks that `false` and
   * `null` both be surfaced as unverified — and says in the same breath that it withholds the
   * verdict "because it must not assert what it has not established, not because it is relying on
   * a particular rendering", so "a neutral badge is the render it asks for" was this file's
   * invention rather than the backend's request. For a **reference**-group citation, where
   * `grounded` is ALWAYS null, it asks for the opposite reading: treat null as "grounding does not
   * apply", not as "unverified evidence" — a client that read it as unverified badged a
   * deterministic Major-interaction finding *"Unsupported"*, which is the issue that made the
   * field stop being published there. So a client that renders every null as unverified would be
   * wrong on exactly the citations this feature is about.
   *
   * `null` does not mean one thing, and two of its causes are not "verification was tried
   * and failed": a {@link group} of `reference` is always null (there is no way to vouch for
   * an answer that recites reference prose), and so is a citation the module attached
   * ({@link attachedByTheModule}), where the module attached no claim for grounding to ask
   * about. The rest are: grounding disabled, this citation not checked, or checked and not
   * certifiable. So do not render any null as evidence that the module tried.
   */
  grounded?: boolean | null;
  /**
   * Lifecycle/status for citation grounding. `checking` means the backend has resolved
   * the source record but final support verification is still running.
   */
  groundingStatus?: 'checking' | 'verified' | 'unsupported' | 'unchecked' | 'mixed';
  /** Whether support was evaluated from this record alone or a cited source set. */
  groundingScope?: 'record' | 'source_set';
  /** Citation indices evaluated together when groundingScope is source_set. */
  groundingGroup?: number[];
  /** Claim/path-level verdicts retained when one record is used more than once. */
  groundingChecks?: Array<{
    status: 'verified' | 'unsupported' | 'unchecked';
    claim: string;
    location: string;
    path?: string;
    source_indices: number[];
  }>;
  /**
   * Whether the MODULE attached this citation rather than the model emitting it — true for
   * a chart record that an injected safety finding the model *did* cite was derived from
   * (the recorded allergy or condition whose match raised it).
   *
   * Two consequences a client must handle, neither derivable from any other field:
   * the answer prose carries NO `[N]` marker for such a citation, so a reference list
   * built by scanning the answer text drops it silently; and its {@link grounded} is
   * always null, which here is "there was no claim to verify" rather than "verification
   * failed" — the module attached no claim. `chart` group + no marker + `grounded: null`
   * do NOT together identify a module-supplied citation, which is why this key exists.
   */
  attachedByTheModule?: boolean | null;
}

/**
 * A non-blocking deterministic safety advisory emitted by med-agent-hub. It
 * annotates the answer and is rendered as a chip below it.
 */
export interface AiSafetyWarning {
  /** 'overdose' | 'interaction' | 'contraindication' */
  type: string;
  /** the reference drug the warning is about */
  drug: string;
  /** human-readable detail, e.g. "interacts with active order warfarin" */
  detail: string;
  /**
   * The rating the loaded reference dataset assigns the rule this warning was raised from,
   * verbatim and unnormalized — the dataset's rating, NOT the module's advice, and never a
   * statement about what the rating licenses clinically.
   *
   * null where the finding carries no rating: a contraindication, an overdose and an
   * ATC-class or cross-reactivity join carry none by construction, AND a hand-authored rule
   * usually omits it — every interaction rule in the module's own bundled curated seed does.
   * So `severity: null` on an `interaction` chip is a statement, not a missing field.
   *
   * Not a closed vocabulary: the bundled knowledge base publishes Major/Moderate/Minor/Unknown
   * but an operator's dataset supplies its own words, so compare case-insensitively after
   * trimming and treat an unrecognised value as unrated rather than as a floor. Read this
   * field; never parse the rating back out of {@link detail}.
   */
  severity?: string | null;
  /**
   * Which of this patient's own active orders each substance the chip names was resolved from,
   * where that order's displayed name does not reach the substance. Empty means nothing on
   * this chip was attributed — common, and not an error.
   *
   * Published as typed fields rather than left inside {@link detail} so a client is handed two
   * strings instead of a sentence to parse. It is the reason a chip can name `Methylprednisolone`
   * while the answer names the same prescription `Solu-Medrol 125mg/5ml`, and it is what lets
   * `resolveFindingSeverities` (in `utils/safety-disclosure.ts`, not imported here, so a
   * `{@link}` to it would not resolve) recognises a finding in the answer's own words whichever
   * vocabulary the answer used.
   *
   * It is a resolution the MODULE performed — say "resolved from", never that the prescription
   * *is* that substance, and never that the chart records those substances.
   */
  chartOrderBridges?: AiChartOrderBridge[] | null;
}

/**
 * One `(substance, orderDisplay)` correspondence on a safety warning.
 *
 * The backend asks a client to render this beside the chip and not to parse it apart. This one
 * does neither yet, and the doc said the opposite of both: display is deferred (the repo README's
 * *Not rendered* section says so), and `shortOrderDisplay` (module-private in
 * `utils/safety-disclosure.ts`) does split `orderDisplay` on
 * whitespace to drop trailing dose tokens, because a live chart's `Vitamin B12 1000mcg` matched
 * nothing as a whole string. The severity join reads it in both the full and the dose-stripped
 * form.
 *
 * Not "the strongest" of that join's leads, which this said for a while: there is no strongest.
 * The three lead groups are read order-free and can only corroborate or contradict, never outrank
 * — reversing the array changes no behaviour, and `candidateLeadTiers` says so where they are
 * built. This group is the one with the best VOCABULARY match, because it carries the chart's
 * words and the knowledge base's both; that is a different claim from precedence.
 */
export interface AiChartOrderBridge {
  substance: string;
  orderDisplay: string;
}

/**
 * How bounded the interaction check that stated it was: the rule pairs it found above the
 * server's severity floor, and the number it reported. Where `reported < found` the list is
 * truncated (least severe dropped first) and has to say so, because silent truncation reads
 * as "nothing else was found".
 *
 * Two readings to keep apart. `found === reported` says that check withheld nothing — NOT
 * that the response is complete, which this field has never claimed. And a null/absent key
 * is the absence of a measurement, never a statement that nothing was found.
 *
 * It counts drug PAIRS, not the warnings beside it: a response can legitimately carry more
 * safety warnings than this states pairs, so never derive the ratio by counting chips.
 */
export interface AiInteractionPairs {
  found: number;
  reported: number;
}

/**
 * Whether the loaded drug-reference dataset can run the CONDITION arm of the
 * contraindication screen at all.
 *
 * `absent` = a dataset was read and no entry carries a condition rule, so the arm cannot
 * fire; `unloaded` = nothing was read, so nothing is known. Those two must not be collapsed —
 * "we looked and there is none" is not "nobody looked". `published` says the DATASET can run
 * the arm and is deliberately NOT a claim that any recorded condition was screened.
 */
export type ConditionRuleCoverage = 'absent' | 'published' | 'unloaded';

/**
 * How many claims about the patient's ACTIVE ORDERS the answer made, and how many of them
 * offered no chart record as evidence.
 *
 * This is what makes {@link AiSearchResponse.misattributedOrderCitations} readable, and the
 * backend says so: without it that key's `[]` is two responses a client cannot tell apart — an
 * answer whose active-order claims all cited chart records that were accepted, and an answer
 * that cited no chart record for any of them. Both have been recorded on one patient and one
 * question, with `misattributedOrderCitations` reading `[]` in each.
 *
 * So `uncited` is the number that carries the warning, and `stated` is what makes it a ratio
 * rather than a bare count. `uncited === 0` says every such claim offered SOME chart record —
 * never that the record was the right one, which is the neighbouring key's business and which it
 * cannot certify either.
 */
export interface AiActiveOrderClaims {
  stated: number;
  uncited: number;
}

/**
 * Honest drug-safety check state: `checked` = the full check ran against real reference data and
 * a real patient context; `limited` = only a subset of checks ran; `unavailable` = the check could
 * not run at all (no patient context, or the policy has drug safety disabled). An empty
 * `safetyWarnings` list must never be read as `checked` on its own.
 */
export type AiSafetyStatus = 'checked' | 'limited' | 'unavailable';

export interface AiSafetyReferencePackage {
  id?: string;
  source_format?: string;
  version?: string;
  provenance?: unknown;
  review_state?: 'proposed' | 'evidence_curated' | 'clinically_approved' | 'retired' | string;
  issues?: string[];
}

/** Provenance and coverage for the deterministic medication-safety pass. */
export interface AiSafetyCheck {
  schema_version?: 'drug_safety.v1' | string;
  status: AiSafetyStatus;
  warnings?: AiSafetyWarning[];
  package?: AiSafetyReferencePackage & {
    cross_reactivity_review_state?: string;
    cross_reactivity?: AiSafetyReferencePackage;
  };
  coverage?: {
    mapping_complete?: boolean;
    exposure_complete?: boolean;
    execution_complete?: boolean;
    active_order_count?: number;
    mapped_active_order_count?: number;
  };
  identity_confidence?: 'high' | 'limited' | 'unavailable' | string;
  issues?: string[];
}

export interface AiCell {
  text: string;
  refs?: number[];
}

export interface AiTableColumn {
  key: string;
  label: string;
}

export interface AiTableBlock {
  kind: 'table';
  title?: string;
  columns: AiTableColumn[];
  rows: Array<{ cells: Record<string, AiCell> }>;
}

export type AiBlock = AiTableBlock;

/** One section's validator confidence: a traffic-light level + an optional caveat note. */
export interface AiConfidenceSection {
  level: 'green' | 'yellow' | 'red';
  note?: string;
}

/**
 * Per-section confidence metadata emitted by the selected med-agent-hub profile.
 */
export interface AiConfidence {
  answer?: AiConfidenceSection;
  in_depth?: AiConfidenceSection;
}

export interface AiInDepth {
  status: 'pending' | 'complete' | 'failed' | 'needs_review';
  answer?: string;
  error?: string;
  validation?: {
    status?: 'checked' | 'edited' | 'needs_review' | 'unavailable';
    review_status?: 'checked' | 'edited' | 'needs_review' | 'unavailable';
    summary?: string;
    [key: string]: unknown;
  };
  /** Pre-check model claims rendered for review. Never the shipped answer. */
  reviewDraft?: string;
  /** References resolved specifically for reviewDraft; kept separate from final answer evidence. */
  reviewReferences?: AiReference[];
}

type AiInDepthEvent = Partial<AiSearchResponse> & { messageId?: string; inDepth: AiInDepth };

export type AiAnswerValidationStatus = 'checking' | 'checked' | 'edited' | 'needs_review' | 'unavailable';

export interface AiAnswerValidation {
  status: AiAnswerValidationStatus;
  label: string;
  summary?: string;
  issues?: unknown[];
  completedAt?: string;
  originalAnswer?: string;
  /** References resolved for originalAnswer; never substitute the final answer's references. */
  originalReferences?: AiReference[];
  /** Pre-check table/list blocks. Review-only and never part of the shipped answer blocks. */
  originalBlocks?: AiBlock[];
}

export interface AiSearchResponse {
  answer: string;
  references: AiReference[];
  /** Deterministic safety advisories emitted by the selected hub profile. */
  safetyWarnings?: AiSafetyWarning[];
  /** checked/limited/unavailable — present alongside safetyWarnings, even when it's empty. */
  safetyStatus?: AiSafetyStatus;
  /** Canonical safety result with source identity, coverage, and limitation reasons. */
  safetyCheck?: AiSafetyCheck;
  blocks?: AiBlock[];
  /** Numeric OpenMRS audit row id used only for feedback. */
  auditLogId?: number;
  /** Server-side conversation handle. Present on chat responses only. */
  session?: string;
  /** Server-assigned uuid for the assistant message row. Present on chat responses only. */
  messageId?: string;
  /** Product profile id that produced this answer. */
  resolvedModel?: string;
  /** Per-section check confidence (green/yellow/red + note) from checked hub profiles. */
  confidence?: AiConfidence;
  /** Clinician-facing answer check lifecycle for staged checked responses. */
  answerValidation?: AiAnswerValidation;
  /** In-Depth analysis attached after the direct answer settles. */
  inDepth?: AiInDepth;
  /**
   * Citation indices the answer offered as evidence of an active drug order that CANNOT be
   * one — a condition, a visit, an encounter, or an order the chart says is no longer in
   * force. Render as "this citation cannot be the order named", never as "this claim is
   * unsupported": the finding behind the sentence is deterministic and typically correct;
   * it is the chart evidence attached to it that is wrong.
   *
   * An EMPTY array is not a certificate that the citations are sound. The check sees only an
   * answer that reproduces the module's own "interacts with active order" phrase, only the
   * markers directly following it, and it cannot tell a citation of the wrong in-force order
   * from a citation of the right one — so `[]` says the check ran and named none. Never
   * render a "citations verified" affordance off this field.
   */
  misattributedOrderCitations?: number[] | null;
  /**
   * Citation indices of safety findings whose rating the answer states NOWHERE, leaving a
   * clinician no way to rank a flat list of findings.
   *
   * The rating is NOT on this key, and the backend is explicit that it "cannot be joined to a
   * chip: chips carry no citation index, and `(type, drug)` does not identify one — a screening
   * question raises several findings sharing it". `resolveFindingSeverities` therefore
   * narrows to that candidate set and requires the answer's own sentence to single one out,
   * declining where it cannot.
   *
   * Render whatever it yields as a CAVEAT, never as a verdict: the backend documents three
   * measured cells where this key over-reports — a rating stated by synonym, a `minor` caution
   * the prompt never asked to be rated, and an operator dataset whose mechanism text happens to
   * contain the rating word.
   *
   * The check asks of the whole answer rather than of the citing sentence, so an answer that
   * states the rating anywhere is silent here — which is why rendering is gated on this list
   * rather than on severity being present.
   */
  unstatedFindingSeverities?: number[] | null;
  /** @see ConditionRuleCoverage */
  // `string & {}` rather than a bare `string`, which would collapse the union and discard the
  // literals — keeping them is what makes the renderer's switch checkable while still accepting
  // a verdict word this client predates.
  conditionRuleCoverage?: ConditionRuleCoverage | (string & {}) | null;
  /** @see AiInteractionPairs */
  interactionPairs?: AiInteractionPairs | null;
  /** @see AiActiveOrderClaims */
  activeOrderClaims?: AiActiveOrderClaims | null;
}

export interface ChatHistoryMessage extends Partial<AiAnswerLimits> {
  messageId: string;
  auditLogId?: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  terminalState?: 'turn_done' | 'turn_error';
  problemCode?: string;
  references?: AiReference[];
  blocks?: AiBlock[];
  /** Deterministic safety advisories emitted by the selected hub profile. */
  safetyWarnings?: AiSafetyWarning[];
  /** checked/limited/unavailable — present alongside safetyWarnings, even when it's empty. */
  safetyStatus?: AiSafetyStatus;
  /** Canonical safety result, persisted with the assistant row for reload and review. */
  safetyCheck?: AiSafetyCheck;
  confidence?: AiConfidence;
  answerValidation?: AiAnswerValidation;
  inDepth?: AiInDepth;
  createdAt: number;
}

export interface ChatHistoryResponse {
  session: string;
  /** The provider that produced this conversation (bundled/hub). Absent only when there is no
   *  conversation yet (empty history). */
  provider?: string;
  messages: ChatHistoryMessage[];
}

/**
 * The response fields that state what a bounded safety answer did not cover. Declared once here,
 * on the wire type, and referenced by the chat message and the panel props so the three cannot
 * drift — in particular the reading that an empty array is not a certificate.
 *
 * FIVE now, not four. `activeOrderClaims` was added to the backend after this client's work on
 * the other four began, and it is not a sixth nice-to-have: it is the key that separates the two
 * readings of `misattributedOrderCitations: []`, so leaving it out left an already-rendered field
 * ambiguous in exactly the way that field's own doc warns about.
 */
export type AiAnswerLimits = Pick<
  AiSearchResponse,
  | 'misattributedOrderCitations'
  | 'unstatedFindingSeverities'
  | 'conditionRuleCoverage'
  | 'interactionPairs'
  | 'activeOrderClaims'
>;

/**
 * What the trailing `grounded` SSE event re-sends. Under `chartsearchai.grounding.async=true`
 * the `done` event is emitted before validation runs, so it carries `safetyWarnings: []` and a
 * null for each measurement taken AFTER the answer — `interactionPairs`,
 * `misattributedOrderCitations`, `unstatedFindingSeverities` — and those arrive only here.
 *
 * Two exceptions to that, both of which a client must not gate on this event.
 * `conditionRuleCoverage` is read off the dataset load before the model is called, so it is
 * already final on the early `done` and is merely re-sent here. And on an answer-cache hit no
 * early `done` is emitted at all: the single `done` carries the replayed final answer, so every
 * field reads as the original request measured it and no `grounded` event follows.
 */
export type AiGroundedUpdate = Pick<AiSearchResponse, 'references' | 'safetyWarnings'> & AiAnswerLimits;

export type FeedbackRating = 'positive' | 'negative';

export interface AiFeedback {
  auditLogId: number;
  rating: FeedbackRating;
  comment?: string;
}

/**
 * Submits user feedback (thumbs up/down + optional comment) for an AI response.
 */
export async function submitFeedback(feedback: AiFeedback): Promise<void> {
  try {
    await openmrsFetch(`${BASE_PATH}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feedback),
    });
  } catch (err) {
    console.error('[submitFeedback] Failed to submit feedback:', err);
    throw err;
  }
}

/**
 * Streaming variant for multi-turn chat. SSE (Server-Sent Events) stream, parsed via raw
 * fetch instead of openmrsFetch because openmrsFetch consumes the response body to parse
 * it as JSON, which prevents streaming — we need direct access to response.body (the
 * ReadableStream). The staged endpoint emits answer/validation/in-depth boundary events:
 *   - sends an optional {@code session} uuid so the server can reuse the
 *     prior conversation thread
 *   - sends a product profile only for med-agent-hub requests
 *   - accepts the optional session response header and the canonical
 *     {@code turn_started} session marker
 *
 * The server is the source of truth for conversation history — the client
 * sends only the new user message, not the rendered transcript.
 */
export function chatPatientChartStream(
  patientUuid: string,
  sessionUuid: string | null,
  question: string,
  callbacks: {
    onSession: (uuid: string) => void;
    /**
     * One `answer_delta` frame: a slice of the answer text from a provider that declares
     * `token_streaming` (the bundled engine). Additive and provisional; `answer_done` restates the
     * whole answer. A provider that streams no tokens (the hub) never fires it.
     */
    onToken?: (chunk: string) => void;
    /** One `reasoning_delta` frame: committed reasoning, shown before any answer exists. */
    onReasoning?: (chunk: string) => void;
    /**
     * One `preliminary_delta` frame: the optional progressive PREVIEW reasoning
     * (`chartsearchai.progressiveReasoning.enabled`, default off). Provisional and separate from
     * `onReasoning` for two reasons the text cannot carry: its `[N]` markers index an
     * independently-numbered top-K chart rather than the records the answer cites, so they must be
     * stripped; and committed reasoning REPLACES it rather than continuing it.
     */
    onPreliminary?: (chunk: string) => void;
    onAnswerDone?: (response: AiSearchResponse) => void;
    onAnswerValidation?: (response: AiSearchResponse) => void;
    onEvidenceUpdated?: (response: AiSearchResponse) => void;
    onInDepthPending?: (payload: AiInDepthEvent) => void;
    onInDepthDone?: (payload: AiInDepthEvent) => void;
    onInDepthError?: (payload: AiInDepthEvent) => void;
    onDone: (response: AiSearchResponse) => void;
    onError: (error: string) => void;
  },
  abortController: AbortController | undefined,
  profileId?: string,
  providerId?: string,
): void {
  if (providerId === 'hub' && !profileId?.trim()) {
    throw new Error('A product profile is required');
  }

  const url = `${window.openmrsBase}${BASE_PATH}/chat/stream`;
  const body: Record<string, string> = { patient: patientUuid, question };
  if (profileId?.trim()) {
    body.profile = profileId;
  }
  // Provider is optional: when omitted the backend applies its configured
  // default (bundled on a fresh install), never a silent cross-provider fallback.
  if (providerId?.trim()) {
    body.provider = providerId;
  }
  if (sessionUuid) {
    body.session = sessionUuid;
  }

  window
    .fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'Disable-WWW-Authenticate': 'true',
      },
      body: JSON.stringify(body),
      credentials: 'include',
      redirect: 'manual',
      signal: abortController?.signal,
    })
    .then(async (response) => {
      if (response.type === 'opaqueredirect' || response.status === 0) {
        callbacks.onError(SESSION_EXPIRED_ERROR_CODE);
        return;
      }

      if (!response.ok) {
        let message = `Server error: ${response.status}`;
        try {
          const errBody = await response.json();
          if (errBody?.error) {
            message = errBody.error;
          }
        } catch {
          // no JSON body
        }
        callbacks.onError(message);
        return;
      }

      // Capture the session uuid the server pinned for this conversation
      // before we start consuming the stream — the client uses it to thread
      // subsequent posts onto the same conversation row.
      const sessionHeader = response.headers.get('X-ChartSearchAi-Session');
      if (sessionHeader) {
        callbacks.onSession(sessionHeader);
      }

      const reader = response.body;

      if (!reader || typeof reader.getReader !== 'function') {
        callbacks.onError('Streaming not supported by this browser.');
        return;
      }

      const textDecoder = new TextDecoder();
      const streamReader = reader.getReader();
      let buffer = '';
      let eventType = '';
      let dataLines: string[] = [];
      let streamFinalized = false;

      const failStream = (message: string) => {
        streamFinalized = true;
        callbacks.onError(message);
      };

      function dispatchEvent() {
        if (dataLines.length === 0) {
          eventType = '';
          return;
        }
        const data = dataLines.join('\n');
        if (streamFinalized) {
          eventType = '';
          dataLines = [];
          return;
        }
        if (eventType === 'preliminary_delta') {
          callbacks.onPreliminary?.(data);
        } else if (eventType === 'answer_delta') {
          // Raw text, not JSON: the server frames each token as one `data:` line per text line.
          callbacks.onToken?.(data);
        } else if (eventType === 'reasoning_delta') {
          callbacks.onReasoning?.(data);
        } else if (eventType === 'answer_done') {
          try {
            const raw = JSON.parse(data) as AiSearchResponse & { model?: string };
            callbacks.onAnswerDone?.({ ...raw, resolvedModel: raw.resolvedModel ?? raw.model });
          } catch {
            failStream('Failed to parse staged answer response');
          }
        } else if (eventType === 'answer_validation') {
          try {
            const raw = JSON.parse(data) as AiSearchResponse & { model?: string };
            callbacks.onAnswerValidation?.({ ...raw, resolvedModel: raw.resolvedModel ?? raw.model });
          } catch {
            failStream('Failed to parse answer validation response');
          }
        } else if (eventType === 'evidence_updated') {
          try {
            const raw = JSON.parse(data) as AiSearchResponse & { model?: string };
            callbacks.onEvidenceUpdated?.({ ...raw, resolvedModel: raw.resolvedModel ?? raw.model });
          } catch {
            failStream('Failed to parse evidence update');
          }
        } else if (eventType === 'indepth_pending') {
          try {
            const raw = JSON.parse(data) as AiInDepthEvent;
            if (!raw.inDepth || typeof raw.inDepth !== 'object') throw new Error('missing inDepth');
            callbacks.onInDepthPending?.(raw);
          } catch {
            failStream('Failed to parse in-depth pending response');
          }
        } else if (eventType === 'indepth_done') {
          try {
            const raw = JSON.parse(data) as AiInDepthEvent;
            if (!raw.inDepth || typeof raw.inDepth !== 'object') throw new Error('missing inDepth');
            callbacks.onInDepthDone?.(raw);
          } catch {
            failStream('Failed to parse in-depth response');
          }
        } else if (eventType === 'indepth_error') {
          try {
            const raw = JSON.parse(data) as AiInDepthEvent;
            if (!raw.inDepth || typeof raw.inDepth !== 'object') throw new Error('missing inDepth');
            callbacks.onInDepthError?.(raw);
          } catch {
            failStream('Failed to parse in-depth error response');
          }
        } else if (eventType === 'turn_started') {
          // Lifecycle marker carrying {session, messageId, provider}. The
          // canonical stream does not set the session response header, so this
          // is the earliest point the client can pin the conversation uuid.
          try {
            const raw = JSON.parse(data) as { session?: string };
            if (raw.session) {
              callbacks.onSession(raw.session);
            }
          } catch {
            // A malformed marker is not fatal; the session also arrives on
            // answer_done and turn_done.
          }
        } else if (eventType === 'turn_done') {
          streamFinalized = true;
          try {
            // The terminal event carries the final envelope so a late safety,
            // validation, evidence, or In-Depth correction reaches the live UI.
            const raw = JSON.parse(data) as AiSearchResponse;
            if (typeof raw.answer !== 'string') throw new Error('missing final answer');
            callbacks.onDone(raw);
          } catch {
            failStream('Failed to parse final response');
          }
        } else if (eventType === 'turn_error') {
          streamFinalized = true;
          try {
            const raw = JSON.parse(data) as { problemCode?: string };
            callbacks.onError(raw.problemCode ?? data);
          } catch {
            callbacks.onError(data);
          }
        }
        eventType = '';
        dataLines = [];
      }

      while (true) {
        const { done, value } = await streamReader.read();
        if (done) break;

        buffer += textDecoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line === '') {
            dispatchEvent();
          } else if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            const raw = line.slice(5);
            dataLines.push(raw.startsWith(' ') ? raw.slice(1) : raw);
          }
        }
      }

      if (buffer) {
        for (const line of buffer.split('\n')) {
          if (line === '') {
            dispatchEvent();
          } else if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            const raw = line.slice(5);
            dataLines.push(raw.startsWith(' ') ? raw.slice(1) : raw);
          }
        }
      }

      dispatchEvent();

      if (!streamFinalized) {
        callbacks.onError('Stream ended unexpectedly without a response');
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        callbacks.onError(err?.message ?? 'An unknown error occurred');
      }
    });
}

/**
 * Hydrate the chat panel state on mount. Returns the active session
 * (creating one if none exists) and its full message list in chronological
 * order. Empty messages array on a freshly-created session.
 */
export async function fetchChatHistory(
  patientUuid: string,
  abortController?: AbortController,
): Promise<ChatHistoryResponse> {
  const response = await openmrsFetch(`${BASE_PATH}/chat?patient=${encodeURIComponent(patientUuid)}`, {
    signal: abortController?.signal,
  });
  return response.data as ChatHistoryResponse;
}

/**
 * Close the current active chat session for this (patient, user) pair
 * and open a fresh one. Returns the new session uuid.
 */
export async function startNewChat(
  patientUuid: string,
  providerId?: string,
  abortController?: AbortController,
): Promise<ChatHistoryResponse> {
  const body: Record<string, string> = { patient: patientUuid };
  if (providerId?.trim()) {
    body.provider = providerId;
  }
  const response = await openmrsFetch(`${BASE_PATH}/chat/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: abortController?.signal,
  });
  return response.data as ChatHistoryResponse;
}

export interface HubProfileMetadata {
  id: string;
  label: string;
  staged: boolean;
  validation: boolean;
  temporal_enforcement: 'off' | 'warn' | 'enforce' | string;
  available: boolean;
  default: boolean;
  selection_priority: number;
  topology: 'single' | 'team' | string;
  visibility: 'product' | 'internal' | 'experimental' | string;
  stages: string[];
  required_models: string[];
  context_window: number | null;
  exact_tokenizer: boolean;
  unavailable_reasons: string[];
}

export interface HubProfileListResponse {
  object: 'list' | string;
  data: HubProfileMetadata[];
}

/**
 * Relay med-agent-hub's authoritative profile metadata through ChartSearchAI.
 */
export async function fetchProfiles(abortController?: AbortController): Promise<HubProfileListResponse> {
  const response = await openmrsFetch(`${BASE_PATH}/models`, {
    signal: abortController?.signal,
  });
  return response.data as HubProfileListResponse;
}

/**
 * A clinical-answer provider (bundled local inference or the med-agent-hub
 * relay) as advertised by ChartSearchAI's provider registry.
 */
export interface ClinicalProviderDescriptor {
  id: string;
  label: string;
  enabled: boolean;
  ready: boolean;
  default: boolean;
  modes: string[];
  capabilities: string[];
  unavailableReason: string | null;
}

export interface ProviderListResponse {
  defaultProvider: string;
  /** True only when more than one provider is configured — drives picker visibility. */
  pickerVisible: boolean;
  providers: ClinicalProviderDescriptor[];
}

/**
 * List the clinical-answer providers ChartSearchAI has configured. Bundled is
 * the fresh-install default; the hub appears only when it is configured.
 */
export async function fetchProviders(abortController?: AbortController): Promise<ProviderListResponse> {
  const response = await openmrsFetch(`${BASE_PATH}/providers`, {
    signal: abortController?.signal,
  });
  return response.data as ProviderListResponse;
}
