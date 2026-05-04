import React, { type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { WatsonHealthAiResults } from '@carbon/react/icons';
import { ActionMenuButton2, useConfig, userHasAccess, useSession } from '@openmrs/esm-framework';
import { type ChartSearchAiConfig } from '../config-schema';

// Privilege is gated in JSX rather than via routes.json because workspaceWindows2
// entries don't accept a `privilege` field — only `extensions` entries do. Since this
// button is mounted by the framework as the window's icon (not as an extension), the
// only place to enforce the privilege is here.
function AiChatActionButton() {
  const { t } = useTranslation();
  const { chatLaunchMode } = useConfig<ChartSearchAiConfig>();
  const session = useSession();

  if (chatLaunchMode === 'floating' || !session?.user || !userHasAccess('AI Query Patient Data', session.user)) {
    return null;
  }

  return (
    <ActionMenuButton2
      icon={(props: ComponentProps<typeof WatsonHealthAiResults>) => <WatsonHealthAiResults {...props} />}
      label={t('askAi', 'Ask AI')}
      workspaceToLaunch={{
        workspaceName: 'ai-chat-workspace',
      }}
    />
  );
}

export default AiChatActionButton;
