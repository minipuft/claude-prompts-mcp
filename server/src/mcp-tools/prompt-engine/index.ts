/**
 * Prompt Engine - Unified Execution System
 *
 * Consolidated prompt engine providing systematic prompt execution with:
 * - Framework integration (CAGEERF, ReACT, 5W1H, SCAMPER)
 * - Chain execution with progress tracking
 * - Semantic analysis and intelligent execution mode detection
 * - Gate validation and retry logic
 *
 * This module maintains API compatibility while providing improved organization.
 */

// Core engine exports
export {
  ConsolidatedPromptEngine,
  createConsolidatedPromptEngine,
} from "./core/engine.js";

// Chain execution exports
export {
  ChainExecutor,
} from "./core/executor.js";

// Type definitions
export type {
  ChainExecutionContext,
  ChainExecutionOptions,
  ChainManagementCommand,
  ChainGateInfo,
  ChainValidationResult,
  ChainStepData,
  StepArgumentsContext,
  FormatterExecutionContext,
  SimpleResponseFormatter,
  PromptClassification,
  ChainExecutionStrategy,
  ChainState,
} from "./core/types.js";

// Processing utilities (internal use)
export {
  TemplateProcessor,
} from "./processors/template-processor.js";

export {
  ResponseFormatter,
} from "./processors/response-formatter.js";

// Utility functions (internal use)
export {
  PromptClassifier,
} from "./utils/classification.js";

export {
  EngineValidator,
} from "./utils/validation.js";

export {
  ContextBuilder,
} from "./utils/context-builder.js";