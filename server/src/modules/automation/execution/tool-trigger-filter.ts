// @lifecycle canonical - Trigger/confirm filtering for prompt-scoped script tools.
/**
 * Tool Trigger Filter
 *
 * Partitions tool detection matches into those ready to run now and those needing
 * user confirmation, deciding from each tool's `trigger` and `confirm` settings.
 *
 * Named for what it does rather than for the retired `mode` field: `mode: auto|manual|confirm`
 * was replaced by `trigger` + `confirm`, so "execution mode" no longer describes anything the
 * schema has. `ExecutionModeSchema` keeps its name because it still parses the deprecated field.
 *
 * Extracted from the pipeline stage to keep orchestration thin.
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

import type { ToolTriggerFilterPort } from '#shared/types/index.js';
import type {
  LoadedScriptTool,
  ToolDetectionMatch,
  ToolTriggerFilterResult,
  ToolPendingConfirmation,
  ConfirmationRequired,
} from '../types.js';

/**
 * Configuration for the ToolTriggerFilter.
 */
export interface ToolTriggerFilterConfig {
  /** Enable debug logging */
  debug?: boolean;
  /** Custom pending confirmation tracker (default: singleton) */
  confirmationTracker?: PendingConfirmationTracker;
}

/**
 * Tool Trigger Filter
 *
 * Filters detected tool matches on their `trigger`/`confirm` settings, separating them into
 * ready-to-execute, skipped, and pending-confirmation groups.
 *
 * @example
 * ```typescript
 * const service = new ToolTriggerFilter();
 *
 * const filterResult = service.filterByTrigger(matches, tools, promptId);
 *
 * if (filterResult.requiresConfirmation) {
 *   return service.buildConfirmationResponse(filterResult, promptId);
 * }
 *
 * // Execute filterResult.readyForExecution tools
 * ```
 */
export class ToolTriggerFilter implements ToolTriggerFilterPort {
  private readonly debug: boolean;
  private readonly confirmationTracker: PendingConfirmationTracker;

  constructor(config: ToolTriggerFilterConfig = {}) {
    this.debug = config.debug ?? false;
    this.confirmationTracker = config.confirmationTracker ?? getDefaultPendingConfirmationTracker();

    if (this.debug) {
      // eslint-disable-next-line no-console
      console.error('[ToolTriggerFilter] Initialized');
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
  filterByTrigger(
    matches: ToolDetectionMatch[],
    tools: LoadedScriptTool[],
    promptId: string
  ): ToolTriggerFilterResult {
    const readyForExecution: ToolDetectionMatch[] = [];
    const skippedManual: string[] = []; // Legacy field, always empty now
    const pendingConfirmation: ToolPendingConfirmation[] = [];

    const toolMap = new Map(tools.map((t) => [t.id, t]));

    for (const match of matches) {
      const tool = toolMap.get(match.toolId);
      if (tool === undefined) {
        if (this.debug) {
          // eslint-disable-next-line no-console
          console.error(`[ToolTriggerFilter] Tool not found: ${match.toolId}`);
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
            `[ToolTriggerFilter] Tool '${tool.id}' confirmation bypassed via explicit arg`
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
            console.error(`[ToolTriggerFilter] Tool '${tool.id}' auto-approved via re-run`);
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

    const result: ToolTriggerFilterResult = {
      readyForExecution,
      skippedManual,
      pendingConfirmation,
      requiresConfirmation: pendingConfirmation.length > 0,
    };

    if (this.debug) {
      // eslint-disable-next-line no-console
      console.error('[ToolTriggerFilter] Filter result:', {
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
   * @param filterResult - Result from filterByTrigger
   * @param promptId - Parent prompt ID
   * @returns Structured confirmation response
   */
  buildConfirmationResponse(
    filterResult: ToolTriggerFilterResult,
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
      `[ToolTriggerFilter] WARN: Tool '${toolId}' confirmation bypassed via explicit arg`
    );
  }
}

/**
 * Factory function with default configuration.
 */
export function createToolTriggerFilter(config?: ToolTriggerFilterConfig): ToolTriggerFilter {
  return new ToolTriggerFilter(config);
}

// ============================================================================
// Default Instance Management (singleton pattern)
// ============================================================================

let defaultService: ToolTriggerFilter | null = null;

/**
 * Get the default ToolTriggerFilter instance.
 * Creates one if it doesn't exist.
 */
export function getDefaultToolTriggerFilter(): ToolTriggerFilter {
  defaultService ??= new ToolTriggerFilter();
  return defaultService;
}

/**
 * Reset the default service (useful for testing).
 */
export function resetDefaultToolTriggerFilter(): void {
  defaultService = null;
}
