import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@openmrs/esm-framework';
import {
  type AiBlock,
  type AiAnswerValidation,
  type AiConfidence,
  type AiInDepth,
  type AiReference,
  type AiSafetyCheck,
  type AiSafetyStatus,
  type AiSafetyWarning,
  type AiSearchResponse,
  type ChatHistoryMessage,
  chatPatientChartStream,
  fetchChatHistory,
  startNewChat,
} from '../api/chartsearchai';
import { chatSessionStore } from '../store/chat-session.store';
import { type TurnPhase, isAwaitingAnswer as phaseIsAwaitingAnswer, isAnswerSettled, isTerminal } from './turn-phase';
import { type MessageAnswerLimits, mergeDisclosure, NO_ANSWER_LIMITS } from '../utils/answer-limits';
import { citationStripPattern } from '../utils/safety-disclosure';

export interface ChatMessage extends MessageAnswerLimits {
  id: string;
  question: string;
  answer: string;
  references: AiReference[];
  safetyWarnings?: AiSafetyWarning[];
  /** checked/limited/unavailable — present alongside safetyWarnings, even when it's empty. */
  safetyStatus?: AiSafetyStatus;
  /** Canonical safety result with package provenance and coverage limitations. */
  safetyCheck?: AiSafetyCheck;
  blocks?: AiBlock[];
  auditLogId?: number;
  /**
   * The turn's single lifecycle phase — the source of truth for composer behavior, section
   * rendering, and DOM signals. Mirrors the backend staged SSE events (see {@link TurnPhase}).
   */
  phase: TurnPhase;
  error: string | null;
  /**
   * Live reasoning streamed before the answer (`reasoning_delta`), shown as a scratchpad while the
   * turn is still answering and cleared the moment the answer arrives. Never persisted.
   */
  reasoning?: string;
  /**
   * The optional progressive PREVIEW reasoning (`preliminary_delta`), with its citation markers
   * stripped: they index a top-K chart of their own, not the records the answer cites. Provisional
   * and replaced by the first committed reasoning or answer token, so it can never be read as the
   * reasoning behind the answer the clinician sees. Never persisted.
   */
  preliminaryReasoning?: string;
  /**
   * The hub product profile that produced this answer. Surfaced as a subtle
   * per-response tag. Undefined for older rows or system notices.
   */
  resolvedModel?: string;
  /** Per-section check confidence (green/yellow/red + note); checked hub profiles only. */
  confidence?: AiConfidence;
  /** Answer check lifecycle for staged checked responses. */
  answerValidation?: AiAnswerValidation;
  /** Product-profile In-Depth state attached to this assistant turn. */
  inDepth?: AiInDepth;
}

interface UseChartSearchAiReturn {
  messages: ChatMessage[];
  /**
   * The latest turn is still producing or checking its direct answer ({@link TurnPhase}
   * `answering`/`checking`).
   * The composer disables on this — so a new question can be asked while the prior turn's in-depth is
   * still streaming in the background.
   */
  isAwaitingAnswer: boolean;
  submitQuestion: (patientUuid: string, question: string) => void;
  clearMessages: () => void;
  stopCurrent: () => void;
  /**
   * Close the current server-side session for this patient and open a
   * fresh one. Use for the "New chat" button.
   */
  startNewChatSession: (patientUuid: string) => void;
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
  chatSessionStore.setState({ ...chatSessionStore.getState(), messagesByPatient: { ...current, [patientUuid]: next } });
}

function setSessionUuid(patientUuid: string, uuid: string | null): void {
  const state = chatSessionStore.getState();
  chatSessionStore.setState({
    ...state,
    sessionUuidByPatient: { ...state.sessionUuidByPatient, [patientUuid]: uuid },
  });
}

/**
 * Map a hydration row from the server's chat-history endpoint to a
 * UI {@link ChatMessage}. Server stores user and assistant rows
 * separately (one per turn); the UI groups them as Q+A pairs anchored
 * on the user-message uuid as the row id.
 */
function hydrateMessages(history: ChatHistoryMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let pending: ChatMessage | null = null;
  for (const m of history) {
    if (m.role === 'user') {
      if (pending) {
        // Two consecutive user messages — push the prior with empty answer.
        // This is unusual (LLM call failed) but the UI must remain coherent.
        out.push(pending);
      }
      pending = {
        id: m.messageId,
        question: m.content,
        answer: '',
        references: [],
        ...NO_ANSWER_LIMITS,
        auditLogId: undefined,
        phase: 'complete',
        error: null,
      };
    } else if (m.role === 'assistant') {
      if (pending) {
        pending.answer = m.content;
        pending.blocks = m.blocks;
        pending.safetyWarnings = m.safetyWarnings;
        pending.safetyStatus = m.safetyStatus;
        pending.safetyCheck = m.safetyCheck;
        pending.confidence = m.confidence;
        pending.answerValidation = interruptAnswerValidation(m.answerValidation);
        pending.inDepth = interruptInDepth(m.inDepth);
        pending.references = m.references ?? [];
        pending.auditLogId = m.auditLogId;
        // The persisted turn carries the answer-limit statements the stream published (#157).
        Object.assign(pending, mergeDisclosure(pending, m));
        if (m.terminalState === 'turn_error') {
          pending.phase = 'error';
          pending.error = m.problemCode ?? 'provider_failure';
        }
        out.push(pending);
        pending = null;
      }
      // Orphan assistant row without a preceding user — ignore (UI has no
      // sane render for it); the row stays in the DB for audit purposes.
    }
    // 'system' rows are dropped — they belong to the LLM-prompt layer.
  }
  if (pending) {
    out.push(pending);
  }
  return out;
}

function stripInDepthHeader(text: string): string {
  return text.replace(/^\s*\*\*In ?Depth\*\*\s*/i, '').trimStart();
}

function interruptInDepth(inDepth?: AiInDepth): AiInDepth | undefined {
  if (!inDepth || inDepth.status !== 'pending') return inDepth;
  return { ...inDepth, status: 'failed', error: 'In-Depth was interrupted.' };
}

function interruptAnswerValidation(
  validation?: AiSearchResponse['answerValidation'],
): AiSearchResponse['answerValidation'] | undefined {
  if (!validation || validation.status !== 'checking') return validation;
  return {
    ...validation,
    status: 'unavailable',
    label: 'Check unavailable',
    summary: 'The answer check was interrupted before completion.',
  };
}

type TurnEnvelope = Partial<AiSearchResponse> & { messageId?: string; inDepth?: AiInDepth };

/**
 * Removes citation markers ([3], [1, 2], …) from the PREVIEW text only. The preview reasons over an
 * independently-numbered top-K chart, so its markers do not line up with the committed answer's
 * records and showing them would mislead. Applied to the whole accumulated preview rather than to
 * each frame, so a marker whose brackets arrive in different frames is still removed. Shares the
 * resolver's pattern, so marker syntax has one home, and does NOT trim: the preview accumulates
 * chunk by chunk and a trailing space must survive between them.
 */
function stripPreviewCitations(text: string): string {
  return text.replace(citationStripPattern(), '');
}

function applyTurnEnvelope(message: ChatMessage, payload: TurnEnvelope, phase: TurnPhase): ChatMessage {
  return {
    ...message,
    answer: payload.answer ?? message.answer,
    // Absence means this event has no reference update. An explicit array is authoritative even
    // when empty: answer validation may remove every draft citation when it edits the answer.
    references: Array.isArray(payload.references) ? payload.references : message.references,
    safetyWarnings: payload.safetyWarnings ?? message.safetyWarnings,
    safetyStatus: payload.safetyStatus ?? message.safetyStatus,
    safetyCheck: payload.safetyCheck ?? message.safetyCheck,
    blocks: payload.blocks ?? message.blocks,
    confidence: payload.confidence ?? message.confidence,
    answerValidation: payload.answerValidation ?? message.answerValidation,
    inDepth: payload.inDepth ?? message.inDepth,
    auditLogId: payload.auditLogId ?? message.auditLogId,
    resolvedModel: payload.resolvedModel ?? message.resolvedModel,
    // Answer-limit statements accumulate across the turn's events: a later event that states
    // nothing about a measurement leaves an earlier statement standing.
    ...mergeDisclosure(message, payload),
    // Both scratchpads served their purpose as live indicators once the answer exists.
    reasoning: phase === 'answering' ? message.reasoning : '',
    preliminaryReasoning: phase === 'answering' ? message.preliminaryReasoning : '',
    phase,
  };
}

export function useChartSearchAi(patientUuid?: string): UseChartSearchAiReturn {
  const { messagesByPatient, sessionUuidByPatient } = useStore(chatSessionStore);
  const messages: ChatMessage[] = patientUuid ? (messagesByPatient[patientUuid] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES;
  const abortControllerRef = useRef<AbortController | null>(null);
  const inFlightMessageIdRef = useRef<string | null>(null);
  const sessionStartRef = useRef<Promise<void> | null>(null);
  const isMountedRef = useRef(true);
  const [isStartingSession, setIsStartingSession] = useState(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Hydrate on mount / patient change. Cleared if the patient has nothing
  // server-side OR if hydration fails — in either case we start blank and
  // the first submit creates a fresh session.
  useEffect(() => {
    if (!patientUuid) return;
    if (messagesByPatient[patientUuid] && messagesByPatient[patientUuid].length > 0) {
      // Local cache already populated (e.g. user just submitted a turn);
      // skip the round-trip.
      return;
    }
    const controller = new AbortController();
    const sessionBeforeFetch = chatSessionStore.getState().sessionUuidByPatient[patientUuid];
    fetchChatHistory(patientUuid, controller)
      .then((response) => {
        if (!isMountedRef.current || controller.signal.aborted) return;
        // This is a mount-time snapshot fetch, not a live subscription — a real turn's own
        // onSession can complete and correct the session while this fetch is still in flight
        // (it started from a stale hydrated session, e.g. right after a provider switch). Only
        // apply the response if nothing has updated the session since this fetch began; a real
        // turn's result always wins over a late, now-outdated snapshot.
        if (chatSessionStore.getState().sessionUuidByPatient[patientUuid] !== sessionBeforeFetch) {
          return;
        }
        setSessionUuid(patientUuid, response.session ?? null);
        // The picker must reflect the provider bound to the restored conversation. Otherwise the
        // next question would request a different provider and correctly start a new conversation.
        if (response.provider) {
          chatSessionStore.setState({ selectedProviderId: response.provider });
        }
        const hydrated = hydrateMessages(response.messages ?? []);
        if (hydrated.length > 0) {
          updateMessages(patientUuid, () => hydrated);
        }
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        console.warn('[useChartSearchAi] hydrate failed; starting empty', err);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientUuid]);

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
        if (isTerminal(msg.phase)) return prev;
        if (!msg.answer) {
          return prev.filter((_, i) => i !== idx);
        }
        const updated = [...prev];
        updated[idx] = {
          ...msg,
          phase: 'complete',
          answerValidation: interruptAnswerValidation(msg.answerValidation),
          inDepth: interruptInDepth(msg.inDepth),
        };
        return updated;
      });
    }
  }, [patientUuid]);

  const startNewChatSession = useCallback((patientUuid: string) => {
    if (sessionStartRef.current) return;
    const providerId = chatSessionStore.getState().selectedProviderId ?? undefined;
    setIsStartingSession(true);
    const pending = startNewChat(patientUuid, providerId)
      .then((response) => {
        if (!isMountedRef.current) return;
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        inFlightMessageIdRef.current = null;
        updateMessages(patientUuid, () => []);
        setSessionUuid(patientUuid, response.session ?? null);
      })
      .catch((err) => {
        console.warn('[useChartSearchAi] startNewChat failed', err);
      })
      .finally(() => {
        if (sessionStartRef.current === pending) {
          sessionStartRef.current = null;
        }
        if (isMountedRef.current) {
          setIsStartingSession(false);
        }
      });
    sessionStartRef.current = pending;
  }, []);

  const submitQuestion = useCallback(
    (patientUuid: string, question: string) => {
      if (sessionStartRef.current) return;
      const state = chatSessionStore.getState();
      const selectedProviderId = state.selectedProviderId ?? undefined;
      const discoveryStatus = state.profileDiscoveryStatus;
      if (selectedProviderId === 'hub' && discoveryStatus !== 'ready') {
        const error =
          discoveryStatus === 'loading'
            ? 'AI profiles are still loading. Try again in a moment.'
            : 'AI profiles are unavailable. Check the med-agent-hub connection.';
        const failedMessage: ChatMessage = {
          id: generateId(),
          question,
          answer: '',
          references: [],
          ...NO_ANSWER_LIMITS,
          auditLogId: undefined,
          phase: 'error',
          error,
        };
        updateMessages(patientUuid, (prev) => [...prev, failedMessage]);
        return;
      }
      const selectedProfileId = selectedProviderId === 'hub' ? (state.selectedProfileId ?? undefined) : undefined;
      if (selectedProviderId === 'hub' && !selectedProfileId) {
        const failedMessage: ChatMessage = {
          id: generateId(),
          question,
          answer: '',
          references: [],
          ...NO_ANSWER_LIMITS,
          auditLogId: undefined,
          phase: 'error',
          error: 'No AI profile is selected. Refresh the available profiles and try again.',
        };
        updateMessages(patientUuid, (prev) => [...prev, failedMessage]);
        return;
      }
      if (abortControllerRef.current) {
        // A turn is still in flight. If its answer has NOT settled yet, don't start a second
        // answer generation (one at a time — this is what keeps the server's getLastOrdinal()
        // path single-flight and race-free). If the answer HAS settled and only the background
        // in-depth is trailing, PREEMPT it so this new question starts immediately. The turn's
        // phase is the single source of truth: isAnswerSettled once validation has landed.
        const preemptedId = inFlightMessageIdRef.current;
        const inFlight = preemptedId
          ? (chatSessionStore.getState().messagesByPatient[patientUuid] ?? []).find((m) => m.id === preemptedId)
          : undefined;
        if (!inFlight || !isAnswerSettled(inFlight.phase)) return;
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        inFlightMessageIdRef.current = null;
        if (preemptedId) {
          updateMessages(patientUuid, (prev) => {
            const idx = prev.findIndex((m) => m.id === preemptedId);
            if (idx === -1) return prev;
            const msg = prev[idx];
            if (isTerminal(msg.phase)) return prev;
            const updated = [...prev];
            // Keep any received content, but report that the phase was interrupted.
            updated[idx] = {
              ...msg,
              phase: 'complete',
              answerValidation: interruptAnswerValidation(msg.answerValidation),
              inDepth: interruptInDepth(msg.inDepth),
            };
            return updated;
          });
        }
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const newMessage: ChatMessage = {
        id: generateId(),
        question,
        answer: '',
        references: [],
        safetyWarnings: [],
        ...NO_ANSWER_LIMITS,
        auditLogId: undefined,
        phase: 'answering',
        error: null,
      };

      updateMessages(patientUuid, (prev) => [...prev, newMessage]);
      const messageId = newMessage.id;
      inFlightMessageIdRef.current = messageId;

      const done = (response: AiSearchResponse) => {
        // This writes to the shared store, so it does not depend on component-mounted state.
        // The terminal-phase guard below still prevents a decoded late event from replacing a
        // turn that the user stopped or that panel cleanup already settled.
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
        if (inFlightMessageIdRef.current === messageId) {
          inFlightMessageIdRef.current = null;
        }
        updateMessages(patientUuid, (prev) => {
          const idx = prev.findIndex((m) => m.id === messageId);
          if (idx === -1) return prev;
          // A done already in the last read chunk still arrives after abort(); a message the user
          // stopped (or that already failed) must not be replaced under them by the full answer.
          if (isTerminal(prev[idx].phase)) return prev;
          const updated = [...prev];
          updated[idx] = applyTurnEnvelope(updated[idx], response, 'complete');
          return updated;
        });
        // Belt-and-braces: the X-ChartSearchAi-Session header captures the
        // session uuid first, but the `done` event also carries it for
        // sync clients that can't read response headers.
        if (response.session) {
          setSessionUuid(patientUuid, response.session);
        }
      };

      const fail = (errMessage: string) => {
        // Not gated on isMountedRef: a genuine terminal error must still settle the shared store.
        // A turn already stopped by the user is terminal, though, and must not be changed afterwards.
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
          if (isTerminal(prev[idx].phase)) return prev;
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            answerValidation: interruptAnswerValidation(updated[idx].answerValidation),
            inDepth: interruptInDepth(updated[idx].inDepth),
            error: errMessage,
            phase: 'error',
          };
          return updated;
        });
      };

      const answerDone = (response: AiSearchResponse) => {
        updateMessages(patientUuid, (prev) => {
          const idx = prev.findIndex((m) => m.id === messageId);
          if (idx === -1) return prev;
          if (isTerminal(prev[idx].phase)) return prev;
          const updated = [...prev];
          const phase = response.answerValidation?.status === 'checking' ? 'checking' : 'settled';
          // Do NOT synthesize a pending inDepth here when the response omits one. A provider
          // that actually supports In-Depth (e.g. the hub) establishes its real pending state via
          // its own indepth_pending event; a provider with no In-Depth capability at all (e.g.
          // bundled) never sends one and never follows up — fabricating {status: 'pending'} for
          // it would show a "Preparing in-depth..." spinner that can never resolve.
          updated[idx] = applyTurnEnvelope(updated[idx], response, phase);
          return updated;
        });
        if (response.session) {
          setSessionUuid(patientUuid, response.session);
        }
      };

      const answerValidation = (response: AiSearchResponse) => {
        // The answer + validation have landed; only in-depth remains. Moving to `settled` unlocks
        // the composer AND makes this turn preemptable (submitQuestion reads the phase).
        updateMessages(patientUuid, (prev) => {
          const idx = prev.findIndex((m) => m.id === messageId);
          if (idx === -1) return prev;
          if (isTerminal(prev[idx].phase)) return prev;
          const updated = [...prev];
          updated[idx] = applyTurnEnvelope(updated[idx], response, 'settled');
          return updated;
        });
      };

      const evidenceUpdated = (response: AiSearchResponse) => {
        updateMessages(patientUuid, (prev) => {
          const idx = prev.findIndex((m) => m.id === messageId);
          if (idx === -1 || isTerminal(prev[idx].phase)) return prev;
          const updated = [...prev];
          updated[idx] = applyTurnEnvelope(updated[idx], response, updated[idx].phase);
          return updated;
        });
      };

      const inDepthPending = (payload: Partial<AiSearchResponse> & { messageId?: string; inDepth?: AiInDepth }) => {
        updateMessages(patientUuid, (prev) => {
          const idx = prev.findIndex((m) => m.id === messageId);
          if (idx === -1) return prev;
          if (isTerminal(prev[idx].phase)) return prev;
          const updated = [...prev];
          updated[idx] = applyTurnEnvelope(
            updated[idx],
            {
              ...payload,
              inDepth: payload.inDepth ?? { status: 'pending', answer: updated[idx].inDepth?.answer ?? '' },
            },
            'in-depth',
          );
          return updated;
        });
      };

      const inDepthDone = (payload: TurnEnvelope) => {
        updateMessages(patientUuid, (prev) => {
          const idx = prev.findIndex((m) => m.id === messageId);
          if (idx === -1) return prev;
          if (isTerminal(prev[idx].phase)) return prev;
          const updated = [...prev];
          const inDepth = payload.inDepth;
          updated[idx] = applyTurnEnvelope(
            updated[idx],
            inDepth
              ? { ...payload, inDepth: { ...inDepth, answer: stripInDepthHeader(inDepth.answer ?? '') } }
              : payload,
            'settled',
          );
          return updated;
        });
      };

      const inDepthError = (payload: TurnEnvelope) => {
        updateMessages(patientUuid, (prev) => {
          const idx = prev.findIndex((m) => m.id === messageId);
          if (idx === -1) return prev;
          if (isTerminal(prev[idx].phase)) return prev;
          const updated = [...prev];
          // The direct answer remains available; the terminal marker still closes the turn.
          const inDepth = payload.inDepth;
          updated[idx] = applyTurnEnvelope(
            updated[idx],
            inDepth
              ? {
                  ...payload,
                  inDepth:
                    inDepth.status === 'failed' || inDepth.status === 'needs_review'
                      ? inDepth
                      : { ...inDepth, status: 'failed' },
                }
              : payload,
            'settled',
          );
          return updated;
        });
      };

      const sessionUuid = sessionUuidByPatient[patientUuid] ?? null;
      // Null means "no explicit selection" — the backend applies its configured
      // default provider, never a silent cross-provider fallback.
      try {
        // Multi-turn streaming: chat history is reconstructed server-side
        // from the session uuid; we only send the new question.
        chatPatientChartStream(
          patientUuid,
          sessionUuid,
          question,
          {
            // Token streaming from a provider that declares it (the bundled engine). Additive while the
            // turn is still answering; ignored once it settled or the user stopped it (both leave the
            // phase past 'answering'). `answer_done` then restates the whole answer, so a provider that
            // streams nothing (the hub) renders exactly as before.
            onToken: (chunk) => {
              updateMessages(patientUuid, (prev) => {
                const idx = prev.findIndex((m) => m.id === messageId);
                if (idx === -1 || prev[idx].phase !== 'answering') return prev;
                const updated = [...prev];
                // The answer supersedes the provisional preview.
                updated[idx] = { ...updated[idx], answer: updated[idx].answer + chunk, preliminaryReasoning: '' };
                return updated;
              });
            },
            onPreliminary: (chunk) => {
              updateMessages(patientUuid, (prev) => {
                const idx = prev.findIndex((m) => m.id === messageId);
                if (idx === -1 || prev[idx].phase !== 'answering') return prev;
                const updated = [...prev];
                updated[idx] = {
                  ...updated[idx],
                  preliminaryReasoning: stripPreviewCitations((updated[idx].preliminaryReasoning ?? '') + chunk),
                };
                return updated;
              });
            },
            onReasoning: (chunk) => {
              updateMessages(patientUuid, (prev) => {
                const idx = prev.findIndex((m) => m.id === messageId);
                if (idx === -1 || prev[idx].phase !== 'answering') return prev;
                const updated = [...prev];
                // Committed reasoning REPLACES the preview rather than continuing it.
                updated[idx] = {
                  ...updated[idx],
                  reasoning: (updated[idx].reasoning ?? '') + chunk,
                  preliminaryReasoning: '',
                };
                return updated;
              });
            },
            onSession: (uuid) => {
              // Defense in depth alongside the hydration-time provider sync: if the backend
              // returns a DIFFERENT session than the one this turn was sent with, it silently
              // started a new conversation (e.g. a provider mismatch the backend correctly
              // refuses to write into the old one — see ConversationServiceImpl.openOrCreate).
              // The old conversation's turns must not stay visible glued to this one.
              if (sessionUuid && uuid && uuid !== sessionUuid) {
                updateMessages(patientUuid, (prev) => prev.filter((m) => m.id === messageId));
              }
              setSessionUuid(patientUuid, uuid);
            },
            onAnswerDone: answerDone,
            onAnswerValidation: answerValidation,
            onEvidenceUpdated: evidenceUpdated,
            onInDepthPending: inDepthPending,
            onInDepthDone: inDepthDone,
            onInDepthError: inDepthError,
            onDone: done,
            onError: fail,
          },
          abortController,
          selectedProfileId,
          selectedProviderId,
        );
      } catch (err) {
        abortControllerRef.current = null;
        inFlightMessageIdRef.current = null;
        fail(err instanceof Error ? err.message : 'An unknown error occurred');
      }
    },
    [sessionUuidByPatient],
  );

  useEffect(() => {
    // The message store outlives this panel. Use the same terminal transition as the Stop action so
    // closing the panel cannot leave an empty `answering` message that disables the next panel instance.
    return () => stopCurrent();
  }, [stopCurrent]);

  // Only the last message can ever be in flight; a new turn either blocks (answer not yet settled)
  // or preempts the trailing in-depth, so checking just the tail is sound. The composer locks only
  // while the direct answer is being produced or checked (answering/checking) — a settled answer unlocks it
  // even while In-Depth or terminal settlement is still pending.
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined;
  const isAwaitingAnswer = isStartingSession || (lastMessage ? phaseIsAwaitingAnswer(lastMessage.phase) : false);

  return {
    messages,
    isAwaitingAnswer,
    submitQuestion,
    clearMessages,
    stopCurrent,
    startNewChatSession,
  };
}
