import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfig, usePatient } from '@openmrs/esm-framework';
import { Close, Send, StopFilled } from '@carbon/react/icons';
import { InlineLoading } from '@carbon/react';
import { useChartSearchAi } from '../hooks/useChartSearchAi';
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
  const responseAreaRef = useRef<HTMLDivElement>(null);

  const { answer, disclaimer, references, isLoading, error, submitQuestion, clearResults } = useChartSearchAi();

  const hasResponse = answer || error;

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmedQuestion = question.trim();
      if (!trimmedQuestion || !patient?.id || isLoading) return;
      submitQuestion(patient.id, trimmedQuestion);
    },
    [question, patient?.id, isLoading, submitQuestion],
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
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
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

  useEffect(() => {
    if (isLoading && responseAreaRef.current) {
      responseAreaRef.current.scrollTop = responseAreaRef.current.scrollHeight;
    }
  }, [isLoading, answer]);

  const handleClear = useCallback(() => {
    clearResults();
    setQuestion('');
    inputRef.current?.focus();
  }, [clearResults]);

  return (
    <div className={styles.panelContainer}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dialog needs onKeyDown for focus trap and Escape handling */}
      <div
        className={styles.panel}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
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

        {hasResponse && (
          <div className={styles.responseArea} ref={responseAreaRef} role="log" aria-live="polite">
            <AiResponsePanel
              answer={answer}
              disclaimer={disclaimer}
              references={references}
              error={error}
              isLoading={isLoading}
              patientUuid={patient?.id ?? ''}
            />
          </div>
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
            disabled={isLoading}
            autoFocus
          />
          {isLoading ? (
            <button className={styles.actionButton} onClick={clearResults} aria-label={t('stop', 'Stop')} type="button">
              <StopFilled size={20} />
            </button>
          ) : hasResponse ? (
            <button
              className={styles.actionButton}
              onClick={handleClear}
              aria-label={t('clearAndAskNew', 'Clear and ask new question')}
              type="button"
            >
              <Close size={20} />
            </button>
          ) : (
            <button
              className={styles.actionButton}
              type="submit"
              aria-label={t('send', 'Send')}
              disabled={!question.trim() || !patient?.id}
            >
              <Send size={20} />
            </button>
          )}
        </form>

        {isLoading && !answer && (
          <div className={styles.loadingArea}>
            <InlineLoading description={t('thinkingEllipsis', 'Thinking...')} />
          </div>
        )}

        {!isPatientLoading && !patient?.id && (
          <div className={styles.loadingArea}>
            <p className={styles.noPatientText}>{t('noPatientSelected', 'No patient selected')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AiSearchPanel;
