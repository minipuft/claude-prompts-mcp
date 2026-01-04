/**
 * Pipeline Stage 4b: Script Execution
 *
 * Detects and executes prompt-scoped script tools based on user input,
 * enriching the template context with script outputs.
 *
 * Position: After Planning Stage (04), before Gate Enhancement (05)
 *
 * Dependencies:
 * - context.parsedCommand (from ParsingStage)
 * - context.convertedPrompt (from ParsingStage)
 *
 * Output:
 * - context.state.scripts.results (Map<toolId, ScriptExecutionResult>)
 * - context.state.scripts.toolsSkipped (string[]) - Manual mode tools without explicit request
 * - context.state.scripts.toolsPendingConfirmation (string[]) - Confirm mode tools awaiting approval
 *
 * The script results are later merged into template context in ExecutionStage (09)
 * as {{tool_<id>}} variables.
 *
 * @see plans/script-tools-implementation.md for the full implementation plan
 */
import { BasePipelineStage } from '../stage.js';
import type { Logger } from '../../../logging/index.js';
import type { ToolDetectionService } from '../../../scripts/detection/tool-detection-service.js';
import type { ExecutionModeService } from '../../../scripts/execution/execution-mode-service.js';
import type { ScriptExecutor } from '../../../scripts/execution/script-executor.js';
import type { ExecutionContext } from '../../context/execution-context.js';
/**
 * Pipeline Stage 4b: Script Execution
 *
 * Detects matching script tools from user input/args and executes them,
 * storing results in pipeline state for template rendering.
 *
 * This stage is a thin orchestration layer:
 * - ToolDetectionService handles detection and trigger types
 * - ExecutionModeService handles confirmation filtering (confirm: true)
 * - ScriptExecutor handles subprocess execution
 */
export declare class ScriptExecutionStage extends BasePipelineStage {
    private readonly scriptExecutor;
    private readonly toolDetectionService;
    private readonly executionModeService;
    readonly name = "ScriptExecution";
    constructor(scriptExecutor: ScriptExecutor, toolDetectionService: ToolDetectionService, executionModeService: ExecutionModeService, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    /**
     * Separate tools with autoApproveOnValid from normal confirmation flow.
     */
    private separateAutoApproveTools;
    /**
     * Check script output for validation result.
     * Expected format: { valid: boolean, warnings?: string[], errors?: string[] }
     *
     * IMPORTANT: Scripts may exit with non-zero code when validation fails,
     * but still output valid JSON with detailed error messages. We must check
     * the output first before falling back to exit code errors.
     */
    private checkValidationOutput;
    /**
     * Execute tools that are ready for execution.
     */
    private executeReadyTools;
    /**
     * Execute a single script tool.
     * Thin wrapper that delegates to ScriptExecutor service.
     */
    private executeScriptTool;
}
/**
 * Factory function for creating the stage with dependencies.
 */
export declare function createScriptExecutionStage(scriptExecutor: ScriptExecutor, toolDetectionService: ToolDetectionService, executionModeService: ExecutionModeService, logger: Logger): ScriptExecutionStage;
