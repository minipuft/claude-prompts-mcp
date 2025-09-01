/**
 * Gate System
 * Complete gate validation and evaluation system
 */

export * from './registry/index.js';
export { GateEvaluationService, createGateEvaluator } from './evaluators/index.js';
// Note: UnifiedGateEvaluator removed - consolidated to strategy-based GateEvaluationService