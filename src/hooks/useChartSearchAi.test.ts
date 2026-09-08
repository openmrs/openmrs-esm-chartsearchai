import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
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

  it('accumulates preliminary preview reasoning and replaces it when committed reasoning arrives', () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'BP history?');
    });

    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];

    // The progressive-reasoning preview streams first, onto its own channel.
    act(() => {
      callbacks.onPreliminary('Quick look: ');
      callbacks.onPreliminary('records [2] mention BP.');
    });
    // The preview's [N] markers are stripped — they index the focused chart, not the final answer's
    // records, so showing them would mislead. (The committed reasoning keeps its markers.)
    expect(result.current.messages[0].preliminaryReasoning).toBe('Quick look: records mention BP.');
    expect(result.current.messages[0].preliminaryReasoning).not.toContain('[');
    expect(result.current.messages[0].reasoning).toBe('');

    // The committed reasoning supersedes and CLEARS the provisional preview — a wrong preview
    // must not linger once the full-chart pass corrects it.
    act(() => {
      callbacks.onThinking('Reviewing the full chart.');
    });
    expect(result.current.messages[0].reasoning).toBe('Reviewing the full chart.');
    expect(result.current.messages[0].preliminaryReasoning).toBe('');
  });

  it('strips a preview citation marker even when it is split across SSE chunks', () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'BP?');
    });
    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];

    // The marker [2] is split across two chunks ('records [' then '2] mention BP.'); accumulation
    // re-strips the whole buffer each chunk, so it must still come out clean.
    act(() => {
      callbacks.onPreliminary('records [');
      callbacks.onPreliminary('2] mention BP.');
    });
    expect(result.current.messages[0].preliminaryReasoning).toBe('records mention BP.');
    expect(result.current.messages[0].preliminaryReasoning).not.toContain('[');
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
      callbacks.onGrounded({ references: [{ ...refs[0], grounded: true }] });
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
      firstCallbacks.onGrounded({
        references: [
          { index: 1, resourceType: 'condition', resourceUuid: 'uuid-7', date: '2022-11-13', grounded: false },
        ],
      });
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

/**
 * The answer-limit measurements (issue #26). Where they arrive from depends on the server:
 * with `chartsearchai.grounding.async=false` the `done` event carries them, and with it true
 * `done` is emitted before validation runs so they arrive only on the trailing `grounded`
 * event. A hook that reads `done` alone renders none of the disclosure on such a server.
 */
describe('useChartSearchAi answer-limit measurements', () => {
  const disclosure = {
    misattributedOrderCitations: [177, 166, 155],
    unstatedFindingSeverities: [350, 351],
    conditionRuleCoverage: 'absent',
    interactionPairs: { found: 18, reported: 10 },
    // The fifth measurement, added to the backend after the other four. It rides the same merge,
    // so listing it HERE is what gives it end-to-end streaming coverage: every test below that
    // asserts on `disclosure` now asserts this key survives the early-`done`-then-`grounded`
    // path, refuses to be erased by a later null, and is refused after a stop.
    activeOrderClaims: { stated: 5, uncited: 3 },
  };

  it('starts a message with no measurement stated', () => {
    mockSearchPatientChart.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Safe to start clarithromycin?');
    });

    // null is "no measurement stated" — never an empty array, which would say a check ran.
    const msg = result.current.messages[0];
    expect(msg.misattributedOrderCitations).toBeNull();
    expect(msg.unstatedFindingSeverities).toBeNull();
    expect(msg.conditionRuleCoverage).toBeNull();
    expect(msg.interactionPairs).toBeNull();
  });

  it('carries the measurements from a sync response onto the message', async () => {
    mockSearchPatientChart.mockResolvedValue({
      answer: 'No — Clarithromycin should not be started [350].',
      references: [],
      safetyWarnings: [{ type: 'interaction', drug: 'Clarithromycin', detail: 'x', severity: 'Major' }],
      questionId: 'q-1',
      ...disclosure,
    });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    await act(async () => {
      result.current.submitQuestion('patient-uuid', 'Safe to start clarithromycin?');
    });

    expect(result.current.messages[0]).toMatchObject(disclosure);
  });

  it('carries measurements that arrive only on the trailing grounded event (async grounding)', () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Safe to start clarithromycin?');
    });
    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];

    // Async grounding: `done` arrives before validation ran, so it states nulls and no chips.
    act(() => {
      callbacks.onDone({
        answer: 'No — Clarithromycin should not be started [350].',
        references: [],
        safetyWarnings: [],
        misattributedOrderCitations: null,
        unstatedFindingSeverities: null,
        conditionRuleCoverage: 'absent',
        interactionPairs: null,
        questionId: 'q-1',
      });
    });
    expect(result.current.messages[0].interactionPairs).toBeNull();
    expect(result.current.messages[0].misattributedOrderCitations).toBeNull();
    // conditionRuleCoverage is known before the model is called, so `done` already has it.
    expect(result.current.messages[0].conditionRuleCoverage).toBe('absent');

    // ...then the trailing event supplies the rest, and they must land on the SAME message.
    act(() => {
      callbacks.onGrounded({
        references: [],
        safetyWarnings: [{ type: 'interaction', drug: 'Clarithromycin', detail: 'x', severity: 'Major' }],
        ...disclosure,
      });
    });
    expect(result.current.messages[0]).toMatchObject(disclosure);
    expect(result.current.messages[0].safetyWarnings).toHaveLength(1);
  });

  it('does not let a later event erase a measurement an earlier one stated', () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Safe to start clarithromycin?');
    });
    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];

    // Sync grounding: `done` carries everything, and the trailing event (if the server sends
    // one at all) re-sends verdicts without repeating the measurements.
    act(() => {
      callbacks.onDone({
        answer: 'a [350]',
        references: [],
        safetyWarnings: [{ type: 'x', drug: 'y', detail: 'z' }],
        questionId: 'q-1',
        ...disclosure,
      });
    });
    act(() => {
      callbacks.onGrounded({
        references: [{ index: 1, resourceType: 'obs', resourceUuid: 'u', date: '2025-01-01', grounded: true }],
      });
    });

    expect(result.current.messages[0]).toMatchObject(disclosure);
    expect(result.current.messages[0].safetyWarnings).toHaveLength(1);
    expect(result.current.messages[0].references[0].grounded).toBe(true);
  });

  it('keeps an empty measurement distinct from an absent one', () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Safe to start clarithromycin?');
    });
    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];

    // [] says the check ran and named none; it must overwrite a null rather than be treated as
    // nothing-stated, or a client can never tell the two apart.
    act(() => {
      callbacks.onDone({
        answer: 'a',
        references: [],
        misattributedOrderCitations: [],
        unstatedFindingSeverities: [],
        questionId: 'q-1',
      });
    });
    expect(result.current.messages[0].misattributedOrderCitations).toEqual([]);
    expect(result.current.messages[0].unstatedFindingSeverities).toEqual([]);
  });
});

describe('useChartSearchAi after the panel closes', () => {
  it('still completes a message whose done event arrives after unmount', () => {
    // Unmount DOES abort the stream — `aborts in-flight request on unmount` below asserts
    // exactly that, and this comment used to claim the opposite of its own sibling. What abort()
    // cannot do is unwind a chunk already in hand, so a `done` decoded from it still arrives.
    // Gating `done` on the mount flag dropped that one, leaving the message `isLoading` forever:
    // the input disabled on reopen and no feedback row, on a message the store keeps.
    //
    // A trailing `grounded` is NOT part of this. It comes only after the slower Tier-2 pass, by
    // which point the abort has closed the stream — so the case for ungating rests on the
    // last-chunk `done` alone, and this test drives that callback directly rather than a real
    // stream, which is why it can reach a state the network no longer produces.
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result, unmount } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Safe to start clarithromycin?');
    });
    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];

    unmount();
    act(() => {
      callbacks.onDone({
        answer: 'No — it should not be started [350].',
        references: [],
        safetyWarnings: [{ type: 'interaction', drug: 'Clarithromycin', detail: 'x', severity: 'Major' }],
        conditionRuleCoverage: 'absent',
        questionId: 'q-1',
      });
    });

    const stored = chatSessionStore.getState().messagesByPatient['patient-uuid'];
    expect(stored).toHaveLength(1);
    expect(stored[0].isLoading).toBe(false);
    expect(stored[0].questionId).toBe('q-1');
    expect(stored[0].conditionRuleCoverage).toBe('absent');
  });

  it('still settles a message whose error arrives after unmount', () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result, unmount } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Safe to start clarithromycin?');
    });
    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];

    unmount();
    act(() => {
      callbacks.onError('boom');
    });

    const stored = chatSessionStore.getState().messagesByPatient['patient-uuid'];
    expect(stored[0].isLoading).toBe(false);
    expect(stored[0].error).toBe('boom');
  });
});

describe('useChartSearchAi late events', () => {
  it('settles rather than throwing when done carries no reference list', () => {
    // Not reachable from a conforming backend — the key is guaranteed on `done` — but the
    // panel dereferences this in a render memo with no error boundary above it, so the value
    // that reaches the store has to be iterable whatever arrived.
    mockUseConfig.mockReturnValue({ useStreaming: false });
    mockSearchPatientChart.mockResolvedValue({ answer: 'Text.', questionId: 'q-1' } as never);
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Any allergies?');
    });
    return waitFor(() => {
      expect(result.current.messages[0].isLoading).toBe(false);
      expect(result.current.messages[0].references).toEqual([]);
      expect(() => result.current.messages[0].references.some(() => true)).not.toThrow();
    });
  });

  it('does not let a done in the last chunk replace an answer the user stopped', () => {
    // abort() cannot unwind a chunk already in hand, so `done` can still arrive after Stop.
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Safe to start clarithromycin?');
    });
    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];
    act(() => {
      callbacks.onToken('Partial answer');
    });
    act(() => {
      result.current.stopCurrent();
    });
    expect(result.current.messages[0].answer).toBe('Partial answer');
    expect(result.current.messages[0].isLoading).toBe(false);

    act(() => {
      callbacks.onDone({ answer: 'THE FULL ANSWER', references: [], questionId: 'q-1' });
    });
    // The answer the user chose to stop at must not change under them.
    expect(result.current.messages[0].answer).toBe('Partial answer');
  });
});

describe('useChartSearchAi trailing grounded event', () => {
  it('does not let a trailing grounded event dress up an answer the user stopped', () => {
    // The `done` twin of this is above. `grounded` is the same hazard and worse: it carries the
    // four measurements, so a message whose answer is half a sentence would grow severity badges
    // resolved against that fragment and a "What the safety checks covered" block stating the
    // extent of a screen over an answer the reader never saw.
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Safe to start clarithromycin?');
    });
    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];
    act(() => {
      callbacks.onToken('Clarithromycin inter');
    });
    act(() => {
      result.current.stopCurrent();
    });

    act(() => {
      callbacks.onGrounded({
        references: [
          { index: 350, resourceType: 'safety_finding', resourceUuid: 'interaction:Clarithromycin', date: null },
        ],
        safetyWarnings: [{ type: 'interaction', drug: 'Clarithromycin', severity: 'Major', message: 'x' }],
        interactionPairs: { found: 5, reported: 5 },
        conditionRuleCoverage: 'absent',
        unstatedFindingSeverities: [350],
        misattributedOrderCitations: [],
      });
    });

    const msg = result.current.messages[0];
    expect(msg.answer).toBe('Clarithromycin inter');
    expect(msg.references).toHaveLength(0);
    expect(msg.safetyWarnings).toEqual([]);
    expect(msg.interactionPairs).toBeNull();
    expect(msg.conditionRuleCoverage).toBeNull();
    expect(msg.unstatedFindingSeverities).toBeNull();
  });

  it('does not blank the citation list when the event carries no references', () => {
    // The API layer coerces a missing/null `references` to `[]` before calling back, so an
    // event that parses without the key arrives as an empty array — and assigning it would
    // strip a completed answer of its whole References section and degrade every inline [N] to
    // plain text, the opposite of the documented "leaves citations rendered as unverified".
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi('patient-uuid'));

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Any allergies?');
    });
    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];
    act(() => {
      callbacks.onDone({
        answer: 'Has it [1].',
        references: [{ index: 1, resourceType: 'condition', resourceUuid: 'uuid-7', date: '2022-11-13' }],
        questionId: 'q-1',
      });
    });
    expect(result.current.messages[0].references).toHaveLength(1);

    act(() => {
      callbacks.onGrounded({ references: [], interactionPairs: { found: 3, reported: 2 } });
    });
    expect(result.current.messages[0].references).toHaveLength(1);
    // ...while the measurement the event DID carry still lands.
    expect(result.current.messages[0].interactionPairs).toEqual({ found: 3, reported: 2 });
  });
});
