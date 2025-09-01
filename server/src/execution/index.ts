/**
 * Modernized Execution System Export Module (Phase 3)
 *
 * Simplified execution system with ConsolidatedPromptEngine delegation:
 *
 * Key exports:
 * - ExecutionCoordinator: Thin orchestration layer that delegates to ConsolidatedPromptEngine
 * - UnifiedPromptProcessor: Basic template processing (streamlined for basic use cases)
 * - All complex execution handled through ConsolidatedPromptEngine
 */

// Export modernized system
export {
  ExecutionCoordinator,
  createExecutionCoordinator,
  type ExecutionResult,
  type ExecutionStats,
} from "./execution-coordinator.js";

export {
  UnifiedPromptProcessor,
  createUnifiedPromptProcessor,
  type PromptExecutionResult,
} from "./unified-prompt-processor.js";

// Phase 3: Chain strategies removed - all execution delegated to ConsolidatedPromptEngine
// Legacy strategy patterns deprecated in favor of ConsolidatedPromptEngine

// Re-export types needed by strategies
export type {
  ChainExecutionResult,
  ConvertedPrompt,
  // WorkflowExecutionResult removed in Phase 2 - use ChainExecutionResult
  // Workflow type removed in Phase 2 - use enhanced ChainStep configurations
  RuntimeTarget,
} from "../types/index.js";

import { FrameworkManager } from "../frameworks/framework-manager.js";
import { FrameworkStateManager } from "../frameworks/framework-state-manager.js";
import { GateEvaluator } from "../gates/evaluators/index.js";
import { Logger } from "../logging/index.js";
import { PromptManager } from "../prompts/index.js";
import { ConversationManager } from "../text-references/conversation.js";
import {
  ExecutionCoordinator,
  createExecutionCoordinator,
} from "./execution-coordinator.js";

/**
 * Factory function to create a modernized ExecutionCoordinator (Phase 3)
 * 
 * Creates the delegation-based execution system:
 * - ExecutionCoordinator delegates all execution to ConsolidatedPromptEngine
 * - Three-tier execution model: prompt/template/chain
 * - LLM-driven chain execution instead of server-side orchestration
 * - ConsolidatedPromptEngine must be set separately via setConsolidatedEngine()
 *
 * @param logger Logger instance for execution tracking
 * @param promptManager Prompt management system
 * @param conversationManager Conversation state management
 * @param gateEvaluator Optional gate validation system
 * @param frameworkStateManager Optional framework state management
 * @param frameworkManager Optional framework management
 * @returns ExecutionCoordinator ready for ConsolidatedPromptEngine delegation
 */
export function createFullyConfiguredExecutionCoordinator(
  logger: Logger,
  promptManager: PromptManager,
  conversationManager: ConversationManager,
  gateEvaluator?: GateEvaluator,
  frameworkStateManager?: FrameworkStateManager,
  frameworkManager?: FrameworkManager
): ExecutionCoordinator {
  // Create the execution coordinator with all dependencies
  const coordinator = createExecutionCoordinator(
    logger,
    promptManager,
    conversationManager,
    gateEvaluator,
    frameworkStateManager,
    frameworkManager
  );

  logger.info("ExecutionCoordinator initialized (Phase 3) with delegation architecture:");
  logger.info("- All execution delegated to ConsolidatedPromptEngine");
  logger.info("- Three-tier execution model: prompt/template/chain");
  logger.info("- LLM-driven chain execution (no server-side orchestration)");
  logger.info("- ConsolidatedPromptEngine must be set via setConsolidatedEngine()");

  return coordinator;
}

// Legacy factory function removed - createFullyConfiguredExecutionEngine
// Use createFullyConfiguredExecutionCoordinator instead
