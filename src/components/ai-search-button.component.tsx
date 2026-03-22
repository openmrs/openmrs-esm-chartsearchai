import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { WatsonHealthAiResults } from '@carbon/react/icons';
import AiSearchPanel from './ai-search-panel.component';
import styles from './ai-search-button.scss';

const PORTAL_CONTAINER_ID = 'chartsearchai-portal';

const AiSearchButton: React.FC = () => {
  const { t } = useTranslation();
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const portalContainerRef = useRef<HTMLDivElement | null>(null);

  if (!portalContainerRef.current) {
    const container = document.createElement('div');
    container.id = PORTAL_CONTAINER_ID;
    portalContainerRef.current = container;
  }

  useEffect(() => {
    const container = portalContainerRef.current!;
    document.body.appendChild(container);
    return () => {
      container.remove();
    };
  }, []);

  const togglePanel = useCallback(() => {
    setIsPanelOpen((prev) => !prev);
  }, []);

  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
  }, []);

  return createPortal(
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
    portalContainerRef.current!,
  );
};

export default AiSearchButton;
