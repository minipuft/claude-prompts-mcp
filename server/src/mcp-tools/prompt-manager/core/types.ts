// @lifecycle canonical - Type definitions for prompt manager internals.
/**
 * Shared types and interfaces for prompt manager modules
 */

import { ConfigManager } from '../../../config/index.js';
import { FrameworkManager } from '../../../frameworks/framework-manager.js';
import { FrameworkStateManager } from '../../../frameworks/framework-state-manager.js';
import { Logger } from '../../../logging/index.js';
import { ContentAnalyzer } from '../../../semantic/configurable-semantic-analyzer.js';
import { ToolResponse, ConvertedPrompt, PromptData, Category } from '../../../types/index.js';

export type { CategoryResult } from '../../../prompts/category-maintenance.js';

/**
 * Prompt classification interface for management operations
 */
export interface PromptClassification {
  executionType: 'single' | 'chain';
  requiresExecution: boolean;
  requiresFramework: boolean;
  confidence: number;
  reasoning: string[];
  suggestedGates: string[];
  framework?: string;
  // Enhanced with configurable analysis information
  analysisMode?: string;
  capabilities?: {
    canDetectStructure: boolean;
    canAnalyzeComplexity: boolean;
    canRecommendFramework: boolean;
    hasSemanticUnderstanding: boolean;
  };
  limitations?: string[];
  warnings?: string[];
}

/**
 * Analysis result with feedback and suggestions
 */
export interface AnalysisResult {
  classification: PromptClassification;
  feedback: string;
  suggestions: string[];
}

/**
 * Smart filter criteria for prompt discovery
 */
export interface SmartFilters {
  text?: string;
  type?: string;
  category?: string;
  confidence?: { min?: number; max?: number };
  execution?: boolean;
  gates?: boolean;
  intent?: string;
}

/**
 * Dependencies required by all prompt manager modules
 */
export interface PromptManagerDependencies {
  logger: Logger;
  mcpServer: any;
  configManager: ConfigManager;
  semanticAnalyzer: ContentAnalyzer;
  frameworkStateManager?: FrameworkStateManager;
  frameworkManager?: FrameworkManager;
  onRefresh: () => Promise<void>;
  onRestart: (reason: string) => Promise<void>;
}

/**
 * Data references shared across modules
 */
export interface PromptManagerData {
  promptsData: PromptData[];
  convertedPrompts: ConvertedPrompt[];
  categories: Category[];
}

/**
 * Common operation result interface
 */
export interface OperationResult {
  message: string;
  affectedFiles?: string[];
  metadata?: any;
}

/**
 * Validation error details
 */
export interface ValidationContext {
  operation: string;
  requiredFields: string[];
  providedFields: string[];
}

/**
 * File operation result
 */
export interface FileOperationResult {
  exists: boolean;
  path?: string;
  metadata?: any;
}

/**
 * Dependency analysis result
 */
export interface DependencyAnalysis {
  dependencies: ConvertedPrompt[];
  risks: string[];
  warnings: string[];
}

/**
 * Migration operation result
 */
export interface MigrationResult {
  fromType: string;
  toType: string;
  changes: string[];
  result: ToolResponse;
}

/**
 * Base interface for all modular components
 */
export interface PromptManagerModule {
  /**
   * Update data references
   */
  updateData?(data: PromptManagerData): void;

  /**
   * Set framework state manager
   */
  setFrameworkStateManager?(frameworkStateManager: FrameworkStateManager): void;

  /**
   * Set framework manager
   */
  setFrameworkManager?(frameworkManager: FrameworkManager): void;
}
