// @lifecycle canonical - Shared result types for phase-guard evaluation.
/**
 * Phase Guard Evaluation Types
 *
 * Result types for deterministic framework phase guard evaluation.
 * Used by the phase guard evaluator and pipeline Stage 09b.
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
