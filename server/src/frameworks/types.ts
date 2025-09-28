/**
 * Framework System Type Definitions
 *
 * Contains all types related to methodology frameworks, framework management,
 * and framework-aware processing. This includes framework definitions, states,
 * and integration interfaces.
 */

import type { ConvertedPrompt } from '../execution/types.js';

/**
 * Framework definition structure
 */
export interface FrameworkDefinition {
  /** Unique identifier for the framework */
  id: string;
  /** Human-readable name */
  name: string;
  /** Framework methodology/approach */
  methodology: string;
  /** Framework description */
  description: string;
  /** Whether this framework is currently active */
  isActive: boolean;
  /** Framework version */
  version?: string;
  /** Framework metadata */
  metadata?: {
    author?: string;
    tags?: string[];
    compatibilityVersion?: string;
    dependencies?: string[];
  };
}

/**
 * Framework state information
 */
export interface FrameworkState {
  /** Currently active framework ID */
  activeFramework: string;
  /** Available frameworks */
  availableFrameworks: string[];
  /** Framework switch history */
  switchHistory: FrameworkSwitchRecord[];
  /** Framework performance metrics */
  performanceMetrics: Record<string, FrameworkPerformanceMetrics>;
  /** Last switch timestamp */
  lastSwitchTime: number;
  /** Total number of switches */
  totalSwitches: number;
}

/**
 * Framework switch record
 */
export interface FrameworkSwitchRecord {
  /** Switch timestamp */
  timestamp: number;
  /** Framework switched from */
  fromFramework: string;
  /** Framework switched to */
  toFramework: string;
  /** Reason for switch */
  reason?: string;
  /** Whether switch was successful */
  success: boolean;
  /** Switch duration in milliseconds */
  duration?: number;
}

/**
 * Framework performance metrics
 */
export interface FrameworkPerformanceMetrics {
  /** Total executions with this framework */
  totalExecutions: number;
  /** Successful executions */
  successfulExecutions: number;
  /** Average execution time */
  averageExecutionTime: number;
  /** Last used timestamp */
  lastUsed: number;
  /** Usage frequency */
  usageFrequency: number;
}

/**
 * Framework configuration options
 */
export interface FrameworkConfig {
  defaultFramework?: string;
  enabledFrameworks: string[];
  frameworkSettings: Record<string, any>;
  fallbackBehavior: 'disable' | 'basic' | 'default';
}

/**
 * Framework enhancement suggestion structure
 */
export interface FrameworkEnhancement {
  section: string;
  priority: 'high' | 'medium' | 'low';
  suggestion: string;
  templateAddition?: string;
  confidence: number;
}

/**
 * Framework metadata for registry management
 */
export interface FrameworkMetadata {
  description: string;
  author: string;
  tags: string[];
  compatibilityVersion: string;
  dependencies?: string[];
}

/**
 * Framework registry entry structure
 */
export interface FrameworkRegistryEntry {
  analyzer: IFrameworkAnalyzer;
  isDefault: boolean;
  priority: number;
  enabled: boolean;
  metadata: FrameworkMetadata;
}

/**
 * Base interface for all framework analyzers
 * Provides standardized analysis contracts while allowing framework-specific implementations
 */
export interface IFrameworkAnalyzer<TAnalysis = any, TCompliance = any> {
  /**
   * Unique identifier for the framework
   */
  readonly frameworkId: string;

  /**
   * Human-readable name of the framework
   */
  readonly frameworkName: string;

  /**
   * Version of the framework analyzer implementation
   */
  readonly version: string;

  /**
   * Analyze a prompt using this framework's methodology
   * @param prompt The prompt to analyze
   * @returns Framework-specific analysis results
   */
  analyzePrompt(prompt: ConvertedPrompt): TAnalysis;

  /**
   * Analyze raw text using this framework's methodology
   * Convenience method for performance testing and simple text analysis
   * @param text The text to analyze
   * @returns Framework-specific analysis results
   */
  analyzeText(text: string): TAnalysis;

  /**
   * Get human-readable analysis summary
   * @param analysis The analysis results to summarize
   * @returns Formatted summary string
   */
  getAnalysisSummary(analysis: TAnalysis): string;

  /**
   * Get framework-specific enhancement suggestions for templates
   * @param analysis The analysis results
   * @returns Array of enhancement suggestions
   */
  getEnhancementSuggestions(analysis: TAnalysis): FrameworkEnhancement[];

  /**
   * Calculate overall compliance/quality score (0.0 to 1.0)
   * @param analysis The analysis results
   * @returns Normalized score between 0 and 1
   */
  calculateOverallScore(analysis: TAnalysis): number;

  /**
   * Get framework-specific gate suggestions for workflow validation
   * @param analysis The analysis results
   * @returns Array of suggested validation gates
   */
  getSuggestedGates(analysis: TAnalysis): string[];
}

/**
 * Basic semantic analysis result structure (framework-agnostic)
 */
export interface SemanticAnalysisResult {
  executionType: ExecutionType;
  requiresExecution: boolean;
  confidence: number;
  reasoning: string[];
  suggestedGates: string[];
}

/**
 * Enhanced semantic analysis with framework insights
 */
export interface EnhancedSemanticResult extends SemanticAnalysisResult {
  frameworkAnalysis?: any;
  frameworkCompliance?: number;
  methodologyScore?: number;
  frameworkEnhancements?: FrameworkEnhancement[];
}

/**
 * Execution types for semantic analysis
 */
export type ExecutionType = "template" | "chain" | "auto";

/**
 * Enhanced framework analyzer with semantic integration capabilities
 * Extends base analyzer with semantic enhancement hooks
 */
export interface ISemanticFrameworkAnalyzer<TAnalysis = any> extends IFrameworkAnalyzer<TAnalysis> {
  /**
   * Enhance basic semantic analysis with framework-specific insights
   * @param basicAnalysis Basic semantic analysis results
   * @param frameworkAnalysis Framework-specific analysis results
   * @returns Enhanced analysis classification
   */
  enhanceSemanticAnalysis(
    basicAnalysis: SemanticAnalysisResult,
    frameworkAnalysis: TAnalysis
  ): EnhancedSemanticResult;

  /**
   * Determine if framework analysis should upgrade execution type
   * @param frameworkAnalysis Framework-specific analysis results
   * @param currentType Current execution type from semantic analysis
   * @returns Recommended execution type or null for no change
   */
  recommendExecutionType(
    frameworkAnalysis: TAnalysis,
    currentType: ExecutionType
  ): ExecutionType | null;
}

/**
 * Framework switch result
 */
export interface FrameworkSwitchResult {
  /** Whether the switch was successful */
  success: boolean;
  /** Previous framework ID */
  previousFramework: string;
  /** New framework ID */
  newFramework: string;
  /** Switch timestamp */
  timestamp: number;
  /** Switch duration in milliseconds */
  duration: number;
  /** Error message if switch failed */
  error?: string;
  /** Additional context */
  context?: Record<string, any>;
}

/**
 * Framework validation result
 */
export interface FrameworkValidationResult {
  /** Whether the framework is valid */
  valid: boolean;
  /** Framework ID that was validated */
  frameworkId: string;
  /** Validation errors */
  errors: string[];
  /** Validation warnings */
  warnings: string[];
  /** Validation timestamp */
  timestamp: number;
}