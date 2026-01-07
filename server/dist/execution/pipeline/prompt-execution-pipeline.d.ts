import type { PipelineStage } from './stage.js';
import type { Logger } from '../../logging/index.js';
import type { MetricsCollector } from '../../metrics/index.js';
import type { McpToolRequest, ToolResponse } from '../../types/index.js';
/**
 * Canonical Prompt Execution Pipeline orchestrator.
 */
export declare class PromptExecutionPipeline {
    private readonly requestStage;
    private readonly dependencyStage;
    private readonly lifecycleStage;
    private readonly parsingStage;
    private readonly inlineGateStage;
    private readonly operatorValidationStage;
    private readonly planningStage;
    private readonly scriptExecutionStage;
    private readonly scriptAutoExecuteStage;
    private readonly frameworkStage;
    private readonly judgeSelectionStage;
    private readonly promptGuidanceStage;
    private readonly gateStage;
    private readonly sessionStage;
    private readonly frameworkInjectionControlStage;
    private readonly responseCaptureStage;
    private readonly shellVerificationStage;
    private readonly executionStage;
    private readonly gateReviewStage;
    private readonly callToActionStage;
    private readonly formattingStage;
    private readonly postFormattingStage;
    private stages;
    private readonly logger;
    private readonly metricsProvider;
    constructor(requestStage: PipelineStage, dependencyStage: PipelineStage, lifecycleStage: PipelineStage, parsingStage: PipelineStage, inlineGateStage: PipelineStage, operatorValidationStage: PipelineStage, planningStage: PipelineStage, scriptExecutionStage: PipelineStage | null, // 04b - Script tool execution
    scriptAutoExecuteStage: PipelineStage | null, // 04c - Script auto-execute
    frameworkStage: PipelineStage, judgeSelectionStage: PipelineStage, promptGuidanceStage: PipelineStage, gateStage: PipelineStage, sessionStage: PipelineStage, frameworkInjectionControlStage: PipelineStage, responseCaptureStage: PipelineStage, shellVerificationStage: PipelineStage | null, // 08b - Shell verification (Ralph Wiggum)
    executionStage: PipelineStage, gateReviewStage: PipelineStage, callToActionStage: PipelineStage, formattingStage: PipelineStage, postFormattingStage: PipelineStage, logger: Logger, metricsProvider?: () => MetricsCollector | undefined);
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
    private runLifecycleCleanupHandlers;
    private getMetricsCollector;
    private createCommandMetricId;
    private recordPipelineStageMetric;
    private recordCommandExecutionMetric;
    private resolveExecutionMode;
    private buildCommandMetricMetadata;
    private extractResponseError;
    private mapStageType;
}
