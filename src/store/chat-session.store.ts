import { createGlobalStore, getSessionStore } from '@openmrs/esm-framework';
import type { ChatMessage } from '../hooks/useChartSearchAi';

export interface ChatSessionState {
  messagesByPatient: Record<string, ChatMessage[]>;
}

export const chatSessionStore = createGlobalStore<ChatSessionState>('chartsearchai-chat-session', {
  messagesByPatient: {},
});

export function setupChatSessionLogoutCleanup(): () => void {
  const sessionStore = getSessionStore();
  const readUserUuid = (state = sessionStore.getState()) => (state.loaded ? state.session?.user?.uuid : undefined);
  let previousUserUuid = readUserUuid();
  return sessionStore.subscribe((state) => {
    const currentUserUuid = readUserUuid(state);
    if (currentUserUuid !== previousUserUuid) {
      chatSessionStore.setState({ messagesByPatient: {} });
      previousUserUuid = currentUserUuid;
    }
  });
}
