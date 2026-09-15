import { createGlobalStore, getSessionStore } from '@openmrs/esm-framework';
import type { ChatMessage } from '../hooks/useChartSearchAi';

export interface ChatSessionState {
  messagesByPatient: Record<string, ChatMessage[]>;
  /**
   * Whether the reader wants an answer's reasoning disclosure open, remembered for the session so
   * the choice costs one click rather than one per answer.
   *
   * `undefined` is NOT `false`. It means no preference has been expressed, and each disclosure
   * then follows its phase: open while the model is still reasoning (the progress indicator the
   * live text was added to be), collapsed once the answer is on screen. An explicit `false` is a
   * reader saying "keep it shut", and closes it in both phases.
   *
   * Only the preference lives here. The reasoning text itself is on the message, and neither is
   * ever written to browser storage — it reasons over chart records.
   */
  reasoningExpanded?: boolean;
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
      // The preference goes with the history: an O3 workstation is shared, and the next user has
      // expressed no view on whether the model's working notes should be open.
      chatSessionStore.setState({ messagesByPatient: {}, reasoningExpanded: undefined });
      previousUserUuid = currentUserUuid;
    }
  });
}
