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
  it('returns initial state', () => {
    const { result } = renderHook(() => useChartSearchAi());

    expect(result.current.answer).toBe('');
    expect(result.current.disclaimer).toBe('');
    expect(result.current.references).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets loading state on submit', () => {
    mockSearchPatientChart.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useChartSearchAi());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'What meds?');
    });

    expect(result.current.isLoading).toBe(true);
    expect(mockSearchPatientChart).toHaveBeenCalledWith('patient-uuid', 'What meds?', expect.any(AbortController));
  });

  it('populates answer on successful sync response', async () => {
    const response = {
      answer: 'The patient is on metformin.',
      disclaimer: 'AI-generated.',
      references: [{ index: 1, resourceType: 'DrugOrder', resourceId: 1, date: '2025-01-01' }],
    };
    mockSearchPatientChart.mockResolvedValue(response);

    const { result } = renderHook(() => useChartSearchAi());

    await act(async () => {
      result.current.submitQuestion('patient-uuid', 'What meds?');
    });

    expect(result.current.answer).toBe('The patient is on metformin.');
    expect(result.current.disclaimer).toBe('AI-generated.');
    expect(result.current.references).toEqual(response.references);
    expect(result.current.isLoading).toBe(false);
  });

  it('sets error on failed sync response', async () => {
    mockSearchPatientChart.mockRejectedValue({ message: 'Server error' });

    const { result } = renderHook(() => useChartSearchAi());

    await act(async () => {
      result.current.submitQuestion('patient-uuid', 'What meds?');
    });

    expect(result.current.error).toBe('Server error');
    expect(result.current.isLoading).toBe(false);
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
      expect.objectContaining({ onToken: expect.any(Function), onDone: expect.any(Function), onError: expect.any(Function) }),
      expect.any(AbortController),
    );
  });

  it('accumulates tokens during streaming', () => {
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

    expect(result.current.answer).toBe('Hello world');
    expect(result.current.isLoading).toBe(true);
  });

  it('finalizes state on streaming done', () => {
    mockUseConfig.mockReturnValue({ useStreaming: true });
    const { result } = renderHook(() => useChartSearchAi());

    act(() => {
      result.current.submitQuestion('patient-uuid', 'Summary?');
    });

    const callbacks = mockSearchPatientChartStream.mock.calls[0][2];
    const finalResponse = {
      answer: 'Final answer.',
      disclaimer: 'Disclaimer text.',
      references: [{ index: 1, resourceType: 'Obs', resourceId: 10, date: '2025-06-01' }],
    };

    act(() => {
      callbacks.onDone(finalResponse);
    });

    expect(result.current.answer).toBe('Final answer.');
    expect(result.current.disclaimer).toBe('Disclaimer text.');
    expect(result.current.references).toEqual(finalResponse.references);
    expect(result.current.isLoading).toBe(false);
  });

  it('clears results', async () => {
    const response = {
      answer: 'Answer.',
      disclaimer: 'Disclaimer.',
      references: [],
    };
    mockSearchPatientChart.mockResolvedValue(response);

    const { result } = renderHook(() => useChartSearchAi());

    await act(async () => {
      result.current.submitQuestion('patient-uuid', 'Question?');
    });

    expect(result.current.answer).toBe('Answer.');

    act(() => {
      result.current.clearResults();
    });

    expect(result.current.answer).toBe('');
    expect(result.current.disclaimer).toBe('');
    expect(result.current.references).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('ignores AbortError on cancelled requests', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    mockSearchPatientChart.mockRejectedValue(abortError);

    const { result } = renderHook(() => useChartSearchAi());

    await act(async () => {
      result.current.submitQuestion('patient-uuid', 'Question?');
    });

    expect(result.current.error).toBeNull();
  });
});
