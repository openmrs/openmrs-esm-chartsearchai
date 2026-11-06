import { useConfig } from '@openmrs/esm-framework';
import { type ChartSearchAiConfig } from '../config-schema';
import { looksLikeIdentifier, looksLikeQuestion } from '../omnibar-contract/query-hints';
import { type OmnibarQueryHints } from '../omnibar-contract/types';

/**
 * Whether the Query results section asks ChartSearch about this query: a question-like query, in a
 * chart, no longer than this app's `maxQuestionLength`, with the section switched on. Who may ask is
 * the extension's privilege in routes.json, which the framework applies before mounting it. The
 * host's `hints.looksLikeQuestion` is the same test the bar's hint used; a host that doesn't pass it
 * gets the contract's own, with its default word count. Under `/ask` (`asked`), the clinician has said
 * it is a question, so any text that isn't ID-shaped counts.
 */
export function useChartSearchOffer(
  query: string,
  patientUuid: string | undefined,
  hints: OmnibarQueryHints | undefined,
  asked = false,
): boolean {
  const { maxQuestionLength, queryResultsAnswer } = useConfig<ChartSearchAiConfig>();
  const question = query.trim();
  return (
    queryResultsAnswer?.enabled !== false &&
    Boolean(patientUuid) &&
    question.length <= maxQuestionLength &&
    (asked
      ? Boolean(question) && !looksLikeIdentifier(question)
      : (hints?.looksLikeQuestion ?? looksLikeQuestion(question)))
  );
}
