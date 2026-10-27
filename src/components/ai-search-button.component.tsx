import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WatsonHealthAiResults } from '@carbon/react/icons';
import { useConfig, usePatient } from '@openmrs/esm-framework';
import { type ChartSearchAiConfig } from '../config-schema';
import { warmupPatient } from '../api/chartsearchai';
import AiSearchPanel from './ai-search-panel.component';
import styles from './ai-search-button.scss';

const AiSearchButton: React.FC = () => {
  const { patientUuid } = usePatient();
  const { t } = useTranslation();
  const { chatLaunchMode } = useConfig<ChartSearchAiConfig>();
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // Pre-warm the server-side LLM prompt cache on patient open. The cleanup
  // aborts an in-flight warmup if the user switches patients before it
  // finishes — server-side stale-skip handles late completions, but cancelling
  // saves a server-thread hop and a DB hit per discarded warmup.
  useEffect(() => {
    if (!patientUuid) return;
    const controller = new AbortController();
    warmupPatient(patientUuid, controller.signal);
    return () => controller.abort();
  }, [patientUuid]);

  const togglePanel = useCallback(() => {
    setIsPanelOpen((prev) => !prev);
  }, []);

  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
  }, []);

  if (!patientUuid || chatLaunchMode === 'workspace') {
    return null;
  }

  return (
    <>
      <button
        className={`${styles.aiButton} ${isPanelOpen ? styles.aiButtonActive : ''}`}
        onClick={togglePanel}
        aria-label={t('aiSearch', 'AI Search')}
        title={t('askAiAboutPatient', 'Ask AI about this patient')}
        type="button"
      >
        <WatsonHealthAiResults size={20} />
      </button>
      {isPanelOpen && <AiSearchPanel onClose={closePanel} />}
    </>
  );
};

export default AiSearchButton;
