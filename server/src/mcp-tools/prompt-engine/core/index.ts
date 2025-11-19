// @lifecycle canonical - Core prompt engine orchestrator exports.
/**
 * Prompt Engine Core Module Exports
 *
 * This index file provides unified access to all core prompt engine functionality
 * to resolve module resolution issues in CI/CD environments.
 */

// Re-export the main execution service (excluding conflicting types)
export {
  PromptExecutionService,
  createPromptExecutionService,
  cleanupPromptExecutionService,
} from './prompt-execution-service.js';

// Re-export all core types and interfaces (primary source for PromptClassification)
export * from './types.js';
