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
  FrameworkMethodology,
  FrameworkDefinition,
  FrameworkExecutionContext,
  FrameworkSelectionCriteria,
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
  MethodologyValidation,
  IMethodologyGuide
} from './methodology-types.js';

export {
  BaseMethodologyGuide
} from './methodology-types.js';

// Prompt guidance types
export type {
  SystemPromptInjectionConfig,
  SystemPromptInjectionResult,
  TemplateEnhancementConfig,
  TemplateEnhancementType,
  TemplateEnhancementResult,
  AppliedEnhancement,
  MethodologyTrackingState,
  MethodologySwitchRecord,
  MethodologyStateChangeEvent,
  PromptGuidanceConfig,
  PromptGuidanceResult,
  PromptGuidanceAnalytics,
  FrameworkStateInfo,
  IPromptGuidanceService,
  // Phase 3 additions
  MethodologyState,
  MethodologySwitchRequest,
  MethodologyHealth,
  PersistedMethodologyState,
  TemplateProcessingGuidance
} from './prompt-guidance-types.js';

// Integration types
export type {
  IntegratedAnalysisResult,
  FrameworkSwitchingConfig,
  FrameworkAlignmentResult,
  FrameworkUsageInsights,
  FrameworkUsageMetrics,
  FrameworkSwitchRecommendation,
  MCPToolIntegrationContext,
  MCPToolIntegrationResult,
  SemanticIntegrationConfig,
  CrossSystemIntegrationStatus,
  IntegrationPerformanceMetrics,
  IntegrationEvent,
  IFrameworkSemanticIntegration,
  IMCPToolIntegration,
  SystemIntegrationConfig
} from './integration-types.js';

// Legacy type aliases for backward compatibility during migration
// These will be removed in Phase 4
export type {
  FrameworkDefinition as LegacyFrameworkDefinition,
  FrameworkExecutionContext as LegacyFrameworkExecutionContext,
  FrameworkSelectionCriteria as LegacyFrameworkSelectionCriteria
} from './methodology-types.js';
