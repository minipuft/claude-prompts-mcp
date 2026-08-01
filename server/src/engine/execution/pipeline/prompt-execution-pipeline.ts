// @lifecycle canonical - Coordinates prompt execution across ordered stages.
import { randomUUID } from 'crypto';

import { trace, SpanStatusCode, context as otelContext } from '@opentelemetry/api';

import { ExecutionContext } from '../context/index.js';

import type { PipelineStage } from './stage.js';
import type { Logger } from '../../../infra/logging/index.js';
import type {
  MetricsCollector,
  PipelineStageType,
  PipelineStageStatus,
  MetricStatus,
  CommandExecutionMetric,
  PipelineStageMetric,
  McpToolRequest,
  ToolResponse,
  HookRegistryPort,
  PipelineHookContext,
} from '../../../shared/types/index.js';
import type { Span } from '@opentelemetry/api';

/**
 * Canonical Prompt Execution Pipeline orchestrator.
 */
export class PromptExecutionPipeline {
  private stages: PipelineStage[] = [];
  private readonly logger: Logger;
  private readonly metricsProvider: (() => MetricsCollector | undefined) | undefined;
  private readonly hookRegistry: HookRegistryPort | undefined;

  constructor(
    private readonly requestStage: PipelineStage,
    private readonly dependencyStage: PipelineStage,
    private readonly lifecycleStage: PipelineStage,
    private readonly identityResolutionStage: PipelineStage,
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
    private readonly phaseGuardVerificationStage: PipelineStage | null, // 09b - Phase guard verification
    private readonly gateReviewStage: PipelineStage,
    private readonly formattingStage: PipelineStage,
    private readonly postFormattingStage: PipelineStage,
    logger: Logger,
    metricsProvider?: () => MetricsCollector | undefined,
    hookRegistry?: HookRegistryPort
  ) {
    this.logger = logger;
    this.metricsProvider = metricsProvider;
    this.hookRegistry = hookRegistry;
    this.registerStages();
  }

  /**
   * Execute the configured pipeline for the given MCP request.
   */
  async execute(mcpRequest: McpToolRequest): Promise<ToolResponse> {
    const context = new ExecutionContext(mcpRequest, this.logger);
    const rootSpan = this.startRootSpan(context);

    // If telemetry active, wrap execution in root span context
    // so trace.getActiveSpan() works for hook observer events
    if (rootSpan !== undefined) {
      return otelContext.with(trace.setSpan(otelContext.active(), rootSpan), () =>
        this.executePipelineStages(context, rootSpan)
      );
    }
    return this.executePipelineStages(context);
  }

  private async executePipelineStages(
    context: ExecutionContext,
    rootSpan?: Span
  ): Promise<ToolResponse> {
    this.logger.info('[Pipeline] Starting execution', {
      command: context.mcpRequest.command ?? '<response-only>',
      chainId: context.mcpRequest.chain_id,
    });

    const pipelineStart = Date.now();
    const commandMetricId = this.createCommandMetricId();
    context.metadata['commandMetricId'] = commandMetricId;
    const stageMetrics: StageMetricSummary[] = [];
    const skippedStages: string[] = [];
    let previousState = this.captureContextState(context);
    let commandStatus: MetricStatus = 'success';
    let commandError: string | undefined;

    try {
      for (let i = 0; i < this.stages.length; i++) {
        const stage = this.stages[i] as PipelineStage;
        const stageStart = Date.now();
        const memoryBefore = process.memoryUsage();
        let stageStatus: PipelineStageStatus = 'success';
        let stageError: string | undefined;
        const stageSpan = this.startStageSpan(stage.name, i);

        this.logger.info('[Pipeline] -> Stage start', {
          stage: stage.name,
          sessionId: context.getSessionId(),
        });

        try {
          await this.emitBeforeStage(stage.name, context);
          await stage.execute(context);
          await this.emitAfterStage(stage.name, context);
        } catch (error) {
          const durationMs = Date.now() - stageStart;
          const message = error instanceof Error ? error.message : String(error);
          stageStatus = 'error';
          stageError = message;
          await this.emitStageError(
            stage.name,
            error instanceof Error ? error : new Error(message),
            context
          );
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
          this.endSpanWithStatus(
            stageSpan,
            stageStatus,
            stageError ? new Error(stageError) : undefined
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
          this.enrichRootSpan(rootSpan, context, stageMetrics, skippedStages, pipelineStart);
          this.endSpanWithStatus(
            rootSpan,
            commandStatus,
            commandError ? new Error(commandError) : undefined
          );
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
      this.enrichRootSpan(rootSpan, context, stageMetrics, skippedStages, pipelineStart);
      this.endSpanWithStatus(
        rootSpan,
        commandStatus,
        commandError ? new Error(commandError) : undefined
      );
      return context.response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      commandStatus = 'error';
      commandError = message;
      this.logger.error('[Pipeline] Execution failed', {
        error: message,
        stages: stageMetrics,
      });
      this.enrichRootSpan(rootSpan, context, stageMetrics, skippedStages, pipelineStart, message);
      this.endSpanWithStatus(
        rootSpan,
        'error',
        error instanceof Error ? error : new Error(message)
      );
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
      this.identityResolutionStage,
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
      // 09b: Phase guard verification (optional) - structural checks before gate review
      ...(this.phaseGuardVerificationStage ? [this.phaseGuardVerificationStage] : []),
      this.gateReviewStage,
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

  // ===== Phase 1.3b: Hook Emissions =====

  private buildHookContext(context: ExecutionContext): PipelineHookContext {
    return {
      executionId: String(context.metadata['commandMetricId'] || 'unknown'),
      executionType: context.isChainExecution() ? 'chain' : 'single',
      chainId: context.getSessionId(),
      currentStep: context.sessionContext?.currentStep,
      frameworkEnabled: Boolean(context.frameworkContext),
      frameworkId: context.frameworkContext?.selectedFramework?.id,
    };
  }

  private async emitBeforeStage(stageName: string, context: ExecutionContext): Promise<void> {
    if (this.hookRegistry === undefined) return;
    try {
      await this.hookRegistry.emitBeforeStage(stageName, this.buildHookContext(context));
    } catch (error) {
      this.logger.debug('[Pipeline] Hook emitBeforeStage error', { stageName, error });
    }
  }

  private async emitAfterStage(stageName: string, context: ExecutionContext): Promise<void> {
    if (this.hookRegistry === undefined) return;
    try {
      await this.hookRegistry.emitAfterStage(stageName, this.buildHookContext(context));
    } catch (error) {
      this.logger.debug('[Pipeline] Hook emitAfterStage error', { stageName, error });
    }
  }

  private async emitStageError(
    stageName: string,
    stageError: Error,
    context: ExecutionContext
  ): Promise<void> {
    if (this.hookRegistry === undefined) return;
    try {
      await this.hookRegistry.emitStageError(stageName, stageError, this.buildHookContext(context));
    } catch (error) {
      this.logger.debug('[Pipeline] Hook emitStageError error', { stageName, error });
    }
  }

  // ===== Phase 1.4: OTel Span Instrumentation =====

  private startRootSpan(context: ExecutionContext): Span | undefined {
    // OTel global API: returns real tracer when SDK is registered, no-op tracer otherwise.
    // No DI needed — TelemetryRuntimeImpl.start() registers the global provider.
    const tracer = trace.getTracer('prompt_engine');
    // Check if the tracer is recording (SDK registered) by probing a span
    const probeSpan = tracer.startSpan('__probe__');
    const isRecording = probeSpan.isRecording();
    probeSpan.end();
    if (!isRecording) return undefined;

    return tracer.startSpan('prompt_engine.request', {
      attributes: {
        'cpm.execution.id': (context.metadata['commandMetricId'] as string) ?? 'unknown',
        'cpm.command.type': context.mcpRequest.command ?? 'response-only',
        'cpm.execution.mode': context.isChainExecution() ? 'chain' : 'single',
      },
    });
  }

  private startStageSpan(stageName: string, stageIndex: number): Span | undefined {
    // Only create stage spans when root span is active (telemetry SDK registered)
    const activeSpan = trace.getActiveSpan();
    if (!activeSpan?.isRecording()) return undefined;

    return trace.getTracer('prompt_engine').startSpan(`pipeline.stage.${stageName}`, {
      attributes: {
        'cpm.stage.name': stageName,
        'cpm.stage.index': stageIndex,
      },
    });
  }

  // ===== Wide-Event Enrichment (per /observability skill) =====

  private enrichRootSpan(
    span: Span | undefined,
    context: ExecutionContext,
    stageMetrics: StageMetricSummary[],
    skippedStages: string[],
    pipelineStart: number,
    errorType?: string
  ): void {
    if (!span?.isRecording()) return;

    // Determine early exit from whether all registered stages actually ran
    const hadEarlyExit = stageMetrics.length < this.stages.length;

    // Find slowest stage from timing data already collected
    const slowest = stageMetrics.reduce((max, s) => (s.durationMs > max.durationMs ? s : max), {
      stage: 'none',
      durationMs: 0,
    } as Pick<StageMetricSummary, 'stage' | 'durationMs'>);

    // Aggregate gate state from pipeline internal state
    const gateState = context.state.gates;
    const allGateIds = [
      ...gateState.temporaryGateIds,
      ...gateState.frameworkGateIds,
      ...gateState.registeredInlineGateIds,
    ];
    const failedCount = gateState.blockedGateIds?.length ?? 0;

    span.setAttributes({
      // Performance summary
      'cpm.duration.total_ms': Date.now() - pipelineStart,
      'cpm.stages.executed_count': stageMetrics.length,
      'cpm.stages.skipped': skippedStages.join(','),
      'cpm.stages.slowest': slowest.stage,
      'cpm.stages.slowest_ms': slowest.durationMs,
      'cpm.had_early_exit': hadEarlyExit,
      // Gate summary
      'cpm.gates.names': allGateIds.join(','),
      'cpm.gates.passed_count': allGateIds.length - failedCount,
      'cpm.gates.failed_count': failedCount,
      'cpm.gates.blocked': gateState.responseBlocked ?? false,
      'cpm.gates.retry_exhausted': gateState.retryLimitExceeded ?? false,
      'cpm.gates.enforcement_mode': gateState.enforcementMode ?? 'standard',
      // Chain context
      'cpm.chain.is_chain': context.isChainExecution(),
      'cpm.chain.step_index': context.sessionContext?.currentStep ?? 0,
      'cpm.chain.id': context.sessionContext?.chainId ?? '',
      // Framework
      'cpm.framework.id': context.frameworkContext?.selectedFramework?.id ?? '',
      'cpm.framework.enabled': Boolean(context.frameworkContext),
      // Scope
      'cpm.scope.source': context.state.scope.source ?? 'default',
      // Error categorization
      ...(errorType ? { 'cpm.error.type': errorType } : {}),
    });
  }

  private endSpanWithStatus(
    span: Span | undefined,
    status: PipelineStageStatus,
    error?: Error
  ): void {
    if (span === undefined) return;
    if (status === 'error') {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error?.message });
      if (error !== undefined) span.recordException(error);
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
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
