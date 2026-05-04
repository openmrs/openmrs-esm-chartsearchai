import { createGlobalStore } from '@openmrs/esm-framework';
import type { ChatMessage } from '../hooks/useChartSearchAi';

export interface ChatSessionState {
  messagesByPatient: Record<string, ChatMessage[]>;
}

export const chatSessionStore = createGlobalStore<ChatSessionState>('chartsearchai-chat-session', {
  messagesByPatient: {},
});
