import type { AiAnswerLimits, AiReference, AiSafetyWarning } from '../api/chartsearchai';
import { citationGroupPattern, parseCitationIndices } from './safety-disclosure';

/**
 * The `resourceUuid` the backend gives a safety finding's citable record: its chip's `type` and
 * `drug` joined by a colon (`interaction:Acetylsalicylic acid (aspirin)`), written by
 * `ChartSearchAiUtils.resourceKey` in openmrs-module-chartsearchai. Several findings of one type
 * about one drug share it, which is why {@link compactChips} refuses a key two chips carry.
 */
function findingKey(warning: AiSafetyWarning): string {
  return `${warning.type}:${warning.drug}`;
}

/** An answer-limit list that was measured and named nothing. `null` or absent is no measurement. */
function measuredEmpty(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

/**
 * Whether every fidelity check the backend runs over a finding's rendering was stated and reported
 * nothing. Any one reporting something, or stating no measurement, keeps every chip in full: the
 * full chip is the backstop for an answer that dropped or softened a finding, and none of these
 * checks is a certificate the answer rendered it faithfully — they are the evidence against.
 */
function noFidelityCheckFired(limits: AiAnswerLimits): boolean {
  const pairs = limits.interactionClaimPairs;
  const pairsClear =
    pairs != null && typeof pairs === 'object' && pairs.unfounded === 0 && measuredEmpty(pairs.misattributedCitations);
  return (
    measuredEmpty(limits.misattributedOrderCitations) &&
    measuredEmpty(limits.unstatedFindingSeverities) &&
    measuredEmpty(limits.unfoundedFindingSeverities) &&
    measuredEmpty(limits.unfaithfullyRenderedCitations) &&
    measuredEmpty(limits.cautionLedOverWithholding) &&
    pairsClear
  );
}

/**
 * The positions in `warnings` whose chip the answer already carries, so the panel can draw it on one
 * line with its detail behind a toggle instead of repeating the answer's paragraph beside it.
 *
 * A chip qualifies only where all three hold, and anything short of proof leaves it in full:
 * - the answer's own inline markers cite the finding's record (a `safety_finding` reference whose
 *   `resourceUuid` is the chip's key) — the one link from prose to chip the wire carries;
 * - every chip carrying that key is covered: the answer cites at least as many DISTINCT findings of the key
 *   as there are chips carrying it. Each finding record the prompt carried becomes a chip, and the chips
 *   pass can only add chips, so per key cited records <= records <= chips; where the cited ones are as many
 *   as the chips, all three are equal and no chip of the key is uncited. Short of that, a citation of a
 *   shared key cannot say which chip it states, and none of them qualifies;
 * - {@link noFidelityCheckFired}.
 *
 * It does not claim the answer states the chip's WORDS: the answer may paraphrase or drop a
 * sentence, which is why the collapsed chip still opens to its full detail.
 *
 * @returns each qualifying position, mapped to the citation indexes in the answer that cite its
 *   finding, ascending — where a clinician reads what the chip no longer repeats. For a shared key that
 *   is every cited index of the key, since which of them is this chip's cannot be told.
 */
export function compactChips(
  answer: string,
  references: AiReference[],
  warnings: AiSafetyWarning[],
  limits: AiAnswerLimits,
): Map<number, number[]> {
  const compact = new Map<number, number[]>();
  if (!answer || !Array.isArray(references) || !Array.isArray(warnings) || !noFidelityCheckFired(limits)) {
    return compact;
  }
  const cited = new Set<number>();
  for (const match of answer.matchAll(citationGroupPattern())) {
    for (const index of parseCitationIndices(match[1])) cited.add(index);
  }
  const citedFindingIndexes = new Map<string, number[]>();
  for (const ref of references) {
    if (ref?.resourceType !== 'safety_finding' || !cited.has(ref.index)) continue;
    citedFindingIndexes.set(ref.resourceUuid, [...(citedFindingIndexes.get(ref.resourceUuid) ?? []), ref.index]);
  }
  const keyCounts = new Map<string, number>();
  for (const warning of warnings) {
    if (!warning) continue;
    keyCounts.set(findingKey(warning), (keyCounts.get(findingKey(warning)) ?? 0) + 1);
  }
  warnings.forEach((warning, position) => {
    if (!warning || typeof warning.type !== 'string' || typeof warning.drug !== 'string') return;
    const key = findingKey(warning);
    const indexes = citedFindingIndexes.get(key);
    if (indexes && new Set(indexes).size >= (keyCounts.get(key) ?? Infinity))
      compact.set(
        position,
        [...indexes].sort((a, b) => a - b),
      );
  });
  return compact;
}
