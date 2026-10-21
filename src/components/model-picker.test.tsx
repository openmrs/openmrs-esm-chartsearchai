/* eslint-disable testing-library/no-container */
import React from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useConfig } from '@openmrs/esm-framework';
import { fetchProfiles, type HubProfileMetadata } from '../api/chartsearchai';
import { chatSessionStore } from '../store/chat-session.store';
import { PROFILE_DISCOVERY_RETRY_MS, stopHubProfileDiscovery } from '../hooks/hub-profile-discovery';
import ModelPicker from './model-picker.component';

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
  default: false,
  selection_priority: 10,
  topology: 'single',
  visibility: 'product',
  stages: ['context', 'answer', 'gate', 'review', 'indepth'],
  required_models: ['gemma-e4b'],
  context_window: 24576,
  exact_tokenizer: true,
  unavailable_reasons: [],
  ...overrides,
});

const PROFILE_DATA = {
  object: 'list',
  data: [
    profile({ default: true }),
    profile({ id: 'single-12b-checked', label: 'Checked answer (12B)', required_models: ['gemma-4-12b'] }),
    profile({ id: 'team-med-checked', label: 'Checked medical team', topology: 'team' }),
    profile({
      id: 'team-high-unavailable',
      label: 'High checked team',
      topology: 'team',
      available: false,
      unavailable_reasons: ['model_not_loaded:gemma-31b'],
    }),
    profile({ id: 'answer:gemma-e4b', label: 'Raw answer leg', visibility: 'internal' }),
  ],
};

const openMenu = async () => {
  const trigger = await screen.findByRole('button', { name: /^AI profile: Fast checked answer \(E4B\)$/i });
  fireEvent.click(trigger);
  return screen.findByRole('menu');
};

beforeEach(() => {
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
  mockFetch.mockReturnValue(new Promise(() => {}));
});

describe('ModelPicker', () => {
  it('renders nothing while metadata is loading', () => {
    const { container } = render(<ModelPicker />);
    expect(container).toBeEmptyDOMElement();
  });

  it('still discovers and selects the hub default when the picker is hidden', async () => {
    mockUseConfig.mockReturnValue({ showModelPicker: false });
    mockFetch.mockResolvedValueOnce(PROFILE_DATA);
    const { container } = render(<ModelPicker />);

    await waitFor(() => expect(chatSessionStore.getState().selectedProfileId).toBe('single-e4b-checked'));
    expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('ready');
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an unavailable state and preserves selection when profile discovery fails', async () => {
    chatSessionStore.setState({ selectedProfileId: 'team-med-checked', profileExplicitlySelected: true });
    mockFetch.mockRejectedValueOnce(new Error('unavailable'));
    render(<ModelPicker />);

    expect(await screen.findByRole('status')).toHaveTextContent(/AI profiles unavailable/i);
    expect(chatSessionStore.getState().selectedProfileId).toBe('team-med-checked');
    expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('unavailable');
  });

  it('uses the available hub-advertised default and authoritative labels', async () => {
    mockFetch.mockResolvedValueOnce(PROFILE_DATA);
    render(<ModelPicker />);

    await waitFor(() => expect(chatSessionStore.getState().selectedProfileId).toBe('single-e4b-checked'));
    expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('ready');
    await openMenu();
    expect(screen.getByRole('group', { name: 'Single profiles' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Team profiles' })).toBeInTheDocument();
    // The visible section headings are not announced as disabled menu choices.
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    expect(screen.getByText('Single profiles')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('menuitemradio', { name: /Fast checked answer \(E4B\).*default/i })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: /Checked answer \(12B\)/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /Checked medical team/i })).toBeInTheDocument();
    expect(screen.queryByText(/Raw answer leg/i)).not.toBeInTheDocument();
  });

  it('stores only the selected product profile id', async () => {
    mockFetch.mockResolvedValueOnce(PROFILE_DATA);
    render(<ModelPicker />);
    await openMenu();

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Checked medical team/i }));
    await waitFor(() => expect(chatSessionStore.getState().selectedProfileId).toBe('team-med-checked'));
    expect(chatSessionStore.getState().profileExplicitlySelected).toBe(true);
  });

  it('never discovers profiles or changes provider for bundled inference', async () => {
    chatSessionStore.setState({ selectedProviderId: 'bundled' });
    const { container } = render(<ModelPicker />);

    await Promise.resolve();

    expect(container).toBeEmptyDOMElement();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(chatSessionStore.getState().selectedProviderId).toBe('bundled');
  });

  it('leaves the explicit hub provider selected when its profile changes', async () => {
    mockFetch.mockResolvedValueOnce(PROFILE_DATA);
    render(<ModelPicker />);
    await openMenu();

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Checked medical team/i }));

    await waitFor(() => expect(chatSessionStore.getState().selectedProfileId).toBe('team-med-checked'));
    expect(chatSessionStore.getState().selectedProviderId).toBe('hub');
  });

  it('lists only the profiles the Hub currently advertises as available', async () => {
    mockFetch.mockResolvedValueOnce(PROFILE_DATA);
    render(<ModelPicker />);
    const menu = await openMenu();

    expect(screen.getAllByRole('menuitemradio')).toHaveLength(3);
    expect(menu).not.toHaveTextContent(/High checked team/i);
    expect(menu).not.toHaveTextContent(/unavailable/i);
  });

  it('replaces a non-explicit unavailable selection with the advertised default', async () => {
    chatSessionStore.setState({ selectedProfileId: 'team-high-unavailable', profileExplicitlySelected: false });
    mockFetch.mockResolvedValueOnce(PROFILE_DATA);
    render(<ModelPicker />);

    await waitFor(() => expect(chatSessionStore.getState().selectedProfileId).toBe('single-e4b-checked'));
    expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('ready');
  });

  it('keeps an explicit menu pick when a later discovery reports it unavailable and restores ready on recovery', async () => {
    mockFetch.mockResolvedValueOnce(PROFILE_DATA);
    const { unmount } = render(<ModelPicker />);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Checked medical team/i }));
    await waitFor(() => expect(chatSessionStore.getState().selectedProfileId).toBe('team-med-checked'));
    unmount();

    mockFetch.mockResolvedValueOnce({
      object: 'list',
      data: [
        profile({ default: true }),
        profile({ id: 'team-med-checked', label: 'Checked medical team', topology: 'team', available: false }),
      ],
    });
    const { unmount: unmountUnavailable } = render(<ModelPicker />);
    expect(
      await screen.findByRole('button', { name: /^AI profile: Checked medical team \(unavailable\)$/i }),
    ).toBeInTheDocument();
    expect(chatSessionStore.getState().selectedProfileId).toBe('team-med-checked');
    expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('selection-unavailable');
    unmountUnavailable();

    mockFetch.mockResolvedValueOnce(PROFILE_DATA);
    render(<ModelPicker />);
    expect(await screen.findByRole('button', { name: /^AI profile: Checked medical team$/i })).toBeInTheDocument();
    expect(chatSessionStore.getState().selectedProfileId).toBe('team-med-checked');
    expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('ready');
  });

  it('requires manual selection when the hub advertises no available default', async () => {
    mockFetch.mockResolvedValueOnce({
      object: 'list',
      data: [
        profile({ available: false, default: true }),
        profile({ id: 'single-12b-checked', label: 'Checked answer (12B)', default: false }),
      ],
    });
    render(<ModelPicker />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(chatSessionStore.getState().selectedProfileId).toBeNull();
    expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('unavailable');
    fireEvent.click(await screen.findByRole('button', { name: /^AI profile: Choose AI profile$/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Checked answer \(12B\)/i }));
    await waitFor(() => expect(chatSessionStore.getState().selectedProfileId).toBe('single-12b-checked'));
    expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('ready');
    expect(chatSessionStore.getState().selectedProviderId).toBe('hub');
  });

  it('portals the Carbon menu outside the picker subtree', async () => {
    mockFetch.mockResolvedValueOnce(PROFILE_DATA);
    const { container } = render(<ModelPicker />);
    const menu = await openMenu();
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });
  it('ignores a failed obsolete discovery after switching away from and back to Hub', async () => {
    let rejectOld: (error: Error) => void;
    mockFetch.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      }),
    );
    mockFetch.mockResolvedValueOnce(PROFILE_DATA);
    render(<ModelPicker />);
    act(() => chatSessionStore.setState({ selectedProviderId: 'bundled' }));
    act(() => chatSessionStore.setState({ selectedProviderId: 'hub' }));
    await waitFor(() => expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('ready'));
    await act(async () => rejectOld(new Error('obsolete request failed')));
    expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('ready');
    expect(chatSessionStore.getState().selectedProfileId).toBe('single-e4b-checked');
    expect(screen.getByRole('button', { name: /Fast checked answer/ })).toBeInTheDocument();
  });
  it('replaces an explicit pick that became unavailable with the default when the picker is hidden', async () => {
    mockUseConfig.mockReturnValue({ showModelPicker: false });
    chatSessionStore.setState({ selectedProfileId: 'team-high-unavailable', profileExplicitlySelected: true });
    mockFetch.mockResolvedValueOnce(PROFILE_DATA);
    render(<ModelPicker />);

    await waitFor(() => expect(chatSessionStore.getState().selectedProfileId).toBe('single-e4b-checked'));
    expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('ready');
  });
  it('retries discovery after a failed fetch and recovers while the panel stays open', async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockRejectedValueOnce(new Error('hub down'));
      mockFetch.mockResolvedValueOnce(PROFILE_DATA);
      render(<ModelPicker />);
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('unavailable');
      expect(screen.getByRole('status')).toHaveTextContent(/AI profiles unavailable/i);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(PROFILE_DISCOVERY_RETRY_MS);
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('ready');
      expect(chatSessionStore.getState().selectedProfileId).toBe('single-e4b-checked');
    } finally {
      vi.useRealTimers();
    }
  });
  it('stops retrying once the picker is gone', async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockRejectedValueOnce(new Error('hub down'));
      const { unmount } = render(<ModelPicker />);
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(chatSessionStore.getState().profileDiscoveryStatus).toBe('unavailable');
      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PROFILE_DISCOVERY_RETRY_MS * 3);
      });
      expect(mockFetch).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps the unavailable state when no product profile can be selected', async () => {
    mockFetch.mockResolvedValueOnce({ object: 'list', data: [profile({ available: false, default: true })] });
    render(<ModelPicker />);
    expect(await screen.findByRole('status')).toHaveTextContent(/AI profiles unavailable/i);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(chatSessionStore.getState().selectedProfileId).toBeNull();
  });
});
