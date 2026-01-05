// @lifecycle canonical - Execution mode filtering for prompt-scoped script tools.
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

import {
  getDefaultPendingConfirmationTracker,
  type PendingConfirmationTracker,
} from './pending-confirmation-tracker.js';

import type {
  LoadedScriptTool,
  ToolDetectionMatch,
  ExecutionModeFilterResult,
  ToolPendingConfirmation,
  ConfirmationRequired,
} from '../types.js';

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
export class ExecutionModeService {
  private readonly debug: boolean;
  private readonly confirmationTracker: PendingConfirmationTracker;

  constructor(config: ExecutionModeServiceConfig = {}) {
    this.debug = config.debug ?? false;
    this.confirmationTracker = config.confirmationTracker ?? getDefaultPendingConfirmationTracker();

    if (this.debug) {
      // eslint-disable-next-line no-console
      console.error('[ExecutionModeService] Initialized');
    }
  }

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
  filterByExecutionMode(
    matches: ToolDetectionMatch[],
    tools: LoadedScriptTool[],
    promptId: string
  ): ExecutionModeFilterResult {
    const readyForExecution: ToolDetectionMatch[] = [];
    const skippedManual: string[] = []; // Legacy field, always empty now
    const pendingConfirmation: ToolPendingConfirmation[] = [];

    const toolMap = new Map(tools.map((t) => [t.id, t]));

    for (const match of matches) {
      const tool = toolMap.get(match.toolId);
      if (tool === undefined) {
        if (this.debug) {
          // eslint-disable-next-line no-console
          console.error(`[ExecutionModeService] Tool not found: ${match.toolId}`);
        }
        continue;
      }

      const needsConfirmation = match.requiresConfirmation ?? false;
      const isExplicit = match.explicitRequest ?? false;

      // Explicit request bypasses confirmation requirement
      if (isExplicit) {
        readyForExecution.push(match);
        if (this.debug && needsConfirmation) {
          // eslint-disable-next-line no-console
          console.error(
            `[ExecutionModeService] Tool '${tool.id}' confirmation bypassed via explicit arg`
          );
        }
        continue;
      }

      // Check if tool requires confirmation
      if (needsConfirmation) {
        // Check if this is a re-run (auto-approve on matching pending confirmation)
        const autoApproved = this.confirmationTracker.checkAndClearPending(
          promptId,
          match.toolId,
          match.extractedInputs
        );

        if (autoApproved) {
          readyForExecution.push(match);
          if (this.debug) {
            // eslint-disable-next-line no-console
            console.error(`[ExecutionModeService] Tool '${tool.id}' auto-approved via re-run`);
          }
          continue;
        }

        // Record this as pending for potential re-run approval
        this.confirmationTracker.recordPending(promptId, match.toolId, match.extractedInputs);
        pendingConfirmation.push(this.buildPendingConfirmation(tool, match, promptId));
      } else {
        readyForExecution.push(match);
      }
    }

    const result: ExecutionModeFilterResult = {
      readyForExecution,
      skippedManual,
      pendingConfirmation,
      requiresConfirmation: pendingConfirmation.length > 0,
    };

    if (this.debug) {
      // eslint-disable-next-line no-console
      console.error('[ExecutionModeService] Filter result:', {
        ready: readyForExecution.length,
        pending: pendingConfirmation.length,
      });
    }

    return result;
  }

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
  buildConfirmationResponse(
    filterResult: ExecutionModeFilterResult,
    promptId: string
  ): ConfirmationRequired {
    const toolNames = filterResult.pendingConfirmation.map((t) => t.toolName).join(', ');

    return {
      type: 'confirmation_required',
      tools: filterResult.pendingConfirmation,
      resumeCommand: `>>${promptId}`,
      message:
        `The following tools require confirmation before execution: ${toolNames}. ` +
        `To proceed, re-run the same command: >>${promptId}`,
    };
  }

  /**
   * Build a pending confirmation entry for a tool.
   * Includes matched parameters for user visibility before approval.
   *
   * Resume command is now just the prompt ID - re-run to approve.
   */
  private buildPendingConfirmation(
    tool: LoadedScriptTool,
    match: ToolDetectionMatch,
    promptId: string
  ): ToolPendingConfirmation {
    const defaultMessage = `Execute ${tool.name}?`;
    const confirmMessage = tool.execution?.confirmMessage ?? defaultMessage;

    return {
      toolId: tool.id,
      toolName: tool.name,
      message: confirmMessage,
      resumeCommand: `>>${promptId}`,
      matchedParams: match.matchedParams,
      extractedInputs: match.extractedInputs,
    };
  }

  /**
   * @deprecated Manual mode is deprecated. Use trigger: explicit instead.
   * This method is preserved for backwards compatibility during migration.
   *
   * @param toolId - Tool ID that was force-executed
   */
  logManualOverride(toolId: string): void {
    // eslint-disable-next-line no-console
    console.warn(
      `[ExecutionModeService] WARN: Tool '${toolId}' confirmation bypassed via explicit arg`
    );
  }
}

/**
 * Factory function with default configuration.
 */
export function createExecutionModeService(
  config?: ExecutionModeServiceConfig
): ExecutionModeService {
  return new ExecutionModeService(config);
}

// ============================================================================
// Default Instance Management (singleton pattern)
// ============================================================================

let defaultService: ExecutionModeService | null = null;

/**
 * Get the default ExecutionModeService instance.
 * Creates one if it doesn't exist.
 */
export function getDefaultExecutionModeService(): ExecutionModeService {
  defaultService ??= new ExecutionModeService();
  return defaultService;
}

/**
 * Reset the default service (useful for testing).
 */
export function resetDefaultExecutionModeService(): void {
  defaultService = null;
}
