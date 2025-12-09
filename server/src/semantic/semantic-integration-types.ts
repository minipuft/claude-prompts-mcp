// @lifecycle canonical - Type definitions for framework-semantic integration contracts.
/**
 * Integration Layer Type Definitions
 *
 * Contains types for framework-semantic coordination and shared integration
 * metadata used by the framework switching layer.
 */

import type { ContentAnalysisResult } from './types.js';
import type { ConvertedPrompt } from '../execution/types.js';
import type {
  FrameworkDefinition,
  FrameworkExecutionContext,
} from '../frameworks/types/methodology-types.js';

/**
 * Integrated analysis result combining semantic intelligence and framework methodology
 */
export interface IntegratedAnalysisResult {
  // Semantic analysis results - PROMPT INTELLIGENCE
  semanticAnalysis: ContentAnalysisResult;

  // Framework execution context - METHODOLOGY GUIDANCE
  frameworkContext: FrameworkExecutionContext | null;

  // Integration metadata
  integration: {
    frameworkSelectionReason: string;
    semanticFrameworkAlignment: number; // How well semantic criteria match selected framework
    alternativeFrameworks: FrameworkDefinition[];
    consensusMetrics: {
      confidenceAlignment: number;
      complexityMatch: number;
      executionTypeCompatibility: number;
    };
  };

  // Combined execution recommendations
  recommendations: {
    executionApproach: string;
    expectedPerformance: {
      processingTime: number;
      memoryUsage: string;
      cacheable: boolean;
    };
    qualityAssurance: string[];
    optimizations: string[];
  };

  // Prompt guidance coordination results
  promptGuidance?: {
    guidanceApplied: boolean;
    enhancedPrompt?: any;
    systemPromptInjection?: any;
    processingTimeMs: number;
    confidenceScore: number;
  };
}

/**
 * Framework switching configuration
 */
export interface FrameworkSwitchingConfig {
  enableAutomaticSwitching: boolean;
  switchingThreshold: number; // Confidence threshold for switching
  preventThrashing: boolean; // Prevent rapid framework switches
  switchingCooldownMs: number;
  blacklistedFrameworks: string[];
  preferredFrameworks: string[];
}

/**
 * Framework switch recommendation
 */
export interface FrameworkSwitchRecommendation {
  currentFramework: FrameworkDefinition;
  recommendedFramework: FrameworkDefinition;
  reason: string;
  expectedImprovement: number;
}

/**
 * Framework alignment result
 */
export interface FrameworkAlignmentResult {
  overallAlignment: number;
  detailedMetrics: {
    confidenceAlignment: number;
    complexityMatch: number;
    executionTypeCompatibility: number;
  };
}

/**
 * Framework usage metrics
 */
export interface FrameworkUsageMetrics {
  usageCount: number;
  averageProcessingTime: number;
  averageAlignmentScore: number;
  lastUsed: Date;
}

/**
 * Framework usage insights
 */
export interface FrameworkUsageInsights {
  totalAnalyses: number;
  frameworkUsage: Record<string, FrameworkUsageMetrics & { framework: FrameworkDefinition }>;
  recommendations: string[];
}
