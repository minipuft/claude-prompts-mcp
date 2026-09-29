// @lifecycle canonical - Shared result types for phase-guard evaluation.
/**
 * Phase Guard Evaluation Types
 *
 * Result types for deterministic framework phase guard evaluation.
 * Used by the phase guard evaluator and pipeline PhaseGuardVerificationStage.
 */

/**
 * Result of a single guard check within a phase
 */
export interface PhaseGuardCheckResult {
  /** Guard type (e.g., 'required', 'min_length', 'contains_any') */
  type: string;
  /** Whether this check passed */
  passed: boolean;
  /** What was expected */
  expected: unknown;
  /** What was found in the output */
  actual: unknown;
  /** Human-readable failure message for enforce-mode feedback */
  feedback: string;
}

/**
 * Result of evaluating all guards for a single phase
 */
export interface PhaseGuardResult {
  /** Phase identifier from framework */
  phase: string;
  /** Section header used for detection */
  section_header: string;
  /** Whether the section header was found in the output */
  found: boolean;
  /** Results of individual guard checks */
  checks: PhaseGuardCheckResult[];
  /** Whether all checks passed for this phase */
  passed: boolean;
}

/**
 * Complete evaluation result across all phases
 */
export interface PhaseGuardEvaluationResult {
  /** Whether all phases passed */
  allPassed: boolean;
  /** Per-phase results */
  results: PhaseGuardResult[];
  /** Phase names that failed */
  failedPhases: string[];
  /** Concatenated feedback for enforce-mode retry response */
  retryFeedback: string;
}

/**
 * One call's grade of the answer it captured (R170). Taken ONCE per call and kept on that call's
 * context: stage 16 takes it before it decides the advance, so a failing answer holds the run on
 * the step it answered, and stage 19 opens the structural review from the same grade.
 *
 * - `skipped`: nothing was graded, and `reason` says why (guards off, no framework, nothing
 *   declared, the step's structural review already open or closed by this call's verdict).
 * - `evaluated`: `evaluatePhaseGuards` ran over `outputText`. `holdsNodeId` names the node the
 *   run must stay on — present only when the grade failed in `enforce` mode on a node this call
 *   captured, which is exactly when a structural review opens on it.
 */
export type AnswerGrade =
  | { readonly kind: 'skipped'; readonly reason: string }
  | {
      readonly kind: 'evaluated';
      readonly result: PhaseGuardEvaluationResult;
      readonly outputText: string;
      readonly mode: 'enforce' | 'warn';
      readonly maxAttempts: number;
      /** The step graded: the node this call captured, or none when it captured nothing. */
      readonly reviewedStep: { readonly stepNumber: number; readonly nodeId: string } | undefined;
      readonly holdsNodeId?: string;
    };
