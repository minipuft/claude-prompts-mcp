/**
 * Modernized Execution System Export Module ()
 *
 * Simplified execution system with PromptExecutionService delegation:
 *
 * Key exports:
 * - ExecutionCoordinator: Thin orchestration layer that delegates to PromptExecutionService
 * - All complex execution handled through PromptExecutionService
 */
export type { ChainExecutionResult, ConvertedPrompt } from '../types/index.js';
