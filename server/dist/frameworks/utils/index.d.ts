/**
 * Framework Utilities
 *
 * Shared utility functions for framework detection, compliance validation,
 * template enhancement, and step generation. These utilities enable
 * data-driven methodology guides to work with YAML/JSON definitions.
 */
export * from './framework-detection.js';
export { validateCompliance, assessPhaseQuality, detectPhase, getCombinedText, type QualityIndicator, type PhaseQualityIndicators, type PhaseDetection, type ComplianceValidatorOptions, } from './compliance-validator.js';
export { createMethodologyEnhancement, convertTemplateSuggestions, convertMethodologyGates, convertProcessingSteps, getSystemPromptGuidance, type ProcessingStepDefinition, type MethodologyDefinitionForEnhancement, } from './template-enhancer.js';
export { generateProcessingSteps, generateExecutionSteps, createProcessingGuidance, createStepGuidance, type ExecutionStepDefinition, type TemplateEnhancementsDefinition, type ExecutionFlowDefinition, type ExecutionTypeEnhancements, type PhasesDefinition, } from './step-generator.js';
