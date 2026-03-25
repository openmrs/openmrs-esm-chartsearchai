import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { usePatient } from '@openmrs/esm-framework';
import AiSearchButton from './ai-search-button.component';

const mockUsePatient = usePatient as jest.Mock;

jest.mock('./ai-search-panel.component', () => {
  const MockPanel = ({ onClose }: { onClose: () => void }) => (
    <div data-testid="ai-search-panel">
      <button onClick={onClose}>Close</button>
    </div>
  );
  return MockPanel;
});

describe('AiSearchButton', () => {
  beforeEach(() => {
    mockUsePatient.mockReturnValue({ patientUuid: 'test-patient-uuid' });
  });

  it('renders the AI button', () => {
    render(<AiSearchButton />);
    expect(screen.getByRole('button', { name: /ai search/i })).toBeInTheDocument();
  });

  it('opens the search panel when clicked', async () => {
    const user = userEvent.setup();
    render(<AiSearchButton />);

    expect(screen.queryByTestId('ai-search-panel')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /ai search/i }));
    expect(screen.getByTestId('ai-search-panel')).toBeInTheDocument();
  });

  it('closes the search panel when toggled again', async () => {
    const user = userEvent.setup();
    render(<AiSearchButton />);

    const button = screen.getByRole('button', { name: /ai search/i });
    await user.click(button);
    expect(screen.getByTestId('ai-search-panel')).toBeInTheDocument();

    await user.click(button);
    expect(screen.queryByTestId('ai-search-panel')).not.toBeInTheDocument();
  });

  it('closes the panel via the onClose callback', async () => {
    const user = userEvent.setup();
    render(<AiSearchButton />);

    await user.click(screen.getByRole('button', { name: /ai search/i }));
    expect(screen.getByTestId('ai-search-panel')).toBeInTheDocument();

    await user.click(screen.getByText('Close'));
    expect(screen.queryByTestId('ai-search-panel')).not.toBeInTheDocument();
  });
});
