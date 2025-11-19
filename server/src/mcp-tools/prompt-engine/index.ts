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
  PromptExecutionService,
  createPromptExecutionService,
  cleanupPromptExecutionService,
} from './core/prompt-execution-service.js';

// Type definitions
export type {
  FormatterExecutionContext,
  SimpleResponseFormatter,
  PromptClassification,
} from './core/types.js';

export { ResponseFormatter } from './processors/response-formatter.js';

// Utility functions (internal use)
export { PromptClassifier } from './utils/classification.js';

export { EngineValidator } from './utils/validation.js';

export { ContextBuilder } from './utils/context-builder.js';
