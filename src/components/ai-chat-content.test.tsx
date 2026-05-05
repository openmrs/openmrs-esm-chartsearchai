import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { useConfig, usePatient } from '@openmrs/esm-framework';
import { useChartSearchAi } from '../hooks/useChartSearchAi';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import AiChatContent from './ai-chat-content.component';

jest.mock('../hooks/useChartSearchAi', () => ({
  useChartSearchAi: jest.fn(),
}));
jest.mock('../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: jest.fn(),
}));
jest.mock('./ai-response-panel.component', () => ({
  __esModule: true,
  default: ({ answer, error }: { answer: string; error: string | null }) => (
    <div data-testid="ai-response">{error ?? answer}</div>
  ),
}));

const mockUseConfig = useConfig as jest.Mock;
const mockUsePatient = usePatient as jest.Mock;
const mockUseChartSearchAi = useChartSearchAi as jest.Mock;
const mockUseSpeechRecognition = useSpeechRecognition as jest.Mock;

let mockSubmitQuestion: jest.Mock;
let mockStopCurrent: jest.Mock;
let speechCallback: ((transcript: string) => void) | null;

beforeEach(() => {
  jest.clearAllMocks();
  mockSubmitQuestion = jest.fn();
  mockStopCurrent = jest.fn();
  speechCallback = null;
  mockUseConfig.mockReturnValue({ aiSearchPlaceholder: 'Ask AI...', maxQuestionLength: 1000 });
  mockUsePatient.mockReturnValue({ patient: { id: 'p1' }, isLoading: false });
  mockUseChartSearchAi.mockReturnValue({
    messages: [],
    isAnyLoading: false,
    submitQuestion: mockSubmitQuestion,
    stopCurrent: mockStopCurrent,
    clearMessages: jest.fn(),
  });
  mockUseSpeechRecognition.mockImplementation((onResult) => {
    speechCallback = onResult;
    return {
      isListening: false,
      isSupported: true,
      error: null,
      startListening: jest.fn(),
      stopListening: jest.fn(),
      clearError: jest.fn(),
    };
  });
});

describe('AiChatContent', () => {
  describe('submit guards', () => {
    it('does not submit when input is empty', async () => {
      const user = userEvent.setup();
      render(<AiChatContent mode="workspace" patientUuid="p1" />);
      await user.click(screen.getByRole('button', { name: /send/i }));
      expect(mockSubmitQuestion).not.toHaveBeenCalled();
    });

    it('does not submit when patientUuid is missing', async () => {
      mockUsePatient.mockReturnValue({ patient: null, isLoading: false });
      const user = userEvent.setup();
      render(<AiChatContent mode="floating" />);
      await user.type(screen.getByRole('textbox'), 'Hello');
      await user.keyboard('{Enter}');
      expect(mockSubmitQuestion).not.toHaveBeenCalled();
    });

    it('does not submit while a request is in flight', async () => {
      mockUseChartSearchAi.mockReturnValue({
        messages: [],
        isAnyLoading: true,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: jest.fn(),
      });
      render(<AiChatContent mode="workspace" patientUuid="p1" />);
      const input = screen.getByRole('textbox');
      expect(input).toBeDisabled();
    });

    it('submits and clears input on Enter', async () => {
      const user = userEvent.setup();
      render(<AiChatContent mode="workspace" patientUuid="p1" />);
      const input = screen.getByRole('textbox');
      await user.type(input, 'What meds?');
      await user.keyboard('{Enter}');
      expect(mockSubmitQuestion).toHaveBeenCalledWith('p1', 'What meds?');
      expect(input).toHaveValue('');
    });
  });

  describe('speech recognition', () => {
    it('appends transcript to existing text and auto-submits', async () => {
      const user = userEvent.setup();
      render(<AiChatContent mode="workspace" patientUuid="p1" />);
      await user.type(screen.getByRole('textbox'), 'Tell me about');
      act(() => speechCallback!('the patient'));
      expect(mockSubmitQuestion).toHaveBeenCalledWith('p1', 'Tell me about the patient');
    });

    it('does not submit speech result when patientUuid is missing', () => {
      mockUsePatient.mockReturnValue({ patient: null, isLoading: false });
      render(<AiChatContent mode="floating" />);
      act(() => speechCallback!('hello'));
      expect(mockSubmitQuestion).not.toHaveBeenCalled();
    });

    it('does not submit speech result when a request is in flight', () => {
      mockUseChartSearchAi.mockReturnValue({
        messages: [],
        isAnyLoading: true,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: jest.fn(),
      });
      render(<AiChatContent mode="workspace" patientUuid="p1" />);
      act(() => speechCallback!('hello'));
      expect(mockSubmitQuestion).not.toHaveBeenCalled();
    });
  });

  describe('auto-scroll', () => {
    // Regression: when streaming ends, the AiResponsePanel mounts the references list
    // and feedback widget in the same React commit that flips isAnyLoading to false,
    // growing the message past the history-area viewport. The scroll effect must fire
    // on this transition so those new elements stay visible.
    it('scrolls history area to bottom when isAnyLoading transitions to false', () => {
      const streaming = {
        id: 'm1',
        question: 'Any allergies?',
        answer: 'partial',
        references: [],
        questionId: '',
        isLoading: true,
        error: null,
      };
      mockUseChartSearchAi.mockReturnValue({
        messages: [streaming],
        isAnyLoading: true,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: jest.fn(),
      });
      const { rerender } = render(<AiChatContent mode="workspace" patientUuid="p1" />);

      const log = screen.getByRole('log');
      Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 });
      log.scrollTop = 0;

      mockUseChartSearchAi.mockReturnValue({
        messages: [
          {
            ...streaming,
            answer: 'No known allergies.',
            references: [{ index: 1, resourceType: 'obs', resourceId: 1, date: '2026-01-01' }],
            isLoading: false,
          },
        ],
        isAnyLoading: false,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: jest.fn(),
      });
      rerender(<AiChatContent mode="workspace" patientUuid="p1" />);

      expect(log.scrollTop).toBe(1000);
    });
  });

  describe('floating mode keyboard handling', () => {
    it('calls onClose when Escape is pressed', async () => {
      const onClose = jest.fn();
      const user = userEvent.setup();
      render(<AiChatContent mode="floating" patientUuid="p1" onClose={onClose} />);
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalled();
    });

    it('does not call onClose on Escape in workspace mode', async () => {
      const onClose = jest.fn();
      const user = userEvent.setup();
      render(<AiChatContent mode="workspace" patientUuid="p1" onClose={onClose} />);
      await user.keyboard('{Escape}');
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
