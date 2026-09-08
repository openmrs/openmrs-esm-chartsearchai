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
  resourceType: string;
  /**
   * OpenMRS UUID of the cited record (the backend serializes this field as `resourceUuid`).
   * Used to locate and highlight the record's row after navigating to its chart page.
   */
  resourceUuid: string;
  date: string;
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
   * Which corpus the cited record came from: `chart` = the patient's own record,
   * `reference` = module-supplied reference material (a drug-reference entry, a
   * safety finding, a drug-class note), which has no chart page to navigate to.
   * Optional so a response predating the field still parses — {@link isReferenceData} accepts
   * either signal, so a `reference` type this client predates is still recognised by its group.
   */
  group?: string | null;
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
 * A non-blocking drug-safety advisory raised by the backend's post-answer validator
 * (only when the optional drug-reference feature is enabled). It annotates the answer
 * — it never alters it. Rendered as a chip below the answer.
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

export interface AiSearchResponse {
  answer: string;
  references: AiReference[];
  /** Empty/absent unless the optional drug-reference feature is enabled on the server. */
  safetyWarnings?: AiSafetyWarning[];
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
  questionId?: string;
}

/**
 * The four response fields that state what a bounded safety answer did not cover. Declared once
 * here, on the wire type, and referenced by the chat message and the panel props so the three
 * cannot drift — in particular the reading that an empty array is not a certificate.
 */
export type AiAnswerLimits = Pick<
  AiSearchResponse,
  'misattributedOrderCitations' | 'unstatedFindingSeverities' | 'conditionRuleCoverage' | 'interactionPairs'
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
  questionId: string;
  rating: FeedbackRating;
  comment?: string;
}

export interface AiSearchError {
  error: string;
}

/**
 * Pre-warms the server-side LLM prompt cache for the given patient. Fire-and-forget;
 * fired when the chart is opened so the first AI query skips full prefill cost. Pass
 * an AbortSignal to cancel an in-flight warmup when the user navigates to a different
 * patient before the previous warmup finished.
 */
export function warmupPatient(patientUuid: string, signal?: AbortSignal): void {
  openmrsFetch(`${BASE_PATH}/warmup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patient: patientUuid }),
    signal,
  }).catch(() => {
    // ignore — the user does not depend on this completing, and aborts are expected on patient switch
  });
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
 * Sends a synchronous AI search request.
 */
export async function searchPatientChart(
  patientUuid: string,
  question: string,
  abortController?: AbortController,
): Promise<AiSearchResponse> {
  const response = await openmrsFetch(`${BASE_PATH}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patient: patientUuid, question }),
    signal: abortController?.signal,
  });
  if (!response.data?.answer) {
    throw new Error('Unexpected response from server');
  }
  return response.data as AiSearchResponse;
}

/**
 * Opens an SSE (Server-Sent Events) stream for AI search.
 *
 * Uses raw fetch instead of openmrsFetch because openmrsFetch consumes
 * the response body to parse it as JSON, which prevents streaming.
 * We need direct access to response.body (the ReadableStream).
 */
export function searchPatientChartStream(
  patientUuid: string,
  question: string,
  callbacks: {
    onToken: (token: string) => void;
    onDone: (response: AiSearchResponse) => void;
    onError: (error: string) => void;
    /**
     * Early citations, emitted by the server the moment the answer's references are
     * known — before the (slower) grounding pass attaches verdicts. Lets the UI show
     * the citations immediately as unverified; the {@code done} event then re-sends
     * the same references with their grounding verdicts. Optional and best-effort: a
     * missing or malformed event is ignored, since {@code done} is authoritative.
     */
    onReferences?: (references: AiReference[]) => void;
    /**
     * Trailing grounding verdicts, emitted only when the server runs with
     * {@code chartsearchai.grounding.async=true}: in that mode {@code done} arrives as soon
     * as the answer is complete (its references carry no verdicts) and this event re-sends
     * the same references with their {@code grounded} verdicts once the (slower) Tier-2
     * verification finishes. Best-effort like {@code onReferences}: when the server runs in
     * classic mode the event never arrives and {@code done}'s references are already final;
     * a malformed payload just leaves citations rendered as unverified.
     *
     * It carries more than the verdicts: the final {@code safetyWarnings} and the answer-limit
     * measurements ({@code interactionPairs}, {@code misattributedOrderCitations},
     * {@code unstatedFindingSeverities}) are all null/empty on the early {@code done} in that
     * mode and arrive only here, so the whole payload is handed over rather than the
     * references alone.
     */
    onGrounded?: (update: AiGroundedUpdate) => void;
    /**
     * Live reasoning ("thinking") chunks, streamed by the server before the answer so the
     * UI can show progress and the model's rationale instead of a dead spinner during the
     * reasoning phase. Scratchpad only — render distinctly (subdued, transient), never as
     * the answer.
     */
    onThinking?: (chunk: string) => void;
    /**
     * Preliminary reasoning chunks from the optional progressive-reasoning preview pass (server
     * GP {@code chartsearchai.progressiveReasoning.enabled}). Streamed before {@code onThinking}
     * over only the top-K focused chart, so the UI can show reasoning almost immediately on a
     * slow host. It is provisional and can be wrong until the committed full-chart reasoning
     * arrives — render it distinctly (subdued/labelled as an in-progress preview, not the answer)
     * and REPLACE it the moment the first {@code onThinking} (or {@code onToken}) chunk arrives.
     * Never fires when the server GP is off.
     */
    onPreliminary?: (chunk: string) => void;
  },
  abortController?: AbortController,
): void {
  const url = `${window.openmrsBase}${BASE_PATH}/search/stream`;

  window
    .fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'Disable-WWW-Authenticate': 'true',
      },
      body: JSON.stringify({ patient: patientUuid, question }),
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
        let bodyError: string | null = null;
        try {
          const body = await response.json();
          if (body?.error) {
            bodyError = body.error;
          }
        } catch {
          // non-JSON body (a bare container/auth response, not a controller error)
        }
        if (bodyError) {
          // The controller always serializes its errors as JSON, so a parseable error is a genuine
          // server-side failure — surface it verbatim.
          callbacks.onError(bodyError);
        } else if (response.status >= 500 || response.status === 401 || response.status === 403) {
          // No JSON body means this came from OpenMRS's auth/session layer, not the controller:
          // a 401/403, or a 500 that is really "sendRedirect() after the response was committed"
          // (the SSE stream commits the response, so the expired-session login redirect can't fire
          // and surfaces as a bare HTML 500). Treat all of these as session expiry — the same
          // actionable cause as the 302 handled above — rather than a cryptic "Server error: 500".
          callbacks.onError(SESSION_EXPIRED_ERROR_CODE);
        } else {
          callbacks.onError(`Server error: ${response.status}`);
        }
        return;
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

      function dispatchEvent() {
        if (dataLines.length === 0) {
          eventType = '';
          return;
        }
        const data = dataLines.join('\n');
        if (eventType === 'token') {
          callbacks.onToken(data);
        } else if (eventType === 'thinking') {
          callbacks.onThinking?.(data);
        } else if (eventType === 'preliminary') {
          callbacks.onPreliminary?.(data);
        } else if (eventType === 'references') {
          // Pre-grounding citations: best-effort, so a malformed payload is ignored rather
          // than failing the stream — the authoritative references arrive with `done`.
          try {
            const parsed = JSON.parse(data);
            callbacks.onReferences?.(parsed.references ?? []);
          } catch {
            // ignore; `done` is authoritative
          }
        } else if (eventType === 'grounded') {
          // Post-done verdicts (async grounding). Best-effort: a malformed payload leaves
          // the citations unverified rather than erroring an already-complete answer.
          try {
            const parsed = JSON.parse(data);
            callbacks.onGrounded?.({ ...parsed, references: parsed.references ?? [] });
          } catch {
            // ignore; citations simply stay unverified
          }
        } else if (eventType === 'done') {
          streamFinalized = true;
          try {
            const parsed: AiSearchResponse = JSON.parse(data);
            callbacks.onDone(parsed);
          } catch {
            callbacks.onError('Failed to parse final response');
          }
        } else if (eventType === 'error') {
          streamFinalized = true;
          callbacks.onError(data);
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

      // Process any remaining lines in the buffer (stream ended without trailing newline)
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

      // Flush any event accumulated in the loop but not yet dispatched
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
