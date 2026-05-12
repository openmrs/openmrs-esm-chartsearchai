import { beforeEach, describe, expect, it } from 'vitest';
import { getSessionStore } from '@openmrs/esm-framework';
import { chatSessionStore, setupChatSessionLogoutCleanup } from './chat-session.store';

const sessionStore = getSessionStore();

const seedMessages = () =>
  chatSessionStore.setState({
    messagesByPatient: {
      'patient-1': [
        {
          id: 'm1',
          question: 'q',
          answer: 'a',
          references: [],
          questionId: '',
          isLoading: false,
          error: null,
        },
      ],
    },
  });

beforeEach(() => {
  chatSessionStore.setState({ messagesByPatient: {} });
  sessionStore.setState({ loaded: false, session: null });
});

describe('chatSessionStore logout cleanup', () => {
  it('clears messages when the session transitions from a logged-in user to logged-out', () => {
    sessionStore.setState({
      loaded: true,
      session: { sessionId: 's1', authenticated: true, user: { uuid: 'user-1' } } as never,
    });

    const unsubscribe = setupChatSessionLogoutCleanup();
    seedMessages();

    sessionStore.setState({
      loaded: true,
      session: { sessionId: '', authenticated: false } as never,
    });

    expect(chatSessionStore.getState().messagesByPatient).toEqual({});
    unsubscribe();
  });

  it('clears messages when a different user logs in', () => {
    sessionStore.setState({
      loaded: true,
      session: { sessionId: 's1', authenticated: true, user: { uuid: 'user-1' } } as never,
    });

    const unsubscribe = setupChatSessionLogoutCleanup();
    seedMessages();

    sessionStore.setState({
      loaded: true,
      session: { sessionId: 's2', authenticated: true, user: { uuid: 'user-2' } } as never,
    });

    expect(chatSessionStore.getState().messagesByPatient).toEqual({});
    unsubscribe();
  });

  it('does not clear when the same user remains logged in across session refreshes', () => {
    sessionStore.setState({
      loaded: true,
      session: { sessionId: 's1', authenticated: true, user: { uuid: 'user-1' } } as never,
    });

    const unsubscribe = setupChatSessionLogoutCleanup();
    seedMessages();

    sessionStore.setState({
      loaded: true,
      session: { sessionId: 's1', authenticated: true, user: { uuid: 'user-1' } } as never,
    });

    expect(chatSessionStore.getState().messagesByPatient).not.toEqual({});
    unsubscribe();
  });
});
