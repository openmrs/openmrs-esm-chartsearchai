import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConfig } from '@openmrs/esm-framework';
import { useChartSearchAi } from './useChartSearchAi';
import { searchPatientChart, searchPatientChartStream } from '../api/chartsearchai';
import { chatSessionStore } from '../store/chat-session.store';

const mockUseConfig = useConfig as Mock;

vi.mock('../api/chartsearchai', () => ({
  searchPatientChart: vi.fn(),
  searchPatientChartStream: vi.fn(),
}));

const mockSearchPatientChart = searchPatientChart as Mock;
const mockSearchPatientChartStream = searchPatientChartStream as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  mockUseConfig.mockReturnValue({ useStreaming: false });
  chatSessionStore.setState({ messagesByPatient: {} });
});

describe('useChartSearchAi', () => {
  it('returns empty messages and not loading initially', () => {
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    expect(result.current.messages).toEqual([]);
    expect(result.current.isAnyLoading).toBe(false);
  });

  it('appends a loading message on submitQuestion', () => {
    mockSearchPatientChart.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

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
      references: [{ index: 1, resourceType: 'DrugOrder', resourceUuid: 'uuid-1', date: '2025-01-01' }],
      questionId: 'q-abc',
    };
    mockSearchPatientChart.mockResolvedValue(response);

    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

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

  it('captures safetyWarnings from the response onto the message', async () => {
    // The data-flow link the safety chips depend on: if `done` stops copying response.safetyWarnings,
    // the panel renders nothing and no other test would catch it.
    const response = {
      answer: 'Ibuprofen is an option [1].',
      references: [],
      safetyWarnings: [
        { type: 'contraindication', drug: 'Ibuprofen', detail: 'the patient has a recorded allergy to Ibuprofen' },
      ],
      questionId: 'q-sw',
    };
    mockSearchPatientChart.mockResolvedValue(response);

    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    await act(async () => {
      result.current.submitQuestion('patient-uuid', 'Is ibuprofen safe?');
    });

    expect(result.current.messages[0].safetyWarnings).toEqual(response.safetyWarnings);
  });

  it('defaults safetyWarnings to an empty array when the response omits them', async () => {
    // The drug-reference feature is optional and off by default, so most responses carry no warnings;
    // the message must still hold an array (the `?? []` fallback), never undefined.
    mockSearchPatientChart.mockResolvedValue({ answer: 'BP is 120/80 [1].', references: [], questionId: 'q-none' });

    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));
    await act(async () => {
      result.current.submitQuestion('patient-uuid', 'Latest BP?');
    });

    expect(result.current.messages[0].safetyWarnings).toEqual([]);
  });

  it('sets error on failed sync response', async () => {
    mockSearchPatientChart.mockRejectedValue({ message: 'Server error' });

    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

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

    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

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
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

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
        onReferences: expect.any(Function),
      }),
      expect.any(AbortController),
    );
  });

  it('shows early (pre-grounding) references on the in-flight message, then done overwrites with grounded ones', () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Any allergies?');
    });

    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];
    const earlyRefs = [{ index: 1, resourceType: 'condition', resourceUuid: 'uuid-7', date: '2022-11-13' }];

    // Early references event arrives before grounding finishes: citations show immediately,
    // message still loading, no grounding verdict yet.
    act(() => {
      callbacks.onReferences(earlyRefs);
    });
    expect(result.current.messages[0].references).toEqual(earlyRefs);
    expect(result.current.messages[0].references[0].grounded).toBeUndefined();
    expect(result.current.messages[0].isLoading).toBe(true);

    // done re-sends the same citations with grounding verdicts; they replace the early ones.
    act(() => {
      callbacks.onDone({
        answer: 'Has it [1]',
        references: [{ ...earlyRefs[0], grounded: true }],
        questionId: 'q-1',
      });
    });
    expect(result.current.messages[0].references[0].grounded).toBe(true);
    expect(result.current.messages[0].isLoading).toBe(false);
  });

  it('accumulates live reasoning on the in-flight message and clears it on done', () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'What meds?');
    });

    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];

    act(() => {
      callbacks.onThinking('The query asks about medications. ');
      callbacks.onThinking('Scanning drug orders.');
    });
    expect(result.current.messages[0].reasoning).toBe('The query asks about medications. Scanning drug orders.');
    expect(result.current.messages[0].isLoading).toBe(true);

    // The scratchpad is a live indicator, not part of the persisted result — done clears it.
    act(() => {
      callbacks.onDone({ answer: 'Aspirin [1]', references: [], questionId: 'q-1' });
    });
    expect(result.current.messages[0].reasoning).toBe('');
    expect(result.current.messages[0].answer).toBe('Aspirin [1]');
  });

  it('applies trailing grounded verdicts to the completed message (async grounding)', () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Any allergies?');
    });

    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];
    const refs = [{ index: 1, resourceType: 'condition', resourceUuid: 'uuid-7', date: '2022-11-13' }];

    // Async grounding: done arrives with verdict-less references and completes the message...
    act(() => {
      callbacks.onDone({ answer: 'Has it [1]', references: refs, questionId: 'q-1' });
    });
    expect(result.current.messages[0].isLoading).toBe(false);
    expect(result.current.messages[0].references[0].grounded).toBeUndefined();

    // ...then the trailing grounded event re-sends them with verdicts, which must land on the
    // SAME (already completed) message.
    act(() => {
      callbacks.onGrounded([{ ...refs[0], grounded: true }]);
    });
    expect(result.current.messages[0].references[0].grounded).toBe(true);
    expect(result.current.messages[0].isLoading).toBe(false);
    expect(result.current.messages[0].questionId).toBe('q-1');
  });

  it('applies grounded verdicts to the right message even after a newer question was submitted', () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Any allergies?');
    });
    const firstCallbacks = mockSearchPatientChartStream.mock.calls[0][2];
    act(() => {
      firstCallbacks.onDone({
        answer: 'Has it [1]',
        references: [{ index: 1, resourceType: 'condition', resourceUuid: 'uuid-7', date: '2022-11-13' }],
        questionId: 'q-1',
      });
    });

    // done released the in-flight slot, so a second question can start while the first
    // stream's grounded event is still pending.
    act(() => {
      result.current.submitQuestion('patient-uuid', 'Any meds?');
    });

    act(() => {
      firstCallbacks.onGrounded([
        { index: 1, resourceType: 'condition', resourceUuid: 'uuid-7', date: '2022-11-13', grounded: false },
      ]);
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].references[0].grounded).toBe(false);
    expect(result.current.messages[1].references).toEqual([]);
  });

  it('accumulates tokens into the last message during streaming', () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

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
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Summary?');
    });

    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];
    const finalResponse = {
      answer: 'Final answer.',
      references: [{ index: 1, resourceType: 'Obs', resourceUuid: 'uuid-10', date: '2025-06-01' }],
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
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

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
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

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
      secondCallbacks.onThinking('Still thinking...');
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
    // The settled message keeps no leftover reasoning scratchpad (mirrors `done`).
    expect(result.current.messages[1].reasoning).toBe('');
  });

  it('stopCurrent aborts the in-flight request', async () => {
    const response = { answer: 'Answer.', references: [], questionId: 'q-1' };
    mockSearchPatientChart.mockResolvedValue(response);
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

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
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

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
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'First?');
      result.current.submitQuestion('patient-uuid', 'Second?');
    });

    expect(result.current.messages).toHaveLength(1);
    expect(mockSearchPatientChart).toHaveBeenCalledTimes(1);
  });

  it('sets error on streaming onError', () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

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

    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    await act(async () => {
      result.current.submitQuestion('patient-uuid', 'Question?');
    });

    expect(result.current.messages[0]?.error).toBeNull();
  });

  it('aborts in-flight request on unmount', () => {
    mockSearchPatientChart.mockReturnValue(new Promise(() => {}));
    const { result, unmount } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Question?');
    });

    const abortController = mockSearchPatientChart.mock.calls[0][2] as AbortController;
    expect(abortController.signal.aborted).toBe(false);

    unmount();
    expect(abortController.signal.aborted).toBe(true);
  });
});
