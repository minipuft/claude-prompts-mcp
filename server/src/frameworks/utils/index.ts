// @lifecycle canonical - Barrel exports for framework utility modules.
/**
 * Framework Utilities
 *
 * Shared utility functions for framework detection, compliance validation,
 * template enhancement, and step generation. These utilities enable
 * data-driven methodology guides to work with YAML/JSON definitions.
 */

// Existing utilities
export * from './framework-detection.js';

// Compliance validation utilities
export {
  validateCompliance,
  assessPhaseQuality,
  detectPhase,
  getCombinedText,
  type QualityIndicator,
  type PhaseQualityIndicators,
  type PhaseDetection,
  type ComplianceValidatorOptions,
} from './compliance-validator.js';

// Template enhancement utilities
// Note: MethodologyGateDefinition and TemplateSuggestion are now canonical in methodology/methodology-definition-types.ts
// They're re-exported via methodology/index.ts to avoid conflicts in the frameworks barrel export
export {
  createMethodologyEnhancement,
  convertTemplateSuggestions,
  convertMethodologyGates,
  convertProcessingSteps,
  getSystemPromptGuidance,
  type ProcessingStepDefinition,
  type MethodologyDefinitionForEnhancement,
} from './template-enhancer.js';

// Step generation utilities
export {
  generateProcessingSteps,
  generateExecutionSteps,
  createProcessingGuidance,
  createStepGuidance,
  type ExecutionStepDefinition,
  type TemplateEnhancementsDefinition,
  type ExecutionFlowDefinition,
  type ExecutionTypeEnhancements,
  type PhasesDefinition,
} from './step-generator.js';
