// @lifecycle canonical - Coordinates prompt execution across ordered stages.
import { randomUUID } from 'crypto';

import { trace, SpanStatusCode, context as otelContext } from '@opentelemetry/api';

import { buildRootSpanAttributes, resolveStageType } from './execution-telemetry.js';
import { formatStageOrderViolations, validateStageOrder } from './validate-stage-order.js';
import { ExecutionContext } from '../context/index.js';

import type { Logger } from '#infra/logging/index.js';
import type {
  MetricsCollector,
  PipelineStageStatus,
  MetricStatus,
  CommandExecutionMetric,
  PipelineStageMetric,
  McpToolRequest,
  ToolResponse,
  HookRegistryPort,
  PipelineHookContext,
} from '#shared/types/index.js';
import type { GateEnforcementAuthority } from './decisions/index.js';
import type { StageMetricSummary } from './execution-telemetry.js';
import type { PipelineStage } from './stage.js';
import type { Span } from '@opentelemetry/api';

/**
 * Canonical Prompt Execution Pipeline orchestrator.
 */
/** Everything the pipeline needs that is not a stage. */
export interface PipelinePorts {
  logger: Logger;
  metricsProvider?: () => MetricsCollector | undefined;
  hookRegistry?: HookRegistryPort;
  /**
   * Assigned onto every ExecutionContext before the first stage runs. Built once
   * by `PipelineBuilder` — it depends only on construction-time services, so it
   * has no reason to be rebuilt per request.
   */
  gateEnforcement?: GateEnforcementAuthority;
}

export class PromptExecutionPipeline {
  private readonly stages: readonly PipelineStage[];
  private readonly logger: Logger;
  private readonly metricsProvider: (() => MetricsCollector | undefined) | undefined;
  private readonly hookRegistry: HookRegistryPort | undefined;
  private readonly gateEnforcement: GateEnforcementAuthority | undefined;

  /**
   * @param stages Executed in array order. The caller owns the ordering and its
   *   rationale — see `PipelineBuilder.build()`, which is the only production
   *   construction site.
   * @param ports Grouped rather than positional: this list has grown twice, and
   *   four positional parameters is the lint ceiling.
   */
  constructor(stages: readonly PipelineStage[], ports: PipelinePorts) {
    if (stages.length === 0) {
      throw new Error('PromptExecutionPipeline requires at least one stage');
    }
    const orderViolations = validateStageOrder(stages);
    if (orderViolations.length > 0) {
      throw new Error(
        `PromptExecutionPipeline received a stage array that violates ${orderViolations.length} declared ordering constraint(s):\n${formatStageOrderViolations(orderViolations)}`
      );
    }
    this.stages = stages;
    this.logger = ports.logger;
    this.metricsProvider = ports.metricsProvider;
    this.hookRegistry = ports.hookRegistry;
    this.gateEnforcement = ports.gateEnforcement;
  }

  /**
   * Execute the configured pipeline for the given MCP request.
   */
  async execute(mcpRequest: McpToolRequest): Promise<ToolResponse> {
    const context = new ExecutionContext(mcpRequest, this.logger);
    if (this.gateEnforcement !== undefined) {
      context.gateEnforcement = this.gateEnforcement;
    }
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
    context.state.lifecycle.metricId = commandMetricId;
    const stageMetrics: StageMetricSummary[] = [];
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
          this.enrichRootSpan(rootSpan, { context, stageMetrics, pipelineStart });
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
      this.enrichRootSpan(rootSpan, { context, stageMetrics, pipelineStart });
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
      this.enrichRootSpan(rootSpan, { context, stageMetrics, pipelineStart, errorType: message });
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
      stageType: resolveStageType(stage.name),
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
    // Typed slot, not `metadata` — every writer moved to `state.gates` and the
    // metadata key stopped being set, which pinned this count at zero.
    const temporaryGateIds = context.state.gates.temporaryGateIds;

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
      executionId: context.state.lifecycle.metricId ?? 'unknown',
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
    // OTel global API: returns a real tracer when the SDK is registered, a no-op
    // tracer otherwise. No DI needed — TelemetryRuntimeImpl.start() registers the
    // global provider.
    //
    // The no-op tracer hands back a NonRecordingSpan that is never exported, so
    // starting the real span and asking IT whether it records answers "is
    // telemetry live?" without emitting anything. Sampling out the root also
    // reports false here, which correctly suppresses the child stage spans.
    const span = trace.getTracer('prompt_engine').startSpan('prompt_engine.request', {
      attributes: {
        'cpm.execution.id': context.state.lifecycle.metricId ?? 'unknown',
        'cpm.command.type': context.mcpRequest.command ?? 'response-only',
        'cpm.execution.mode': context.isChainExecution() ? 'chain' : 'single',
      },
    });

    if (!span.isRecording()) {
      span.end();
      return undefined;
    }
    return span;
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
    execution: {
      context: ExecutionContext;
      stageMetrics: StageMetricSummary[];
      pipelineStart: number;
      errorType?: string;
    }
  ): void {
    if (span?.isRecording() !== true) return;

    span.setAttributes(
      buildRootSpanAttributes({
        ...execution,
        registeredStageNames: this.stages.map((stage) => stage.name),
      })
    );
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
}

interface ContextStateSnapshot {
  parsedCommand: boolean;
  executionPlan: boolean;
  frameworkContext: boolean;
  sessionContext: boolean;
  executionResults: boolean;
  response: boolean;
}
