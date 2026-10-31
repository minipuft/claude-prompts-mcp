// @lifecycle canonical - Grades a gate review's check-tier gates against one output.
import { physicalReviewDefinitionIndex } from '../../execution/pipeline/decisions/gates/frozen-review-definitions.js';
import { selectToolReviewGateIds } from '../../execution/pipeline/decisions/gates/structural-review-composition.js';

import type {
  GateCheckResult,
  GateReview,
  GateReviewSemanticContext,
} from '#shared/types/chain-execution.js';
import type { StateStoreOptions } from '#shared/types/persistence.js';

/**
 * Runs a review's ground-truth checks (`runGateReviewEvidence`, bound to the gate loader and the
 * executors at the composition root). `scope` is the verdict request's, for the shell executor's
 * gate master-switch read; `issuedDefinitions` is the review's own frozen authority, omitted on
 * legacy reviews.
 */
export type ReviewCheckRunner = (
  gateIds: string[],
  agentResponse: string,
  scope: StateStoreOptions | undefined,
  issuedDefinitions?: GateReviewSemanticContext['definitions']
) => Promise<GateCheckResult[]>;

export interface GradeReviewOptions {
  /**
   * What an inconsistent issued authority does here. `throw` surfaces it at once (a detached
   * review's caller expects that). `skip` grades nothing and hands the review on unchanged, so
   * the adjudication that follows refuses it by name instead of a grader throwing first.
   */
  readonly onInconsistentAuthority: 'throw' | 'skip';
}

/**
 * Run the review's check-tier gates (`shell_verify`, `script_tool`) against `output` and record
 * what they produced on the review. One grader for both verdict paths: a detached review grades
 * the node's RECORDED output, a step review grades the answer the verdict arrived with. With no
 * runner wired, the review is returned as it was, which the lifecycle then treats as a review
 * whose gates are all reminders; `scope` is read only when a runner is.
 */
export async function gradeReviewChecks(
  runner: ReviewCheckRunner | undefined,
  review: GateReview,
  output: string,
  scope: () => StateStoreOptions | undefined,
  options: GradeReviewOptions = { onInconsistentAuthority: 'throw' }
): Promise<GateReview> {
  if (runner === undefined) return review;
  let issued: GateReviewSemanticContext['definitions'] | undefined;
  try {
    issued = physicalReviewDefinitionIndex(review);
  } catch (error) {
    if (options.onInconsistentAuthority === 'throw') throw error;
    return review;
  }
  const checkResults = await runner(selectToolReviewGateIds(review), output, scope(), issued);
  return checkResults.length > 0 ? { ...review, checkResults } : review;
}
