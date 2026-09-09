import React from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  chatPatientChartStream,
  fetchChatHistory,
  fetchProviders,
  startNewChat,
  type ClinicalProviderDescriptor,
} from '../api/chartsearchai';
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
      <ProviderPicker onSwitched={() => startNewChatSession('patient-uuid')} />
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

  it('stores the selected provider and starts a new conversation on switch', async () => {
    mockFetch.mockResolvedValueOnce(DUAL);
    const onSwitched = vi.fn();
    render(<ProviderPicker onSwitched={onSwitched} />);
    await openMenu();

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Med-Agent Hub/i }));

    await waitFor(() => expect(chatSessionStore.getState().selectedProviderId).toBe('hub'));
    expect(onSwitched).toHaveBeenCalledWith('hub');
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
      const onSwitched = vi.fn();
      render(<ProviderPicker onSwitched={onSwitched} />);

      fireEvent.click(await screen.findByRole('button', { name: `${label} (unavailable)` }));
      expect(chatSessionStore.getState().selectedProviderId).toBe(id);
      expect(onSwitched).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Bundled \(local\)/i }));
      expect(chatSessionStore.getState().selectedProviderId).toBe('bundled');
      expect(onSwitched).toHaveBeenCalledExactlyOnceWith('bundled');
    },
  );

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

  it('does not start a new conversation when re-selecting the current provider', async () => {
    mockFetch.mockResolvedValueOnce(DUAL);
    const onSwitched = vi.fn();
    render(<ProviderPicker onSwitched={onSwitched} />);
    await openMenu();

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Bundled \(local\).*default/i }));

    expect(onSwitched).not.toHaveBeenCalled();
  });
});
