import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
    safetyStatus,
  }: {
    answer: string;
    error: string | null;
    safetyWarnings?: Array<{ type: string; drug: string; detail: string }>;
    safetyStatus?: string;
  }) => (
    <div data-testid="ai-response">
      {error ?? answer}
      {safetyWarnings && safetyWarnings.length > 0 ? (
        <span data-testid="ai-response-safety">{safetyWarnings.map((w) => `${w.type}:${w.drug}`).join('|')}</span>
      ) : null}
      {safetyStatus ? <span data-testid="ai-response-safety-status">{safetyStatus}</span> : null}
    </div>
  ),
}));

const mockUseConfig = useConfig as Mock;
const mockUsePatient = usePatient as Mock;
const mockUseChartSearchAi = useChartSearchAi as Mock;
const mockUseSpeechRecognition = useSpeechRecognition as Mock;

let mockSubmitQuestion: Mock;
let mockStopCurrent: Mock;
let mockStartNewChatSession: Mock;
let speechCallback: ((transcript: string) => void) | null;

beforeEach(() => {
  vi.clearAllMocks();
  mockSubmitQuestion = vi.fn();
  mockStopCurrent = vi.fn();
  mockStartNewChatSession = vi.fn();
  speechCallback = null;
  mockUseConfig.mockReturnValue({ aiSearchPlaceholder: 'Ask AI...', maxQuestionLength: 1000, showReasoning: true });
  mockUsePatient.mockReturnValue({ patient: { id: 'p1' }, isLoading: false });
  mockUseChartSearchAi.mockReturnValue({
    messages: [],
    isAwaitingAnswer: false,
    submitQuestion: mockSubmitQuestion,
    stopCurrent: mockStopCurrent,
    clearMessages: vi.fn(),
    startNewChatSession: mockStartNewChatSession,
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
    auditLogId: undefined,
    phase: 'answering',
    error: null,
    ...overrides,
  };
}

describe('AiChatContent', () => {
  it('shows a "Thinking..." indicator while the answer is generating (no answer yet)', () => {
    mockUseChartSearchAi.mockReturnValue({
      messages: [message({ phase: 'answering', answer: '' })],
      isAwaitingAnswer: true,
      submitQuestion: mockSubmitQuestion,
      stopCurrent: mockStopCurrent,
      clearMessages: vi.fn(),
    });
    render(<AiChatContent mode="workspace" />);

    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  it('drops the "Thinking..." indicator once answer text arrives', () => {
    mockUseChartSearchAi.mockReturnValue({
      messages: [message({ answer: 'Aspirin [1]' })],
      isAwaitingAnswer: true,
      submitQuestion: mockSubmitQuestion,
      stopCurrent: mockStopCurrent,
      clearMessages: vi.fn(),
    });
    render(<AiChatContent mode="workspace" />);

    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
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

    it('disables the composer while awaiting the answer', async () => {
      mockUseChartSearchAi.mockReturnValue({
        messages: [],
        isAwaitingAnswer: true,
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

    it('does not submit speech result while awaiting the answer', () => {
      mockUseChartSearchAi.mockReturnValue({
        messages: [],
        isAwaitingAnswer: true,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: vi.fn(),
      });
      render(<AiChatContent mode="workspace" patientUuid="p1" />);
      act(() => speechCallback!('hello'));
      expect(mockSubmitQuestion).not.toHaveBeenCalled();
    });
  });

  // Interactive-first: once the answer + validation land (phase 'settled'), the composer unlocks
  // even though in-depth is still streaming. A new question can then be asked, which preempts the
  // trailing in-depth in the hook.
  describe('interactive-first composer (in-depth streaming in background)', () => {
    const settledWhileInDepth = () =>
      mockUseChartSearchAi.mockReturnValue({
        messages: [message({ answer: 'Aspirin [1].', phase: 'settled', inDepth: { status: 'pending', answer: '' } })],
        isAwaitingAnswer: false,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: vi.fn(),
      });

    it('keeps the composer enabled and shows Send (not Stop) once the answer settles', () => {
      settledWhileInDepth();
      render(<AiChatContent mode="workspace" patientUuid="p1" />);
      expect(screen.getByRole('textbox')).toBeEnabled();
      expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument();
    });

    it('submits a new question while in-depth is still streaming (preempt path)', async () => {
      settledWhileInDepth();
      const user = userEvent.setup();
      render(<AiChatContent mode="workspace" patientUuid="p1" />);
      const input = screen.getByRole('textbox');
      await user.type(input, 'And allergies?');
      await user.keyboard('{Enter}');
      expect(mockSubmitQuestion).toHaveBeenCalledWith('p1', 'And allergies?');
    });
  });

  describe('auto-scroll', () => {
    it('keeps streamed reasoning in view before answer text arrives', () => {
      mockUseChartSearchAi.mockReturnValue({
        messages: [message({ reasoning: 'Checking' })],
        isAwaitingAnswer: true,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: vi.fn(),
        startNewChatSession: mockStartNewChatSession,
      });
      const { rerender } = render(<AiChatContent mode="workspace" patientUuid="p1" />);
      const history = screen.getByRole('log');
      const setScrollTop = vi.fn();
      Object.defineProperty(history, 'scrollHeight', { configurable: true, value: 500 });
      Object.defineProperty(history, 'scrollTop', { configurable: true, set: setScrollTop });

      mockUseChartSearchAi.mockReturnValue({
        messages: [message({ reasoning: 'Checking the chart' })],
        isAwaitingAnswer: true,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: vi.fn(),
        startNewChatSession: mockStartNewChatSession,
      });
      rerender(<AiChatContent mode="workspace" patientUuid="p1" />);

      expect(setScrollTop).toHaveBeenCalledWith(500);
    });
  });

  describe('safety-warning forwarding', () => {
    it('forwards a message safetyWarnings to the response panel', () => {
      // Regression guard for the wiring at ai-chat-content.component.tsx
      // (`safetyWarnings={msg.safetyWarnings}`):
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
            auditLogId: 42,
            phase: 'complete',
            error: null,
          },
        ],
        isAwaitingAnswer: false,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: vi.fn(),
      });

      render(<AiChatContent mode="workspace" patientUuid="p1" />);

      expect(screen.getByTestId('ai-response-safety')).toHaveTextContent('contraindication:Ibuprofen');
    });

    it('forwards a message safetyStatus to the response panel even with no warnings', () => {
      // The message-to-panel boundary must preserve limited and unavailable safety states.
      mockUseChartSearchAi.mockReturnValue({
        messages: [
          {
            id: 'm-status',
            question: 'What medications is the patient on?',
            answer: 'Lisinopril 10 mg [1].',
            references: [],
            safetyWarnings: [],
            safetyStatus: 'unavailable',
            auditLogId: 42,
            phase: 'complete',
            error: null,
          },
        ],
        isAwaitingAnswer: false,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: vi.fn(),
      });

      render(<AiChatContent mode="workspace" patientUuid="p1" />);

      expect(screen.getByTestId('ai-response-safety-status')).toHaveTextContent('unavailable');
    });
  });
  describe('header controls (new chat / maximize)', () => {
    // New chat must be available even on an empty chat, before any conversation
    // has started.
    it('renders the New chat button even with no messages and calls startNewChatSession on click', async () => {
      const user = userEvent.setup();
      render(<AiChatContent mode="floating" patientUuid="p1" onClose={vi.fn()} />);
      const newChat = screen.getByRole('button', { name: /new chat/i });
      await user.click(newChat);
      expect(mockStartNewChatSession).toHaveBeenCalledWith('p1');
    });

    it('shows the maximize control only when onToggleExpand is provided, and toggles it', async () => {
      const onToggleExpand = vi.fn();
      const user = userEvent.setup();
      const { rerender } = render(<AiChatContent mode="floating" patientUuid="p1" onClose={vi.fn()} />);
      // No handler → no maximize control.
      expect(screen.queryByRole('button', { name: /maximize/i })).not.toBeInTheDocument();
      rerender(<AiChatContent mode="floating" patientUuid="p1" onClose={vi.fn()} onToggleExpand={onToggleExpand} />);
      await user.click(screen.getByRole('button', { name: /maximize/i }));
      expect(onToggleExpand).toHaveBeenCalled();
    });
  });
  describe('floating mode keyboard handling', () => {
    it('does not trap keyboard focus while the panel is docked', () => {
      render(<AiChatContent mode="floating" patientUuid="p1" onClose={vi.fn()} onToggleExpand={vi.fn()} />);
      const lastEnabledControl = screen.getByRole('button', { name: /voice input/i });
      lastEnabledControl.focus();
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      lastEnabledControl.dispatchEvent(tab);

      expect(tab.defaultPrevented).toBe(false);
    });

    it('marks only the expanded panel as modal', () => {
      const { rerender } = render(
        <AiChatContent mode="floating" patientUuid="p1" onClose={vi.fn()} onToggleExpand={vi.fn()} />,
      );
      expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-modal');

      rerender(
        <AiChatContent mode="floating" patientUuid="p1" onClose={vi.fn()} onToggleExpand={vi.fn()} isExpanded />,
      );
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

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

describe('upstream reasoning and scroll behavior in conversations', () => {
  it('shows the live reasoning text while the model is thinking (no answer yet)', () => {
    mockUseChartSearchAi.mockReturnValue({
      messages: [message({ reasoning: 'The query asks about medications. Scanning drug orders.' })],
      isAwaitingAnswer: true,
      submitQuestion: mockSubmitQuestion,
      stopCurrent: mockStopCurrent,
      clearMessages: vi.fn(),
    });
    render(<AiChatContent mode="workspace" />);

    // `toBeVisible`, not `toBeInTheDocument`: a collapsed <details> keeps its content in the DOM,
    // so the weaker matcher would pass whether or not the disclosure opens for the live phase —
    // which is the one thing this test is about.
    expect(screen.getByText('The query asks about medications. Scanning drug orders.')).toBeVisible();
  });

  it('collapses the reasoning behind a disclosure once answer text starts streaming', () => {
    // It used to be UNMOUNTED here, which left a reader who looked away during the reasoning
    // phase with nothing to open. It is kept, and collapsed, so the answer still leads.
    mockUseChartSearchAi.mockReturnValue({
      messages: [message({ answer: 'Aspirin [1]', reasoning: 'Scanning drug orders.' })],
      isAwaitingAnswer: true,
      submitQuestion: mockSubmitQuestion,
      stopCurrent: mockStopCurrent,
      clearMessages: vi.fn(),
    });
    render(<AiChatContent mode="workspace" />);

    expect(screen.getByText('Model reasoning')).toBeInTheDocument();
    expect(screen.getByText('Scanning drug orders.')).not.toBeVisible();
  });

  it('offers the reasoning of a settled answer, collapsed', () => {
    mockUseChartSearchAi.mockReturnValue({
      messages: [message({ answer: 'Aspirin [1]', reasoning: 'Scanning drug orders.', phase: 'complete' })],
      isAwaitingAnswer: false,
      submitQuestion: mockSubmitQuestion,
      stopCurrent: mockStopCurrent,
      clearMessages: vi.fn(),
    });
    render(<AiChatContent mode="workspace" />);

    expect(screen.getByText('Model reasoning')).toBeInTheDocument();
    expect(screen.getByText('Scanning drug orders.')).not.toBeVisible();
  });

  it('draws no reasoning at all when showReasoning is off', () => {
    // A transcript already on a message — one that predates an operator flipping the flag off —
    // is not drawn either, which is why the render carries its own test of the config.
    mockUseConfig.mockReturnValue({ aiSearchPlaceholder: 'Ask AI...', maxQuestionLength: 1000, showReasoning: false });
    mockUseChartSearchAi.mockReturnValue({
      messages: [message({ answer: 'Aspirin [1]', reasoning: 'Scanning drug orders.', phase: 'complete' })],
      isAwaitingAnswer: false,
      submitQuestion: mockSubmitQuestion,
      stopCurrent: mockStopCurrent,
      clearMessages: vi.fn(),
    });
    render(<AiChatContent mode="workspace" />);

    expect(screen.queryByText('Model reasoning')).not.toBeInTheDocument();
    expect(screen.queryByText('Scanning drug orders.')).not.toBeInTheDocument();
  });

  describe('auto-scroll', () => {
    // Regression: when streaming ends, the AiResponsePanel mounts the references list
    // and feedback widget in the same React commit that flips isAwaitingAnswer to false,
    // growing the message past the history-area viewport. The scroll effect must fire
    // on this transition so those new elements stay visible.
    it('scrolls history area to bottom when isAwaitingAnswer transitions to false', () => {
      const streaming = {
        id: 'm1',
        question: 'Any allergies?',
        answer: 'partial',
        references: [],
        questionId: '',
        phase: 'answering',
        error: null,
      };
      mockUseChartSearchAi.mockReturnValue({
        messages: [streaming],
        isAwaitingAnswer: true,
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
            phase: 'complete',
          },
        ],
        isAwaitingAnswer: false,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: vi.fn(),
      });
      rerender(<AiChatContent mode="workspace" patientUuid="p1" />);

      expect(log.scrollTop).toBe(1000);
    });

    describe('when a finished answer is taller than the history area', () => {
      function finish(messageHeight: number) {
        const streaming = {
          id: 'm1',
          question: 'Is it safe to give rifampicin?',
          answer: 'partial',
          references: [],
          questionId: '',
          phase: 'answering',
          error: null,
        };
        mockUseChartSearchAi.mockReturnValue({
          messages: [streaming],
          isAwaitingAnswer: true,
          submitQuestion: mockSubmitQuestion,
          stopCurrent: mockStopCurrent,
          clearMessages: vi.fn(),
        });
        const { rerender, container } = render(<AiChatContent mode="workspace" patientUuid="p1" />);
        const log = screen.getByRole('log');
        Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 });
        Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 });
        log.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
        log.scrollTop = 0;
        mockUseChartSearchAi.mockReturnValue({
          messages: [{ ...streaming, answer: 'No — Rifampicin should not be given.', phase: 'complete' }],
          isAwaitingAnswer: false,
          submitQuestion: mockSubmitQuestion,
          stopCurrent: mockStopCurrent,
          clearMessages: vi.fn(),
        });
        // Scrolled to the bottom, the message's top sits 300px above the log's,
        // so aligning it is 1000 - 300 = 700.
        HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
          if (this.hasAttribute('data-message-pair')) return { top: -200, height: messageHeight } as DOMRect;
          return this === log ? ({ top: 100 } as DOMRect) : ({ top: 0, height: 0 } as DOMRect);
        };
        rerender(<AiChatContent mode="workspace" patientUuid="p1" />);
        return { log, container };
      }

      const original = HTMLElement.prototype.getBoundingClientRect;
      afterEach(() => {
        HTMLElement.prototype.getBoundingClientRect = original;
      });

      it('aligns the message to its top, so the answer is in view rather than the end of its safety box', () => {
        const { log } = finish(600);
        expect(log.scrollTop).toBe(700);
      });

      it('leaves a message that fits at the bottom, as before', () => {
        const { log } = finish(200);
        expect(log.scrollTop).toBe(1000);
      });
    });

    // Regression: the live "Thinking..." reasoning streams before any answer text exists,
    // so it changes neither `answer` nor `isAwaitingAnswer`. If the scroll effect ignores
    // reasoning, the growing scratchpad runs past the viewport and is clipped out of sight
    // (it disappears behind the disclaimer). The effect must re-fire on each reasoning chunk.
    it('scrolls history area to bottom as reasoning streams (before any answer)', () => {
      const thinking = {
        id: 'm1',
        question: 'Summarize the visits.',
        answer: '',
        references: [],
        questionId: '',
        phase: 'answering',
        error: null,
        reasoning: 'Scanning',
      };
      mockUseChartSearchAi.mockReturnValue({
        messages: [thinking],
        isAwaitingAnswer: true,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: vi.fn(),
      });
      const { rerender } = render(<AiChatContent mode="workspace" patientUuid="p1" />);

      const log = screen.getByRole('log');
      Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 });
      log.scrollTop = 0;

      // Only `reasoning` grows — answer stays empty, isAwaitingAnswer stays true.
      mockUseChartSearchAi.mockReturnValue({
        messages: [{ ...thinking, reasoning: 'Scanning visits, then active problems, then medications…' }],
        isAwaitingAnswer: true,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: vi.fn(),
      });
      rerender(<AiChatContent mode="workspace" patientUuid="p1" />);

      expect(log.scrollTop).toBe(1000);
    });
  });

  describe('scrolling back while an answer streams', () => {
    // Measured live on a 3.7.1 standalone: after two answers, a wheel-up during the third's stream was
    // undone within 150 ms on every try, because each chunk re-set scrollTop to the bottom. Following
    // the stream is right only while the reader is AT the bottom.
    const thinking = {
      id: 'm2',
      question: 'Is it safe to start her on clarithromycin?',
      answer: '',
      references: [],
      questionId: '',
      phase: 'answering',
      error: null,
      reasoning: 'Scanning',
    };
    const earlier = {
      id: 'm1',
      question: 'any allergies?',
      answer: 'Lidocaine [1].',
      references: [],
      questionId: 'q1',
      phase: 'complete',
      error: null,
    };
    const hookReturning = (messages: unknown[], isAwaitingAnswer = true) =>
      mockUseChartSearchAi.mockReturnValue({
        messages,
        isAwaitingAnswer,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: vi.fn(),
      });

    function streamingLog() {
      hookReturning([earlier, thinking]);
      const view = render(<AiChatContent mode="workspace" patientUuid="p1" />);
      const log = screen.getByRole('log');
      Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 });
      Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 });
      return { ...view, log };
    }

    /** What a reader's own scroll does: the position moves, then the browser fires `scroll`. */
    function readerScrollsTo(log: HTMLElement, top: number) {
      log.scrollTop = top;
      fireEvent.scroll(log);
    }

    it('leaves the reader where they scrolled to when the next chunk arrives', () => {
      const { log, rerender } = streamingLog();
      readerScrollsTo(log, 700);
      readerScrollsTo(log, 100);

      hookReturning([earlier, { ...thinking, reasoning: 'Scanning her orders, then the drug reference…' }]);
      rerender(<AiChatContent mode="workspace" patientUuid="p1" />);

      expect(log.scrollTop).toBe(100);
    });

    it('follows the stream again once the reader scrolls back to the bottom', () => {
      const { log, rerender } = streamingLog();
      readerScrollsTo(log, 700);
      readerScrollsTo(log, 100);
      readerScrollsTo(log, 690);

      hookReturning([earlier, { ...thinking, reasoning: 'Scanning her orders, then the drug reference…' }]);
      rerender(<AiChatContent mode="workspace" patientUuid="p1" />);

      expect(log.scrollTop).toBe(1000);
    });

    it('jumps to a question the reader has just asked, wherever they had scrolled', () => {
      const { log, rerender } = streamingLog();
      readerScrollsTo(log, 700);
      readerScrollsTo(log, 100);

      hookReturning([earlier, { ...thinking, phase: 'complete', answer: 'Done.' }, { ...thinking, id: 'm3' }]);
      rerender(<AiChatContent mode="workspace" patientUuid="p1" />);

      expect(log.scrollTop).toBe(1000);
    });
  });
});

describe('reader position through asynchronous completion', () => {
  it('leaves earlier content in view when review and In-Depth finish', () => {
    const current = message({
      answer: 'Shown answer.',
      phase: 'checking',
      answerValidation: { status: 'checking', label: 'Checking answer' },
    });
    const hookReturns = (last: Record<string, unknown>, awaiting: boolean) =>
      mockUseChartSearchAi.mockReturnValue({
        messages: [message({ id: 'earlier', answer: 'Earlier answer.', phase: 'complete' }), last],
        isAwaitingAnswer: awaiting,
        submitQuestion: mockSubmitQuestion,
        stopCurrent: mockStopCurrent,
        clearMessages: vi.fn(),
        startNewChatSession: mockStartNewChatSession,
      });
    hookReturns(current, true);
    const { rerender } = render(<AiChatContent mode="workspace" patientUuid="p1" />);
    const log = screen.getByRole('log');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 });
    log.scrollTop = 700;
    fireEvent.scroll(log);
    log.scrollTop = 100;
    fireEvent.scroll(log);
    hookReturns(
      {
        ...current,
        phase: 'in-depth',
        answerValidation: { status: 'checked', label: 'Checked' },
        inDepth: { status: 'pending', answer: '' },
      },
      false,
    );
    rerender(<AiChatContent mode="workspace" patientUuid="p1" />);
    expect(log.scrollTop).toBe(100);
    hookReturns(
      {
        ...current,
        phase: 'complete',
        answerValidation: { status: 'checked', label: 'Checked' },
        inDepth: { status: 'complete', answer: 'Completed In-Depth.' },
      },
      false,
    );
    rerender(<AiChatContent mode="workspace" patientUuid="p1" />);
    expect(log.scrollTop).toBe(100);
  });
});
