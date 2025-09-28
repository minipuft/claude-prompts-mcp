/**
 * Prompt Guidance Type Definitions
 *
 * Contains all types related to prompt enhancement, system prompt injection,
 * and methodology-driven template processing. These types support the prompt
 * guidance system that enhances MCP prompts with methodology-specific improvements.
 */

import type { ConvertedPrompt } from '../../types/index.js';
import type { FrameworkDefinition, MethodologyEnhancement, ProcessingGuidance } from './methodology-types.js';

/**
 * System prompt injection configuration
 */
export interface SystemPromptInjectionConfig {
  /** Whether to inject methodology guidance into system prompts */
  enabled: boolean;
  /** Priority of injection (higher values override lower) */
  priority: number;
  /** Template for injecting methodology guidance */
  injectionTemplate: string;
  /** Variables available for injection template */
  availableVariables: string[];
}

/**
 * System prompt injection result
 */
export interface SystemPromptInjectionResult {
  /** Original system prompt before injection */
  originalPrompt: string;
  /** Enhanced system prompt with methodology guidance */
  enhancedPrompt: string;
  /** Methodology guidance that was injected */
  injectedGuidance: string;
  /** Framework that provided the guidance */
  sourceFramework: FrameworkDefinition;
  /** Injection metadata */
  metadata: {
    injectionTime: Date;
    injectionMethod: string;
    variablesUsed: string[];
    confidence: number;
    processingTimeMs: number;
    validationPassed: boolean;
    error?: string;
    // Phase 4: Semantic analysis metadata
    semanticAware?: boolean;
    semanticComplexity?: 'low' | 'medium' | 'high';
    semanticConfidence?: number;
  };
}

/**
 * Template enhancement configuration
 */
export interface TemplateEnhancementConfig {
  /** Whether to enhance templates with methodology guidance */
  enabled: boolean;
  /** Types of enhancements to apply */
  enabledEnhancements: TemplateEnhancementType[];
  /** Minimum confidence threshold for applying enhancements */
  confidenceThreshold: number;
  /** Maximum number of enhancements to apply */
  maxEnhancements: number;
}

/**
 * Types of template enhancements
 */
export type TemplateEnhancementType =
  | 'structure'
  | 'clarity'
  | 'completeness'
  | 'methodology_alignment'
  | 'quality_gates';

/**
 * Template enhancement result
 */
export interface TemplateEnhancementResult {
  /** Original template before enhancement */
  originalTemplate: string;
  /** Enhanced template with methodology improvements */
  enhancedTemplate: string;
  /** Applied enhancements */
  suggestions: string[];
  /** Template processing guidance from methodology */
  processingGuidance: ProcessingGuidance;
  /** Framework that provided the guidance */
  sourceFramework: FrameworkDefinition;
  /** Enhancement metadata */
  metadata: {
    enhancementTime: Date;
    enhancementLevel: 'minimal' | 'moderate' | 'comprehensive';
    suggestionsCount: number;
    validationPassed: boolean;
    processingTimeMs: number;
    methodologyApplied: string;
    error?: string;
    // Phase 4: Semantic analysis metadata
    semanticAware?: boolean;
    semanticComplexity?: 'low' | 'medium' | 'high';
    semanticConfidence?: number;
    semanticEnhancementsApplied?: string[];
  };
  /** Validation result */
  validation: {
    passed: boolean;
    score: number;
    issues: string[];
    recommendations: string[];
  };
}

/**
 * Applied enhancement details
 */
export interface AppliedEnhancement {
  /** Type of enhancement applied */
  type: TemplateEnhancementType;
  /** Description of what was enhanced */
  description: string;
  /** Location in template where enhancement was applied */
  location: 'system' | 'user' | 'arguments' | 'metadata';
  /** Enhancement content that was added/modified */
  content: string;
  /** Confidence in this enhancement */
  confidence: number;
  /** Methodology justification for the enhancement */
  justification: string;
}

/**
 * Methodology tracking state
 */
export interface MethodologyTrackingState {
  /** Currently active methodology */
  activeMethodology: string;
  /** Previous methodology (for switch tracking) */
  previousMethodology: string | null;
  /** When the current methodology was activated */
  activatedAt: Date;
  /** Reason for the current methodology selection */
  activationReason: string;
  /** Whether methodology tracking is enabled */
  trackingEnabled: boolean;
  /** Methodology switch history */
  switchHistory: MethodologySwitchRecord[];
}

/**
 * Methodology switch record
 */
export interface MethodologySwitchRecord {
  /** When the switch occurred */
  timestamp: Date;
  /** Methodology switched from */
  fromMethodology: string;
  /** Methodology switched to */
  toMethodology: string;
  /** Reason for the switch */
  reason: string;
  /** Whether the switch was successful */
  successful: boolean;
  /** Switch duration in milliseconds */
  duration: number;
}

/**
 * Methodology state change event
 */
export interface MethodologyStateChangeEvent {
  /** Type of state change */
  type: 'switch' | 'enable' | 'disable' | 'error';
  /** Previous state */
  previousState: MethodologyTrackingState;
  /** New state */
  newState: MethodologyTrackingState;
  /** Event timestamp */
  timestamp: Date;
  /** Additional event context */
  context?: Record<string, any>;
}

/**
 * Prompt guidance configuration
 */
export interface PromptGuidanceConfig {
  /** System prompt injection configuration */
  systemPromptInjection: SystemPromptInjectionConfig;
  /** Template enhancement configuration */
  templateEnhancement: TemplateEnhancementConfig;
  /** Methodology tracking configuration */
  methodologyTracking: {
    enabled: boolean;
    persistState: boolean;
    trackSwitches: boolean;
    maxHistoryEntries: number;
  };
}

/**
 * Comprehensive prompt guidance result
 */
export interface PromptGuidanceResult {
  /** Original prompt before guidance was applied */
  originalPrompt: ConvertedPrompt;
  /** Enhanced prompt with all guidance applied */
  enhancedPrompt: ConvertedPrompt;
  /** System prompt injection result */
  systemPromptInjection: SystemPromptInjectionResult | null;
  /** Template enhancement result */
  templateEnhancement: TemplateEnhancementResult | null;
  /** Applied methodology enhancement */
  methodologyEnhancement: MethodologyEnhancement | null;
  /** Guidance metadata */
  metadata: {
    guidanceTime: Date;
    activeMethodology: string;
    totalEnhancements: number;
    confidenceScore: number;
    processingTime: number;
  };
}

/**
 * Prompt guidance analytics
 */
export interface PromptGuidanceAnalytics {
  /** Total number of prompts enhanced */
  totalEnhanced: number;
  /** Enhancement success rate */
  successRate: number;
  /** Average enhancement confidence */
  averageConfidence: number;
  /** Most common enhancement types */
  commonEnhancements: Record<TemplateEnhancementType, number>;
  /** Methodology usage distribution */
  methodologyUsage: Record<string, {
    count: number;
    averageConfidence: number;
    successRate: number;
  }>;
  /** Performance metrics */
  performance: {
    averageProcessingTime: number;
    maxProcessingTime: number;
    totalProcessingTime: number;
  };
}

/**
 * Framework state information for prompt guidance
 */
export interface FrameworkStateInfo {
  /** Whether framework system is enabled */
  frameworkSystemEnabled: boolean;
  /** Active framework definition */
  activeFramework: FrameworkDefinition | null;
  /** Available frameworks */
  availableFrameworks: FrameworkDefinition[];
  /** Framework health status */
  healthStatus: 'healthy' | 'degraded' | 'error';
  /** Framework switching metrics */
  switchingMetrics: {
    totalSwitches: number;
    successfulSwitches: number;
    averageResponseTime: number;
  };
}

/**
 * Prompt guidance service interface
 */
export interface IPromptGuidanceService {
  /**
   * Apply comprehensive guidance to a prompt
   */
  applyGuidance(
    prompt: ConvertedPrompt,
    config?: Partial<PromptGuidanceConfig>
  ): Promise<PromptGuidanceResult>;

  /**
   * Get current methodology tracking state
   */
  getMethodologyState(): MethodologyTrackingState;

  /**
   * Get framework state information
   */
  getFrameworkState(): FrameworkStateInfo;

  /**
   * Get guidance analytics
   */
  getAnalytics(): PromptGuidanceAnalytics;

  /**
   * Reset analytics and tracking data
   */
  resetAnalytics(): void;
}

/**
 * Methodology state information (Phase 3)
 */
export interface MethodologyState {
  /** Currently active methodology */
  activeMethodology: string;
  /** Previous methodology (for switch tracking) */
  previousMethodology: string | null;
  /** When the current methodology was activated */
  switchedAt: Date;
  /** Reason for the current methodology selection */
  switchReason: string;
  /** Whether methodology system is healthy */
  isHealthy: boolean;
  /** Whether methodology system is enabled */
  methodologySystemEnabled: boolean;
  /** Methodology switching metrics */
  switchingMetrics: {
    switchCount: number;
    averageResponseTime: number;
    errorCount: number;
  };
}

/**
 * Methodology switch request (Phase 3)
 */
export interface MethodologySwitchRequest {
  /** Target methodology to switch to */
  targetMethodology: string;
  /** Reason for the switch */
  reason?: string;
  /** Additional criteria for the switch */
  criteria?: Record<string, any>;
}

/**
 * Methodology system health information (Phase 3)
 */
export interface MethodologyHealth {
  /** System health status */
  status: "healthy" | "degraded" | "error";
  /** Currently active methodology */
  activeMethodology: string;
  /** Whether methodology system is enabled */
  methodologySystemEnabled: boolean;
  /** Last switch time */
  lastSwitchTime: Date | null;
  /** Switching performance metrics */
  switchingMetrics: {
    totalSwitches: number;
    successfulSwitches: number;
    failedSwitches: number;
    averageResponseTime: number;
  };
  /** Current health issues */
  issues: string[];
}

/**
 * Persisted methodology state for disk storage (Phase 3)
 */
export interface PersistedMethodologyState {
  /** State format version */
  version: string;
  /** Whether methodology system is enabled */
  methodologySystemEnabled: boolean;
  /** Currently active methodology */
  activeMethodology: string;
  /** Last switch timestamp as ISO string */
  lastSwitchedAt: string;
  /** Reason for current state */
  switchReason: string;
}

/**
 * Template processing guidance from methodology guides (Phase 3)
 * Extends the base ProcessingGuidance interface
 */
export interface TemplateProcessingGuidance {
  // Methodology-specific processing steps
  processingSteps: Array<{
    id: string;
    name: string;
    action: string;
    methodologyPhase: string;
    dependencies: string[];
    expected_output: string;
  }>;

  // Template enhancement suggestions
  templateEnhancements: {
    systemPromptAdditions: string[];
    userPromptModifications: string[];
    contextualHints: string[];
  };

  // Execution flow guidance
  executionFlow: {
    preProcessingSteps: string[];
    postProcessingSteps: string[];
    validationSteps: string[];
  };
}