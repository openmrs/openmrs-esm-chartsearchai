import React from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useConfig, usePatient } from '@openmrs/esm-framework';
import { useChartSearchAi } from '../hooks/useChartSearchAi';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import AiChatContent from './ai-chat-content.component';

vi.mock('../hooks/useChartSearchAi', () => ({
  useChartSearchAi: vi.fn(),
}));
vi.mock('../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: vi.fn(),
}));
vi.mock('./ai-response-panel.component', () => ({
  __esModule: true,
  default: ({
    answer,
    error,
    safetyWarnings,
  }: {
    answer: string;
    error: string | null;
    safetyWarnings?: Array<{ type: string; drug: string; detail: string }>;
  }) => (
    <div data-testid="ai-response">
      {error ?? answer}
      {safetyWarnings && safetyWarnings.length > 0 ? (
        <span data-testid="ai-response-safety">{safetyWarnings.map((w) => `${w.type}:${w.drug}`).join('|')}</span>
      ) : null}
    </div>
  ),
}));

const mockUseConfig = useConfig as Mock;
const mockUsePatient = usePatient as Mock;
const mockUseChartSearchAi = useChartSearchAi as Mock;
const mockUseSpeechRecognition = useSpeechRecognition as Mock;

let mockSubmitQuestion: Mock;
let mockStopCurrent: Mock;
let speechCallback: ((transcript: string) => void) | null;

beforeEach(() => {
  vi.clearAllMocks();
  mockSubmitQuestion = vi.fn();
  mockStopCurrent = vi.fn();
  speechCallback = null;
  mockUseConfig.mockReturnValue({ aiSearchPlaceholder: 'Ask AI...', maxQuestionLength: 1000 });
  mockUsePatient.mockReturnValue({ patient: { id: 'p1' }, isLoading: false });
  mockUseChartSearchAi.mockReturnValue({
    messages: [],
    isAnyLoading: false,
    submitQuestion: mockSubmitQuestion,
    stopCurrent: mockStopCurrent,
    clearMessages: vi.fn(),
  });
  mockUseSpeechRecognition.mockImplementation((onResult) => {
    speechCallback = onResult;
    return {
      isListening: false,
      isSupported: true,
      error: null,
      startListening: vi.fn(),
      stopListening: vi.fn(),
      clearError: vi.fn(),
    };
  });
});

function message(overrides = {}) {
  return {
    id: 'm1',
    question: 'What meds?',
    answer: '',
    references: [],
    questionId: '',
    isLoading: true,
    error: null,
    reasoning: '',
    ...overrides,
  };
}

describe('AiChatContent', () => {
  it('shows the live reasoning text while the model is thinking (no answer yet)', () => {
    mockUseChartSearchAi.mockReturnValue({
      messages: [message({ reasoning: 'The query asks about medications. Scanning drug orders.' })],
      isAnyLoading: true,
      submitQuestion: mockSubmitQuestion,
      stopCurrent: mockStopCurrent,
      clearMessages: vi.fn(),
    });
    render(<AiChatContent mode="workspace" />);

    expect(screen.getByText('The query asks about medications. Scanning drug orders.')).toBeInTheDocument();
  });

  it('hides the reasoning once answer text starts streaming', () => {
    mockUseChartSearchAi.mockReturnValue({
      messages: [message({ answer: 'Aspirin [1]', reasoning: 'Scanning drug orders.' })],
      isAnyLoading: true,
      submitQuestion: mockSubmitQuestion,
      stopCurrent: mockStopCurrent,
      clearMessages: vi.fn(),
    });
    render(<AiChatContent mode="workspace" />);

    expect(screen.queryByText('Scanning drug orders.')).not.toBeInTheDocument();
  });

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
        clearMessages: vi.fn(),
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
        clearMessages: vi.fn(),
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
        clearMessages: vi.fn(),
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
            references: [{ index: 1, resourceType: 'obs', resourceUuid: 'uuid-1', date: '2026-01-01' }],
            isLoading: false,
          },
        ],
        isAnyLoading: false,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: vi.fn(),
      });
      rerender(<AiChatContent mode="workspace" patientUuid="p1" />);

      expect(log.scrollTop).toBe(1000);
    });

    // Regression: the live "Thinking..." reasoning streams before any answer text exists,
    // so it changes neither `answer` nor `isAnyLoading`. If the scroll effect ignores
    // reasoning, the growing scratchpad runs past the viewport and is clipped out of sight
    // (it disappears behind the disclaimer). The effect must re-fire on each reasoning chunk.
    it('scrolls history area to bottom as reasoning streams (before any answer)', () => {
      const thinking = {
        id: 'm1',
        question: 'Summarize the visits.',
        answer: '',
        references: [],
        questionId: '',
        isLoading: true,
        error: null,
        reasoning: 'Scanning',
      };
      mockUseChartSearchAi.mockReturnValue({
        messages: [thinking],
        isAnyLoading: true,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: vi.fn(),
      });
      const { rerender } = render(<AiChatContent mode="workspace" patientUuid="p1" />);

      const log = screen.getByRole('log');
      Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 });
      log.scrollTop = 0;

      // Only `reasoning` grows — answer stays empty, isAnyLoading stays true.
      mockUseChartSearchAi.mockReturnValue({
        messages: [{ ...thinking, reasoning: 'Scanning visits, then active problems, then medications…' }],
        isAnyLoading: true,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: vi.fn(),
      });
      rerender(<AiChatContent mode="workspace" patientUuid="p1" />);

      expect(log.scrollTop).toBe(1000);
    });
  });

  describe('safety-warning forwarding', () => {
    it('forwards a message safetyWarnings to the response panel', () => {
      // Regression guard for the wiring at ai-chat-content.component.tsx (safetyWarnings={msg.safetyWarnings}):
      // the hook populates the message and the panel renders it, but dropping this prop pass-through
      // would let the chips silently never reach the panel, with no other test catching it.
      mockUseChartSearchAi.mockReturnValue({
        messages: [
          {
            id: 'm-sw',
            question: 'Is ibuprofen safe?',
            answer: 'Ibuprofen is an option [1].',
            references: [],
            safetyWarnings: [
              {
                type: 'contraindication',
                drug: 'Ibuprofen',
                detail: 'the patient has a recorded allergy to Ibuprofen',
              },
            ],
            questionId: 'q',
            isLoading: false,
            error: null,
          },
        ],
        isAnyLoading: false,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: vi.fn(),
      });

      render(<AiChatContent mode="workspace" patientUuid="p1" />);

      expect(screen.getByTestId('ai-response-safety')).toHaveTextContent('contraindication:Ibuprofen');
    });
  });

  describe('floating mode keyboard handling', () => {
    it('calls onClose when Escape is pressed', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(<AiChatContent mode="floating" patientUuid="p1" onClose={onClose} />);
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalled();
    });

    it('does not call onClose on Escape in workspace mode', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(<AiChatContent mode="workspace" patientUuid="p1" onClose={onClose} />);
      await user.keyboard('{Escape}');
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
