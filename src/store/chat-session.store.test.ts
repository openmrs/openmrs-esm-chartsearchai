import { beforeEach, describe, expect, it } from 'vitest';
import { NO_ANSWER_LIMITS } from '../utils/answer-limits';
import { getSessionStore } from '@openmrs/esm-framework';
import { chatSessionStore, initialChatSessionState, setupChatSessionLogoutCleanup } from './chat-session.store';

const sessionStore = getSessionStore();

const seedSession = () =>
  chatSessionStore.setState({
    messagesByPatient: {
      'patient-1': [
        {
          id: 'm1',
          question: 'q',
          answer: 'a',
          references: [],
          safetyWarnings: [],
          ...NO_ANSWER_LIMITS,
          questionId: '',
          isLoading: false,
          error: null,
          reasoning: '',
        },
      ],
    },
    sessionUuidByPatient: { 'patient-1': 'server-session-handle-1' },
    selectedProfileId: 'single-e4b-checked',
    selectedProviderId: 'hub',
    profileDiscoveryStatus: 'ready',
    reasoningExpanded: true,
  });

beforeEach(() => {
  chatSessionStore.setState(initialChatSessionState(), true);
  sessionStore.setState({ loaded: false, session: null });
});

describe('chatSessionStore initial state', () => {
  it('starts with no history, no handles, no selections and profile discovery loading', () => {
    expect(initialChatSessionState()).toStrictEqual({
      messagesByPatient: {},
      sessionUuidByPatient: {},
      selectedProfileId: null,
      profileDiscoveryStatus: 'loading',
      selectedProviderId: null,
    });
  });
});

describe('chatSessionStore logout cleanup', () => {
  it('clears all per-session state when the session transitions from a logged-in user to logged-out', () => {
    sessionStore.setState({
      loaded: true,
      session: { sessionId: 's1', authenticated: true, user: { uuid: 'user-1' } } as never,
    });

    const unsubscribe = setupChatSessionLogoutCleanup();
    seedSession();

    sessionStore.setState({
      loaded: true,
      session: { sessionId: '', authenticated: false } as never,
    });

    // Strictly the fresh state: a field the reset did not name would survive a merge.
    expect(chatSessionStore.getState()).toStrictEqual(initialChatSessionState());
    unsubscribe();
  });

  it('clears all per-session state when a different user logs in', () => {
    sessionStore.setState({
      loaded: true,
      session: { sessionId: 's1', authenticated: true, user: { uuid: 'user-1' } } as never,
    });

    const unsubscribe = setupChatSessionLogoutCleanup();
    seedSession();

    sessionStore.setState({
      loaded: true,
      session: { sessionId: 's2', authenticated: true, user: { uuid: 'user-2' } } as never,
    });

    // Cross-user leak vectors: server session handle and picked profile must not
    // bleed from user-1 into user-2's session, nor any field the reset did not name.
    expect(chatSessionStore.getState()).toStrictEqual(initialChatSessionState());
    unsubscribe();
  });

  it('does not clear when the same user remains logged in across session refreshes', () => {
    sessionStore.setState({
      loaded: true,
      session: { sessionId: 's1', authenticated: true, user: { uuid: 'user-1' } } as never,
    });

    const unsubscribe = setupChatSessionLogoutCleanup();
    seedSession();

    sessionStore.setState({
      loaded: true,
      session: { sessionId: 's1', authenticated: true, user: { uuid: 'user-1' } } as never,
    });

    const state = chatSessionStore.getState();
    expect(state.messagesByPatient).not.toEqual({});
    expect(state.sessionUuidByPatient).not.toEqual({});
    expect(state.selectedProfileId).not.toBeNull();
    expect(state.selectedProviderId).toBe('hub');
    expect(state.profileDiscoveryStatus).toBe('ready');
    expect(state.reasoningExpanded).toBe(true);
    unsubscribe();
  });
});
