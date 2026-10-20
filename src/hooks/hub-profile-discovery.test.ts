import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useConfig } from '@openmrs/esm-framework';
import { fetchProfiles, type HubProfileMetadata } from '../api/chartsearchai';
import { chatSessionStore } from '../store/chat-session.store';
import {
  refreshHubProfiles,
  selectHubProfile,
  stopHubProfileDiscovery,
  useHubProfileDiscovery,
} from './hub-profile-discovery';

vi.mock('../api/chartsearchai', () => ({ fetchProfiles: vi.fn() }));

const mockFetch = fetchProfiles as Mock;
const mockUseConfig = useConfig as unknown as Mock;

const profile = (overrides: Partial<HubProfileMetadata>): HubProfileMetadata => ({
  id: 'single-e4b-checked',
  label: 'Fast checked answer (E4B)',
  staged: true,
  validation: true,
  temporal_enforcement: 'enforce',
  available: true,
  default: true,
  selection_priority: 10,
  topology: 'single',
  visibility: 'product',
  stages: ['answer'],
  required_models: ['gemma-e4b'],
  context_window: 24576,
  exact_tokenizer: true,
  unavailable_reasons: [],
  ...overrides,
});

const list = (...data: HubProfileMetadata[]) => ({ object: 'list', data });

beforeEach(() => {
  // Discovery is module state shared by every user of it; a test that leaves a request open
  // must not hand it to the next one.
  stopHubProfileDiscovery();
  vi.clearAllMocks();
  mockUseConfig.mockReturnValue({ showModelPicker: true });
  chatSessionStore.setState({
    messagesByPatient: {},
    sessionUuidByPatient: {},
    selectedProfileId: null,
    profileExplicitlySelected: false,
    profileDiscoveryStatus: 'loading',
    hubProfiles: null,
    selectedProviderId: 'hub',
  });
});

describe('Hub profile discovery', () => {
  it('authorizes the Hub default without any picker mounted', async () => {
    mockFetch.mockResolvedValueOnce(list(profile({})));
    renderHook(() => useHubProfileDiscovery());

    await waitFor(() => expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('ready'));
    expect(chatSessionStore.getState().selectedProfileId).toBe('single-e4b-checked');
  });

  it('marks an explicit pick the Hub no longer offers as a selection to replace, not a Hub outage', async () => {
    mockFetch.mockResolvedValueOnce(list(profile({}), profile({ id: 'team', label: 'Team', default: false })));
    await refreshHubProfiles(true);
    selectHubProfile('team');

    mockFetch.mockResolvedValueOnce(list(profile({}), profile({ id: 'team', label: 'Team', available: false })));
    await refreshHubProfiles(true);

    expect(chatSessionStore.getState().selectedProfileId).toBe('team');
    expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('selection-unavailable');
  });

  it('keeps the current profiles and status while a refresh is in flight', async () => {
    mockFetch.mockResolvedValueOnce(list(profile({})));
    await refreshHubProfiles(true);
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    refreshHubProfiles(true);

    expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('ready');
    expect(chatSessionStore.getState().hubProfiles).toHaveLength(1);
  });

  it('keeps reporting the Hub as unreachable while a retry is in flight', async () => {
    mockFetch.mockRejectedValueOnce(new Error('hub down'));
    await refreshHubProfiles(true);
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    refreshHubProfiles(true);

    expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('unavailable');
  });

  it('shares one request between concurrent refreshes', async () => {
    mockFetch.mockResolvedValueOnce(list(profile({})));
    await Promise.all([refreshHubProfiles(true), refreshHubProfiles(true)]);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('reports a failed fetch as a Hub outage and drops the stale profile list', async () => {
    mockFetch.mockResolvedValueOnce(list(profile({})));
    await refreshHubProfiles(true);
    mockFetch.mockRejectedValueOnce(new Error('hub down'));

    await refreshHubProfiles(true);

    expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('unavailable');
    expect(chatSessionStore.getState().hubProfiles).toBeNull();
  });

  it('does not discover profiles for bundled inference', async () => {
    chatSessionStore.setState({ selectedProviderId: 'bundled' });
    renderHook(() => useHubProfileDiscovery());
    await act(() => Promise.resolve());
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
