import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WatsonHealthAiResults } from '@carbon/react/icons';
import { usePatient } from '@openmrs/esm-framework';
import AiSearchPanel from './ai-search-panel.component';
import styles from './ai-search-button.scss';

const AiSearchButton: React.FC = () => {
  const { patientUuid } = usePatient();
  const { t } = useTranslation();
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const togglePanel = useCallback(() => {
    setIsPanelOpen((prev) => !prev);
  }, []);

  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
  }, []);

  if (!patientUuid) {
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
