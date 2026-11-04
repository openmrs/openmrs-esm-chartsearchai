import { defineConfigSchema, getAsyncLifecycle, getSyncLifecycle } from '@openmrs/esm-framework';
import { configSchema } from './config-schema';
import { withViewBoundary } from './omnibar-contract/view-boundary';
import aiChatActionButtonComponent from './components/ai-chat-action-button.component';
import { setupChatSessionLogoutCleanup } from './store/chat-session.store';

const moduleName = '@openmrs/esm-chartsearchai-app';
const options = { featureName: 'chartsearchai', moduleName };

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

export function startupApp() {
  defineConfigSchema(moduleName, configSchema);
  setupChatSessionLogoutCleanup();
}

export const aiSearchButton = getAsyncLifecycle(() => import('./components/ai-search-button.component'), options);

export const aiChatWorkspace = getAsyncLifecycle(() => import('./components/ai-chat-workspace.component'), options);

export const aiChatActionButton = getSyncLifecycle(aiChatActionButtonComponent, options);

// A section of the omnibar's Query results page. The boundary keeps a throw inside the section.
export const chartSearchQueryResultsView = getAsyncLifecycle(async () => {
  const { default: View } = await import('./query-results/chartsearch-answer.view');
  return { default: withViewBoundary(View, 'chartsearch-query-results-view') };
}, options);
