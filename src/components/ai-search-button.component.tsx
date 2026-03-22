import React, { useCallback, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { WatsonHealthAiResults } from '@carbon/react/icons';
import AiSearchPanel from './ai-search-panel.component';
import styles from './ai-search-button.scss';

const PORTAL_CONTAINER_ID = 'chartsearchai-portal';

function getPortalContainer(): HTMLElement {
  let container = document.getElementById(PORTAL_CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = PORTAL_CONTAINER_ID;
    document.body.appendChild(container);
  }
  return container;
}

const AiSearchButton: React.FC = () => {
  const { t } = useTranslation();
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const portalContainer = useMemo(() => getPortalContainer(), []);

  const togglePanel = useCallback(() => {
    setIsPanelOpen((prev) => !prev);
  }, []);

  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
  }, []);

  return ReactDOM.createPortal(
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
    </>,
    portalContainer,
  );
};

export default AiSearchButton;
