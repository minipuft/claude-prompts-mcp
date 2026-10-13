// @lifecycle canonical - The retry-hint format a semantic FAIL records, and its partition.
const SEMANTIC_HINT_PREFIX = 'Semantic gate ';

/**
 * The retry hint a semantic FAIL records on its review. A review's hints are one list shared
 * with structural grading, so this prefix is what tells the two apart: when they are rendered,
 * and when a replacement's grade drops only the structural ones.
 */
export function formatSemanticGateHint(gateId: string, finding: string): string {
  return `${SEMANTIC_HINT_PREFIX}'${gateId}' ${finding}`;
}

/** Split a review's retry hints into those a semantic FAIL recorded and all the others. */
export function partitionReviewHints(hints: readonly string[]): {
  readonly semantic: readonly string[];
  readonly structural: readonly string[];
} {
  const semantic = hints.filter((hint) => hint.startsWith(SEMANTIC_HINT_PREFIX));
  const structural = hints.filter((hint) => !hint.startsWith(SEMANTIC_HINT_PREFIX));
  return { semantic, structural };
}
