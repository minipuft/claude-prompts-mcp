// @lifecycle canonical - Barrel exports for the prompt execution engine.
/**
 * Prompt Execution Service - Unified Pipeline Entry
 *
 * Provides systematic prompt execution backed by the staged pipeline:
 * - Framework integration (CAGEERF, ReACT, 5W1H, SCAMPER)
 * - Chain execution with progress tracking
 * - Semantic analysis and intelligent execution mode detection
 * - Gate validation and retry logic
 */

// Core tool exports
export {
  PromptExecutor,
  createPromptExecutor,
  cleanupPromptExecutor,
} from './core/prompt-executor.js';

// Type definitions
export type {
  FormatterExecutionContext,
  SimpleResponseFormatter,
  PromptClassification,
} from './core/types.js';

export { ResponseFormatter } from './processors/response-formatter.js';

// Utility functions (internal use)
export { PromptClassifier } from './utils/classification.js';
