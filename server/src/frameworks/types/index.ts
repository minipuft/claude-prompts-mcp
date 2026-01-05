// @lifecycle canonical - Barrel exports for framework and methodology type contracts.
/**
 * Framework Types Index
 *
 * Consolidated export of all framework-related type definitions.
 * This replaces the distributed type definitions across multiple files
 * and provides a single source of truth for framework types.
 */

// Methodology guide types
export type {
  ArgumentGuidance,
  ExecutionStep,
  FrameworkDefinition,
  FrameworkExecutionContext,
  FrameworkMethodology,
  FrameworkSelectionCriteria,
  FrameworkType,
  IMethodologyGuide,
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
} from './methodology-types.js';

export { BaseMethodologyGuide } from './methodology-types.js';

// Prompt guidance types
export type {
  FrameworkStateInfo,
  IPromptGuidanceService,
  MethodologyHealth,
  MethodologyState,
  MethodologySwitchRequest,
  PersistedMethodologyState,
  PromptGuidanceAnalytics,
  PromptGuidanceConfig,
  PromptGuidanceResult,
  SystemPromptInjectionConfig,
  SystemPromptInjectionResult,
  TemplateProcessingGuidance,
} from './prompt-guidance-types.js';

// Integration types
export type {
  FrameworkAlignmentResult,
  FrameworkSwitchRecommendation,
  FrameworkSwitchingConfig,
  FrameworkUsageInsights,
  FrameworkUsageMetrics,
  IntegratedAnalysisResult,
} from '../../semantic/semantic-integration-types.js';
