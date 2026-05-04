import { defineConfigSchema, getAsyncLifecycle, getSyncLifecycle } from '@openmrs/esm-framework';
import { configSchema } from './config-schema';
import aiChatActionButtonComponent from './components/ai-chat-action-button.component';

const moduleName = '@openmrs/esm-chartsearchai-app';
const options = { featureName: 'chartsearchai', moduleName };

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

export function startupApp() {
  defineConfigSchema(moduleName, configSchema);
}

export const aiSearchButton = getAsyncLifecycle(() => import('./components/ai-search-button.component'), options);

export const aiChatWorkspace = getAsyncLifecycle(() => import('./components/ai-chat-workspace.component'), options);

export const aiChatActionButton = getSyncLifecycle(aiChatActionButtonComponent, options);
