import { useCallback, useEffect, useRef } from 'react';
import { useConfig, useStore } from '@openmrs/esm-framework';
import {
  type AiReference,
  type AiSearchResponse,
  searchPatientChart,
  searchPatientChartStream,
} from '../api/chartsearchai';
import { type ChartSearchAiConfig } from '../config-schema';
import { chatSessionStore } from '../store/chat-session.store';

export interface ChatMessage {
  id: string;
  question: string;
  answer: string;
  references: AiReference[];
  questionId: string;
  isLoading: boolean;
  error: string | null;
}

interface UseChartSearchAiReturn {
  messages: ChatMessage[];
  isAnyLoading: boolean;
  submitQuestion: (patientUuid: string, question: string) => void;
  clearMessages: () => void;
  stopCurrent: () => void;
}

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

const EMPTY_MESSAGES: ChatMessage[] = [];

function updateMessages(patientUuid: string, updater: (prev: ChatMessage[]) => ChatMessage[]): void {
  const current = chatSessionStore.getState().messagesByPatient;
  const prev = current[patientUuid] ?? EMPTY_MESSAGES;
  const next = updater(prev);
  if (next === prev) return;
  chatSessionStore.setState({ messagesByPatient: { ...current, [patientUuid]: next } });
}

export function useChartSearchAi(patientUuid?: string): UseChartSearchAiReturn {
  const config = useConfig<ChartSearchAiConfig>();
  const { messagesByPatient } = useStore(chatSessionStore);
  const messages: ChatMessage[] = patientUuid ? (messagesByPatient[patientUuid] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES;
  const abortControllerRef = useRef<AbortController | null>(null);
  const inFlightMessageIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const clearMessages = useCallback(() => {
    if (patientUuid) {
      updateMessages(patientUuid, () => []);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    inFlightMessageIdRef.current = null;
  }, [patientUuid]);

  const stopCurrent = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const stoppedId = inFlightMessageIdRef.current;
    inFlightMessageIdRef.current = null;
    if (stoppedId && patientUuid) {
      updateMessages(patientUuid, (prev) => {
        const idx = prev.findIndex((m) => m.id === stoppedId);
        if (idx === -1) return prev;
        const msg = prev[idx];
        if (!msg.isLoading) return prev;
        if (!msg.answer) {
          return prev.filter((_, i) => i !== idx);
        }
        const updated = [...prev];
        updated[idx] = { ...msg, isLoading: false };
        return updated;
      });
    }
  }, [patientUuid]);

  const submitQuestion = useCallback(
    (patientUuid: string, question: string) => {
      if (abortControllerRef.current) return;

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const newMessage: ChatMessage = {
        id: generateId(),
        question,
        answer: '',
        references: [],
        questionId: '',
        isLoading: true,
        error: null,
      };

      updateMessages(patientUuid, (prev) => [...prev, newMessage]);
      const messageId = newMessage.id;
      inFlightMessageIdRef.current = messageId;

      const done = (response: AiSearchResponse) => {
        if (!isMountedRef.current) return;
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
        if (inFlightMessageIdRef.current === messageId) {
          inFlightMessageIdRef.current = null;
        }
        updateMessages(patientUuid, (prev) => {
          const idx = prev.findIndex((m) => m.id === messageId);
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            answer: response.answer,
            references: response.references,
            questionId: response.questionId ?? '',
            isLoading: false,
          };
          return updated;
        });
      };

      const fail = (errMessage: string) => {
        if (!isMountedRef.current) return;
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
        if (inFlightMessageIdRef.current === messageId) {
          inFlightMessageIdRef.current = null;
        }
        console.error('[useChartSearchAi] Request failed:', errMessage);
        updateMessages(patientUuid, (prev) => {
          const idx = prev.findIndex((m) => m.id === messageId);
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = { ...updated[idx], error: errMessage, isLoading: false };
          return updated;
        });
      };

      try {
        if (config.useStreaming) {
          searchPatientChartStream(
            patientUuid,
            question,
            {
              onToken: (token) => {
                if (!isMountedRef.current) return;
                updateMessages(patientUuid, (prev) => {
                  const idx = prev.findIndex((m) => m.id === messageId);
                  if (idx === -1) return prev;
                  const updated = [...prev];
                  updated[idx] = { ...updated[idx], answer: updated[idx].answer + token };
                  return updated;
                });
              },
              onDone: done,
              onError: fail,
            },
            abortController,
          );
        } else {
          searchPatientChart(patientUuid, question, abortController)
            .then(done)
            .catch((err) => {
              if (err.name !== 'AbortError') {
                console.error('[useChartSearchAi] Fetch failed:', err);
                fail(err?.responseBody?.error ?? err?.message ?? 'An unknown error occurred');
              }
            });
        }
      } catch (err) {
        abortControllerRef.current = null;
        inFlightMessageIdRef.current = null;
        fail(err instanceof Error ? err.message : 'An unknown error occurred');
      }
    },
    [config.useStreaming],
  );

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  // Only the last message can ever be loading; submitQuestion guards against
  // concurrent submits via abortControllerRef, so checking just the tail is sound.
  const isAnyLoading = messages.length > 0 && messages[messages.length - 1].isLoading;

  return {
    messages,
    isAnyLoading,
    submitQuestion,
    clearMessages,
    stopCurrent,
  };
}
