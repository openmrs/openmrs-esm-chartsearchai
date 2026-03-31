import React, { act } from 'react';
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
    submittedQuestion: mockSubmittedQuestion,
    answer: mockAnswer,
    disclaimer: mockDisclaimer,
    references: mockReferences,
    questionId: mockQuestionId,
    isLoading: mockIsLoading,
    error: mockError,
    submitQuestion: mockSubmitQuestion,
    clearResults: mockClearResults,
  }),
}));

const mockStartListening = jest.fn();
const mockStopListening = jest.fn();
const mockClearSpeechError = jest.fn();
let mockIsListening = false;
let mockIsSpeechSupported = false;
let mockSpeechError: string | null = null;
let capturedOnResult: ((transcript: string) => void) | null = null;

jest.mock('../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: (onResult: (transcript: string) => void) => {
    capturedOnResult = onResult;
    return {
      isListening: mockIsListening,
      isSupported: mockIsSpeechSupported,
      error: mockSpeechError,
      startListening: mockStartListening,
      stopListening: mockStopListening,
      clearError: mockClearSpeechError,
    };
  },
}));

jest.mock('../api/chartsearchai', () => ({
  submitFeedback: jest.fn().mockResolvedValue(undefined),
}));

let mockSubmittedQuestion = '';
let mockAnswer = '';
let mockDisclaimer = '';
let mockReferences: Array<{ index: number; resourceType: string; resourceId: number; date: string }> = [];
let mockQuestionId = '';
let mockIsLoading = false;
let mockError: string | null = null;

beforeEach(() => {
  mockSubmittedQuestion = '';
  mockAnswer = '';
  mockDisclaimer = '';
  mockReferences = [];
  mockQuestionId = '';
  mockIsLoading = false;
  mockError = null;
  mockIsListening = false;
  mockIsSpeechSupported = false;
  mockSpeechError = null;
  mockSubmitQuestion.mockClear();
  mockClearResults.mockClear();
  mockStartListening.mockClear();
  mockStopListening.mockClear();
  mockClearSpeechError.mockClear();
  capturedOnResult = null;

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

  beforeEach(() => {
    onClose.mockClear();
  });

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

  it('closes the panel when Escape is pressed', async () => {
    const user = userEvent.setup();
    render(<AiSearchPanel onClose={onClose} />);

    const input = screen.getByPlaceholderText('Ask AI about this patient...');
    await user.click(input);
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
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
    mockSubmittedQuestion = 'Any allergies?';
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

  it('shows no patient selected message when patient is unavailable', () => {
    mockUsePatient.mockReturnValue({
      patient: null,
      isLoading: false,
      error: null,
      patientUuid: null,
    });
    render(<AiSearchPanel onClose={onClose} />);

    expect(screen.getByText('No patient selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  describe('voice input', () => {
    beforeEach(() => {
      mockIsSpeechSupported = true;
    });

    it('shows mic button when speech is supported', () => {
      render(<AiSearchPanel onClose={onClose} />);

      expect(screen.getByRole('button', { name: /voice input/i })).toBeInTheDocument();
    });

    it('does not show mic button when speech is not supported', () => {
      mockIsSpeechSupported = false;
      render(<AiSearchPanel onClose={onClose} />);

      expect(screen.queryByRole('button', { name: /voice input/i })).not.toBeInTheDocument();
    });

    it('calls startListening when mic button is clicked', async () => {
      const user = userEvent.setup();
      render(<AiSearchPanel onClose={onClose} />);

      await user.click(screen.getByRole('button', { name: /voice input/i }));
      expect(mockStartListening).toHaveBeenCalled();
    });

    it('calls stopListening when active mic button is clicked', async () => {
      mockIsListening = true;
      const user = userEvent.setup();
      render(<AiSearchPanel onClose={onClose} />);

      await user.click(screen.getByRole('button', { name: /stop listening/i }));
      expect(mockStopListening).toHaveBeenCalled();
    });

    it('shows microphone permission error', () => {
      mockSpeechError = 'not-allowed';
      render(<AiSearchPanel onClose={onClose} />);

      expect(screen.getByText(/microphone access was denied/i)).toBeInTheDocument();
    });

    it('shows generic speech error', () => {
      mockSpeechError = 'network';
      render(<AiSearchPanel onClose={onClose} />);

      expect(screen.getByText(/speech recognition failed/i)).toBeInTheDocument();
    });

    it('auto-submits after speech result', () => {
      render(<AiSearchPanel onClose={onClose} />);

      act(() => {
        capturedOnResult?.('What are the allergies?');
      });

      expect(mockSubmitQuestion).toHaveBeenCalledWith('test-patient-uuid', 'What are the allergies?');
    });

    it('hides mic button while loading', () => {
      mockIsLoading = true;
      mockAnswer = 'partial';
      render(<AiSearchPanel onClose={onClose} />);

      expect(screen.queryByRole('button', { name: /voice input/i })).not.toBeInTheDocument();
    });
  });

  describe('clear and response flow', () => {
    it('shows clear button when there is a response', () => {
      mockAnswer = 'The patient has no known allergies.';
      mockQuestionId = 'q-1';
      render(<AiSearchPanel onClose={onClose} />);

      expect(screen.getByRole('button', { name: /clear and ask new question/i })).toBeInTheDocument();
    });

    it('clears results when clear button is clicked', async () => {
      mockAnswer = 'The patient has no known allergies.';
      mockQuestionId = 'q-1';
      const user = userEvent.setup();
      render(<AiSearchPanel onClose={onClose} />);

      await user.click(screen.getByRole('button', { name: /clear and ask new question/i }));
      expect(mockClearResults).toHaveBeenCalled();
    });

    it('displays the answer text in the response area', () => {
      mockAnswer = 'The patient is taking metformin.';
      mockQuestionId = 'q-1';
      render(<AiSearchPanel onClose={onClose} />);

      expect(screen.getByText('The patient is taking metformin.')).toBeInTheDocument();
    });

    it('displays the disclaimer when present', () => {
      mockAnswer = 'Some answer';
      mockDisclaimer = 'AI responses may not be accurate.';
      mockQuestionId = 'q-1';
      render(<AiSearchPanel onClose={onClose} />);

      expect(screen.getByText('AI responses may not be accurate.')).toBeInTheDocument();
    });
  });

  describe('feedback', () => {
    it('shows feedback widget when answer is complete', () => {
      mockAnswer = 'The patient has diabetes.';
      mockQuestionId = 'q-123';
      render(<AiSearchPanel onClose={onClose} />);

      expect(screen.getByText('Was this helpful?')).toBeInTheDocument();
    });

    it('does not show feedback widget while loading', () => {
      mockAnswer = 'partial answer';
      mockQuestionId = 'q-123';
      mockIsLoading = true;
      render(<AiSearchPanel onClose={onClose} />);

      expect(screen.queryByText('Was this helpful?')).not.toBeInTheDocument();
    });

    it('shows thumbs up and thumbs down buttons', () => {
      mockAnswer = 'The patient has diabetes.';
      mockQuestionId = 'q-123';
      render(<AiSearchPanel onClose={onClose} />);

      expect(screen.getByRole('button', { name: 'Helpful' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Not helpful' })).toBeInTheDocument();
    });

    it('shows thanks message after positive feedback', async () => {
      mockAnswer = 'The patient has diabetes.';
      mockQuestionId = 'q-123';
      const user = userEvent.setup();
      render(<AiSearchPanel onClose={onClose} />);

      await user.click(screen.getByRole('button', { name: 'Helpful' }));
      expect(screen.getByText('Thanks for your feedback')).toBeInTheDocument();
    });

    it('shows comment form after negative feedback', async () => {
      mockAnswer = 'The patient has diabetes.';
      mockQuestionId = 'q-123';
      const user = userEvent.setup();
      render(<AiSearchPanel onClose={onClose} />);

      await user.click(screen.getByRole('button', { name: 'Not helpful' }));
      expect(screen.getByPlaceholderText('What was wrong? (optional)')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });
  });
});
