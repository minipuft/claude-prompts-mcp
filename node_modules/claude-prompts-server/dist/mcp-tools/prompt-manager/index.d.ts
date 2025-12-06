/**
 * Prompt Manager - Modular Architecture Entry Point
 *
 * This module maintains 100% backwards compatibility while providing
 * a modular internal architecture for improved maintainability.
 */
export { ConsolidatedPromptManager } from './core/manager.js';
export { createConsolidatedPromptManager } from './core/manager.js';
export type { PromptClassification, AnalysisResult, SmartFilters } from './core/types.js';
export type { PromptManagerDependencies } from './core/types.js';
/**
 * Re-export all original interfaces to maintain API compatibility
 */
export type { PromptManagerModule, PromptManagerData, OperationResult, CategoryResult, FileOperationResult, DependencyAnalysis, MigrationResult, ValidationContext, } from './core/types.js';
