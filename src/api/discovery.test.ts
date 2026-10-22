import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { openmrsFetch } from '@openmrs/esm-framework';
import { fetchProfiles, fetchProviders, type HubProfileListResponse, type ProviderListResponse } from './chartsearchai';

const mockFetch = openmrsFetch as Mock;

beforeEach(() => vi.clearAllMocks());

describe('discovery requests', () => {
  it('reads the Hub profiles from /models with the caller signal and returns the body', async () => {
    const body = { object: 'list', data: [] } as HubProfileListResponse;
    mockFetch.mockResolvedValueOnce({ data: body });
    const controller = new AbortController();

    expect(await fetchProfiles(controller)).toBe(body);
    expect(mockFetch).toHaveBeenCalledExactlyOnceWith('/ws/rest/v1/chartsearchai/models', {
      signal: controller.signal,
    });
  });

  it('reads the providers from /providers with the caller signal and returns the body', async () => {
    const body = { defaultProvider: 'bundled', pickerVisible: false, providers: [] } as ProviderListResponse;
    mockFetch.mockResolvedValueOnce({ data: body });
    const controller = new AbortController();

    expect(await fetchProviders(controller)).toBe(body);
    expect(mockFetch).toHaveBeenCalledExactlyOnceWith('/ws/rest/v1/chartsearchai/providers', {
      signal: controller.signal,
    });
  });

  it.each([
    ['profiles', fetchProfiles],
    ['providers', fetchProviders],
  ])('passes a failed %s read to the caller', async (_kind, read) => {
    const failure = new Error('Gateway down');
    mockFetch.mockRejectedValueOnce(failure);

    await expect(read()).rejects.toBe(failure);
  });
});
