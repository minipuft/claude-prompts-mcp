// @lifecycle canonical - Exposes phase-guard evaluation APIs for methodology validation.
/**
 * Phase Guard Evaluation Module
 *
 * Deterministic structural validation for methodology phases.
 * Parses LLM output by section headers and evaluates phase guards.
 */

export { evaluatePhaseGuards, buildPhaseGuardPassSummary } from './phase-guard-evaluator.js';
export { splitBySectionHeaders } from './section-splitter.js';
export { getOutputContract, renderOutputContractSkeleton } from './output-contract.js';
export type { OutputSection } from './section-splitter.js';
export type { OutputContract, ContractHeader } from './output-contract.js';
export type {
  PhaseGuardCheckResult,
  PhaseGuardEvaluationResult,
  PhaseGuardResult,
} from './types.js';
