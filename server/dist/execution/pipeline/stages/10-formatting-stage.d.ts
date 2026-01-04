import { BasePipelineStage } from '../stage.js';
import type { Logger } from '../../../logging/index.js';
import type { ResponseFormatter } from '../../../mcp-tools/prompt-engine/processors/response-formatter.js';
import type { ExecutionContext } from '../../context/execution-context.js';
/**
 * Pipeline Stage 10: Response Formatting
 *
 * Assembles final ToolResponse payloads with metadata, session information,
 * and progress tracking for different execution types (prompt/chain/template).
 *
 * Dependencies: context.executionPlan, rendered content from Stage 9
 * Output: context.response (final ToolResponse)
 * Can Early Exit: No (always runs last)
 */
export declare class ResponseFormattingStage extends BasePipelineStage {
    private readonly responseFormatter;
    readonly name = "ResponseFormatting";
    constructor(responseFormatter: ResponseFormatter, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    /**
     * Formats response for chain execution with session tracking
     */
    private formatChainResponse;
    /**
     * Formats response for single prompt execution
     */
    private formatSinglePromptResponse;
    /**
     * Formats script tool confirmation request for user approval.
     * Shows matched parameters so users can verify what will be executed.
     */
    private formatConfirmationRequest;
    /**
     * Formats validation errors from script tool validation.
     * Displayed when autoApproveOnValid validation fails.
     */
    private formatValidationErrors;
    /**
     * Formats extracted inputs as a concise summary for confirmation display.
     * Truncates long values and arrays for readability.
     */
    private formatExtractedInputsSummary;
    /**
     * Whether gate guidance injection is enabled for the current execution.
     * Defaults to true when no decision exists.
     */
    private shouldInjectGateGuidance;
    /**
     * Builds footer for chain execution with session and progress tracking
     */
    private buildChainFooter;
    /**
     * Builds footer with session and execution metadata (legacy method for compatibility)
     * Shows only essential information needed to continue execution
     */
    private buildFooter;
}
