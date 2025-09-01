/**
 * Framework Analysis Interfaces
 * Defines standardized contracts for pluggable framework analyzers
 * Enables separation of semantic analysis from specific methodological frameworks
 */

import { ConvertedPrompt } from "../../types/index.js";

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
export type ExecutionType = "template" | "workflow" | "chain" | "auto";

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
 * Framework configuration options
 */
export interface FrameworkConfig {
  defaultFramework?: string;
  enabledFrameworks: string[];
  frameworkSettings: Record<string, any>;
  fallbackBehavior: 'disable' | 'basic' | 'default';
}

/**
 * Base abstract class for framework analyzers
 * Provides common functionality and enforces interface compliance
 */
export abstract class BaseFrameworkAnalyzer<TAnalysis = any> implements IFrameworkAnalyzer<TAnalysis> {
  abstract readonly frameworkId: string;
  abstract readonly frameworkName: string;
  abstract readonly version: string;

  abstract analyzePrompt(prompt: ConvertedPrompt): TAnalysis;

  /**
   * Default implementation of text analysis using prompt conversion
   */
  analyzeText(text: string): TAnalysis {
    // Convert string to minimal ConvertedPrompt object for analysis
    const prompt: ConvertedPrompt = {
      id: 'text-analysis',
      name: 'Text Analysis',
      description: 'Text analysis for framework compliance',
      category: 'analysis',
      userMessageTemplate: text || '',
      arguments: []
    };
    
    return this.analyzePrompt(prompt);
  }

  abstract getAnalysisSummary(analysis: TAnalysis): string;
  abstract getEnhancementSuggestions(analysis: TAnalysis): FrameworkEnhancement[];
  abstract calculateOverallScore(analysis: TAnalysis): number;
  abstract getSuggestedGates(analysis: TAnalysis): string[];

  /**
   * Utility method to get combined text from prompt
   */
  protected getCombinedText(prompt: ConvertedPrompt): string {
    if (!prompt) {
      return "";
    }
    
    // Enhanced null safety for all fields
    const systemMessage = prompt.systemMessage?.trim() || "";
    const userMessage = prompt.userMessageTemplate?.trim() || "";
    const description = prompt.description?.trim() || "";
    
    return `${systemMessage} ${userMessage} ${description}`.trim().toLowerCase();
  }

  /**
   * Utility method to normalize confidence scores
   */
  protected normalizeConfidence(score: number): number {
    return Math.max(0, Math.min(1, score));
  }
}