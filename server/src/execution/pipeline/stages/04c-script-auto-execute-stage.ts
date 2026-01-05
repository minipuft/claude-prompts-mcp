// @lifecycle canonical - Pipeline stage for script tool auto-execution.
/**
 * Pipeline Stage 4c: Script Auto-Execute
 *
 * Detects script results with `auto_execute` metadata and internally
 * calls the appropriate MCP tool handler, storing results for downstream use.
 *
 * Position: After Script Execution (04b), before Judge Selection (06a)
 *
 * Dependencies:
 * - context.state.scripts.results (from ScriptExecutionStage)
 *
 * Output:
 * - context.state.scripts.autoExecuteResults (Map<toolId, ToolResponse>)
 *
 * The auto-execute results are available in templates as {{tool_<id>_result}}.
 *
 * @see plans/script-tools-implementation.md for the full implementation plan
 */

import { BasePipelineStage } from '../stage.js';

import type { Logger } from '../../../logging/index.js';
import type { ToolResponse } from '../../../types/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';

/**
 * Supported auto-execute tool types.
 * Add new tool types here as support is added.
 */
type SupportedAutoExecuteTool = 'resource_manager' | (string & {});

/**
 * Auto-execute metadata structure expected in script output.
 */
interface AutoExecuteMetadata {
  /** Target tool to execute */
  tool: SupportedAutoExecuteTool;
  /** Parameters to pass to the tool */
  params: Record<string, unknown>;
}

/**
 * Script output structure with optional auto-execute metadata.
 */
interface ScriptOutputWithAutoExecute {
  /** Whether validation passed */
  valid: boolean;
  /** Auto-execute instructions (if present and valid) */
  auto_execute?: AutoExecuteMetadata;
  /** Validation errors */
  errors?: string[];
  /** Validation warnings */
  warnings?: string[];
}

/**
 * Handler function type for MCP tool execution.
 * Matches ResourceManagerRouter.handleAction signature.
 */
export type AutoExecuteHandler = (
  args: Record<string, unknown>,
  context: Record<string, unknown>
) => Promise<ToolResponse>;

/**
 * Pipeline Stage 4c: Script Auto-Execute
 *
 * Detects auto_execute metadata in script outputs and calls
 * the appropriate MCP tool handler internally, avoiding LLM round-trips.
 *
 * This stage is intentionally thin (~80 lines) - it only coordinates
 * auto-execution. Validation logic lives in the script tools themselves.
 */
export class ScriptAutoExecuteStage extends BasePipelineStage {
  readonly name = 'ScriptAutoExecute';

  constructor(
    private readonly resourceManagerHandler: AutoExecuteHandler | null,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    const scriptResults = context.state.scripts?.results;
    if (scriptResults === undefined || scriptResults.size === 0) {
      this.logExit({ skipped: 'No script results' });
      return;
    }

    // Check if resourceManagerHandler is available
    if (this.resourceManagerHandler === null) {
      this.logExit({ skipped: 'No auto-execute handler configured' });
      return;
    }

    let autoExecuteCount = 0;

    for (const [toolId, result] of scriptResults) {
      if (result.success !== true || result.output === null || result.output === undefined) {
        continue;
      }

      const output = result.output as ScriptOutputWithAutoExecute;

      // Skip if no auto_execute metadata or validation failed
      if (output.valid !== true || output.auto_execute === undefined) {
        continue;
      }

      const autoExecute = output.auto_execute;

      // Currently only support resource_manager - expand as needed
      if (autoExecute.tool !== 'resource_manager') {
        context.diagnostics.warn(
          this.name,
          `Unsupported auto-execute tool: ${String(autoExecute.tool)}`,
          { toolId }
        );
        continue;
      }

      try {
        const toolResult = await this.resourceManagerHandler(autoExecute.params, {});

        // Initialize scripts and autoExecuteResults map if needed
        context.state.scripts ??= {};
        context.state.scripts.autoExecuteResults ??= new Map();

        context.state.scripts.autoExecuteResults.set(toolId, toolResult);
        autoExecuteCount++;

        context.diagnostics.info(this.name, `Auto-executed ${autoExecute.tool} for ${toolId}`, {
          isError: toolResult.isError,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        context.diagnostics.error(this.name, `Auto-execute failed for ${toolId}: ${message}`);

        // Initialize scripts and store error result so template can access it
        context.state.scripts ??= {};
        context.state.scripts.autoExecuteResults ??= new Map();

        context.state.scripts.autoExecuteResults.set(toolId, {
          content: [{ type: 'text', text: `Auto-execute failed: ${message}` }],
          isError: true,
        });
      }
    }

    this.logExit({ autoExecuted: autoExecuteCount });
  }
}

/**
 * Factory function for creating the stage with dependencies.
 */
export function createScriptAutoExecuteStage(
  resourceManagerHandler: AutoExecuteHandler | null,
  logger: Logger
): ScriptAutoExecuteStage {
  return new ScriptAutoExecuteStage(resourceManagerHandler, logger);
}
