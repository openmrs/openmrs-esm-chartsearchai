import React from 'react';
import AiChatContent from './ai-chat-content.component';
import styles from './ai-search-panel.scss';

interface AiSearchPanelProps {
  onClose: () => void;
}

const AiSearchPanel: React.FC<AiSearchPanelProps> = ({ onClose }) => {
  return (
    <div className={styles.panelContainer}>
      <AiChatContent mode="floating" onClose={onClose} />
    </div>
  );
};

export default AiSearchPanel;
