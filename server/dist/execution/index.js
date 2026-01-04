// @lifecycle canonical - Exports execution pipeline building blocks.
/**
 * Modernized Execution System Export Module ()
 *
 * Simplified execution system with PromptExecutionService delegation:
 *
 * Key exports:
 * - ExecutionCoordinator: Thin orchestration layer that delegates to PromptExecutionService
 * - All complex execution handled through PromptExecutionService
 */
export {};
// REMOVED: All execution coordinator imports - modular chain system removed
// REMOVED: createFullyConfiguredExecutionCoordinator - modular chain system removed
// All execution now handled directly by PromptExecutionService in mcp-tools/prompt-engine.ts
// Legacy factory function removed - createFullyConfiguredExecutionEngine
// Use createFullyConfiguredExecutionCoordinator instead
//# sourceMappingURL=index.js.map