import React from 'react';
import { useTranslation } from 'react-i18next';
import { Workspace2 } from '@openmrs/esm-framework';
import { type PatientChartWorkspaceActionButtonProps } from '../types';
import AiChatContent from './ai-chat-content.component';

const AiChatWorkspace: React.FC<PatientChartWorkspaceActionButtonProps> = ({ groupProps: { patientUuid } }) => {
  const { t } = useTranslation();

  return (
    <Workspace2 title={t('aiChartSearch', 'AI Chart Search')} hasUnsavedChanges={false}>
      <AiChatContent mode="workspace" patientUuid={patientUuid} />
    </Workspace2>
  );
};

export default AiChatWorkspace;
