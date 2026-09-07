import type { AiAnswerLimits, AiSearchResponse } from '../api/chartsearchai';

/**
 * The four answer-limit measurements as a chat message carries them: every key present, and null
 * until stated.
 *
 * `Required` only makes them present — their semantics, including that an empty array is not a
 * certificate and a null is not a completeness claim, are stated once on {@link AiAnswerLimits}.
 */
export type MessageAnswerLimits = Required<AiAnswerLimits>;

/** A message that has stated no measurement yet. */
export const NO_ANSWER_LIMITS: MessageAnswerLimits = {
  misattributedOrderCitations: null,
  unstatedFindingSeverities: null,
  conditionRuleCoverage: null,
  interactionPairs: null,
};

/**
 * Carries the answer-limit measurements from a response — or from the trailing `grounded` event —
 * onto what the message already holds.
 *
 * Falls back to the previous value rather than assigning outright, because under
 * `chartsearchai.grounding.async=true` the early `done` event states nulls for every measurement
 * taken after the answer and the trailing `grounded` event supplies them, while
 * `conditionRuleCoverage` is already final on `done` and merely re-sent. So a null or absent
 * value never erases one already stated, whichever order a given server states them in. A stated
 * value DOES replace an earlier one — including `[]` replacing null, which is the whole
 * distinction between "the check ran and named none" and "no measurement stated".
 *
 * One of two enumerations of the four keys — {@link NO_ANSWER_LIMITS} above is the other, and a
 * fifth measurement is a compile error at both, plus at any `ChatMessage` literal. It is NOT a
 * compile error in the panel: that reads its props by name, so making a new measurement RENDER
 * is a hand edit there whatever this file does.
 */
export function mergeDisclosure(previous: MessageAnswerLimits, source: Partial<AiSearchResponse>): MessageAnswerLimits {
  return {
    misattributedOrderCitations: source.misattributedOrderCitations ?? previous.misattributedOrderCitations,
    unstatedFindingSeverities: source.unstatedFindingSeverities ?? previous.unstatedFindingSeverities,
    conditionRuleCoverage: source.conditionRuleCoverage ?? previous.conditionRuleCoverage,
    interactionPairs: source.interactionPairs ?? previous.interactionPairs,
  };
}

/**
 * The message's measurements, as props for the response panel.
 *
 * Spread rather than listed key-by-key in JSX, and that is the point: the panel's props extend
 * {@link AiAnswerLimits}, whose keys are all optional, so a hand-written list of them in JSX is
 * the one place a fifth measurement would silently fail to REACH the panel at all — stored on
 * the message and never passed down. Verified by adding a fifth key: this file, the
 * `ChatMessage` literals and the hook redden; the panel's own prop destructuring does not, which
 * is why the spread is about delivery and not about rendering.
 */
export function answerLimitsOf(message: MessageAnswerLimits): MessageAnswerLimits {
  return mergeDisclosure(message, {});
}
