import { createGlobalStore, getSessionStore } from '@openmrs/esm-framework';
import type { ChatMessage } from '../hooks/useChartSearchAi';

export interface ChatSessionState {
  messagesByPatient: Record<string, ChatMessage[]>;
  /**
   * Server-pinned conversation handle per patient. Captured from the
   * X-ChartSearchAi-Session response header on the first chat POST, then
   * threaded into every subsequent post for the same patient. Cleared on
   * logout (see {@link setupChatSessionLogoutCleanup}) and on "New chat".
   */
  sessionUuidByPatient: Record<string, string | null>;
  /** Hub product profile selected for this browser session. */
  selectedProfileId: string | null;
  /** Whether product-profile discovery can safely authorize a chat request. */
  profileDiscoveryStatus: 'loading' | 'ready' | 'unavailable';
  /**
   * Clinical-answer provider selected for this browser session. Null means the
   * backend applies its configured default (bundled on a fresh install); it is
   * never a silent cross-provider fallback.
   */
  selectedProviderId: string | null;
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
  sessionUuidByPatient: {},
  selectedProfileId: null,
  profileDiscoveryStatus: 'loading',
  selectedProviderId: null,
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
      chatSessionStore.setState({
        messagesByPatient: {},
        sessionUuidByPatient: {},
        selectedProfileId: null,
        profileDiscoveryStatus: 'loading',
        selectedProviderId: null,
        reasoningExpanded: undefined,
      });
      previousUserUuid = currentUserUuid;
    }
  });
}
