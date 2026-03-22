import React, { useCallback, useRef, useState } from 'react';
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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleClear = useCallback(() => {
    clearResults();
    setQuestion('');
    inputRef.current?.focus();
  }, [clearResults]);

  return (
    <div className={styles.panelContainer}>
      <div className={styles.panel}>
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
          <div className={styles.responseArea}>
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
            onKeyDown={handleKeyDown}
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
