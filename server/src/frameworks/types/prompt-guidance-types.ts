// @lifecycle canonical - Types for system prompt injection and template guidance flows.
/**
 * Prompt Guidance Type Definitions
 *
 * Contains all types related to prompt enhancement, system prompt injection,
 * and methodology-driven template processing. These types support the prompt
 * guidance system that enhances MCP prompts with methodology-specific improvements.
 */

import type {
  FrameworkDefinition,
  MethodologyEnhancement,
  ProcessingGuidance,
} from './methodology-types.js';
import type { ConvertedPrompt } from '../../execution/types.js';

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
    // Semantic analysis metadata
    semanticAware?: boolean;
    semanticComplexity?: 'low' | 'medium' | 'high';
    semanticConfidence?: number;
  };
}

/**
 * Methodology tracking state
 */
/**
 * Prompt guidance configuration
 */
export interface PromptGuidanceConfig {
  /** System prompt injection configuration */
  systemPromptInjection: SystemPromptInjectionConfig;
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
  /** Methodology usage distribution */
  methodologyUsage: Record<
    string,
    {
      count: number;
      averageConfidence: number;
      successRate: number;
    }
  >;
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
   * Get current methodology state
   */
  getCurrentMethodologyState(): MethodologyState;

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
 * Methodology state information
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
 * Methodology switch request ()
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
 * Methodology system health information ()
 */
export interface MethodologyHealth {
  /** System health status */
  status: 'healthy' | 'degraded' | 'error';
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
 * Persisted methodology state for disk storage ()
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
 * Template processing guidance from methodology guides.
 * Alias to ProcessingGuidance to keep a single source of truth.
 */
export type TemplateProcessingGuidance = ProcessingGuidance;
