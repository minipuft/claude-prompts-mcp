// @lifecycle canonical - Interface exports for framework guides and registry contracts.
/**
 * Framework Interfaces -  Implementation
 *
 * Consolidated interfaces for framework guides and registry management.
 * This file centralizes all framework-related interfaces that were
 * previously distributed across multiple files.
 */

// Re-export all framework interfaces from the consolidated types
export type {
  ArgumentGuidance,
  ExecutionStep,
  FrameworkGuide,
  JudgePromptDefinition,
  FrameworkEnhancement,
  FrameworkToolDescription,
  FrameworkToolDescriptions,
  FrameworkValidation,
  ProcessingGuidance,
  ProcessingStep,
  PromptCreationGuidance,
  QualityGate,
  StepGuidance,
  TemplateEnhancement,
} from '../types/methodology-types.js';

export { BaseFrameworkGuide } from '../types/methodology-types.js';
