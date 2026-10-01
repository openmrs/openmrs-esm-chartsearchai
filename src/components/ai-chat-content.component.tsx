import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfig, usePatient } from '@openmrs/esm-framework';
import { Add, Close, Maximize, Microphone, MicrophoneFilled, Minimize, Send, StopFilled } from '@carbon/react/icons';
import { Button, IconButton, InlineLoading } from '@carbon/react';
import { useChartSearchAi } from '../hooks/useChartSearchAi';
import { isAwaitingAnswer as isPhaseAwaiting } from '../hooks/turn-phase';
import { answerLimitsOf } from '../utils/answer-limits';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { type ChartSearchAiConfig } from '../config-schema';
import AiReasoningDisclosure from './ai-reasoning-disclosure.component';
import AiResponsePanel from './ai-response-panel.component';
import ModelPicker from './model-picker.component';
import ProviderPicker from './provider-picker.component';
import styles from './ai-chat-content.scss';

interface AiChatContentProps {
  mode: 'floating' | 'workspace';
  onClose?: () => void;
  patientUuid?: string;
  /** Floating mode only: whether the panel is maximized to full screen. */
  isExpanded?: boolean;
  /** Floating mode only: toggle the maximized state. When omitted, the maximize control is hidden. */
  onToggleExpand?: () => void;
}

const AiChatContent: React.FC<AiChatContentProps> = ({
  mode,
  onClose,
  patientUuid: patientUuidProp,
  isExpanded = false,
  onToggleExpand,
}) => {
  const { t } = useTranslation();
  const config = useConfig<ChartSearchAiConfig>();
  const { patient, isLoading: isPatientLoading } = usePatient();
  const patientUuid = patientUuidProp ?? patient?.id;

  const [question, setQuestion] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const historyAreaRef = useRef<HTMLDivElement>(null);

  const { messages, isAwaitingAnswer, submitQuestion, stopCurrent, startNewChatSession } =
    useChartSearchAi(patientUuid);

  const questionRef = useRef(question);
  questionRef.current = question;

  const handleSpeechResult = useCallback(
    (transcript: string) => {
      const existing = questionRef.current.trimEnd();
      const fullQuestion = existing ? existing + ' ' + transcript : transcript;
      const trimmed = fullQuestion.trim();
      if (trimmed && patientUuid && !isAwaitingAnswer) {
        submitQuestion(patientUuid, trimmed);
        setQuestion('');
      } else {
        setQuestion(fullQuestion);
      }
    },
    [patientUuid, isAwaitingAnswer, submitQuestion],
  );

  const {
    isListening,
    isSupported: isSpeechSupported,
    error: speechError,
    startListening,
    stopListening,
    clearError: clearSpeechError,
  } = useSpeechRecognition(handleSpeechResult);

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmedQuestion = question.trim();
      if (!trimmedQuestion || !patientUuid || isAwaitingAnswer) return;
      clearSpeechError();
      submitQuestion(patientUuid, trimmedQuestion);
      setQuestion('');
    },
    [question, patientUuid, isAwaitingAnswer, submitQuestion, clearSpeechError],
  );

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handlePanelKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (mode !== 'floating') return;

      if (e.key === 'Escape') {
        onClose?.();
        return;
      }

      // The docked panel is non-modal: keyboard users must still be able to reach the patient chart.
      // Only the expanded panel has a backdrop and traps focus as a modal dialog.
      if (!isExpanded || e.key !== 'Tab' || !rootRef.current) return;

      const focusable = rootRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [isExpanded, mode, onClose],
  );

  // Whether the history follows new content to the bottom. Only the reader moves it: a scroll UP that
  // leaves the bottom unpins, and reaching the bottom again re-pins. Decided on scroll events rather
  // than on where the view sits when a chunk lands, because content growing under a pinned view also
  // leaves it short of the bottom. Before this, every streamed chunk re-set scrollTop, so a reader
  // scrolling back through earlier answers was pulled down again within a chunk.
  const pinnedToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const handleHistoryScroll = useCallback(() => {
    const el = historyAreaRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 16;
    if (atBottom) {
      pinnedToBottomRef.current = true;
    } else if (el.scrollTop < lastScrollTopRef.current) {
      pinnedToBottomRef.current = false;
    }
    lastScrollTopRef.current = el.scrollTop;
  }, []);

  const prevMessagesLengthRef = useRef(0);
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current && historyAreaRef.current) {
      // A question just asked is what the reader wants to see, wherever they had scrolled to.
      pinnedToBottomRef.current = true;
      historyAreaRef.current.scrollTop = historyAreaRef.current.scrollHeight;
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages.length]);

  // Re-scrolls per chunk and again when streaming ends — references and the feedback row mount
  // in that final commit and grow the message past the viewport.
  //
  // Tracks `reasoning` too: it streams before any answer text exists, so without it the live
  // "Thinking..." scratchpad grows past the viewport and is clipped out of sight.
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined;
  const lastAnswer = lastMessage?.answer ?? '';
  const lastReasoning = lastMessage?.reasoning ?? '';
  const lastPreliminary = lastMessage?.preliminaryReasoning ?? '';
  // In-depth arrives after the answer settles; track it so it keeps the transcript scrolled to
  // the bottom too.
  const lastInDepth = lastMessage?.inDepth?.answer ?? '';
  useEffect(() => {
    if (historyAreaRef.current && pinnedToBottomRef.current) {
      historyAreaRef.current.scrollTop = historyAreaRef.current.scrollHeight;
    }
  }, [
    lastAnswer,
    lastReasoning,
    lastPreliminary,
    lastInDepth,
    lastMessage?.phase,
    lastMessage?.answerValidation?.status,
  ]);

  // When an answer finishes and the reader is still following it, a message taller than the history area
  // is aligned to its TOP, not its bottom: following the stream to the bottom suits text as it arrives,
  // but a finished answer with a safety box under it would otherwise open on the end of that box, with
  // the answer itself scrolled out of view above. A message that fits stays where the line above put it.
  // After that effect, so it overrides it in the same commit.
  const prevIsAnyLoadingForScrollRef = useRef(false);
  useEffect(() => {
    const el = historyAreaRef.current;
    if (el && prevIsAnyLoadingForScrollRef.current && !isAwaitingAnswer && pinnedToBottomRef.current) {
      const pairs = el.querySelectorAll('[data-message-pair]');
      const last = pairs.length > 0 ? pairs[pairs.length - 1] : null;
      if (last) {
        const message = last.getBoundingClientRect();
        if (message.height > el.clientHeight) {
          el.scrollTop += message.top - el.getBoundingClientRect().top;
        }
      }
    }
    prevIsAnyLoadingForScrollRef.current = isAwaitingAnswer;
  }, [isAwaitingAnswer]);

  const hasCompletedAnswer = messages.some((m) => !isPhaseAwaiting(m.phase) && m.answer);

  // Return focus to the composer as soon as the answer SETTLES (so the next question can be typed
  // while in-depth still streams), not after the whole turn (incl. in-depth) finishes.
  const prevAwaitingRef = useRef(false);
  useEffect(() => {
    if (prevAwaitingRef.current && !isAwaitingAnswer) {
      inputRef.current?.focus();
    }
    prevAwaitingRef.current = isAwaitingAnswer;
  }, [isAwaitingAnswer]);

  const handleMicClick = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, stopListening, startListening]);

  const handleFeedbackComplete = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const handleNewChat = useCallback(() => {
    if (!patientUuid) return;
    startNewChatSession(patientUuid);
    setQuestion('');
    inputRef.current?.focus();
  }, [patientUuid, startNewChatSession]);

  // A provider switch starts a fresh conversation: the backend attributes each
  // conversation to a single provider and closes it on switch.
  const handleProviderSwitched = useCallback(() => {
    if (!patientUuid) return;
    startNewChatSession(patientUuid);
  }, [patientUuid, startNewChatSession]);

  return (
    <div
      className={`${styles.chatRoot} ${mode === 'floating' ? styles.chatRootFloating : styles.chatRootWorkspace} ${
        mode === 'floating' && isExpanded ? styles.chatRootFloatingExpanded : ''
      }`}
      ref={rootRef}
      role={mode === 'floating' ? 'dialog' : undefined}
      aria-modal={mode === 'floating' && isExpanded ? true : undefined}
      aria-label={mode === 'floating' ? t('aiChartSearch', 'AI Chart Search') : undefined}
      onKeyDown={handlePanelKeyDown}
    >
      {mode === 'floating' && (
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>
            <span className={styles.sparkle}>&#10024;</span>
            {t('aiChartSearch', 'AI Chart Search')}
          </span>
          <span className={styles.panelHeaderActions}>
            <IconButton
              kind="ghost"
              size="sm"
              align="bottom"
              label={t('newChat', 'New chat')}
              onClick={handleNewChat}
              disabled={!patientUuid}
            >
              <Add size={16} />
            </IconButton>
            {onToggleExpand && (
              <IconButton
                kind="ghost"
                size="sm"
                align="bottom"
                label={isExpanded ? t('restore', 'Restore') : t('maximize', 'Maximize')}
                onClick={onToggleExpand}
              >
                {isExpanded ? <Minimize size={16} /> : <Maximize size={16} />}
              </IconButton>
            )}
            <IconButton kind="ghost" size="sm" align="bottom-end" label={t('close', 'Close')} onClick={onClose}>
              <Close size={16} />
            </IconButton>
          </span>
        </div>
      )}
      {mode === 'workspace' && (
        <div className={styles.workspaceActions}>
          <Button kind="ghost" size="sm" renderIcon={Add} onClick={handleNewChat} disabled={!patientUuid}>
            {t('newChat', 'New chat')}
          </Button>
        </div>
      )}

      <div
        className={styles.historyArea}
        ref={historyAreaRef}
        role="log"
        aria-live="polite"
        onScroll={handleHistoryScroll}
      >
        {messages.length === 0 && !isPatientLoading && patientUuid && (
          <p className={styles.emptyState}>{t('askAiAboutPatient', 'Ask AI about this patient')}</p>
        )}

        {!isPatientLoading && !patientUuid && (
          <p className={styles.infoText}>{t('noPatientSelected', 'No patient selected')}</p>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={styles.messagePair} data-message-pair>
            <div className={styles.questionBubble}>{msg.question}</div>
            <div className={styles.answerBubble}>
              {isPhaseAwaiting(msg.phase) && !msg.answer && (
                <div>
                  <InlineLoading description={t('thinkingEllipsis', 'Thinking...')} />
                  {/* Provisional preview reasoning, shown only until the committed reasoning/answer
                      arrives (the hook then clears preliminaryReasoning). Labelled so a clinician
                      knows it may change. Gets no disclosure of its own, unlike the committed
                      reasoning below: it is superseded within the same answer, so there would be
                      nothing behind the row by the time a reader could open it. */}
                  {!msg.reasoning && msg.preliminaryReasoning && (
                    <p className={styles.preliminaryReasoning}>
                      <span className={styles.preliminaryLabel}>
                        {t('preliminaryReasoning', 'Reviewing the most relevant records…')}
                      </span>{' '}
                      {msg.preliminaryReasoning}
                    </p>
                  )}
                </div>
              )}
              <AiResponsePanel
                answer={msg.answer}
                references={msg.references}
                safetyWarnings={msg.safetyWarnings}
                {...answerLimitsOf(msg)}
                error={msg.error}
                phase={msg.phase}
                safetyStatus={msg.safetyStatus}
                safetyCheck={msg.safetyCheck}
                blocks={msg.blocks}
                confidence={msg.confidence}
                answerValidation={msg.answerValidation}
                inDepth={msg.inDepth}
                auditLogId={msg.auditLogId}
                resolvedModel={msg.resolvedModel}
                patientUuid={patientUuid ?? ''}
                onFeedbackComplete={handleFeedbackComplete}
              />
              {/* After the answer so retained working notes do not precede clinical output. Outside
                  AiResponsePanel on purpose: that panel returns early on an error with no answer,
                  and an errored run is the case where "what was it doing?" is worth most.
                  The config test is not the hook's: the hook decides whether reasoning is
                  ingested at all, this decides whether a transcript already on a message —
                  one that predates an operator flipping the flag off — is still offered. */}
              {config.showReasoning && msg.reasoning && (
                <AiReasoningDisclosure
                  reasoning={msg.reasoning}
                  isStreaming={isPhaseAwaiting(msg.phase) && !msg.answer}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {hasCompletedAnswer && (
        <p className={styles.disclaimer}>
          {t(
            'aiDisclaimerText',
            "This response is AI-generated and may not be accurate. It is not a substitute for clinical judgment. Always verify against the patient's medical records.",
          )}
        </p>
      )}

      {speechError && (
        <p className={styles.speechError}>
          {speechError === 'not-allowed'
            ? t('microphonePermissionDenied', 'Microphone access was denied. Please allow microphone permissions.')
            : t('speechRecognitionError', 'Speech recognition failed. Please try again.')}
        </p>
      )}

      <div className={styles.modelPickerRow}>
        <ProviderPicker onSwitched={handleProviderSwitched} />
        <ModelPicker />
      </div>

      <form className={styles.inputArea} onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className={styles.searchInput}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={config.aiSearchPlaceholder}
          maxLength={config.maxQuestionLength}
          disabled={isAwaitingAnswer}
          autoFocus={mode === 'floating'}
        />
        {isSpeechSupported && !isAwaitingAnswer && (
          <button
            className={`${styles.micButton} ${isListening ? styles.micButtonActive : ''}`}
            onClick={handleMicClick}
            aria-label={isListening ? t('stopListening', 'Stop listening') : t('voiceInput', 'Voice input')}
            title={isListening ? t('stopListening', 'Stop listening') : t('voiceInput', 'Voice input')}
            type="button"
            disabled={!patientUuid}
          >
            {isListening ? <MicrophoneFilled size={20} /> : <Microphone size={20} />}
          </button>
        )}
        {isAwaitingAnswer ? (
          <button
            className={styles.actionButton}
            onClick={stopCurrent}
            aria-label={t('stop', 'Stop')}
            title={t('stop', 'Stop')}
            type="button"
          >
            <StopFilled size={20} />
          </button>
        ) : (
          <button
            className={styles.actionButton}
            type="submit"
            aria-label={t('send', 'Send')}
            title={t('send', 'Send')}
            disabled={!question.trim() || !patientUuid}
          >
            <Send size={20} />
          </button>
        )}
      </form>
    </div>
  );
};

export default AiChatContent;
