import { BasePipelineStage } from '../stage.js';
import type { Logger } from '../../../logging/index.js';
import type { ResponseFormatter } from '../../../mcp-tools/prompt-engine/processors/response-formatter.js';
import type { ExecutionContext } from '../../context/execution-context.js';
/**
 * Stage 7: Response formatting with variant-specific logic
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
     * Formats response for template execution
     */
    private formatTemplateResponse;
    /**
     * Formats response for single prompt execution
     */
    private formatSinglePromptResponse;
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
