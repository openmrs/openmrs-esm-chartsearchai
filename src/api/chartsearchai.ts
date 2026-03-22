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
  disclaimer: string;
  references: AiReference[];
}

export interface AiSearchError {
  error: string;
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
    body: { patient: patientUuid, question },
    signal: abortController?.signal,
  });
  return response.data;
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
      signal: abortController?.signal,
    })
    .then(async (response) => {
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
      let currentEvent = '';
      let streamFinalized = false;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await streamReader.read();
        if (done) break;

        buffer += textDecoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (currentEvent === 'token') {
              callbacks.onToken(data);
            } else if (currentEvent === 'done') {
              streamFinalized = true;
              try {
                const parsed: AiSearchResponse = JSON.parse(data);
                callbacks.onDone(parsed);
              } catch {
                callbacks.onError('Failed to parse final response');
              }
            } else if (currentEvent === 'error') {
              streamFinalized = true;
              callbacks.onError(data);
            }
          }
        }
      }

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
