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
  FrameworkEnhancement,
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
  frameworkTracking: {
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
  frameworkEnhancement: FrameworkEnhancement | null;
  /** Guidance metadata */
  metadata: {
    guidanceTime: Date;
    activeFrameworkType: string;
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
  frameworkUsage: Record<
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
 * Methodology system health information ()
 */
export interface FrameworkHealth {
  /** System health status */
  status: 'healthy' | 'degraded' | 'error';
  /** Currently active methodology */
  activeFrameworkType: string;
  /** Whether methodology system is enabled */
  frameworkSystemEnabled: boolean;
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
 * Template processing guidance from methodology guides.
 * Alias to ProcessingGuidance to keep a single source of truth.
 */
export type TemplateProcessingGuidance = ProcessingGuidance;
