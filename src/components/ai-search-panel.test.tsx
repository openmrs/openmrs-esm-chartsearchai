import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { useConfig, usePatient } from '@openmrs/esm-framework';
import AiSearchPanel from './ai-search-panel.component';

const mockUseConfig = useConfig as jest.Mock;
const mockUsePatient = usePatient as jest.Mock;

const mockSubmitQuestion = jest.fn();
const mockClearResults = jest.fn();

jest.mock('../hooks/useChartSearchAi', () => ({
  useChartSearchAi: () => ({
    answer: mockAnswer,
    disclaimer: mockDisclaimer,
    references: mockReferences,
    isLoading: mockIsLoading,
    error: mockError,
    submitQuestion: mockSubmitQuestion,
    clearResults: mockClearResults,
  }),
}));

let mockAnswer = '';
let mockDisclaimer = '';
let mockReferences: Array<{ index: number; resourceType: string; resourceId: number; date: string }> = [];
let mockIsLoading = false;
let mockError: string | null = null;

beforeEach(() => {
  mockAnswer = '';
  mockDisclaimer = '';
  mockReferences = [];
  mockIsLoading = false;
  mockError = null;
  mockSubmitQuestion.mockClear();
  mockClearResults.mockClear();

  mockUseConfig.mockReturnValue({
    aiSearchPlaceholder: 'Ask AI about this patient...',
    maxQuestionLength: 1000,
    useStreaming: true,
  });

  mockUsePatient.mockReturnValue({
    patient: { id: 'test-patient-uuid' },
    isLoading: false,
    error: null,
    patientUuid: 'test-patient-uuid',
  });
});

describe('AiSearchPanel', () => {
  const onClose = jest.fn();

  it('renders the header and input', () => {
    render(<AiSearchPanel onClose={onClose} />);

    expect(screen.getByText('AI Chart Search')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ask AI about this patient...')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup();
    render(<AiSearchPanel onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('submits a question when the send button is clicked', async () => {
    const user = userEvent.setup();
    render(<AiSearchPanel onClose={onClose} />);

    const input = screen.getByPlaceholderText('Ask AI about this patient...');
    await user.type(input, 'What medications is this patient on?');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(mockSubmitQuestion).toHaveBeenCalledWith('test-patient-uuid', 'What medications is this patient on?');
  });

  it('submits on Enter key press', async () => {
    const user = userEvent.setup();
    render(<AiSearchPanel onClose={onClose} />);

    const input = screen.getByPlaceholderText('Ask AI about this patient...');
    await user.type(input, 'Any allergies?{enter}');

    expect(mockSubmitQuestion).toHaveBeenCalledWith('test-patient-uuid', 'Any allergies?');
  });

  it('disables send button when input is empty', () => {
    render(<AiSearchPanel onClose={onClose} />);

    const sendButton = screen.getByRole('button', { name: /send/i });
    expect(sendButton).toBeDisabled();
  });

  it('does not submit whitespace-only input', async () => {
    const user = userEvent.setup();
    render(<AiSearchPanel onClose={onClose} />);

    const input = screen.getByPlaceholderText('Ask AI about this patient...');
    await user.type(input, '   {enter}');

    expect(mockSubmitQuestion).not.toHaveBeenCalled();
  });

  it('shows loading indicator when waiting for first token', () => {
    mockIsLoading = true;
    render(<AiSearchPanel onClose={onClose} />);

    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  it('shows stop button while loading', () => {
    mockIsLoading = true;
    mockAnswer = 'partial answer';
    render(<AiSearchPanel onClose={onClose} />);

    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('shows error message when error occurs', () => {
    mockError = 'Something went wrong';
    render(<AiSearchPanel onClose={onClose} />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});
