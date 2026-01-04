import type { Logger } from "../../logging/index.js";
import type { ToolResponse } from "../../types/index.js";
import { type McpToolRequest } from "../context/execution-context.js";
import type { PipelineStage } from "./stage.js";
/**
 * Lightweight orchestrator that wires together the pipeline stages.
 */
export declare class PipelineOrchestrator {
    private readonly parsingStage;
    private readonly planningStage;
    private readonly gateStage;
    private readonly frameworkStage;
    private readonly sessionStage;
    private readonly executionStage;
    private readonly formattingStage;
    private stages;
    private readonly logger;
    constructor(parsingStage: PipelineStage, planningStage: PipelineStage, gateStage: PipelineStage, frameworkStage: PipelineStage, sessionStage: PipelineStage, executionStage: PipelineStage, formattingStage: PipelineStage, logger: Logger);
    /**
     * Execute the configured pipeline for the given MCP request.
     */
    execute(mcpRequest: McpToolRequest): Promise<ToolResponse>;
    /**
     * Expose stage lookups for diagnostics and testing.
     */
    getStage(name: string): PipelineStage | undefined;
    private registerStages;
    private logStageMetrics;
    private captureContextState;
    private logContextTransitions;
}
