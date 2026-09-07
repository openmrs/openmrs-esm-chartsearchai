import { useCallback, useEffect, useRef } from 'react';
import { useConfig, useStore } from '@openmrs/esm-framework';
import {
  type AiInteractionPairs,
  type AiReference,
  type AiSafetyWarning,
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
  safetyWarnings: AiSafetyWarning[];
  /** Citations the answer offered as evidence of an active drug order that cannot be one.
   *  null = the response stated no measurement; [] = the check ran and named none, which is
   *  NOT a certificate that the remaining citations are sound. */
  misattributedOrderCitations: number[] | null;
  /** Citations of safety findings whose rating the answer states nowhere. */
  unstatedFindingSeverities: number[] | null;
  /** Whether the loaded dataset could run the condition arm of the contraindication screen. */
  conditionRuleCoverage: string | null;
  /** How bounded the interaction check that stated it was. null = no measurement stated. */
  interactionPairs: AiInteractionPairs | null;
  questionId: string;
  isLoading: boolean;
  error: string | null;
  /** Live model reasoning while the answer is still being generated — a transient
   *  "thinking" indicator, cleared when the answer completes. Never the answer. */
  reasoning: string;
  /** Transient PRELIMINARY reasoning from the progressive-reasoning preview pass (server GP
   *  chartsearchai.progressiveReasoning.enabled): shown before {@link reasoning} on a slow host,
   *  and provisional — REPLACED the moment real reasoning or the answer arrives, and never
   *  persisted. Optional: only the streaming path sets it (always to '' first); it stays
   *  absent/empty when progressive reasoning is off, so non-streaming fixtures need not supply it. */
  preliminaryReasoning?: string;
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

/** Removes citation markers ([3], [1, 2], …) from the progressive-reasoning PREVIEW text only.
 *  The preview reasons over an independently-numbered top-K focused chart, so its [N] markers do
 *  NOT line up with the committed answer's record numbering — showing them would mislead. Mirrors
 *  the citation regex in ai-response-panel's stripCitations, but WITHOUT trimming, since the preview
 *  is accumulated chunk-by-chunk and the trailing space must survive between chunks. */
function stripPreviewCitations(text: string): string {
  return text.replace(/\s?\[\d+(?:\s*,\s*\d+)*\]/g, '');
}

type Disclosure = Pick<
  ChatMessage,
  'misattributedOrderCitations' | 'unstatedFindingSeverities' | 'conditionRuleCoverage' | 'interactionPairs'
>;

/**
 * Carries the answer-limit measurements from a response — or from the trailing `grounded`
 * event — onto the message.
 *
 * Falls back to what the message already holds rather than assigning outright, because under
 * `chartsearchai.grounding.async=true` the early `done` event states nulls for every
 * measurement taken after the answer and the trailing `grounded` event supplies them, while
 * `conditionRuleCoverage` is already final on `done` and merely re-sent. So neither event can
 * erase the other's value, whichever order a given server states them in.
 */
function mergeDisclosure(previous: Disclosure, source: Partial<AiSearchResponse>): Disclosure {
  return {
    misattributedOrderCitations: source.misattributedOrderCitations ?? previous.misattributedOrderCitations,
    unstatedFindingSeverities: source.unstatedFindingSeverities ?? previous.unstatedFindingSeverities,
    conditionRuleCoverage: source.conditionRuleCoverage ?? previous.conditionRuleCoverage,
    interactionPairs: source.interactionPairs ?? previous.interactionPairs,
  };
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
        // Mirror `done`: a settled message keeps no reasoning scratchpad, even when stopped mid-stream.
        updated[idx] = { ...msg, isLoading: false, reasoning: '', preliminaryReasoning: '' };
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
        safetyWarnings: [],
        misattributedOrderCitations: null,
        unstatedFindingSeverities: null,
        conditionRuleCoverage: null,
        interactionPairs: null,
        questionId: '',
        isLoading: true,
        error: null,
        reasoning: '',
        preliminaryReasoning: '',
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
            safetyWarnings: response.safetyWarnings ?? [],
            ...mergeDisclosure(updated[idx], response),
            questionId: response.questionId ?? '',
            isLoading: false,
            // the scratchpad served its purpose as a live indicator; don't persist it
            reasoning: '',
            preliminaryReasoning: '',
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
              // Preliminary reasoning: the progressive-reasoning preview, shown before any real
              // reasoning exists. Provisional — cleared the moment real reasoning or the answer
              // arrives (see onThinking/onToken), so a wrong preview can't linger.
              onPreliminary: (chunk) => {
                if (!isMountedRef.current) return;
                updateMessages(patientUuid, (prev) => {
                  const idx = prev.findIndex((m) => m.id === messageId);
                  if (idx === -1) return prev;
                  const updated = [...prev];
                  updated[idx] = {
                    ...updated[idx],
                    // strip the preview's [N] markers: they index the focused chart, not the
                    // committed answer's records, so showing them would mislead.
                    preliminaryReasoning: stripPreviewCitations((updated[idx].preliminaryReasoning ?? '') + chunk),
                  };
                  return updated;
                });
              },
              // Live reasoning: shown while the model thinks, before any answer text exists.
              onThinking: (chunk) => {
                if (!isMountedRef.current) return;
                updateMessages(patientUuid, (prev) => {
                  const idx = prev.findIndex((m) => m.id === messageId);
                  if (idx === -1) return prev;
                  const updated = [...prev];
                  updated[idx] = {
                    ...updated[idx],
                    reasoning: updated[idx].reasoning + chunk,
                    // committed reasoning supersedes the provisional preview
                    preliminaryReasoning: '',
                  };
                  return updated;
                });
              },
              onToken: (token) => {
                if (!isMountedRef.current) return;
                updateMessages(patientUuid, (prev) => {
                  const idx = prev.findIndex((m) => m.id === messageId);
                  if (idx === -1) return prev;
                  const updated = [...prev];
                  updated[idx] = {
                    ...updated[idx],
                    answer: updated[idx].answer + token,
                    // the answer supersedes any provisional preview reasoning
                    preliminaryReasoning: '',
                  };
                  return updated;
                });
              },
              // Show citations as soon as the server emits them (before grounding finishes).
              // These carry no grounding verdict yet, so they render unverified; `done` then
              // overwrites this message's references with the grounded set.
              onReferences: (references) => {
                if (!isMountedRef.current) return;
                updateMessages(patientUuid, (prev) => {
                  const idx = prev.findIndex((m) => m.id === messageId);
                  if (idx === -1) return prev;
                  const updated = [...prev];
                  updated[idx] = { ...updated[idx], references };
                  return updated;
                });
              },
              onDone: done,
              // Trailing verdicts (server runs async grounding): update the SAME message's
              // references after done completed it — and its safety warnings and answer-limit
              // measurements, which `done` states as empty/null in that mode because validation
              // and the answer checks run after it is handed off. Reading `done` alone there
              // would render none of the disclosure.
              //
              // Deliberately NOT gated on isMountedRef — the chat store outlives the panel, and
              // verdicts that arrive after the user closed it must still land so badges are
              // correct when the panel reopens.
              onGrounded: (update) => {
                updateMessages(patientUuid, (prev) => {
                  const idx = prev.findIndex((m) => m.id === messageId);
                  if (idx === -1) return prev;
                  const updated = [...prev];
                  updated[idx] = {
                    ...updated[idx],
                    references: update.references ?? updated[idx].references,
                    safetyWarnings: update.safetyWarnings ?? updated[idx].safetyWarnings,
                    ...mergeDisclosure(updated[idx], update),
                  };
                  return updated;
                });
              },
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
