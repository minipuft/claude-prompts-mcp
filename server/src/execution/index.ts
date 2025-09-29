/**
 * Modernized Execution System Export Module (Phase 3)
 *
 * Simplified execution system with ConsolidatedPromptEngine delegation:
 *
 * Key exports:
 * - ExecutionCoordinator: Thin orchestration layer that delegates to ConsolidatedPromptEngine
 * - All complex execution handled through ConsolidatedPromptEngine
 */

// REMOVED: ExecutionCoordinator - modular chain system removed
// All execution now handled directly by ConsolidatedPromptEngine

// Execution conversation management integrated with text-references/conversation.ts
// No separate execution conversation manager needed

// UnifiedPromptProcessor removed - functionality consolidated into ExecutionCoordinator

// Phase 3: Chain strategies removed - all execution delegated to ConsolidatedPromptEngine
// Legacy strategy patterns deprecated in favor of ConsolidatedPromptEngine

// Re-export types needed by strategies
export type {
  ChainExecutionResult,
  ConvertedPrompt,
  // WorkflowExecutionResult removed in Phase 2 - use ChainExecutionResult
  // Workflow type removed in Phase 2 - use enhanced ChainStep configurations
  // RuntimeTarget removed in Phase 2 - workflow foundation types eliminated
} from "../types/index.js";

// REMOVED: All execution coordinator imports - modular chain system removed

// REMOVED: createFullyConfiguredExecutionCoordinator - modular chain system removed
// All execution now handled directly by ConsolidatedPromptEngine in mcp-tools/prompt-engine.ts

// Legacy factory function removed - createFullyConfiguredExecutionEngine
// Use createFullyConfiguredExecutionCoordinator instead
