import { makeUrl, restBaseUrl } from '@openmrs/esm-framework';

/**
 * Reads ChartSearch's streaming answer (`POST chartsearchai/search/stream`, server-sent events) for
 * the Query results page. The events and their fields are ChartSearch's; their meanings are in that
 * module's README ("Search" and "Streaming search (SSE)"), which this follows. Everything read here
 * is checked for shape, because it is drawn on a clinical page.
 */

export interface SseEvent {
  event: string;
  data: string;
}

/** The most bytes read, and the longest answer kept, so a runaway stream can't fill the page. */
export const maxStreamBytes = 2_000_000;
export const maxAnswerCharacters = 50_000;
/** The longest safety finding, and the longest of any other field, drawn from ChartSearch's statements. */
export const maxDetailCharacters = 5_000;
export const maxFieldCharacters = 500;

/**
 * A server-sent events parser for a stream read in chunks. Lines starting with ":" are comments
 * (ChartSearch's keep-alives) and are skipped; an event is dispatched at the blank line that ends it,
 * and an unfinished one at the end of the stream is dropped, as the SSE spec says.
 */
export function createSseParser(onEvent: (event: SseEvent) => void) {
  let buffer = '';
  let event = '';
  let data: Array<string> = [];
  let pendingCarriageReturn = false;

  const takeLine = (line: string) => {
    if (line === '') {
      if (data.length) {
        onEvent({ event: event || 'message', data: data.join('\n') });
      }
      event = '';
      data = [];
      return;
    }
    if (line.startsWith(':')) {
      return;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    if (field === 'event') {
      event = value;
    } else if (field === 'data') {
      data.push(value);
    }
  };

  return {
    push(chunk: string) {
      let text = chunk;
      // A "\r\n" split across two chunks is one line ending, not two.
      if (pendingCarriageReturn && text.startsWith('\n')) {
        text = text.slice(1);
      }
      pendingCarriageReturn = text.endsWith('\r');
      buffer += text;
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop() ?? '';
      lines.forEach(takeLine);
    },
  };
}

/** Thrown when the stream couldn't be read; `response.status` is set as `openmrsFetch` sets it. */
export class ChartSearchStreamError extends Error {
  response?: { status: number };
  constructor(status?: number) {
    super('ChartSearch stream failed');
    if (status !== undefined) {
      this.response = { status };
    }
  }
}

/**
 * Asks ChartSearch about this patient and calls `onEvent` for each event as it arrives. Resolves when
 * the stream ends. `openmrsFetch` can't be used: it reads the whole body before resolving.
 */
export async function streamChartSearch(
  patientUuid: string,
  question: string,
  onEvent: (event: SseEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await window.fetch(makeUrl(`${restBaseUrl}/chartsearchai/search/stream`), {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Disable-WWW-Authenticate': 'true',
    },
    body: JSON.stringify({ patient: patientUuid, question }),
  });
  if (!response.ok || !response.body) {
    throw new ChartSearchStreamError(response.status);
  }
  if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/event-stream')) {
    throw new ChartSearchStreamError();
  }

  const parser = createSseParser(onEvent);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let read = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        parser.push(decoder.decode());
        return;
      }
      read += value.byteLength;
      if (read > maxStreamBytes) {
        throw new ChartSearchStreamError();
      }
      parser.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
}

// What the page reads from ChartSearch's events. Fields it doesn't draw are left out.

export interface ChartSearchReference {
  index: number;
  resourceType: string;
  date: string | null;
  grounded: boolean | null;
  group: string;
  source: string | null;
  withheldInteractions: number;
  attachedByTheModule: boolean;
}

export interface ChartSearchSafetyWarning {
  type: string;
  drug: string;
  detail: string;
  severity: string | null;
  chartOrderBridges: Array<{ substance: string; orderDisplay: string }>;
}

/** The statements ChartSearch makes about its answer, from `done` and, later, `grounded`. */
export interface ChartSearchStatements {
  safetyWarnings: Array<ChartSearchSafetyWarning>;
  interactionPairs: { found: number; reported: number } | null;
  unresolvedDrugClass: string | null;
  unfaithfullyRenderedCitations: Array<number> | null;
  misattributedOrderCitations: Array<number> | null;
  unstatedFindingSeverities: Array<number> | null;
  activeOrderClaims: { stated: number; uncited: number } | null;
  conditionRuleCoverage: string | null;
}

const isString = (value: unknown): value is string => typeof value === 'string';
/** A string cut to `max` characters, so no one field from the server can fill the page. */
const capped = (value: string, max = maxFieldCharacters) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;
const stringOrNull = (value: unknown) => (isString(value) ? capped(value) : null);
const wholeNumber = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const numbersOrNull = (value: unknown) => (Array.isArray(value) ? value.filter(wholeNumber) : null);

export function parseReferences(value: unknown): Array<ChartSearchReference> | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value
    .filter((ref) => ref && typeof ref === 'object' && wholeNumber(ref.index) && isString(ref.resourceType))
    .map((ref) => ({
      index: ref.index,
      resourceType: capped(ref.resourceType),
      date: stringOrNull(ref.date),
      grounded: typeof ref.grounded === 'boolean' ? ref.grounded : null,
      // Anything but "reference" is drawn as chart evidence only if ChartSearch says "chart".
      group: isString(ref.group) ? capped(ref.group) : 'unknown',
      source: stringOrNull(ref.source),
      withheldInteractions: wholeNumber(ref.withheldInteractions) ? ref.withheldInteractions : 0,
      attachedByTheModule: ref.attachedByTheModule === true,
    }));
}

function parseWarnings(value: unknown): Array<ChartSearchSafetyWarning> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((chip) => chip && typeof chip === 'object' && isString(chip.detail))
    .map((chip) => ({
      type: isString(chip.type) ? capped(chip.type) : '',
      drug: isString(chip.drug) ? capped(chip.drug) : '',
      detail: capped(chip.detail, maxDetailCharacters),
      severity: isString(chip.severity) && chip.severity.trim() ? capped(chip.severity.trim()) : null,
      chartOrderBridges: Array.isArray(chip.chartOrderBridges)
        ? chip.chartOrderBridges
            .filter(
              (bridge: { substance?: unknown; orderDisplay?: unknown } | null) =>
                bridge && isString(bridge.substance) && isString(bridge.orderDisplay),
            )
            .map((bridge: { substance: string; orderDisplay: string }) => ({
              substance: capped(bridge.substance),
              orderDisplay: capped(bridge.orderDisplay),
            }))
        : [],
    }));
}

export function parseStatements(payload: Record<string, unknown>): ChartSearchStatements {
  const pairs = payload.interactionPairs as { found?: unknown; reported?: unknown } | null;
  const claims = payload.activeOrderClaims as { stated?: unknown; uncited?: unknown } | null;
  return {
    safetyWarnings: parseWarnings(payload.safetyWarnings),
    interactionPairs:
      pairs && wholeNumber(pairs.found) && wholeNumber(pairs.reported)
        ? { found: pairs.found, reported: pairs.reported }
        : null,
    unresolvedDrugClass: stringOrNull(payload.unresolvedDrugClass),
    unfaithfullyRenderedCitations: numbersOrNull(payload.unfaithfullyRenderedCitations),
    misattributedOrderCitations: numbersOrNull(payload.misattributedOrderCitations),
    unstatedFindingSeverities: numbersOrNull(payload.unstatedFindingSeverities),
    activeOrderClaims:
      claims && wholeNumber(claims.stated) && wholeNumber(claims.uncited)
        ? { stated: claims.stated, uncited: claims.uncited }
        : null,
    conditionRuleCoverage: stringOrNull(payload.conditionRuleCoverage),
  };
}

export function parseJson(data: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
