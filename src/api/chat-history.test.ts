import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { openmrsFetch } from '@openmrs/esm-framework';
import { fetchChatHistory, startNewChat, type ChatHistoryResponse } from './chartsearchai';

const mockFetch = openmrsFetch as Mock;

beforeEach(() => vi.clearAllMocks());

describe('chat history requests', () => {
  it('encodes the patient identifier and preserves the server response and cancellation signal', async () => {
    const history: ChatHistoryResponse = {
      session: 'session-1',
      provider: 'bundled',
      messages: [
        { messageId: 'question-1', role: 'user', content: 'Any allergies?', createdAt: 1 },
        {
          messageId: 'answer-1',
          role: 'assistant',
          content: 'Penicillin allergy.',
          createdAt: 2,
          safetyStatus: 'limited',
          terminalState: 'turn_done',
          orderStopDates: [],
        },
      ],
    };
    mockFetch.mockResolvedValueOnce({ data: history });
    const controller = new AbortController();

    expect(await fetchChatHistory('patient/1&session=other', controller)).toBe(history);
    expect(mockFetch).toHaveBeenCalledExactlyOnceWith(
      '/ws/rest/v1/chartsearchai/chat?patient=patient%2F1%26session%3Dother',
      { signal: controller.signal },
    );
  });

  it('accepts the rows the server sends for a finished turn and for one still running', async () => {
    const history: ChatHistoryResponse = {
      session: 'session-1',
      provider: 'hub',
      mode: 'query_scoped',
      messages: [
        { messageId: 'request-1', role: 'user', content: 'Any allergies?', createdAt: 1 },
        {
          messageId: 'turn-1',
          role: 'assistant',
          content: 'Penicillin allergy.',
          terminalState: 'turn_done',
          problemCode: null,
          createdAt: 2,
          auditLogId: 7,
        },
        { messageId: 'request-2', role: 'user', content: 'Since when?', createdAt: 3 },
        { messageId: 'turn-2', role: 'assistant', content: 'Since 2019.', terminalState: null, problemCode: null },
      ],
    };
    mockFetch.mockResolvedValueOnce({ data: history });

    const result = await fetchChatHistory('patient-1');

    expect(result.messages[1].terminalState).toBe('turn_done');
    expect(result.messages[3].terminalState).toBeNull();
    expect(result.messages[3].createdAt).toBeUndefined();
  });

  it('accepts an empty history with no server conversation', async () => {
    const empty: ChatHistoryResponse = { session: null, provider: null, messages: [] };
    mockFetch.mockResolvedValueOnce({ data: empty });

    expect(await fetchChatHistory('patient-1')).toEqual(empty);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('passes a history failure to the caller instead of reporting empty history', async () => {
    const failure = new Error('History unavailable');
    mockFetch.mockRejectedValueOnce(failure);

    await expect(fetchChatHistory('patient-1')).rejects.toBe(failure);
  });
});

describe('new chat requests', () => {
  it('sends the selected provider and cancellation signal and returns the new conversation', async () => {
    const result: ChatHistoryResponse = { session: 'new-session', provider: 'hub', messages: [] };
    mockFetch.mockResolvedValueOnce({ data: result });
    const controller = new AbortController();

    expect(await startNewChat('patient-1', 'hub', controller)).toBe(result);
    expect(mockFetch).toHaveBeenCalledExactlyOnceWith('/ws/rest/v1/chartsearchai/chat/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patient: 'patient-1', provider: 'hub' }),
      signal: controller.signal,
    });
  });

  it.each([undefined, '', '  '])('leaves provider selection to the server for %s', async (provider) => {
    mockFetch.mockResolvedValueOnce({ data: { session: 'new-session', messages: [] } });

    await startNewChat('patient-1', provider);

    expect(mockFetch).toHaveBeenCalledExactlyOnceWith('/ws/rest/v1/chartsearchai/chat/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patient: 'patient-1' }),
      signal: undefined,
    });
  });

  it('passes a failed new-chat request to the caller', async () => {
    const failure = new Error('Provider unavailable');
    mockFetch.mockRejectedValueOnce(failure);

    await expect(startNewChat('patient-1', 'hub')).rejects.toBe(failure);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
