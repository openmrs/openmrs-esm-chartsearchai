import { getAsyncLifecycle, defineConfigSchema } from '@openmrs/esm-framework';
import { configSchema } from './config-schema';

const moduleName = '@openmrs/esm-chartsearchai-app';
const options = { featureName: 'chartsearchai', moduleName };

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

export function startupApp() {
  defineConfigSchema(moduleName, configSchema);
}

// Floating AI button — appears on the patient chart page (bottom-right corner)
export const aiSearchButton = getAsyncLifecycle(
  () => import('./components/ai-search-button.component'),
  options,
);
