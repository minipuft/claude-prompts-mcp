// @lifecycle canonical - Types for prompt resource services.
/**
 * Shared types and interfaces for prompt resource services.
 */

import { ConfigManager } from '../../../../config/index.js';
import { FrameworkManager } from '../../../../frameworks/framework-manager.js';
import { FrameworkStateManager } from '../../../../frameworks/framework-state-manager.js';
import { Logger } from '../../../../logging/index.js';
import { ContentAnalyzer } from '../../../../semantic/configurable-semantic-analyzer.js';
import { ToolResponse, ConvertedPrompt, PromptData, Category } from '../../../../types/index.js';

export type { CategoryResult } from '../../../../prompts/category-maintenance.js';

export interface PromptClassification {
  executionType: 'single' | 'chain';
  requiresExecution: boolean;
  requiresFramework: boolean;
  confidence: number;
  reasoning: string[];
  suggestedGates: string[];
  framework?: string;
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

export interface AnalysisResult {
  classification: PromptClassification;
  feedback: string;
  suggestions: string[];
}

export interface SmartFilters {
  text?: string;
  type?: string;
  category?: string;
  confidence?: { min?: number; max?: number };
  execution?: boolean;
  gates?: boolean;
  intent?: string;
}

export interface PromptResourceDependencies {
  logger: Logger;
  mcpServer?: any;
  configManager: ConfigManager;
  semanticAnalyzer: ContentAnalyzer;
  frameworkStateManager?: FrameworkStateManager;
  frameworkManager?: FrameworkManager;
  onRefresh: () => Promise<void>;
  onRestart: (reason: string) => Promise<void>;
}

export interface PromptResourceData {
  promptsData: PromptData[];
  convertedPrompts: ConvertedPrompt[];
  categories: Category[];
}

export interface OperationResult {
  message: string;
  affectedFiles?: string[];
  metadata?: any;
}

export interface ValidationContext {
  operation: string;
  requiredFields: string[];
  providedFields: string[];
}

export interface FileOperationResult {
  exists: boolean;
  path?: string;
  metadata?: any;
}

export interface DependencyAnalysis {
  dependencies: ConvertedPrompt[];
  risks: string[];
  warnings: string[];
}

export interface MigrationResult {
  fromType: string;
  toType: string;
  changes: string[];
  result: ToolResponse;
}

export interface PromptResourceModule {
  updateData?(data: PromptResourceData): void;
  setFrameworkStateManager?(frameworkStateManager: FrameworkStateManager): void;
  setFrameworkManager?(frameworkManager: FrameworkManager): void;
}
