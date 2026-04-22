import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfig, usePatient } from '@openmrs/esm-framework';
import { Close, Microphone, MicrophoneFilled, Send, StopFilled } from '@carbon/react/icons';
import { InlineLoading } from '@carbon/react';
import { useChartSearchAi } from '../hooks/useChartSearchAi';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { type ChartSearchAiConfig } from '../config-schema';
import AiResponsePanel from './ai-response-panel.component';
import styles from './ai-search-panel.scss';

interface AiSearchPanelProps {
  onClose: () => void;
}

const AiSearchPanel: React.FC<AiSearchPanelProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const config = useConfig<ChartSearchAiConfig>();
  const { patient, isLoading: isPatientLoading } = usePatient();
  const [question, setQuestion] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const historyAreaRef = useRef<HTMLDivElement>(null);

  const { messages, isAnyLoading, submitQuestion, stopCurrent } = useChartSearchAi();

  const questionRef = useRef(question);
  questionRef.current = question;

  const pendingSpeechSubmitRef = useRef(false);

  const handleSpeechResult = useCallback((transcript: string) => {
    const existing = questionRef.current.trimEnd();
    const fullQuestion = existing ? existing + ' ' + transcript : transcript;
    setQuestion(fullQuestion);
    pendingSpeechSubmitRef.current = true;
  }, []);

  useEffect(() => {
    if (!pendingSpeechSubmitRef.current) return;
    pendingSpeechSubmitRef.current = false;
    const trimmed = question.trim();
    if (trimmed && patient?.id && !isAnyLoading) {
      submitQuestion(patient.id, trimmed);
      setQuestion('');
    }
  }, [question, patient?.id, isAnyLoading, submitQuestion]);

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
      if (!trimmedQuestion || !patient?.id || isAnyLoading) return;
      clearSpeechError();
      submitQuestion(patient.id, trimmedQuestion);
      setQuestion('');
    },
    [question, patient?.id, isAnyLoading, submitQuestion, clearSpeechError],
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
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key !== 'Tab' || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
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
    [onClose],
  );

  // Scroll to bottom when a new message is submitted
  const prevMessagesLengthRef = useRef(0);
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current && historyAreaRef.current) {
      historyAreaRef.current.scrollTop = historyAreaRef.current.scrollHeight;
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages.length]);

  // Scroll to bottom while tokens are streaming in
  const lastAnswer = messages.length > 0 ? messages[messages.length - 1].answer : '';
  useEffect(() => {
    if (isAnyLoading && historyAreaRef.current) {
      historyAreaRef.current.scrollTop = historyAreaRef.current.scrollHeight;
    }
  }, [lastAnswer, isAnyLoading]);

  // Scroll to bottom when the response completes (to reveal full answer)
  useEffect(() => {
    if (!isAnyLoading && historyAreaRef.current) {
      historyAreaRef.current.scrollTop = historyAreaRef.current.scrollHeight;
    }
  }, [isAnyLoading]);

  // Refocus input after loading completes
  const prevIsAnyLoadingRef = useRef(false);
  useEffect(() => {
    if (prevIsAnyLoadingRef.current && !isAnyLoading) {
      inputRef.current?.focus();
    }
    prevIsAnyLoadingRef.current = isAnyLoading;
  }, [isAnyLoading]);

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

  const hasCompletedAnswer = messages.some((m) => !m.isLoading && m.answer);

  return (
    <div className={styles.panelContainer}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dialog needs onKeyDown for focus trap and Escape handling */}
      <div
        className={styles.panel}
        ref={panelRef}
        role="dialog"
        aria-label={t('aiChartSearch', 'AI Chart Search')}
        onKeyDown={handlePanelKeyDown}
      >
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>
            <span className={styles.sparkle}>&#10024;</span>
            {t('aiChartSearch', 'AI Chart Search')}
          </span>
          <button className={styles.closeButton} onClick={onClose} aria-label={t('close', 'Close')} type="button">
            <Close size={16} />
          </button>
        </div>

        <div className={styles.historyArea} ref={historyAreaRef} role="log" aria-live="polite">
          {messages.length === 0 && !isPatientLoading && patient?.id && (
            <p className={styles.emptyState}>{t('askAiAboutPatient', 'Ask AI about this patient')}</p>
          )}

          {!isPatientLoading && !patient?.id && (
            <p className={styles.infoText}>{t('noPatientSelected', 'No patient selected')}</p>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={styles.messagePair}>
              <div className={styles.questionBubble}>{msg.question}</div>
              <div className={styles.answerBubble}>
                <AiResponsePanel
                  answer={msg.answer}
                  references={msg.references}
                  questionId={msg.questionId}
                  error={msg.error}
                  isLoading={msg.isLoading}
                  patientUuid={patient?.id ?? ''}
                  onFeedbackComplete={handleFeedbackComplete}
                />
                {msg.isLoading && !msg.answer && <InlineLoading description={t('thinkingEllipsis', 'Thinking...')} />}
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
            disabled={isAnyLoading}
            autoFocus
          />
          {isSpeechSupported && !isAnyLoading && (
            <button
              className={`${styles.micButton} ${isListening ? styles.micButtonActive : ''}`}
              onClick={handleMicClick}
              aria-label={isListening ? t('stopListening', 'Stop listening') : t('voiceInput', 'Voice input')}
              title={isListening ? t('stopListening', 'Stop listening') : t('voiceInput', 'Voice input')}
              type="button"
              disabled={!patient?.id}
            >
              {isListening ? <MicrophoneFilled size={20} /> : <Microphone size={20} />}
            </button>
          )}
          {isAnyLoading ? (
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
              disabled={!question.trim() || !patient?.id}
            >
              <Send size={20} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
};

export default AiSearchPanel;
