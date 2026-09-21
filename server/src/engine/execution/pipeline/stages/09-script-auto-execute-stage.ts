// @lifecycle canonical - Pipeline stage for script tool auto-execution.
/**
 * Pipeline Stage 09: Script Auto-Execute
 *
 * Detects script results with `auto_execute` metadata and internally
 * calls the appropriate MCP tool handler, storing results for downstream use.
 *
 * Position: After ScriptExecutionStage, before JudgeSelectionStage
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

import type { Logger } from '#infra/logging/index.js';
import type { ToolResponse } from '#shared/types/index.js';
import type { ExecutionContext } from '../../context/index.js';

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
 * Why a script's emitted params name something `resource_manager` will not read, or `null`.
 *
 * INJECTED rather than imported: the refusal is owned at layer 4 (`mcp/tools/shared/
 * undeclared-parameters.ts`) and this stage is layer 2, which `validate:arch` forbids from
 * value-importing `mcp/`. The composition root that already hands this stage its
 * {@link AutoExecuteHandler} hands it the matching refusal, so the two cannot drift.
 */
export type AutoExecuteParamRefusal = (params: Record<string, unknown>) => string | null;

/**
 * Pipeline Stage 09: Script Auto-Execute
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
    logger: Logger,
    private readonly describeParamRefusal: AutoExecuteParamRefusal | null = null
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

      this.assertParamsAreDeclared(toolId, autoExecute.params);

      // Get script state once (already initialized with autoExecuteResults by helper)
      const scripts = context.ensureScriptState();

      // NO try/catch. A handler throw belongs to the pipeline's single error boundary, the same
      // one `assertParamsAreDeclared` throws into. The catch that used to stand here converted a
      // throw into a stored `isError` result — the second half of the same false success the
      // `isError` check below closes, reached by a different route.
      const toolResult = await this.resourceManagerHandler(autoExecute.params, {});
      this.assertToolAccepted(toolId, autoExecute.tool, toolResult);

      scripts.autoExecuteResults.set(toolId, toolResult);
      autoExecuteCount++;

      context.diagnostics.info(this.name, `Auto-executed ${autoExecute.tool} for ${toolId}`, {
        isError: toolResult.isError,
      });
    }

    this.logExit({ autoExecuted: autoExecuteCount });
  }

  /**
   * Throw unless every emitted key is one `resource_manager` declares.
   *
   * A script's stdout is authored content, and these params go straight to a resource MUTATION.
   * The router runs the same refusal, but this stage SWALLOWS what the router returns — an
   * `isError` response only reaches `context.diagnostics.info` and nothing downstream reads it,
   * so `prompt_engine` answered success over a refused write. A THROW instead of a skip: the
   * pipeline's single error boundary turns it into the tool's error, and the message names the
   * script so an operator knows which file to open.
   */
  private assertParamsAreDeclared(toolId: string, params: Record<string, unknown>): void {
    const refusal = this.describeParamRefusal?.(params) ?? null;
    if (refusal === null) return;

    throw new Error(
      `Script tool '${toolId}' emitted an auto_execute call that is refused. ${refusal}`
    );
  }

  /**
   * Throw when the tool answered the auto-execute with an error.
   *
   * P4.93 closed ONE class here — an undeclared parameter — by refusing before the call. Every
   * other way the router says no arrived as a `ToolResponse` with `isError: true`, was written
   * into `autoExecuteResults`, and was reported through `context.diagnostics.info`, which nothing
   * downstream reads: `18-execution-stage.ts` never consults it. Measured 2026-09-20 by drive
   * through `prompt_engine`: a parameter the resource type does not own, an unconfirmed
   * destructive `delete`, and a schema-invalid `limit` each rendered the prompt and answered
   * `isError: false`. The mutation did not happen and the caller was told it had.
   *
   * The remedy is the CHANNEL, not a new report: `prompt_engine`'s error is what a caller reads,
   * and the pipeline's single error boundary is the only thing that reaches it. The router's own
   * message is carried verbatim — it already names the parameter, the resource type, or the
   * confirmation it wanted, and rewriting it here would produce a second, worse vocabulary.
   */
  private assertToolAccepted(toolId: string, tool: string, result: ToolResponse): void {
    if (result.isError !== true) return;

    const message = result.content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();

    throw new Error(
      `Script tool '${toolId}' emitted an auto_execute call that ${tool} refused. ` +
        (message.length > 0 ? message : `${tool} reported an error with no message.`)
    );
  }
}

/**
 * Factory function for creating the stage with dependencies.
 */
export function createScriptAutoExecuteStage(
  resourceManagerHandler: AutoExecuteHandler | null,
  logger: Logger,
  describeParamRefusal: AutoExecuteParamRefusal | null = null
): ScriptAutoExecuteStage {
  return new ScriptAutoExecuteStage(resourceManagerHandler, logger, describeParamRefusal);
}
