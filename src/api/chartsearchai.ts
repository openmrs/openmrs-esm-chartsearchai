import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';

const BASE_PATH = `${restBaseUrl}/chartsearchai`;

export interface AiReference {
  index: number;
  resourceType: string;
  resourceId: number;
  date: string;
}

export interface AiSearchResponse {
  answer: string;
  references: AiReference[];
  questionId?: string;
}

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
        callbacks.onError('Your session has expired. Please log in again.');
        return;
      }

      if (!response.ok) {
        let message = `Server error: ${response.status}`;
        try {
          const body = await response.json();
          if (body?.error) {
            message = body.error;
          }
        } catch {
          // no JSON body
        }
        callbacks.onError(message);
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

      // eslint-disable-next-line no-constant-condition
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
