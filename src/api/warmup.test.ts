import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { openmrsFetch } from '@openmrs/esm-framework';
import { warmupPatient } from './chartsearchai';

const mockFetch = openmrsFetch as Mock;

beforeEach(() => vi.clearAllMocks());

describe('warmupPatient', () => {
  it('POSTs the patient to /warmup with the abort signal', () => {
    mockFetch.mockResolvedValueOnce({});
    const controller = new AbortController();

    warmupPatient('uuid-1', controller.signal);

    expect(mockFetch).toHaveBeenCalledWith(
      '/ws/rest/v1/chartsearchai/warmup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ patient: 'uuid-1' }),
        signal: controller.signal,
      }),
    );
  });

  it('swallows a failed or aborted warmup', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'));

    await expect(warmupPatient('uuid-1')).resolves.toBeUndefined();
  });
});
