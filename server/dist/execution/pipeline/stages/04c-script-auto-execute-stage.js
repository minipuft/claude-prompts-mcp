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
    constructor(resourceManagerHandler, logger) {
        super(logger);
        this.resourceManagerHandler = resourceManagerHandler;
        this.name = 'ScriptAutoExecute';
    }
    async execute(context) {
        var _a, _b, _c, _d;
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
            const output = result.output;
            // Skip if no auto_execute metadata or validation failed
            if (output.valid !== true || output.auto_execute === undefined) {
                continue;
            }
            const autoExecute = output.auto_execute;
            // Currently only support resource_manager - expand as needed
            if (autoExecute.tool !== 'resource_manager') {
                context.diagnostics.warn(this.name, `Unsupported auto-execute tool: ${String(autoExecute.tool)}`, { toolId });
                continue;
            }
            try {
                const toolResult = await this.resourceManagerHandler(autoExecute.params, {});
                // Initialize scripts and autoExecuteResults map if needed
                (_a = context.state).scripts ?? (_a.scripts = {});
                (_b = context.state.scripts).autoExecuteResults ?? (_b.autoExecuteResults = new Map());
                context.state.scripts.autoExecuteResults.set(toolId, toolResult);
                autoExecuteCount++;
                context.diagnostics.info(this.name, `Auto-executed ${autoExecute.tool} for ${toolId}`, {
                    isError: toolResult.isError,
                });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                context.diagnostics.error(this.name, `Auto-execute failed for ${toolId}: ${message}`);
                // Initialize scripts and store error result so template can access it
                (_c = context.state).scripts ?? (_c.scripts = {});
                (_d = context.state.scripts).autoExecuteResults ?? (_d.autoExecuteResults = new Map());
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
export function createScriptAutoExecuteStage(resourceManagerHandler, logger) {
    return new ScriptAutoExecuteStage(resourceManagerHandler, logger);
}
//# sourceMappingURL=04c-script-auto-execute-stage.js.map