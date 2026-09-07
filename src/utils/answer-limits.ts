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
 * This function is the ONE place the four keys are enumerated. Everything else derives from it,
 * so adding a fifth measurement is a compile error here and nowhere has to be found by hand.
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
 * the one place a fifth measurement would NOT be a compile error — it would be stored on the
 * message and silently never reach the panel. Verified by adding a fifth key: every other site
 * reddened and that one did not.
 */
export function answerLimitsOf(message: MessageAnswerLimits): MessageAnswerLimits {
  return mergeDisclosure(message, {});
}
