import { ExecutionContext } from "../context/execution-context.js";
/**
 * Lightweight orchestrator that wires together the pipeline stages.
 */
export class PipelineOrchestrator {
    constructor(parsingStage, planningStage, gateStage, frameworkStage, sessionStage, executionStage, formattingStage, logger) {
        this.parsingStage = parsingStage;
        this.planningStage = planningStage;
        this.gateStage = gateStage;
        this.frameworkStage = frameworkStage;
        this.sessionStage = sessionStage;
        this.executionStage = executionStage;
        this.formattingStage = formattingStage;
        this.stages = [];
        this.logger = logger;
        this.registerStages();
    }
    /**
     * Execute the configured pipeline for the given MCP request.
     */
    async execute(mcpRequest) {
        const context = new ExecutionContext(mcpRequest);
        this.logger.info("[Pipeline] Starting execution", {
            command: mcpRequest.command,
            sessionId: mcpRequest.session_id,
        });
        const pipelineStart = Date.now();
        const stageMetrics = [];
        let previousState = this.captureContextState(context);
        try {
            for (const stage of this.stages) {
                const stageStart = Date.now();
                const memoryBefore = process.memoryUsage();
                this.logger.info("[Pipeline] -> Stage start", {
                    stage: stage.name,
                    sessionId: context.getSessionId(),
                });
                try {
                    await stage.execute(context);
                }
                catch (error) {
                    const durationMs = Date.now() - stageStart;
                    const message = error instanceof Error ? error.message : String(error);
                    this.logger.error("[Pipeline] Stage failed", {
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
                    const currentState = this.captureContextState(context);
                    this.logContextTransitions(stage.name, previousState, currentState);
                    previousState = currentState;
                    this.logger.info("[Pipeline] <- Stage complete", {
                        stage: stage.name,
                        durationMs,
                        responseReady: Boolean(context.response),
                    });
                }
                if (context.response) {
                    this.logger.info("[Pipeline] Early termination", {
                        stage: stage.name,
                        reason: "Response already available",
                        totalDurationMs: Date.now() - pipelineStart,
                        stages: stageMetrics,
                    });
                    return context.response;
                }
            }
            if (!context.response) {
                throw new Error("Pipeline completed without producing a response");
            }
            this.logger.info("[Pipeline] Execution complete", {
                totalDurationMs: Date.now() - pipelineStart,
                stages: stageMetrics,
            });
            return context.response;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error("[Pipeline] Execution failed", {
                error: message,
                stages: stageMetrics,
            });
            throw error instanceof Error ? error : new Error(message);
        }
    }
    /**
     * Expose stage lookups for diagnostics and testing.
     */
    getStage(name) {
        return this.stages.find((stage) => stage.name === name);
    }
    registerStages() {
        this.stages = [
            this.parsingStage,
            this.planningStage,
            this.gateStage,
            this.frameworkStage,
            this.sessionStage,
            this.executionStage,
            this.formattingStage,
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
        this.logger.debug("[Pipeline] Stage metrics", metrics);
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
            this.logger.info("[Pipeline] Context updated", {
                stage,
                transitions,
            });
        }
    }
}
//# sourceMappingURL=orchestrator.js.map