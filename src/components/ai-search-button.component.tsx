import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WatsonHealthAiResults } from '@carbon/react/icons';
import { useConfig, usePatient, useStore } from '@openmrs/esm-framework';
import { warmupPatient } from '../api/chartsearchai';
import { type ChartSearchAiConfig } from '../config-schema';
import { chatSessionStore } from '../store/chat-session.store';
import AiSearchPanel from './ai-search-panel.component';
import styles from './ai-search-button.scss';

const AiSearchButton: React.FC = () => {
  const { patientUuid } = usePatient();
  const { t } = useTranslation();
  const { chatLaunchMode } = useConfig<ChartSearchAiConfig>();
  const { selectedProviderId, providerByPatient } = useStore(chatSessionStore);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const effectiveProviderId = (patientUuid ? providerByPatient?.[patientUuid] : undefined) ?? selectedProviderId;

  // Pre-warm the server-side LLM prompt cache on patient open when the bundled
  // provider is in use. The cleanup aborts an in-flight warmup if the user
  // switches patients or providers before it finishes — server-side stale-skip
  // handles late completions, but cancelling saves a server-thread hop and a DB
  // hit per discarded warmup.
  useEffect(() => {
    if (!patientUuid || effectiveProviderId === 'hub') return;
    const controller = new AbortController();
    warmupPatient(patientUuid, controller.signal);
    return () => controller.abort();
  }, [patientUuid, effectiveProviderId]);

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
