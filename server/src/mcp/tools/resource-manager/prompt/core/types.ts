// @lifecycle canonical - Types for prompt resource services.
/**
 * Shared types and interfaces for prompt resource services.
 */

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { PromptData, Category } from '#modules/prompts/types.js';

import { FrameworkManager } from '#engine/frameworks/framework-manager.js';
import { FrameworkStateStore } from '#engine/frameworks/framework-state-store.js';
import { ContentAnalyzer } from '#modules/semantic/content-analyzer.js';
import { type Logger, ToolResponse, ConfigManager } from '#shared/types/index.js';

export type { CategoryResult } from '#modules/prompts/category-maintenance.js';

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
  configManager: ConfigManager;
  semanticAnalyzer: ContentAnalyzer;
  frameworkStateStore?: FrameworkStateStore;
  frameworkManager?: FrameworkManager;
  onRefresh: () => Promise<void>;
  onRestart: (reason: string) => Promise<void>;
}

export interface PromptResourceData {
  promptsData: PromptData[];
  convertedPrompts: ConvertedPrompt[];
  categories: Category[];
}

/**
 * Whether a category's written prompts are actually tracked by git (P7-D4).
 *
 * `server/resources/prompts/.gitignore` allowlists which categories ship in the published repo —
 * the write path never consulted it, so `create`/`update` reported identical success whether the
 * prompt landed in a shipped category or a gitignored one. `ships: false` does not block the
 * write (OQ-P7-4 ruled warn, not refuse); it only tells the caller the file will not be tracked.
 */
export interface CategoryShipStatus {
  /** Slugified category (matches the directory actually written to disk). */
  category: string;
  /** `false` means the category is excluded by the allowlist and will not ship with the repo. */
  ships: boolean;
  /** Absolute path to the `.gitignore` consulted — may not exist (workspace overlays). */
  gitignorePath: string;
}

export interface OperationResult {
  message: string;
  affectedFiles?: string[];
  metadata?: any;
  /** Present whenever a write path resolved category-ship status (P7-D4). */
  categoryShipStatus?: CategoryShipStatus;
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
  setFrameworkStateStore?(frameworkStateStore: FrameworkStateStore): void;
  setFrameworkManager?(frameworkManager: FrameworkManager): void;
}
