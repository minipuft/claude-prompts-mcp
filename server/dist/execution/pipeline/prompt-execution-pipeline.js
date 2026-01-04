// @lifecycle canonical - Coordinates prompt execution across ordered stages.
import { randomUUID } from 'crypto';
import { ExecutionContext } from '../context/execution-context.js';
/**
 * Canonical Prompt Execution Pipeline orchestrator.
 */
export class PromptExecutionPipeline {
    constructor(requestStage, dependencyStage, lifecycleStage, parsingStage, inlineGateStage, operatorValidationStage, planningStage, scriptExecutionStage, // 04b - Script tool execution
    scriptAutoExecuteStage, // 04c - Script auto-execute
    frameworkStage, judgeSelectionStage, promptGuidanceStage, gateStage, sessionStage, frameworkInjectionControlStage, responseCaptureStage, executionStage, gateReviewStage, callToActionStage, formattingStage, postFormattingStage, logger, metricsProvider) {
        this.requestStage = requestStage;
        this.dependencyStage = dependencyStage;
        this.lifecycleStage = lifecycleStage;
        this.parsingStage = parsingStage;
        this.inlineGateStage = inlineGateStage;
        this.operatorValidationStage = operatorValidationStage;
        this.planningStage = planningStage;
        this.scriptExecutionStage = scriptExecutionStage;
        this.scriptAutoExecuteStage = scriptAutoExecuteStage;
        this.frameworkStage = frameworkStage;
        this.judgeSelectionStage = judgeSelectionStage;
        this.promptGuidanceStage = promptGuidanceStage;
        this.gateStage = gateStage;
        this.sessionStage = sessionStage;
        this.frameworkInjectionControlStage = frameworkInjectionControlStage;
        this.responseCaptureStage = responseCaptureStage;
        this.executionStage = executionStage;
        this.gateReviewStage = gateReviewStage;
        this.callToActionStage = callToActionStage;
        this.formattingStage = formattingStage;
        this.postFormattingStage = postFormattingStage;
        this.stages = [];
        this.logger = logger;
        this.metricsProvider = metricsProvider;
        this.registerStages();
    }
    /**
     * Execute the configured pipeline for the given MCP request.
     */
    async execute(mcpRequest) {
        const context = new ExecutionContext(mcpRequest, this.logger);
        this.logger.info('[Pipeline] Starting execution', {
            command: mcpRequest.command ?? '<response-only>',
            chainId: mcpRequest.chain_id,
        });
        const pipelineStart = Date.now();
        const commandMetricId = this.createCommandMetricId();
        context.metadata['commandMetricId'] = commandMetricId;
        const stageMetrics = [];
        let previousState = this.captureContextState(context);
        let commandStatus = 'success';
        let commandError;
        try {
            for (const stage of this.stages) {
                const stageStart = Date.now();
                const memoryBefore = process.memoryUsage();
                let stageStatus = 'success';
                let stageError;
                this.logger.info('[Pipeline] -> Stage start', {
                    stage: stage.name,
                    sessionId: context.getSessionId(),
                });
                try {
                    await stage.execute(context);
                }
                catch (error) {
                    const durationMs = Date.now() - stageStart;
                    const message = error instanceof Error ? error.message : String(error);
                    stageStatus = 'error';
                    stageError = message;
                    this.logger.error('[Pipeline] Stage failed', {
                        stage: stage.name,
                        durationMs,
                        error: message,
                    });
                    throw error;
                }
                finally {
                    const durationMs = Date.now() - stageStart;
                    const memoryAfter = process.memoryUsage();
                    stageMetrics.push(this.logStageMetrics(stage.name, durationMs, memoryBefore, memoryAfter));
                    this.recordPipelineStageMetric(stage, context, stageStart, durationMs, stageStatus, stageError, memoryBefore, memoryAfter);
                    const currentState = this.captureContextState(context);
                    this.logContextTransitions(stage.name, previousState, currentState);
                    previousState = currentState;
                    this.logger.info('[Pipeline] <- Stage complete', {
                        stage: stage.name,
                        durationMs,
                        responseReady: Boolean(context.response),
                    });
                }
                if (context.response) {
                    if (context.response.isError) {
                        commandStatus = 'error';
                        commandError = this.extractResponseError(context.response);
                    }
                    this.logger.info('[Pipeline] Early termination', {
                        stage: stage.name,
                        reason: 'Response already available',
                        totalDurationMs: Date.now() - pipelineStart,
                        stages: stageMetrics,
                    });
                    return context.response;
                }
            }
            if (!context.response) {
                throw new Error('Pipeline completed without producing a response');
            }
            if (context.response.isError) {
                commandStatus = 'error';
                commandError = this.extractResponseError(context.response);
            }
            this.logger.info('[Pipeline] Execution complete', {
                totalDurationMs: Date.now() - pipelineStart,
                stages: stageMetrics,
            });
            return context.response;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            commandStatus = 'error';
            commandError = message;
            this.logger.error('[Pipeline] Execution failed', {
                error: message,
                stages: stageMetrics,
            });
            throw error instanceof Error ? error : new Error(message);
        }
        finally {
            this.recordCommandExecutionMetric(context, pipelineStart, commandMetricId, commandStatus, commandError);
            await this.runLifecycleCleanupHandlers(context);
        }
    }
    /**
     * Expose stage lookups for diagnostics and testing.
     */
    getStage(name) {
        return this.stages.find((stage) => stage.name === name);
    }
    registerStages() {
        // Stage order is critical for the two-phase judge selection flow:
        // JudgeSelectionStage must run BEFORE framework/gate stages so that:
        // 1. Judge phase (%judge) returns clean resource menu without framework/gate injection
        // 2. Execution phase with selections has clientFrameworkOverride set before FrameworkResolutionStage
        //
        // Stage ordering for injection control:
        // 1. SessionStage MUST run before InjectionControlStage (provides currentStep)
        // 2. InjectionControlStage MUST run before PromptGuidanceStage (decisions control injection)
        // 3. PromptGuidanceStage reads context.state.injection to decide what to inject
        //
        // Script execution ordering:
        // ScriptExecutionStage (04b) runs after planning, before auto-execute.
        // ScriptAutoExecuteStage (04c) runs after script execution, before judge selection.
        // This allows auto-executed tool outputs to be available in template context.
        this.stages = [
            this.requestStage,
            this.dependencyStage,
            this.lifecycleStage,
            this.parsingStage,
            this.inlineGateStage,
            this.operatorValidationStage,
            this.planningStage,
            // 04b: Script execution (optional) - runs after planning
            ...(this.scriptExecutionStage ? [this.scriptExecutionStage] : []),
            // 04c: Script auto-execute (optional) - runs after script execution, before judge selection
            ...(this.scriptAutoExecuteStage ? [this.scriptAutoExecuteStage] : []),
            this.judgeSelectionStage, // Moved before framework/gate stages for two-phase flow
            this.gateStage, // Now runs after judge decision
            this.frameworkStage, // Now uses clientFrameworkOverride from judge flow
            this.sessionStage, // MOVED: Session management (populates currentStep)
            this.frameworkInjectionControlStage, // MOVED: Injection decisions (needs currentStep, controls guidance)
            this.promptGuidanceStage, // NOW AFTER: Uses injection decisions from state.injection
            this.responseCaptureStage,
            this.executionStage,
            this.gateReviewStage,
            this.callToActionStage,
            this.formattingStage,
            this.postFormattingStage,
        ];
    }
    logStageMetrics(stage, durationMs, memoryBefore, memoryAfter) {
        const metrics = {
            stage,
            durationMs,
            heapUsed: memoryAfter.heapUsed,
            rss: memoryAfter.rss,
            heapUsedDelta: memoryAfter.heapUsed - memoryBefore.heapUsed,
            rssDelta: memoryAfter.rss - memoryBefore.rss,
        };
        this.logger.debug('[Pipeline] Stage metrics', metrics);
        return metrics;
    }
    captureContextState(context) {
        return {
            parsedCommand: Boolean(context.parsedCommand),
            executionPlan: Boolean(context.executionPlan),
            frameworkContext: Boolean(context.frameworkContext),
            sessionContext: Boolean(context.sessionContext),
            executionResults: Boolean(context.executionResults),
            response: Boolean(context.response),
        };
    }
    logContextTransitions(stage, previous, current) {
        const transitions = {};
        let hasChanges = false;
        for (const key of Object.keys(current)) {
            if (previous[key] !== current[key]) {
                transitions[key] = current[key];
                hasChanges = true;
            }
        }
        if (hasChanges) {
            this.logger.info('[Pipeline] Context updated', {
                stage,
                transitions,
            });
        }
    }
    async runLifecycleCleanupHandlers(context) {
        const handlers = context.state.lifecycle.cleanupHandlers;
        if (!Array.isArray(handlers)) {
            return;
        }
        for (const handler of handlers) {
            try {
                await handler();
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.logger.warn('[Pipeline] Lifecycle cleanup handler failed', { message });
            }
        }
    }
    getMetricsCollector() {
        return this.metricsProvider?.();
    }
    createCommandMetricId() {
        return `cmd_${randomUUID()}`;
    }
    recordPipelineStageMetric(stage, context, startTime, durationMs, status, errorMessage, memoryBefore, memoryAfter) {
        const metrics = this.getMetricsCollector();
        if (!metrics) {
            return;
        }
        const metricPayload = {
            stageId: `${stage.name}:${context.getSessionId() ?? 'sessionless'}:${startTime}`,
            stageName: stage.name,
            stageType: this.mapStageType(stage.name),
            toolName: 'prompt_engine',
            startTime,
            endTime: startTime + durationMs,
            durationMs,
            status,
            metadata: {
                heapUsed: memoryAfter.heapUsed,
                rss: memoryAfter.rss,
                heapUsedDelta: memoryAfter.heapUsed - memoryBefore.heapUsed,
                rssDelta: memoryAfter.rss - memoryBefore.rss,
                responseReady: Boolean(context.response),
            },
        };
        const sessionId = context.getSessionId();
        if (sessionId !== undefined) {
            metricPayload.sessionId = sessionId;
        }
        if (errorMessage !== undefined) {
            metricPayload.errorMessage = errorMessage;
        }
        metrics.recordPipelineStage(metricPayload);
    }
    recordCommandExecutionMetric(context, startTime, commandId, status, errorMessage) {
        const metrics = this.getMetricsCollector();
        if (!metrics) {
            return;
        }
        const endTime = Date.now();
        const appliedGates = context.executionPlan?.gates ?? [];
        const temporaryGateIds = Array.isArray(context.metadata['temporaryGateIds'])
            ? context.metadata['temporaryGateIds']
            : [];
        const metric = {
            commandId,
            commandName: context.mcpRequest.command ?? '<response-only>',
            toolName: 'prompt_engine',
            executionMode: this.resolveExecutionMode(context),
            startTime,
            endTime,
            durationMs: endTime - startTime,
            status,
            appliedGates,
            temporaryGatesApplied: temporaryGateIds.length,
            metadata: this.buildCommandMetricMetadata(context),
        };
        const sessionId = context.getSessionId();
        if (sessionId !== undefined) {
            metric.sessionId = sessionId;
        }
        if (errorMessage !== undefined) {
            metric.errorMessage = errorMessage;
        }
        metrics.recordCommandExecutionMetric(metric);
    }
    resolveExecutionMode(context) {
        if (context.isChainExecution()) {
            return 'chain';
        }
        const strategy = context.executionPlan?.strategy;
        if (strategy === 'single' || strategy === 'chain') {
            return strategy;
        }
        // Default to 'single' for metrics when strategy is not yet determined
        return 'single';
    }
    buildCommandMetricMetadata(context) {
        return {
            strategy: context.executionPlan?.strategy,
            category: context.executionPlan?.category,
            hasSessionContext: Boolean(context.sessionContext),
            isChainExecution: context.isChainExecution(),
            frameworkEnabled: Boolean(context.frameworkContext),
            responseReady: Boolean(context.response),
        };
    }
    extractResponseError(response) {
        if (!response?.content?.length) {
            return undefined;
        }
        const text = response.content.find((item) => typeof item.text === 'string')?.text;
        return text?.slice(0, 200);
    }
    mapStageType(stageName) {
        switch (stageName) {
            case 'CommandParsing':
                return 'parsing';
            case 'ExecutionPlanning':
                return 'planning';
            case 'GateEnhancement':
                return 'gate_enhancement';
            case 'FrameworkResolution':
                return 'framework';
            case 'SessionManagement':
                return 'session';
            case 'StepExecution':
                return 'execution';
            case 'ResponseFormatting':
                return 'post_processing';
            default:
                return 'other';
        }
    }
}
//# sourceMappingURL=prompt-execution-pipeline.js.map