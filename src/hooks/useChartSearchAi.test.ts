import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChartSearchAi } from './useChartSearchAi';
import { chatPatientChartStream, fetchChatHistory, startNewChat } from '../api/chartsearchai';
import { chatSessionStore } from '../store/chat-session.store';

vi.mock('../api/chartsearchai', () => ({
  chatPatientChartStream: vi.fn(),
  fetchChatHistory: vi.fn(),
  startNewChat: vi.fn(),
}));

const mockChatStream = chatPatientChartStream as Mock;
const mockFetchHistory = fetchChatHistory as Mock;
const mockStartNewChat = startNewChat as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  chatSessionStore.setState({ messagesByPatient: {}, sessionUuidByPatient: {} });
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
});
