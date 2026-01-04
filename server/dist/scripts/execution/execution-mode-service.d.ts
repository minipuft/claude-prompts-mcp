/**
 * Execution Mode Service
 *
 * Filters tool detection matches by their execution mode configuration,
 * identifying which tools are ready for execution, which require confirmation,
 * and which were skipped due to manual mode.
 *
 * This service implements the execution mode logic extracted from the pipeline
 * stage to maintain thin orchestration patterns.
 *
 * Re-run to Approve:
 * When a tool requires confirmation, users can re-run the same command to approve.
 * The PendingConfirmationTracker remembers what was shown and auto-approves on match.
 *
 * @see plans/script-tools-implementation.md for the full implementation plan
 */
import { type PendingConfirmationTracker } from './pending-confirmation-tracker.js';
import type { LoadedScriptTool, ToolDetectionMatch, ExecutionModeFilterResult, ConfirmationRequired } from '../types.js';
/**
 * Configuration for the ExecutionModeService.
 */
export interface ExecutionModeServiceConfig {
    /** Enable debug logging */
    debug?: boolean;
    /** Custom pending confirmation tracker (default: singleton) */
    confirmationTracker?: PendingConfirmationTracker;
}
/**
 * Execution Mode Service
 *
 * Filters detected tool matches based on their execution mode configuration,
 * separating them into ready-to-execute, skipped, and pending-confirmation groups.
 *
 * @example
 * ```typescript
 * const service = new ExecutionModeService();
 *
 * const filterResult = service.filterByExecutionMode(matches, tools, promptId);
 *
 * if (filterResult.requiresConfirmation) {
 *   return service.buildConfirmationResponse(filterResult, promptId);
 * }
 *
 * // Execute filterResult.readyForExecution tools
 * ```
 */
export declare class ExecutionModeService {
    private readonly debug;
    private readonly confirmationTracker;
    constructor(config?: ExecutionModeServiceConfig);
    /**
     * Filter tool matches by their confirmation requirements.
     *
     * Categorizes matches into:
     * - readyForExecution: Tools that can execute immediately
     * - skippedManual: (legacy) Always empty - manual mode is now trigger: explicit
     * - pendingConfirmation: Tools with confirm: true awaiting user approval
     *
     * Note: The old mode-based filtering (auto/manual/confirm) has been replaced
     * with a simpler boolean check: requiresConfirmation from the match.
     *
     * @param matches - Detection matches from ToolDetectionService
     * @param tools - Available tools for lookup
     * @param promptId - Parent prompt ID for resume command
     * @returns Categorized filter result
     */
    filterByExecutionMode(matches: ToolDetectionMatch[], tools: LoadedScriptTool[], promptId: string): ExecutionModeFilterResult;
    /**
     * Build a confirmation response for tools requiring user approval.
     *
     * Users can approve by simply re-running the same command.
     * The tracker remembers the pending confirmation and auto-approves on match.
     *
     * @param filterResult - Result from filterByExecutionMode
     * @param promptId - Parent prompt ID
     * @returns Structured confirmation response
     */
    buildConfirmationResponse(filterResult: ExecutionModeFilterResult, promptId: string): ConfirmationRequired;
    /**
     * Build a pending confirmation entry for a tool.
     * Includes matched parameters for user visibility before approval.
     *
     * Resume command is now just the prompt ID - re-run to approve.
     */
    private buildPendingConfirmation;
    /**
     * @deprecated Manual mode is deprecated. Use trigger: explicit instead.
     * This method is preserved for backwards compatibility during migration.
     *
     * @param toolId - Tool ID that was force-executed
     */
    logManualOverride(toolId: string): void;
}
/**
 * Factory function with default configuration.
 */
export declare function createExecutionModeService(config?: ExecutionModeServiceConfig): ExecutionModeService;
/**
 * Get the default ExecutionModeService instance.
 * Creates one if it doesn't exist.
 */
export declare function getDefaultExecutionModeService(): ExecutionModeService;
/**
 * Reset the default service (useful for testing).
 */
export declare function resetDefaultExecutionModeService(): void;
