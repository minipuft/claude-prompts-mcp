// @lifecycle canonical - Coordinates prompt execution across ordered stages.
import { randomUUID } from 'crypto';

import { ExecutionContext } from '../context/execution-context.js';

import type { PipelineStage } from './stage.js';
import type { Logger } from '../../logging/index.js';
import type {
  MetricsCollector,
  PipelineStageType,
  PipelineStageStatus,
  MetricStatus,
  CommandExecutionMetric,
  PipelineStageMetric,
} from '../../metrics/index.js';
import type { McpToolRequest, ToolResponse } from '../../types/index.js';

/**
 * Canonical Prompt Execution Pipeline orchestrator.
 */
export class PromptExecutionPipeline {
  private stages: PipelineStage[] = [];
  private readonly logger: Logger;
  private readonly metricsProvider: (() => MetricsCollector | undefined) | undefined;

  constructor(
    private readonly requestStage: PipelineStage,
    private readonly dependencyStage: PipelineStage,
    private readonly lifecycleStage: PipelineStage,
    private readonly parsingStage: PipelineStage,
    private readonly inlineGateStage: PipelineStage,
    private readonly operatorValidationStage: PipelineStage,
    private readonly planningStage: PipelineStage,
    private readonly scriptExecutionStage: PipelineStage | null, // 04b - Script tool execution
    private readonly scriptAutoExecuteStage: PipelineStage | null, // 04c - Script auto-execute
    private readonly frameworkStage: PipelineStage,
    private readonly judgeSelectionStage: PipelineStage,
    private readonly promptGuidanceStage: PipelineStage,
    private readonly gateStage: PipelineStage,
    private readonly sessionStage: PipelineStage,
    private readonly frameworkInjectionControlStage: PipelineStage,
    private readonly responseCaptureStage: PipelineStage,
    private readonly shellVerificationStage: PipelineStage | null, // 08b - Shell verification (Ralph Wiggum)
    private readonly executionStage: PipelineStage,
    private readonly gateReviewStage: PipelineStage,
    private readonly callToActionStage: PipelineStage,
    private readonly formattingStage: PipelineStage,
    private readonly postFormattingStage: PipelineStage,
    logger: Logger,
    metricsProvider?: () => MetricsCollector | undefined
  ) {
    this.logger = logger;
    this.metricsProvider = metricsProvider;
    this.registerStages();
  }

  /**
   * Execute the configured pipeline for the given MCP request.
   */
  async execute(mcpRequest: McpToolRequest): Promise<ToolResponse> {
    const context = new ExecutionContext(mcpRequest, this.logger);

    this.logger.info('[Pipeline] Starting execution', {
      command: mcpRequest.command ?? '<response-only>',
      chainId: mcpRequest.chain_id,
    });

    const pipelineStart = Date.now();
    const commandMetricId = this.createCommandMetricId();
    context.metadata['commandMetricId'] = commandMetricId;
    const stageMetrics: StageMetricSummary[] = [];
    let previousState = this.captureContextState(context);
    let commandStatus: MetricStatus = 'success';
    let commandError: string | undefined;

    try {
      for (const stage of this.stages) {
        const stageStart = Date.now();
        const memoryBefore = process.memoryUsage();
        let stageStatus: PipelineStageStatus = 'success';
        let stageError: string | undefined;

        this.logger.info('[Pipeline] -> Stage start', {
          stage: stage.name,
          sessionId: context.getSessionId(),
        });

        try {
          await stage.execute(context);
        } catch (error) {
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
        } finally {
          const durationMs = Date.now() - stageStart;
          const memoryAfter = process.memoryUsage();
          stageMetrics.push(
            this.logStageMetrics(stage.name, durationMs, memoryBefore, memoryAfter)
          );
          this.recordPipelineStageMetric(
            stage,
            context,
            stageStart,
            durationMs,
            stageStatus,
            stageError,
            memoryBefore,
            memoryAfter
          );

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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      commandStatus = 'error';
      commandError = message;
      this.logger.error('[Pipeline] Execution failed', {
        error: message,
        stages: stageMetrics,
      });
      throw error instanceof Error ? error : new Error(message);
    } finally {
      this.recordCommandExecutionMetric(
        context,
        pipelineStart,
        commandMetricId,
        commandStatus,
        commandError
      );
      await this.runLifecycleCleanupHandlers(context);
    }
  }

  /**
   * Expose stage lookups for diagnostics and testing.
   */
  getStage(name: string): PipelineStage | undefined {
    return this.stages.find((stage) => stage.name === name);
  }

  private registerStages(): void {
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
      // 08b: Shell verification (optional) - runs after response capture, before execution
      // Enables Ralph Wiggum loops where shell commands validate Claude's work
      ...(this.shellVerificationStage ? [this.shellVerificationStage] : []),
      this.executionStage,
      this.gateReviewStage,
      this.callToActionStage,
      this.formattingStage,
      this.postFormattingStage,
    ];
  }

  private logStageMetrics(
    stage: string,
    durationMs: number,
    memoryBefore: NodeJS.MemoryUsage,
    memoryAfter: NodeJS.MemoryUsage
  ): StageMetricSummary {
    const metrics: StageMetricSummary = {
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

  private captureContextState(context: ExecutionContext): ContextStateSnapshot {
    return {
      parsedCommand: Boolean(context.parsedCommand),
      executionPlan: Boolean(context.executionPlan),
      frameworkContext: Boolean(context.frameworkContext),
      sessionContext: Boolean(context.sessionContext),
      executionResults: Boolean(context.executionResults),
      response: Boolean(context.response),
    };
  }

  private logContextTransitions(
    stage: string,
    previous: ContextStateSnapshot,
    current: ContextStateSnapshot
  ): void {
    const transitions: Partial<ContextStateSnapshot> = {};
    let hasChanges = false;

    for (const key of Object.keys(current) as Array<keyof ContextStateSnapshot>) {
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

  private async runLifecycleCleanupHandlers(context: ExecutionContext): Promise<void> {
    const handlers = context.state.lifecycle.cleanupHandlers;
    if (!Array.isArray(handlers)) {
      return;
    }

    for (const handler of handlers) {
      try {
        await handler();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn('[Pipeline] Lifecycle cleanup handler failed', { message });
      }
    }
  }

  private getMetricsCollector(): MetricsCollector | undefined {
    return this.metricsProvider?.();
  }

  private createCommandMetricId(): string {
    return `cmd_${randomUUID()}`;
  }

  private recordPipelineStageMetric(
    stage: PipelineStage,
    context: ExecutionContext,
    startTime: number,
    durationMs: number,
    status: PipelineStageStatus,
    errorMessage: string | undefined,
    memoryBefore: NodeJS.MemoryUsage,
    memoryAfter: NodeJS.MemoryUsage
  ): void {
    const metrics = this.getMetricsCollector();
    if (!metrics) {
      return;
    }

    const metricPayload: PipelineStageMetric = {
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

  private recordCommandExecutionMetric(
    context: ExecutionContext,
    startTime: number,
    commandId: string,
    status: MetricStatus,
    errorMessage?: string
  ): void {
    const metrics = this.getMetricsCollector();
    if (!metrics) {
      return;
    }

    const endTime = Date.now();
    const appliedGates = context.executionPlan?.gates ?? [];
    const temporaryGateIds = Array.isArray(context.metadata['temporaryGateIds'])
      ? (context.metadata['temporaryGateIds'] as string[])
      : [];

    const metric: CommandExecutionMetric = {
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

  private resolveExecutionMode(context: ExecutionContext): CommandExecutionMetric['executionMode'] {
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

  private buildCommandMetricMetadata(context: ExecutionContext): Record<string, unknown> {
    return {
      strategy: context.executionPlan?.strategy,
      category: context.executionPlan?.category,
      hasSessionContext: Boolean(context.sessionContext),
      isChainExecution: context.isChainExecution(),
      frameworkEnabled: Boolean(context.frameworkContext),
      responseReady: Boolean(context.response),
    };
  }

  private extractResponseError(response?: ToolResponse): string | undefined {
    if (!response?.content?.length) {
      return undefined;
    }

    const text = response.content.find((item) => typeof item.text === 'string')?.text;
    return text?.slice(0, 200);
  }

  private mapStageType(stageName: string): PipelineStageType {
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

interface StageMetricSummary {
  stage: string;
  durationMs: number;
  heapUsed: number;
  rss: number;
  heapUsedDelta: number;
  rssDelta: number;
}

interface ContextStateSnapshot {
  parsedCommand: boolean;
  executionPlan: boolean;
  frameworkContext: boolean;
  sessionContext: boolean;
  executionResults: boolean;
  response: boolean;
}
