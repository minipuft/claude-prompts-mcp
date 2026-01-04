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
 * Handler function type for MCP tool execution.
 * Matches ResourceManagerRouter.handleAction signature.
 */
export type AutoExecuteHandler = (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<ToolResponse>;
/**
 * Pipeline Stage 4c: Script Auto-Execute
 *
 * Detects auto_execute metadata in script outputs and calls
 * the appropriate MCP tool handler internally, avoiding LLM round-trips.
 *
 * This stage is intentionally thin (~80 lines) - it only coordinates
 * auto-execution. Validation logic lives in the script tools themselves.
 */
export declare class ScriptAutoExecuteStage extends BasePipelineStage {
    private readonly resourceManagerHandler;
    readonly name = "ScriptAutoExecute";
    constructor(resourceManagerHandler: AutoExecuteHandler | null, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
}
/**
 * Factory function for creating the stage with dependencies.
 */
export declare function createScriptAutoExecuteStage(resourceManagerHandler: AutoExecuteHandler | null, logger: Logger): ScriptAutoExecuteStage;
