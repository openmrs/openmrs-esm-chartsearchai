import React from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ModelPicker from './model-picker.component';
import { fetchAvailableModels, setCurrentModel } from '../api/chartsearchai';
import { useConfig } from '@openmrs/esm-framework';

vi.mock('@openmrs/esm-framework', () => ({
  useConfig: vi.fn(() => ({ showModelPicker: true })),
}));
vi.mock('../api/chartsearchai', () => ({
  fetchAvailableModels: vi.fn(),
  setCurrentModel: vi.fn(),
}));

const mockFetch = fetchAvailableModels as Mock;
const mockSet = setCurrentModel as Mock;
const mockUseConfig = useConfig as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  mockUseConfig.mockReturnValue({ showModelPicker: true });
  // Default: fetch hangs. Individual tests can override before render().
  mockFetch.mockReturnValue(new Promise(() => {}));
});

describe('ModelPicker visibility gates', () => {
  it('renders nothing during the initial load (no layout shift)', () => {
    // beforeEach already mocked fetch to hang — verifies the no-snapshot path.
    const { container } = render(<ModelPicker />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hides when config.showModelPicker is false', () => {
    mockUseConfig.mockReturnValueOnce({ showModelPicker: false });
    // Even with a valid snapshot waiting, false config wins immediately.
    const { container } = render(<ModelPicker />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hides when engine is local', async () => {
    mockFetch.mockResolvedValueOnce({ engine: 'local', current: null, available: [] });
    const { container } = render(<ModelPicker />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('hides when fewer than 2 models are available', async () => {
    mockFetch.mockResolvedValueOnce({ engine: 'remote', current: 'only-one', available: ['only-one'] });
    const { container } = render(<ModelPicker />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('hides when /models fetch fails (treats 503 / network errors as not-applicable)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Service unavailable'));
    const { container } = render(<ModelPicker />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ModelPicker interaction', () => {
  const snapshot = {
    engine: 'remote' as const,
    current: 'gemma-4-e2b-it',
    available: ['gemma-4-e2b-it', 'google/gemma-4-31b', 'meta-llama-3.1-8b-instruct'],
    endpointUrl: 'http://host:1234/v1/chat/completions',
  };

  it('renders a trigger button showing the current model', async () => {
    mockFetch.mockResolvedValueOnce(snapshot);
    render(<ModelPicker />);
    const trigger = await screen.findByRole('button', { name: /select model/i });
    expect(trigger).toHaveTextContent('gemma-4-e2b-it');
  });

  it('opens the popover on click and lists all available models with the current one checked', async () => {
    mockFetch.mockResolvedValue(snapshot); // resolves on mount AND on open
    render(<ModelPicker />);
    const trigger = await screen.findByRole('button', { name: /select model/i });
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    // 3 option entries (one per available)
    expect(screen.getAllByRole('option')).toHaveLength(3);
    // The current model option carries aria-selected=true
    const selected = screen.getByRole('option', { selected: true });
    expect(selected).toHaveTextContent('gemma-4-e2b-it');
  });

  it('calls setCurrentModel on click and surfaces the new selection optimistically', async () => {
    mockFetch.mockResolvedValue(snapshot);
    mockSet.mockResolvedValueOnce({ current: 'google/gemma-4-31b' });
    const onSwitched = vi.fn();
    render(<ModelPicker onSwitched={onSwitched} />);
    fireEvent.click(await screen.findByRole('button', { name: /select model/i }));
    // The clickable target is the menu-item button inside the <li role=option>.
    fireEvent.click(screen.getByRole('button', { name: /google\/gemma-4-31b/i }));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith('google/gemma-4-31b'));
    expect(onSwitched).toHaveBeenCalledWith('google/gemma-4-31b');
  });

  it('rolls back the optimistic flip and surfaces an error when setCurrentModel fails', async () => {
    mockFetch.mockResolvedValue(snapshot);
    mockSet.mockRejectedValueOnce(new Error("Model 'bogus' is not in the active endpoint's /v1/models list."));
    render(<ModelPicker />);
    fireEvent.click(await screen.findByRole('button', { name: /select model/i }));
    fireEvent.click(screen.getByRole('button', { name: /google\/gemma-4-31b/i }));
    // After rollback, trigger goes back to original selection
    await waitFor(() => {
      const trigger = screen.getByRole('button', { name: /select model/i });
      expect(trigger).toHaveTextContent('gemma-4-e2b-it');
    });
    // Error notification visible
    expect(screen.getByText(/Failed to switch model/i)).toBeInTheDocument();
  });

  it('does NOT call setCurrentModel when the user clicks the currently-selected model', async () => {
    mockFetch.mockResolvedValue(snapshot);
    render(<ModelPicker />);
    fireEvent.click(await screen.findByRole('button', { name: /select model/i }));
    fireEvent.click(screen.getByRole('button', { name: /gemma-4-e2b-it/i }));
    expect(mockSet).not.toHaveBeenCalled();
  });
});
