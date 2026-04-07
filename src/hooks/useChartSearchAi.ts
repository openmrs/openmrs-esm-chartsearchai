import { useCallback, useEffect, useRef, useState } from 'react';
import { useConfig } from '@openmrs/esm-framework';
import {
  type AiReference,
  type AiSearchResponse,
  searchPatientChart,
  searchPatientChartStream,
} from '../api/chartsearchai';
import { type ChartSearchAiConfig } from '../config-schema';

export interface ChatMessage {
  id: string;
  question: string;
  answer: string;
  disclaimer: string;
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
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function useChartSearchAi(): UseChartSearchAiReturn {
  const config = useConfig<ChartSearchAiConfig>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const clearMessages = useCallback(() => {
    setMessages([]);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const stopCurrent = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      updated[updated.length - 1] = { ...updated[updated.length - 1], isLoading: false };
      return updated;
    });
  }, []);

  const submitQuestion = useCallback(
    (patientUuid: string, question: string) => {
      if (abortControllerRef.current) return;

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const newMessage: ChatMessage = {
        id: generateId(),
        question,
        answer: '',
        disclaimer: '',
        references: [],
        questionId: '',
        isLoading: true,
        error: null,
      };

      setMessages((prev) => [...prev, newMessage]);

      const done = (response: AiSearchResponse) => {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            answer: response.answer,
            disclaimer: response.disclaimer,
            references: response.references,
            questionId: response.questionId ?? '',
            isLoading: false,
          };
          return updated;
        });
      };

      const fail = (errMessage: string) => {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            error: errMessage,
            isLoading: false,
          };
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
                setMessages((prev) => {
                  if (prev.length === 0) return prev;
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    answer: updated[updated.length - 1].answer + token,
                  };
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
                fail(err?.responseBody?.error ?? err?.message ?? 'An unknown error occurred');
              }
            });
        }
      } catch (err) {
        abortControllerRef.current = null;
        fail(err instanceof Error ? err.message : 'An unknown error occurred');
      }
    },
    [config.useStreaming],
  );

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Only the last message can ever be loading because submitQuestion guards against
  // concurrent requests via abortControllerRef.
  const isAnyLoading = messages.length > 0 && messages[messages.length - 1].isLoading;

  return {
    messages,
    isAnyLoading,
    submitQuestion,
    clearMessages,
    stopCurrent,
  };
}
