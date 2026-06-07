import React from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ModelPicker from './model-picker.component';
import { fetchEndpoints } from '../api/chartsearchai';
import { chatSessionStore } from '../store/chat-session.store';
import { useConfig } from '@openmrs/esm-framework';

// NB: do NOT vi.mock('@openmrs/esm-framework') here — the picker now reads the
// shared chatSessionStore via useStore, and the store module itself depends on
// createGlobalStore/getSessionStore. The vitest config already aliases the whole
// framework to its mock (real useStore/createGlobalStore, jest.fn useConfig), so
// we only stub the api layer and drive useConfig through its mock return value.
vi.mock('../api/chartsearchai', () => ({
  fetchEndpoints: vi.fn(),
}));

const mockFetch = fetchEndpoints as Mock;
const mockUseConfig = useConfig as unknown as Mock;

const LM = 'http://lm/v1/chat/completions';
const LLAMA = 'http://llama/v1/chat/completions';
const HUB = 'http://hub/v1/chat/completions';

// A realistic /endpoints payload: LM Studio + llama-server carry team-internal component
// models (qwen/medgemma/gemma-31b), quant/non-validated variants, and the GGUF single models;
// Med Agent Hub carries all 9 tiers. The curated picker must surface ONLY the validation arms
// (4 AI-team + 3 single), located by id across endpoints, and hide everything else.
const CURATED_DATA = {
  endpoints: [
    {
      label: 'LM Studio',
      url: LM,
      provider: 'lm-studio',
      reachable: true,
      current: false,
      models: [
        { id: 'qwen2.5-32b-instruct', displayName: 'Qwen 32B', loaded: true },
        { id: 'medgemma-27b-text-it-mlx', displayName: 'MedGemma 27B', loaded: true },
      ],
    },
    {
      label: 'llama-server',
      url: LLAMA,
      provider: 'generic-openai-compat',
      reachable: true,
      current: false,
      models: [
        { id: 'gemma-e4b', displayName: 'gemma-e4b', loaded: true },
        { id: 'gemma-4-12b', displayName: 'gemma-4-12b', loaded: true },
        { id: 'gemma-26b', displayName: 'gemma-26b', loaded: true },
        { id: 'gemma-31b', displayName: 'gemma-31b', loaded: true },
        { id: 'qwen3.6-35b', displayName: 'qwen3.6-35b', loaded: true },
      ],
    },
    {
      label: 'Med Agent Hub',
      url: HUB,
      provider: 'generic-openai-compat',
      reachable: true,
      current: false,
      models: [{ id: 'med-agent-team', displayName: 'med-agent-team', loaded: false }],
    },
  ],
  current: { endpointUrl: LM, modelName: 'gemma-4-e2b-it' },
};
// The picker is a Carbon MenuButton: the trigger button is labelled with the
// current model, and opening it portals a `role="menu"` to document.body whose
// model options carry `role="menuitemradio"`.
const openMenu = async (currentModel: string) => {
  const trigger = await screen.findByRole('button', { name: new RegExp(currentModel.replace('/', '\\/'), 'i') });
const LM = 'http://lm/v1/chat/completions';
const HUB = 'http://hub/v1/chat/completions';

// LM Studio (current) with two models + Med Agent Hub with the single team choice.
const TWO_SECTIONS = {
  endpoints: [
    {
      label: 'LM Studio',
      url: LM,
      provider: 'lm-studio',
      reachable: true,
      current: true,
      models: [
        { id: 'gemma-4-e2b-it', displayName: 'Gemma 4 e2b', loaded: true },
        { id: 'medgemma-1.5-4b-it', displayName: 'MedGemma', loaded: false },
      ],
    },
    {
      label: 'Med Agent Hub',
      url: HUB,
      provider: 'generic-openai-compat',
      reachable: true,
      current: false,
      models: [{ id: 'med-agent-team', displayName: 'Med Agent Team', loaded: false }],
      models: [
        { id: 'med-agent-team-high-validated', displayName: 'high-validated', loaded: false },
        { id: 'med-agent-team-med-validated', displayName: 'med-validated', loaded: false },
        { id: 'med-agent-team-low-validated-12b', displayName: 'low-validated-12b', loaded: false },
        { id: 'med-agent-team-parity', displayName: 'parity', loaded: false },
        { id: 'med-agent-team-low', displayName: 'low', loaded: false },
        { id: 'med-agent-team-high', displayName: 'high', loaded: false },
      ],
    },
  ],
  // The config-controlled global default — gets the faded "(default)" tag.
  current: { endpointUrl: HUB, modelName: 'med-agent-team-med-validated' },
};

// The picker is a Carbon MenuButton: the trigger is labelled "<endpoint> · <model>",
// and opening it portals a role="menu" to document.body whose models carry
// role="menuitemradio", grouped under a role="group" per endpoint.
const openMenu = async (triggerNeedle: RegExp) => {
  const trigger = await screen.findByRole('button', { name: triggerNeedle });
  fireEvent.click(trigger);
  return screen.findByRole('menu');
};
beforeEach(() => {
  vi.clearAllMocks();
  mockUseConfig.mockReturnValue({ showModelPicker: true });
  // Real store; reset to a clean slate (no per-session selection) each test.
  chatSessionStore.setState({ messagesByPatient: {}, sessionUuidByPatient: {}, selectedBackend: null });
  mockFetch.mockReturnValue(new Promise(() => {})); // hang by default
});

async function openMenu() {
  await waitFor(() => screen.getByRole('button', { name: /select model/i }));
  fireEvent.click(screen.getByRole('button', { name: /select model/i }));
}

describe('ModelPicker visibility gates', () => {
  it('renders nothing during the initial load (no layout shift)', () => {
    const { container } = render(<ModelPicker />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hides when config.showModelPicker is false', () => {
    mockUseConfig.mockReturnValueOnce({ showModelPicker: false });
    const { container } = render(<ModelPicker />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hides when there are fewer than 2 selectable models across endpoints', async () => {
    mockFetch.mockResolvedValueOnce({
      endpoints: [
        {
          label: 'LM Studio',
          url: LM,
          provider: 'lm-studio',
          reachable: true,
          current: true,
          models: [{ id: 'only', displayName: 'Only', loaded: true }],
  it('hides when engine is local', async () => {
    mockFetch.mockResolvedValueOnce({ engine: 'local', current: null, available: [] });
  it('hides when there are fewer than 2 selectable models across endpoints', async () => {
    mockFetch.mockResolvedValueOnce({
      endpoints: [
        {
          label: 'LM Studio',
          url: LM,
          provider: 'lm-studio',
          reachable: true,
          current: true,
          models: [{ id: 'only', displayName: 'Only', loaded: true }],
        },
      ],
      current: { endpointUrl: LM, modelName: 'only' },
    });
    const { container } = render(<ModelPicker />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('hides when /endpoints fetch fails (treats 503 / network errors as not-applicable)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Service unavailable'));
    const { container } = render(<ModelPicker />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ModelPicker curated sections', () => {
  it('renders the two curated group headers (AI Team / Single models), not raw endpoints', async () => {
    mockFetch.mockResolvedValue(CURATED_DATA);
    render(<ModelPicker />);
    await openMenu(/Med \(validated\)/i);
    expect(screen.getByRole('menuitem', { name: /AI Team/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Single models/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /AI Team/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Single models/i })).toBeInTheDocument();
    // Raw endpoint labels are no longer used as group headers.
    expect(screen.queryByRole('menuitem', { name: /^LM Studio$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /llama-server/i })).not.toBeInTheDocument();
  });

  it('lists exactly the 7 validation arms with human labels', async () => {
    mockFetch.mockResolvedValue(CURATED_DATA);
    render(<ModelPicker />);
    await openMenu(/Med \(validated\)/i);
    for (const name of [
      /High \(validated\)/i,
      /Med \(validated\)/i,
      /Low \(validated\)/i,
      /Parity/i,
      /Gemma 4B/i,
      /Gemma 12B/i,
      /Gemma 26B/i,
    ]) {
      expect(screen.getByRole('menuitemradio', { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(7);
  });

  it('hides team-internal components, non-validated tiers, and the LM Studio line', async () => {
    mockFetch.mockResolvedValue(CURATED_DATA);
    render(<ModelPicker />);
    await openMenu(/Med \(validated\)/i);
    expect(screen.queryByRole('menuitemradio', { name: /qwen/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: /medgemma/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: /31b/i })).not.toBeInTheDocument();
  });

  it('checks + tags the config default tier ("Med (validated)"), and only that one', async () => {
    mockFetch.mockResolvedValue(CURATED_DATA);
    render(<ModelPicker />);
    await openMenu(/Med \(validated\)/i);
    const checked = screen.getByRole('menuitemradio', { checked: true });
    expect(checked).toHaveTextContent(/Med \(validated\)/i);
    expect(checked).toHaveTextContent(/default/i);
    expect(screen.getByRole('menuitemradio', { name: /High \(validated\)/i })).not.toHaveTextContent(/default/i);
  });

  it('selecting an AI-team tier writes the hub url + tier id as the per-session override', async () => {
    mockFetch.mockResolvedValue(CURATED_DATA);
    const onSwitched = vi.fn();
    render(<ModelPicker onSwitched={onSwitched} />);
    await openMenu(/Med \(validated\)/i);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /High \(validated\)/i }));
    await waitFor(() =>
      expect(chatSessionStore.getState().selectedBackend).toEqual({
        endpointUrl: HUB,
        modelName: 'med-agent-team-high-validated',
      }),
    );
    expect(onSwitched).toHaveBeenCalledWith('med-agent-team-high-validated');
  });

  it('selecting a single model resolves its serving endpoint (llama-server) by id', async () => {
    mockFetch.mockResolvedValue(CURATED_DATA);
    render(<ModelPicker />);
    await openMenu(/Med \(validated\)/i);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Gemma 12B/i }));
    await waitFor(() =>
      expect(chatSessionStore.getState().selectedBackend).toEqual({ endpointUrl: LLAMA, modelName: 'gemma-4-12b' }),
    );
  });

  it('portals the menu outside the picker subtree so the chat panel cannot clip it', async () => {
    mockFetch.mockResolvedValue(CURATED_DATA);
    const { container } = render(<ModelPicker />);
    await openMenu(/Med \(validated\)/i);
    const menu = screen.getByRole('menu');
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });

  it('selecting a model writes the per-session selectedBackend (no global default mutation)', async () => {
    mockFetch.mockResolvedValue(TWO_SECTIONS);
    const onSwitched = vi.fn();
    render(<ModelPicker onSwitched={onSwitched} />);
    await openMenu(/Gemma 4 e2b/i);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Med Agent Team/i }));

    // The selection is held client-side as a per-request override...
    await waitFor(() =>
      expect(chatSessionStore.getState().selectedBackend).toEqual({ endpointUrl: HUB, modelName: 'med-agent-team' }),
    );
    expect(onSwitched).toHaveBeenCalledWith('med-agent-team');
    // ...and the trigger reflects the new effective backend.
    expect(await screen.findByRole('button', { name: /Med Agent Team/i })).toBeInTheDocument();
  });

  it('selecting the config default model records it as the per-session selection', async () => {
    mockFetch.mockResolvedValue(TWO_SECTIONS);
    render(<ModelPicker />);
    await openMenu(/Gemma 4 e2b/i);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Gemma 4 e2b/i }));
    expect(mockSet).not.toHaveBeenCalled();
  });

// --- LM Studio sub-category + load-state + pre-load -------------------
// These tests pin the picker's behavior when the backend returned the
// LM Studio v1 enriched shape (provider='lm-studio' + per-entry state).

describe('ModelPicker with LM Studio provider grouping', () => {
  const lmStudioSnapshot = {
    engine: 'remote' as const,
    current: 'google/gemma-3-12b',
    available: ['google/gemma-3-12b', 'meta-llama-3.1-8b-instruct', 'mistral-7b-instruct'],
    endpointUrl: 'http://host.docker.internal:1234/v1/chat/completions',
    provider: 'lm-studio' as const,
    entries: [
      {
        id: 'google/gemma-3-12b',
        displayName: 'Gemma 3 12B',
        type: 'llm' as const,
        loaded: true,
        maxContextLength: 131072,
      },
      { id: 'meta-llama-3.1-8b-instruct', displayName: 'Llama 3.1 8B Instruct', type: 'llm' as const, loaded: false },
      { id: 'mistral-7b-instruct', displayName: 'Mistral 7B Instruct', type: 'llm' as const, loaded: false },
    ],
  };

  it('labels the radio group "LM Studio" (Carbon accessible group name)', async () => {
    mockFetch.mockResolvedValue(lmStudioSnapshot);
    render(<ModelPicker />);
    await openMenu('google/gemma-3-12b');
    // Carbon MenuItemRadioGroup exposes its label as the accessible name of the
    // `role="group"` element (aria-label), grouping the options for AT.
    expect(screen.getByRole('group', { name: /LM Studio/i })).toBeInTheDocument();
  });

  it('shows a "(not loaded)" affix on entries whose loaded flag is false', async () => {
    mockFetch.mockResolvedValue(lmStudioSnapshot);
    render(<ModelPicker />);
    await openMenu('google/gemma-3-12b');
    // Loaded entry: no affix
    const gemma = screen.getByRole('menuitemradio', { name: /Gemma 3 12B/i });
    expect(gemma).not.toHaveTextContent(/not loaded/i);
    // Not-loaded entries: affix present
    const llama = screen.getByRole('menuitemradio', { name: /Llama 3.1 8B Instruct/i });
    expect(llama).toHaveTextContent(/not loaded/i);
    const mistral = screen.getByRole('menuitemradio', { name: /Mistral 7B Instruct/i });
    expect(mistral).toHaveTextContent(/not loaded/i);
  });

  it('uses displayName instead of raw id when an entry provides one', async () => {
    mockFetch.mockResolvedValue(lmStudioSnapshot);
    render(<ModelPicker />);
    await openMenu('google/gemma-3-12b');
    expect(screen.getByRole('menuitemradio', { name: /Gemma 3 12B/i })).toBeInTheDocument();
  });

  it('pre-loads via loadModel before calling setCurrentModel when target is not loaded', async () => {
    mockFetch.mockResolvedValue(lmStudioSnapshot);
    mockLoad.mockResolvedValueOnce({ loaded: 'meta-llama-3.1-8b-instruct' });
    mockSet.mockResolvedValueOnce({ current: 'meta-llama-3.1-8b-instruct' });

    render(<ModelPicker />);
    await openMenu('google/gemma-3-12b');
    // The aria-label includes "(not loaded)" for affix-tagged entries, so the
    // partial-match regex still finds the option.
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Llama 3.1 8B Instruct/i }));

    await waitFor(() => expect(mockLoad).toHaveBeenCalledWith('meta-llama-3.1-8b-instruct'));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith('meta-llama-3.1-8b-instruct'));
    // Ordering: load happened before set
    expect(mockLoad.mock.invocationCallOrder[0]).toBeLessThan(mockSet.mock.invocationCallOrder[0]);
  });

  it('surfaces an actionable memory message and rolls back when pre-load fails on resources', async () => {
    mockFetch.mockResolvedValue(lmStudioSnapshot);
    // LM Studio refuses to load (RAM full, won't evict explicitly-loaded models).
    // The backend bubbles the real reason on responseBody.error (HTTP 503) — the
    // picker must show THAT, not the generic openmrsFetch "Service unavailable".
    mockLoad.mockRejectedValueOnce(
      Object.assign(new Error('Service unavailable'), {
        responseBody: {
          error: "Failed to pre-load model 'meta-llama-3.1-8b-instruct': HTTP 500: insufficient system resources",
        },
      ],
      current: { endpointUrl: LM, modelName: 'only' },
    });
    const { container } = render(<ModelPicker />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe('ModelPicker sections', () => {
  it('renders a section header per endpoint with its own models beneath', async () => {
    mockFetch.mockResolvedValue(TWO_SECTIONS);
    render(<ModelPicker />);
    await openMenu();
    expect(screen.getByText('LM Studio')).toBeInTheDocument();
    expect(screen.getByText('Med Agent Hub')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gemma 4 e2b/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^med-agent-team$/i })).toBeInTheDocument();
  });

  it('marks the current endpoint+model as the selected option', async () => {
    mockFetch.mockResolvedValue(TWO_SECTIONS);
    render(<ModelPicker />);
    await openMenu();
    const selected = screen.getByRole('option', { selected: true });
    expect(selected).toHaveTextContent('Gemma 4 e2b');
  });

  it('shows "(not loaded)" only for an LM Studio model, not the generic team', async () => {
    mockFetch.mockResolvedValue(TWO_SECTIONS);
    render(<ModelPicker />);
    await openMenu();
    // MedGemma (lm-studio, loaded:false) -> affix; med-agent-team (generic) -> none.
    expect(screen.getByRole('button', { name: /MedGemma \(not loaded\)/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /med-agent-team \(not loaded\)/i })).toBeNull();
  });

  it('switching: selecting the team calls setEndpointModel(hubUrl, "med-agent-team")', async () => {
    mockFetch.mockResolvedValue(TWO_SECTIONS);
    mockSet.mockResolvedValue({ endpointUrl: HUB, current: 'med-agent-team' });
    render(<ModelPicker />);
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: /^med-agent-team$/i }));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith(HUB, 'med-agent-team'));
  });

  it('surfaces the backend reason when a switch fails', async () => {
    mockFetch.mockResolvedValue(TWO_SECTIONS);
    mockSet.mockRejectedValueOnce(
      Object.assign(new Error('Server responded with 400'), {
        responseBody: { error: "Model 'x' is not served by endpoint 'y'." },
  it('surfaces the backend reason when a switch fails', async () => {
    mockFetch.mockResolvedValue(TWO_SECTIONS);
    mockSet.mockRejectedValueOnce(
      Object.assign(new Error('Server responded with 400'), {
        responseBody: { error: "Model 'x' is not served by endpoint 'y'." },
      }),
    await waitFor(() =>
      expect(chatSessionStore.getState().selectedBackend).toEqual({ endpointUrl: LM, modelName: 'gemma-4-e2b-it' }),
    );
    render(<ModelPicker />);
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: /^med-agent-team$/i }));
    await waitFor(() => expect(screen.getByText(/not served by endpoint/i)).toBeInTheDocument());
    await openMenu('google/gemma-3-12b');
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Llama 3.1 8B Instruct/i }));

    // Actionable, resource-specific message — not the opaque generic error.
    expect(await screen.findByText(/not enough memory/i)).toBeInTheDocument();
    // Switch must NOT proceed to the GP flip when the model can't be loaded.
    expect(mockSet).not.toHaveBeenCalled();
    // Optimistic selection rolled back to the original current model.
    expect(screen.getByRole('button', { name: /google\/gemma-3-12b/i })).toBeInTheDocument();
  });

  it('does NOT pre-load when the selected model is already loaded', async () => {
    // Switching from current (Llama, loaded) to another loaded model should
    // skip the load call — it's already in memory, just flip the GP.
    const altSnapshot = {
      ...lmStudioSnapshot,
      current: 'meta-llama-3.1-8b-instruct',
      entries: lmStudioSnapshot.entries.map((e) =>
        e.id === 'meta-llama-3.1-8b-instruct' ? { ...e, loaded: true } : e,
      ),
    };
    mockFetch.mockResolvedValue(altSnapshot);
    mockSet.mockResolvedValueOnce({ current: 'google/gemma-3-12b' });

    render(<ModelPicker />);
    await openMenu('meta-llama-3.1-8b-instruct');
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Gemma 3 12B/i }));

    await waitFor(() => expect(mockSet).toHaveBeenCalledWith('google/gemma-3-12b'));
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('does NOT label the group "LM Studio" when provider is generic-openai-compat', async () => {
    // Backward compat: when the backend probe falls back to /v1/models (e.g.
    // an Anthropic endpoint), no LM Studio grouping should appear.
    mockFetch.mockResolvedValue({
      engine: 'remote',
      current: 'claude-opus-4-7',
      available: ['claude-opus-4-7', 'claude-haiku-4-5'],
      endpointUrl: 'https://api.anthropic.com/v1/chat/completions',
      provider: 'generic-openai-compat',
      entries: [
        { id: 'claude-opus-4-7', displayName: 'claude-opus-4-7', type: 'llm', loaded: false },
        { id: 'claude-haiku-4-5', displayName: 'claude-haiku-4-5', type: 'llm', loaded: false },
      ],
    });
    render(<ModelPicker />);
    await openMenu('claude-opus-4-7');
    expect(screen.queryByRole('group', { name: /LM Studio/i })).not.toBeInTheDocument();
  });

  it('still works against the legacy response shape (no provider, no entries)', async () => {
    // Older backend builds returned only {available: string[]}. The picker must
    // keep rendering correctly without the enriched fields.
    mockFetch.mockResolvedValue({
      engine: 'remote',
      current: 'one',
      available: ['one', 'two'],
      endpointUrl: 'http://host:1234/v1/chat/completions',
    });
    render(<ModelPicker />);
    await openMenu('one');
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(2);
    expect(screen.getByRole('menuitemradio', { name: /one/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /two/i })).toBeInTheDocument();
    await openMenu(/Gemma 4 e2b/i);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Med Agent Team/i }));
    await waitFor(() => expect(screen.getByText(/not served by endpoint/i)).toBeInTheDocument());
  });
});
