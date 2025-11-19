// @lifecycle canonical - Barrel exports for the prompt manager MCP tool.
/**
 * Prompt Manager - Modular Architecture Entry Point
 *
 * This module maintains 100% backwards compatibility while providing
 * a modular internal architecture for improved maintainability.
 */

// Export the main class and factory function with exact same API
export { ConsolidatedPromptManager } from './core/manager.js';
export { createConsolidatedPromptManager } from './core/manager.js';

// Export types for external use
export type { PromptClassification, AnalysisResult, SmartFilters } from './core/types.js';

// Backwards compatibility exports
export type { PromptManagerDependencies } from './core/types.js';

/**
 * Re-export all original interfaces to maintain API compatibility
 */
export type {
  PromptManagerModule,
  PromptManagerData,
  OperationResult,
  CategoryResult,
  FileOperationResult,
  DependencyAnalysis,
  MigrationResult,
  ValidationContext,
} from './core/types.js';
