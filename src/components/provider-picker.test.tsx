import React from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  chatPatientChartStream,
  fetchChatHistory,
  fetchProviders,
  startNewChat,
  type ClinicalProviderDescriptor,
} from '../api/chartsearchai';
import { useConfig } from '@openmrs/esm-framework';
import { useChartSearchAi } from '../hooks/useChartSearchAi';
import { chatSessionStore } from '../store/chat-session.store';
import ProviderPicker from './provider-picker.component';

vi.mock('../api/chartsearchai', () => ({
  fetchProviders: vi.fn(),
  fetchChatHistory: vi.fn(),
  chatPatientChartStream: vi.fn(),
  startNewChat: vi.fn(),
}));

const mockFetch = fetchProviders as Mock;

// Exercise the real picker, shared state, history hydration and request selection together.
// Only the network boundary is mocked; this is not a backend persistence test.
const ChatWithPicker = () => {
  const { messages, submitQuestion, startNewChatSession } = useChartSearchAi('patient-uuid');
  return (
    <>
      <ProviderPicker onSelect={(providerId) => startNewChatSession('patient-uuid', providerId)} />
      {messages.map((message) => (
        <p key={message.id}>{message.answer}</p>
      ))}
      <button onClick={() => submitQuestion('patient-uuid', 'Next question')}>Ask next</button>
    </>
  );
};

const provider = (overrides: Partial<ClinicalProviderDescriptor>): ClinicalProviderDescriptor => ({
  id: 'bundled',
  label: 'Bundled (local)',
  enabled: true,
  ready: true,
  default: true,
  modes: ['query_scoped'],
  capabilities: [],
  unavailableReason: null,
  ...overrides,
});

const SINGLE = {
  defaultProvider: 'bundled',
  pickerVisible: false,
  providers: [provider({ default: true })],
};

const DUAL = {
  defaultProvider: 'bundled',
  pickerVisible: true,
  providers: [provider({ default: true }), provider({ id: 'hub', label: 'Med-Agent Hub', default: false })],
};

const openMenu = async () => {
  const trigger = await screen.findByRole('button', { name: /Bundled \(local\)/i });
  fireEvent.click(trigger);
  return screen.findByRole('menu');
};

beforeEach(() => {
  vi.clearAllMocks();
  chatSessionStore.setState({
    messagesByPatient: {},
    sessionUuidByPatient: {},
    selectedProfileId: null,
    profileDiscoveryStatus: 'loading',
    selectedProviderId: null,
  });
  mockFetch.mockReturnValue(new Promise(() => {}));
  (useConfig as Mock).mockReturnValue({ useStreaming: true, showReasoning: true });
  (fetchChatHistory as Mock).mockResolvedValue({ session: null, messages: [] });
  (startNewChat as Mock).mockResolvedValue({ session: 'new-session' });
});

describe('ProviderPicker', () => {
  it('renders nothing while providers are loading', () => {
    const { container } = render(<ProviderPicker />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when only one provider is configured', async () => {
    mockFetch.mockResolvedValueOnce(SINGLE);
    const { container } = render(<ProviderPicker />);

    await waitFor(() => expect(chatSessionStore.getState().selectedProviderId).toBe('bundled'));
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the provider menu with the default marked when multiple providers exist', async () => {
    mockFetch.mockResolvedValueOnce(DUAL);
    render(<ProviderPicker />);
    await openMenu();

    expect(screen.getByRole('menuitemradio', { name: /Bundled \(local\).*default/i })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: /Med-Agent Hub/i })).toBeInTheDocument();
  });

  it('lets the conversation owner commit the requested provider', async () => {
    mockFetch.mockResolvedValueOnce(DUAL);
    const onSelect = vi.fn();
    render(<ProviderPicker onSelect={onSelect} />);
    await openMenu();

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Med-Agent Hub/i }));

    expect(onSelect).toHaveBeenCalledWith('hub');
    expect(chatSessionStore.getState().selectedProviderId).toBe('bundled');
    act(() => chatSessionStore.setState({ selectedProviderId: 'hub' }));
    await screen.findByRole('button', { name: /Med-Agent Hub/i });
  });

  it('shows an unavailable provider as disabled, never a silent fallback', async () => {
    mockFetch.mockResolvedValueOnce({
      defaultProvider: 'bundled',
      pickerVisible: true,
      providers: [
        provider({ default: true }),
        provider({
          id: 'hub',
          label: 'Med-Agent Hub',
          default: false,
          ready: false,
          unavailableReason: 'hub_not_configured',
        }),
      ],
    });
    render(<ProviderPicker />);
    await openMenu();

    expect(screen.getByRole('menuitem', { name: /Med-Agent Hub.*unavailable/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.queryByRole('menuitemradio', { name: /Med-Agent Hub/i })).not.toBeInTheDocument();
  });

  it('keeps ready providers selectable when the advertised default is unavailable', async () => {
    mockFetch.mockResolvedValueOnce({
      defaultProvider: 'hub',
      pickerVisible: true,
      providers: [
        provider({ default: false }),
        provider({
          id: 'hub',
          label: 'Med-Agent Hub',
          default: true,
          ready: false,
          unavailableReason: 'hub_not_configured',
        }),
      ],
    });
    render(<ProviderPicker />);
    fireEvent.click(await screen.findByRole('button', { name: /Med-Agent Hub.*unavailable/i }));

    expect(screen.getByRole('menuitemradio', { name: /Bundled \(local\)/i })).not.toBeChecked();
    expect(screen.getByRole('menuitem', { name: /Med-Agent Hub.*unavailable/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(chatSessionStore.getState().selectedProviderId).toBe('hub');
  });

  it.each([
    { id: 'hub', label: 'Med-Agent Hub', enabled: true, ready: false, advertised: true },
    { id: 'hub', label: 'Med-Agent Hub', enabled: false, ready: true, advertised: true },
    { id: 'removed-provider', label: 'removed-provider', enabled: false, ready: false, advertised: false },
  ])(
    'preserves an unavailable explicit selection ($enabled/$ready/$advertised) until the user switches',
    async ({ id, label, enabled, ready, advertised }) => {
      chatSessionStore.setState({ selectedProviderId: id });
      mockFetch.mockResolvedValueOnce({
        defaultProvider: 'bundled',
        pickerVisible: advertised,
        providers: [provider({}), ...(advertised ? [provider({ id, label, enabled, ready, default: false })] : [])],
      });
      const onSelect = vi.fn();
      render(<ProviderPicker onSelect={onSelect} />);

      fireEvent.click(await screen.findByRole('button', { name: `${label} (unavailable)` }));
      expect(chatSessionStore.getState().selectedProviderId).toBe(id);
      expect(onSelect).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Bundled \(local\)/i }));
      expect(onSelect).toHaveBeenCalledExactlyOnceWith('bundled');
      expect(chatSessionStore.getState().selectedProviderId).toBe(id);
      act(() => chatSessionStore.setState({ selectedProviderId: 'bundled' }));
      expect(chatSessionStore.getState().selectedProviderId).toBe('bundled');
    },
  );

  it('does not start a new conversation when re-selecting the current provider', async () => {
    mockFetch.mockResolvedValueOnce(DUAL);
    const onSelect = vi.fn();
    render(<ProviderPicker onSelect={onSelect} />);
    await openMenu();

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Bundled \(local\).*default/i }));

    expect(onSelect).not.toHaveBeenCalled();
  });
  it('ignores an obsolete discovery response after React restarts the effect', async () => {
    let resolveOld: (value: typeof SINGLE) => void;
    mockFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    mockFetch.mockResolvedValueOnce(DUAL);
    render(
      <React.StrictMode>
        <ProviderPicker />
      </React.StrictMode>,
    );
    await screen.findByRole('button', { name: /Bundled/ });
    await act(async () => resolveOld(SINGLE));
    expect(screen.getByRole('button', { name: /Bundled/ })).toBeInTheDocument();
  });
});

describe('restored conversation provider with the real hook', () => {
  it.each([true, false])('commits a requested provider only after the new session succeeds (%s)', async (succeed) => {
    chatSessionStore.setState({ selectedProfileId: 'single-e4b-checked', profileDiscoveryStatus: 'ready' });
    mockFetch.mockResolvedValueOnce(DUAL);
    (fetchChatHistory as Mock).mockResolvedValueOnce({
      session: 'restored-hub-session',
      provider: 'hub',
      messages: [
        { messageId: 'u-1', role: 'user', content: 'Earlier question', createdAt: 1 },
        { messageId: 'a-1', role: 'assistant', content: 'Existing answer', createdAt: 2 },
      ],
    });
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    (startNewChat as Mock).mockReturnValueOnce(
      new Promise((done, fail) => {
        resolve = done;
        reject = fail;
      }),
    );
    render(<ChatWithPicker />);
    await screen.findByText('Existing answer');
    fireEvent.click(await screen.findByRole('button', { name: /Med-Agent Hub/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Bundled \(local\)/i }));
    expect(startNewChat).toHaveBeenCalledExactlyOnceWith('patient-uuid', 'bundled');
    expect(chatSessionStore.getState().selectedProviderId).toBe('hub');
    expect(chatSessionStore.getState().sessionUuidByPatient['patient-uuid']).toBe('restored-hub-session');
    expect(screen.getByText('Existing answer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ask next' }));
    expect(chatPatientChartStream).not.toHaveBeenCalled();
    await act(async () => {
      if (succeed) resolve({ session: 'new-session', provider: 'bundled', messages: [] });
      else reject(new Error('server unavailable'));
    });
    expect(chatSessionStore.getState().selectedProviderId).toBe(succeed ? 'bundled' : 'hub');
    if (succeed) expect(screen.queryByText('Existing answer')).not.toBeInTheDocument();
    else expect(screen.getByText('Existing answer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ask next' }));
    const request = (chatPatientChartStream as Mock).mock.calls[0];
    expect(request[1]).toBe(succeed ? 'new-session' : 'restored-hub-session');
    expect(request[6]).toBe(succeed ? 'bundled' : 'hub');
  });

  it('keeps a restored conversation bound to its unavailable provider on the next request', async () => {
    chatSessionStore.setState({ selectedProfileId: 'single-e4b-checked', profileDiscoveryStatus: 'ready' });
    mockFetch.mockResolvedValueOnce({
      ...DUAL,
      providers: [provider({}), provider({ id: 'hub', label: 'Med-Agent Hub', ready: false, default: false })],
    });
    (fetchChatHistory as Mock).mockResolvedValueOnce({
      session: 'restored-hub-session',
      provider: 'hub',
      messages: [
        { messageId: 'u-1', role: 'user', content: 'Earlier question', createdAt: 1 },
        { messageId: 'a-1', role: 'assistant', content: 'Existing answer', createdAt: 2 },
      ],
    });
    render(<ChatWithPicker />);

    await screen.findByText('Existing answer');
    await screen.findByRole('button', { name: /Med-Agent Hub.*unavailable/i });
    fireEvent.click(screen.getByRole('button', { name: 'Ask next' }));
    expect(chatPatientChartStream).toHaveBeenCalledOnce();
    const request = (chatPatientChartStream as Mock).mock.calls[0];
    expect(request[1]).toBe('restored-hub-session');
    expect(request[6]).toBe('hub');
    expect(startNewChat).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Med-Agent Hub.*unavailable/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Bundled \(local\)/i }));
    await waitFor(() => expect(startNewChat).toHaveBeenCalledExactlyOnceWith('patient-uuid', 'bundled'));
    await waitFor(() => expect(chatSessionStore.getState().sessionUuidByPatient['patient-uuid']).toBe('new-session'));
    fireEvent.click(screen.getByRole('button', { name: 'Ask next' }));
    const nextRequest = (chatPatientChartStream as Mock).mock.calls[1];
    expect(nextRequest[1]).toBe('new-session');
    expect(nextRequest[6]).toBe('bundled');
  });
});
