/**
 * Methodology Interfaces - Phase 2 Implementation
 *
 * Consolidated interfaces for methodology guides and registry management.
 * This file centralizes all methodology-related interfaces that were
 * previously distributed across multiple files.
 */

// Re-export all methodology interfaces from the consolidated types
export type {
  IMethodologyGuide,
  PromptCreationGuidance,
  ProcessingGuidance,
  StepGuidance,
  MethodologyEnhancement,
  ArgumentGuidance,
  ProcessingStep,
  ExecutionStep,
  QualityGate,
  TemplateEnhancement,
  MethodologyToolDescription,
  MethodologyToolDescriptions,
  MethodologyValidation
} from "../types/methodology-types.js";

export {
  BaseMethodologyGuide
} from "../types/methodology-types.js";
