/**
 * Gate Evaluators - Strategy-Based System
 * Clean, unified gate evaluation system with strategy-based organization
 */

// Main Gate Evaluator - Single entry point for all gate evaluation
export { GateEvaluationService, createGateEvaluator } from './gate-evaluator.js';
export { GateEvaluationService as GateEvaluator } from './gate-evaluator.js';

// Strategy-based evaluator factories (for advanced usage)
export { ContentAnalysisEvaluatorFactory } from './strategies/content-analysis-evaluators.js';
export { StructureValidationEvaluatorFactory } from './strategies/structure-validation-evaluators.js';
export { PatternMatchingEvaluatorFactory } from './strategies/pattern-matching-evaluators.js';
export { CustomLogicEvaluatorFactory } from './strategies/custom-logic-evaluators.js';

// Hint generation system
export { HintGeneratorFactory, UniversalHintGenerator } from './hint-generators.js';

// Type exports for advanced usage
export type {
  ExtendedGateType,
  ExtendedGateRequirement,
  GateEvaluationContext,
  EnhancedGateEvaluationResult,
  GateEvaluator as IGateEvaluator,
  HintGenerator,
  ImprovementSuggestion,
} from '../registry/gate-registry.js';

// Note: Legacy duplicate files removed - consolidated to strategy-based system
// All gate evaluation now handled through GateEvaluationService with strategy pattern