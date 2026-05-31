import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChartSearchAi } from './useChartSearchAi';
import { chatPatientChartStream, fetchChatHistory, refreshChartSnapshot, startNewChat } from '../api/chartsearchai';
import { chatSessionStore } from '../store/chat-session.store';

vi.mock('../api/chartsearchai', () => ({
  chatPatientChartStream: vi.fn(),
  fetchChatHistory: vi.fn(),
  refreshChartSnapshot: vi.fn(),
  startNewChat: vi.fn(),
}));

const mockChatStream = chatPatientChartStream as Mock;
const mockFetchHistory = fetchChatHistory as Mock;
const mockRefreshSnapshot = refreshChartSnapshot as Mock;
const mockStartNewChat = startNewChat as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  chatSessionStore.setState({ messagesByPatient: {}, sessionUuidByPatient: {}, selectedBackend: null });
  // Default: empty hydration so tests opt-in to populated history.
  mockFetchHistory.mockResolvedValue({ session: 'srv-session-default', messages: [] });
  mockChatStream.mockImplementation(() => {});
});

describe('useChartSearchAi', () => {
  it('returns empty messages and not loading initially', () => {
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    expect(result.current.messages).toEqual([]);
    expect(result.current.isAnyLoading).toBe(false);
  });

  it('hydrates chat history on mount and stores the server session uuid', async () => {
    mockFetchHistory.mockResolvedValueOnce({
      session: 'srv-session-1',
      messages: [
        { messageId: 'u-1', role: 'user', content: 'First Q', createdAt: 1 },
        { messageId: 'a-1', role: 'assistant', content: 'First A', createdAt: 2 },
      ],
    });

    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0].question).toBe('First Q');
    expect(result.current.messages[0].answer).toBe('First A');
    expect(result.current.messages[0].reasoning).toBe('');
    expect(chatSessionStore.getState().sessionUuidByPatient['patient-uuid']).toBe('srv-session-1');
  });

  it('submits first turn with null session and all stream callbacks', () => {
    mockFetchHistory.mockReturnValueOnce(new Promise(() => {}));
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'What meds?');
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].question).toBe('What meds?');
    expect(result.current.messages[0].isLoading).toBe(true);
    expect(mockChatStream).toHaveBeenCalledWith(
      'patient-uuid',
      null,
      'What meds?',
      expect.objectContaining({
        onSession: expect.any(Function),
        onThinking: expect.any(Function),
        onToken: expect.any(Function),
        onReferences: expect.any(Function),
        onDone: expect.any(Function),
        onGrounded: expect.any(Function),
        onError: expect.any(Function),
      }),
      expect.any(AbortController),
      // No per-session pick → null backend → server uses its config default.
      null,
    );
  });

  it('captures session uuid via onSession and reuses it on the next submit', async () => {
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalled());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Q1');
    });

    const callbacks1 = mockChatStream.mock.calls[0][3];
    act(() => {
      callbacks1.onSession('srv-session-captured');
      callbacks1.onDone({ answer: 'A1', references: [], session: 'srv-session-captured', messageId: 'm-1' });
    });
    expect(chatSessionStore.getState().sessionUuidByPatient['patient-uuid']).toBe('srv-session-captured');

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Q2');
    });

    expect(mockChatStream).toHaveBeenLastCalledWith(
      'patient-uuid',
      'srv-session-captured',
      'Q2',
      expect.any(Object),
      expect.any(AbortController),
      null,
    );
  });

  it('accumulates tokens into the in-flight message', async () => {
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalled());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Summary?');
    });
    const callbacks = mockChatStream.mock.calls[0][3];

    act(() => {
      callbacks.onToken('Hello');
      callbacks.onToken(' world');
    });

    expect(result.current.messages[0].answer).toBe('Hello world');
    expect(result.current.messages[0].isLoading).toBe(true);
  });

  it('accumulates live reasoning and clears it on done', async () => {
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalled());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'What meds?');
    });
    const callbacks = mockChatStream.mock.calls[0][3];

    act(() => {
      callbacks.onThinking('The query asks about medications. ');
      callbacks.onThinking('Scanning drug orders.');
    });
    expect(result.current.messages[0].reasoning).toBe('The query asks about medications. Scanning drug orders.');

    act(() => {
      callbacks.onDone({ answer: 'Aspirin [1]', references: [], messageId: 'q-1' });
    });
    expect(result.current.messages[0].reasoning).toBe('');
    expect(result.current.messages[0].answer).toBe('Aspirin [1]');
  });

  it('shows early references, then done overwrites them with grounded references', async () => {
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalled());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Any allergies?');
    });
    const callbacks = mockChatStream.mock.calls[0][3];
    const earlyRefs = [{ index: 1, resourceType: 'condition', resourceUuid: 'uuid-7', date: '2022-11-13' }];

    act(() => {
      callbacks.onReferences(earlyRefs);
    });
    expect(result.current.messages[0].references).toEqual(earlyRefs);
    expect(result.current.messages[0].references[0].grounded).toBeUndefined();
    expect(result.current.messages[0].isLoading).toBe(true);

    act(() => {
      callbacks.onDone({
        answer: 'Has it [1]',
        references: [{ ...earlyRefs[0], grounded: true }],
        messageId: 'q-1',
      });
    });
    expect(result.current.messages[0].references[0].grounded).toBe(true);
    expect(result.current.messages[0].isLoading).toBe(false);
  });

  it('applies trailing grounded verdicts to the completed message', async () => {
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalled());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Any allergies?');
    });
    const callbacks = mockChatStream.mock.calls[0][3];
    const refs = [{ index: 1, resourceType: 'condition', resourceUuid: 'uuid-7', date: '2022-11-13' }];

    act(() => {
      callbacks.onDone({ answer: 'Has it [1]', references: refs, messageId: 'q-1' });
    });
    expect(result.current.messages[0].isLoading).toBe(false);
    expect(result.current.messages[0].references[0].grounded).toBeUndefined();

    act(() => {
      callbacks.onGrounded([{ ...refs[0], grounded: false }]);
    });
    expect(result.current.messages[0].references[0].grounded).toBe(false);
  });

  it('carries blocks from streaming done onto the message', async () => {
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalled());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'List meds');
    });
    const callbacks = mockChatStream.mock.calls[0][3];

    const finalResponse = {
      answer: 'See table.',
      references: [{ index: 1, resourceType: 'order', resourceUuid: 'uuid-100', date: '2024-01-01' }],
      blocks: [
        {
          kind: 'table' as const,
          title: 'Medications',
          columns: [{ key: 'name', label: 'Medication' }],
          rows: [{ cells: { name: { text: 'Lisinopril', refs: [1] } } }],
        },
      ],
      session: 'srv-session-1',
      messageId: 'msg-blocks',
    };

    act(() => {
      callbacks.onDone(finalResponse);
    });

    expect(result.current.messages[0].blocks).toEqual(finalResponse.blocks);
  });

  it('hydrates blocks from chat history rows so reloads restore tables', async () => {
    mockFetchHistory.mockResolvedValueOnce({
      session: 'srv-session-h',
      messages: [
        { messageId: 'u-1', role: 'user', content: 'List meds', createdAt: 1 },
        {
          messageId: 'a-1',
          role: 'assistant',
          content: 'See table.',
          blocks: [
            {
              kind: 'table',
              title: 'Medications',
              columns: [{ key: 'name', label: 'Medication' }],
              rows: [{ cells: { name: { text: 'Lisinopril', refs: [1] } } }],
            },
          ],
          createdAt: 2,
        },
      ],
    });

    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0].answer).toBe('See table.');
    expect(result.current.messages[0].blocks).toHaveLength(1);
    expect(result.current.messages[0].blocks?.[0].title).toBe('Medications');
  });

  it('sets error on streaming onError', async () => {
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalled());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'What meds?');
    });
    const callbacks = mockChatStream.mock.calls[0][3];

    act(() => {
      callbacks.onError('Stream failed');
    });

    expect(result.current.messages[0].error).toBe('Stream failed');
    expect(result.current.messages[0].isLoading).toBe(false);
    expect(result.current.isAnyLoading).toBe(false);
  });

  it('clearMessages resets to empty array and aborts in-flight request', async () => {
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalled());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Q?');
    });

    const abortController = mockChatStream.mock.calls[0][4] as AbortController;
    expect(abortController.signal.aborted).toBe(false);

    act(() => {
      result.current.clearMessages();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.isAnyLoading).toBe(false);
    expect(abortController.signal.aborted).toBe(true);
  });

  it('stopCurrent preserves partial answer and keeps prior message history', async () => {
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalled());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'First?');
    });
    const firstCallbacks = mockChatStream.mock.calls[0][3];
    act(() => {
      firstCallbacks.onDone({ answer: 'Answer.', references: [], session: 's', messageId: 'm-1' });
    });

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Second?');
    });
    const secondCallbacks = mockChatStream.mock.calls[1][3];
    act(() => {
      secondCallbacks.onToken('Partial...');
    });

    act(() => {
      result.current.stopCurrent();
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].answer).toBe('Answer.');
    expect(result.current.messages[1].isLoading).toBe(false);
    expect(result.current.messages[1].answer).toBe('Partial...');
  });

  it('stopCurrent removes the message bubble when no answer was received', async () => {
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalled());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'First?');
    });
    const firstCallbacks = mockChatStream.mock.calls[0][3];
    act(() => {
      firstCallbacks.onDone({ answer: 'Answer.', references: [], session: 's', messageId: 'm-1' });
    });

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Second?');
    });

    act(() => {
      result.current.stopCurrent();
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].answer).toBe('Answer.');
  });

  it('startNewChatSession clears local state and stores fresh server session', async () => {
    mockStartNewChat.mockResolvedValueOnce({ session: 'new-session' });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalled());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Q?');
    });
    expect(result.current.messages).toHaveLength(1);

    await act(async () => {
      result.current.startNewChatSession('patient-uuid');
    });

    expect(result.current.messages).toEqual([]);
    expect(mockStartNewChat).toHaveBeenCalledWith('patient-uuid');
    await waitFor(() => expect(chatSessionStore.getState().sessionUuidByPatient['patient-uuid']).toBe('new-session'));
  });

  it('aborts in-flight request on unmount', async () => {
    mockChatStream.mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useChartSearchAi('patient-uuid'));
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalled());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Question?');
    });

    const abortController = mockChatStream.mock.calls[0][4] as AbortController;
    expect(abortController.signal.aborted).toBe(false);

    unmount();
    expect(abortController.signal.aborted).toBe(true);
  });

  it('records the resolved model from the streaming done event onto the message', async () => {
    mockChatStream.mockImplementation(() => {});
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalled());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Summary?');
    });
    const callbacks = mockChatStream.mock.calls[0][3];

    act(() => {
      callbacks.onDone({
        answer: 'Done.',
        references: [],
        session: 's',
        messageId: 'm-1',
        resolvedModel: 'med-agent-team',
      });
    });

    expect(result.current.messages[0].resolvedModel).toBe('med-agent-team');
  });

  it('passes the picker selection as the per-request backend override', async () => {
    mockChatStream.mockImplementation(() => {});
    chatSessionStore.setState({ selectedBackend: { endpointUrl: 'http://hub/v1', modelName: 'med-agent-team' } });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalled());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'What meds?');
    });

    expect(mockChatStream).toHaveBeenLastCalledWith(
      'patient-uuid',
      expect.anything(),
      'What meds?',
      expect.any(Object),
      expect.any(AbortController),
      { endpointUrl: 'http://hub/v1', modelName: 'med-agent-team' },
    );
  });

  it('refreshClinicalContext appends an in-thread system notice on success', async () => {
    mockRefreshSnapshot.mockResolvedValue({ session: 'srv-session-1' });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalled());

    await act(async () => {
      await result.current.refreshClinicalContext('patient-uuid');
    });

    expect(result.current.messages).toHaveLength(1);
    const notice = result.current.messages[0];
    expect(notice.kind).toBe('system');
    expect(notice.answer).toMatch(/clinical context refreshed/i);
    expect(notice.isLoading).toBe(false);
  });

  it('refreshClinicalContext rejects without dropping a notice when the refresh fails', async () => {
    mockRefreshSnapshot.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    await waitFor(() => expect(mockFetchHistory).toHaveBeenCalled());

    await expect(
      act(async () => {
        await result.current.refreshClinicalContext('patient-uuid');
      }),
    ).rejects.toThrow('boom');

    expect(result.current.messages).toHaveLength(0);
  });
});
