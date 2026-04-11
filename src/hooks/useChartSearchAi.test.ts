import { renderHook, act } from '@testing-library/react';
import { useConfig } from '@openmrs/esm-framework';
import { useChartSearchAi } from './useChartSearchAi';
import { searchPatientChart, searchPatientChartStream } from '../api/chartsearchai';

const mockUseConfig = useConfig as jest.Mock;

jest.mock('../api/chartsearchai', () => ({
  searchPatientChart: jest.fn(),
  searchPatientChartStream: jest.fn(),
}));

const mockSearchPatientChart = searchPatientChart as jest.Mock;
const mockSearchPatientChartStream = searchPatientChartStream as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockUseConfig.mockReturnValue({ useStreaming: false });
});

describe('useChartSearchAi', () => {
  it('returns empty messages and not loading initially', () => {
    const { result } = renderHook(() => useChartSearchAi());

    expect(result.current.messages).toEqual([]);
    expect(result.current.isAnyLoading).toBe(false);
  });

  it('appends a loading message on submitQuestion', () => {
    mockSearchPatientChart.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useChartSearchAi());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'What meds?');
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].question).toBe('What meds?');
    expect(result.current.messages[0].isLoading).toBe(true);
    expect(result.current.messages[0].answer).toBe('');
    expect(result.current.isAnyLoading).toBe(true);
    expect(mockSearchPatientChart).toHaveBeenCalledWith('patient-uuid', 'What meds?', expect.any(AbortController));
  });

  it('populates answer on successful sync response', async () => {
    const response = {
      answer: 'The patient is on metformin.',
      references: [{ index: 1, resourceType: 'DrugOrder', resourceId: 1, date: '2025-01-01' }],
      questionId: 'q-abc',
    };
    mockSearchPatientChart.mockResolvedValue(response);

    const { result } = renderHook(() => useChartSearchAi());

    await act(async () => {
      result.current.submitQuestion('patient-uuid', 'What meds?');
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].answer).toBe('The patient is on metformin.');
    expect(result.current.messages[0].references).toEqual(response.references);
    expect(result.current.messages[0].questionId).toBe('q-abc');
    expect(result.current.messages[0].isLoading).toBe(false);
    expect(result.current.isAnyLoading).toBe(false);
  });

  it('sets error on failed sync response', async () => {
    mockSearchPatientChart.mockRejectedValue({ message: 'Server error' });

    const { result } = renderHook(() => useChartSearchAi());

    await act(async () => {
      result.current.submitQuestion('patient-uuid', 'What meds?');
    });

    expect(result.current.messages[0].error).toBe('Server error');
    expect(result.current.messages[0].isLoading).toBe(false);
    expect(result.current.isAnyLoading).toBe(false);
  });

  it('appends a second message without removing the first', async () => {
    const response1 = { answer: 'Answer 1.', references: [], questionId: 'q-1' };
    const response2 = { answer: 'Answer 2.', references: [], questionId: 'q-2' };
    mockSearchPatientChart.mockResolvedValueOnce(response1).mockResolvedValueOnce(response2);

    const { result } = renderHook(() => useChartSearchAi());

    await act(async () => {
      result.current.submitQuestion('patient-uuid', 'First question?');
    });

    await act(async () => {
      result.current.submitQuestion('patient-uuid', 'Second question?');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].question).toBe('First question?');
    expect(result.current.messages[0].answer).toBe('Answer 1.');
    expect(result.current.messages[1].question).toBe('Second question?');
    expect(result.current.messages[1].answer).toBe('Answer 2.');
  });

  it('uses streaming endpoint when configured', () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Any allergies?');
    });

    expect(mockSearchPatientChartStream).toHaveBeenCalledWith(
      'patient-uuid',
      'Any allergies?',
      expect.objectContaining({
        onToken: expect.any(Function),
        onDone: expect.any(Function),
        onError: expect.any(Function),
      }),
      expect.any(AbortController),
    );
  });

  it('accumulates tokens into the last message during streaming', () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Summary?');
    });

    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];

    act(() => {
      callbacks.onToken('Hello');
      callbacks.onToken(' world');
    });

    expect(result.current.messages[0].answer).toBe('Hello world');
    expect(result.current.messages[0].isLoading).toBe(true);
  });

  it('finalizes last message on streaming done', () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Summary?');
    });

    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];
    const finalResponse = {
      answer: 'Final answer.',
      references: [{ index: 1, resourceType: 'Obs', resourceId: 10, date: '2025-06-01' }],
      questionId: 'q-stream-1',
    };

    act(() => {
      callbacks.onDone(finalResponse);
    });

    expect(result.current.messages[0].answer).toBe('Final answer.');
    expect(result.current.messages[0].references).toEqual(finalResponse.references);
    expect(result.current.messages[0].questionId).toBe('q-stream-1');
    expect(result.current.messages[0].isLoading).toBe(false);
  });

  it('clearMessages resets to empty array and aborts in-flight request', () => {
    mockSearchPatientChart.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useChartSearchAi());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Question?');
    });

    const abortController = mockSearchPatientChart.mock.calls[0][2] as AbortController;
    expect(result.current.messages).toHaveLength(1);
    expect(abortController.signal.aborted).toBe(false);

    act(() => {
      result.current.clearMessages();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.isAnyLoading).toBe(false);
    expect(abortController.signal.aborted).toBe(true);
  });

  it('stopCurrent preserves history of completed messages when second message has partial answer', async () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi());

    // First question resolves via streaming
    act(() => {
      result.current.submitQuestion('patient-uuid', 'First?');
    });
    const firstCallbacks = mockSearchPatientChartStream.mock.calls[0][2];
    act(() => {
      firstCallbacks.onDone({ answer: 'Answer.', references: [], questionId: 'q-1' });
    });

    // Second question — receives a partial token then hangs
    act(() => {
      result.current.submitQuestion('patient-uuid', 'Second?');
    });
    const secondCallbacks = mockSearchPatientChartStream.mock.calls[1][2];
    act(() => {
      secondCallbacks.onToken('Partial...');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].answer).toBe('Partial...');

    act(() => {
      result.current.stopCurrent();
    });

    // Partial-answer message is kept; first message history preserved
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].answer).toBe('Answer.');
    expect(result.current.messages[1].isLoading).toBe(false);
    expect(result.current.messages[1].answer).toBe('Partial...');
  });

  it('stopCurrent aborts the in-flight request', async () => {
    const response = { answer: 'Answer.', references: [], questionId: 'q-1' };
    mockSearchPatientChart.mockResolvedValue(response);
    const { result } = renderHook(() => useChartSearchAi());

    await act(async () => {
      result.current.submitQuestion('patient-uuid', 'First?');
    });

    mockSearchPatientChart.mockReturnValue(new Promise(() => {}));
    act(() => {
      result.current.submitQuestion('patient-uuid', 'Second?');
    });

    const abortController = mockSearchPatientChart.mock.calls[1][2] as AbortController;
    expect(abortController.signal.aborted).toBe(false);

    act(() => {
      result.current.stopCurrent();
    });

    expect(abortController.signal.aborted).toBe(true);
  });

  it('stopCurrent removes the message bubble when no answer was received', async () => {
    const response = { answer: 'Answer.', references: [], questionId: 'q-1' };
    mockSearchPatientChart.mockResolvedValue(response);
    const { result } = renderHook(() => useChartSearchAi());

    await act(async () => {
      result.current.submitQuestion('patient-uuid', 'First?');
    });

    mockSearchPatientChart.mockReturnValue(new Promise(() => {}));
    act(() => {
      result.current.submitQuestion('patient-uuid', 'Second?');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].answer).toBe('');

    act(() => {
      result.current.stopCurrent();
    });

    // Empty-answer message is removed; history of first message preserved
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].answer).toBe('Answer.');
  });

  it('drops a second submitQuestion call while the first is in flight', () => {
    mockSearchPatientChart.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useChartSearchAi());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'First?');
      result.current.submitQuestion('patient-uuid', 'Second?');
    });

    expect(result.current.messages).toHaveLength(1);
    expect(mockSearchPatientChart).toHaveBeenCalledTimes(1);
  });

  it('sets error on streaming onError', () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'What meds?');
    });

    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];

    act(() => {
      callbacks.onError('Stream failed');
    });

    expect(result.current.messages[0].error).toBe('Stream failed');
    expect(result.current.messages[0].isLoading).toBe(false);
    expect(result.current.isAnyLoading).toBe(false);
  });

  it('ignores AbortError on cancelled requests', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    mockSearchPatientChart.mockRejectedValue(abortError);

    const { result } = renderHook(() => useChartSearchAi());

    await act(async () => {
      result.current.submitQuestion('patient-uuid', 'Question?');
    });

    expect(result.current.messages[0]?.error).toBeNull();
  });

  it('aborts in-flight request on unmount', () => {
    mockSearchPatientChart.mockReturnValue(new Promise(() => {}));
    const { result, unmount } = renderHook(() => useChartSearchAi());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Question?');
    });

    const abortController = mockSearchPatientChart.mock.calls[0][2] as AbortController;
    expect(abortController.signal.aborted).toBe(false);

    unmount();
    expect(abortController.signal.aborted).toBe(true);
  });
});
