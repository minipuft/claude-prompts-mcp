// @lifecycle canonical - Exposes phase-guard evaluation APIs for framework validation.
/**
 * Phase Guard Evaluation Module
 *
 * Deterministic structural validation for framework phases.
 * Parses LLM output by section headers and evaluates phase guards.
 */

export { evaluatePhaseGuards, buildPhaseGuardPassSummary } from './phase-guard-evaluator.js';
export { splitBySectionHeaders } from './section-splitter.js';
export type { OutputSection } from './section-splitter.js';
export type {
  PhaseGuardCheckResult,
  PhaseGuardEvaluationResult,
  PhaseGuardResult,
} from './types.js';
