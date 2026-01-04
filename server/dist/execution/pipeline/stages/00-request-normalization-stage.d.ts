import { BasePipelineStage } from '../stage.js';
import type { Logger } from '../../../logging/index.js';
import type { ChainManagementService } from '../../../mcp-tools/prompt-engine/core/chain-management.js';
import type { ToolResponse } from '../../../types/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
type ToolRouter = (targetTool: string, params: Record<string, any>, originalCommand: string) => Promise<ToolResponse>;
/**
 * Canonical Pipeline Stage 0.1: Request Normalization
 *
 * Validates MCP tool requests, captures session metadata, and routes
 * management/help/list commands before the parsing stages execute.
 *
 * Dependencies: None (always runs first)
 * Output: Normalized request metadata or early ToolResponse
 * Can Early Exit: Yes
 */
export declare class RequestNormalizationStage extends BasePipelineStage {
    private readonly chainManagementService;
    private readonly toolRouter;
    readonly name = "RequestNormalization";
    constructor(chainManagementService: ChainManagementService | null, toolRouter: ToolRouter | null, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    private validateRequest;
    private hasResumeIdentifier;
    private captureRequestMetadata;
    private tryHandleChainCommand;
    private tryRouteCommand;
    private buildErrorResponse;
}
export {};
