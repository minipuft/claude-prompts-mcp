// @lifecycle canonical - Interface exports for methodology guides and registry contracts.
/**
 * Methodology Interfaces -  Implementation
 *
 * Consolidated interfaces for methodology guides and registry management.
 * This file centralizes all methodology-related interfaces that were
 * previously distributed across multiple files.
 */

// Re-export all methodology interfaces from the consolidated types
export type {
  ArgumentGuidance,
  ExecutionStep,
  IMethodologyGuide,
  JudgePromptDefinition,
  MethodologyEnhancement,
  MethodologyToolDescription,
  MethodologyToolDescriptions,
  MethodologyValidation,
  ProcessingGuidance,
  ProcessingStep,
  PromptCreationGuidance,
  QualityGate,
  StepGuidance,
  TemplateEnhancement,
} from '../types/methodology-types.js';

export { BaseMethodologyGuide } from '../types/methodology-types.js';
