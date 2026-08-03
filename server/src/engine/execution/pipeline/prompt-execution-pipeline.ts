// @lifecycle canonical - Coordinates prompt execution across ordered stages.
import { randomUUID } from 'crypto';

import { trace, SpanStatusCode, context as otelContext } from '@opentelemetry/api';

import {
  buildCommandMetric,
  buildStageMetric,
  summarizeStageAttempt,
  type CommandOutcome,
  type StageAttempt,
} from './execution-metrics.js';
import { buildRootSpanAttributes } from './execution-telemetry.js';
import { formatStageOrderViolations, validateStageOrder } from './validate-stage-order.js';
import { ExecutionContext } from '../context/index.js';

import type { Logger } from '#infra/logging/index.js';
import type {
  MetricsCollector,
  PipelineStageStatus,
  MetricStatus,
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
    // Owned here rather than by `runStages` because the catch and finally blocks
    // below report whatever ran before a failure — an accumulator returned only on
    // success would be empty in exactly the case the metrics matter most.
    const stageMetrics: StageMetricSummary[] = [];
    let commandStatus: MetricStatus = 'success';
    let commandError: string | undefined;

    try {
      const earlyExitStage = await this.runStages(context, stageMetrics);

      if (!context.response) {
        throw new Error('Pipeline completed without producing a response');
      }

      if (context.response.isError) {
        commandStatus = 'error';
        commandError = this.extractResponseError(context.response);
      }

      this.logCompletion(earlyExitStage, pipelineStart, stageMetrics);
      this.finishRootSpan(rootSpan, {
        context,
        stageMetrics,
        pipelineStart,
        status: commandStatus,
        error: messageAsError(commandError),
      });
      return context.response;
    } catch (error) {
      const failure = toError(error);
      commandStatus = 'error';
      commandError = failure.message;
      this.logger.error('[Pipeline] Execution failed', {
        error: failure.message,
        stages: stageMetrics,
      });
      this.finishRootSpan(rootSpan, {
        context,
        stageMetrics,
        pipelineStart,
        status: 'error',
        error: failure,
        errorType: failure.message,
      });
      throw failure;
    } finally {
      this.recordCommandExecutionMetric(context, {
        commandId: commandMetricId,
        startTime: pipelineStart,
        endTime: Date.now(),
        status: commandStatus,
        errorMessage: commandError,
      });
      await this.runLifecycleCleanupHandlers(context);
    }
  }

  /**
   * Run stages in order until one produces a response.
   *
   * @returns the name of the stage that short-circuited, or undefined if every stage ran.
   */
  private async runStages(
    context: ExecutionContext,
    stageMetrics: StageMetricSummary[]
  ): Promise<string | undefined> {
    let previousState = this.captureContextState(context);

    for (let i = 0; i < this.stages.length; i++) {
      const stage = this.stages[i] as PipelineStage;
      const { summary, failure } = await this.runStage(stage, i, context);
      stageMetrics.push(summary);

      const currentState = this.captureContextState(context);
      this.logContextTransitions(stage.name, previousState, currentState);
      previousState = currentState;

      // Rethrown here rather than inside `runStage` so a failed stage still records
      // its metrics, span and context transition before the error propagates.
      if (failure !== undefined) {
        throw failure.error;
      }

      if (context.response) {
        return stage.name;
      }
    }

    return undefined;
  }

  /**
   * Execute one stage and report what it did.
   *
   * Reports a thrown error rather than rethrowing it: the caller owns control flow, and
   * every stage that starts gets a metric entry whether or not it completed.
   */
  private async runStage(
    stage: PipelineStage,
    index: number,
    context: ExecutionContext
  ): Promise<StageRunResult> {
    const startTime = Date.now();
    const memoryBefore = process.memoryUsage();
    const stageSpan = this.startStageSpan(stage.name, index);

    this.logger.info('[Pipeline] -> Stage start', {
      stage: stage.name,
      sessionId: context.getSessionId(),
    });

    let failure: StageFailure | undefined;
    let status: PipelineStageStatus = 'success';
    let errorMessage: string | undefined;

    try {
      await this.emitBeforeStage(stage.name, context);
      await stage.execute(context);
      await this.emitAfterStage(stage.name, context);
    } catch (error) {
      const stageError = toError(error);
      status = 'error';
      errorMessage = stageError.message;
      failure = { error };
      await this.emitStageError(stage.name, stageError, context);
      this.logger.error('[Pipeline] Stage failed', {
        stage: stage.name,
        durationMs: Date.now() - startTime,
        error: stageError.message,
      });
    }

    const attempt: StageAttempt = {
      stageName: stage.name,
      startTime,
      durationMs: Date.now() - startTime,
      status,
      errorMessage,
      memoryBefore,
      memoryAfter: process.memoryUsage(),
    };

    const summary = summarizeStageAttempt(attempt);
    this.logger.debug('[Pipeline] Stage metrics', summary);
    this.recordPipelineStageMetric(attempt, context);
    this.endSpanWithStatus(stageSpan, status, messageAsError(errorMessage));

    this.logger.info('[Pipeline] <- Stage complete', {
      stage: stage.name,
      durationMs: attempt.durationMs,
      responseReady: Boolean(context.response),
    });

    return failure !== undefined ? { summary, failure } : { summary };
  }

  /** Early exit and full completion are distinct events, so they log distinct payloads. */
  private logCompletion(
    earlyExitStage: string | undefined,
    pipelineStart: number,
    stageMetrics: readonly StageMetricSummary[]
  ): void {
    const totalDurationMs = Date.now() - pipelineStart;

    if (earlyExitStage !== undefined) {
      this.logger.info('[Pipeline] Early termination', {
        stage: earlyExitStage,
        reason: 'Response already available',
        totalDurationMs,
        stages: stageMetrics,
      });
      return;
    }

    this.logger.info('[Pipeline] Execution complete', {
      totalDurationMs,
      stages: stageMetrics,
    });
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

  private recordPipelineStageMetric(attempt: StageAttempt, context: ExecutionContext): void {
    const metrics = this.getMetricsCollector();
    if (!metrics) {
      return;
    }

    metrics.recordPipelineStage(buildStageMetric(attempt, context));
  }

  private recordCommandExecutionMetric(context: ExecutionContext, outcome: CommandOutcome): void {
    const metrics = this.getMetricsCollector();
    if (!metrics) {
      return;
    }

    metrics.recordCommandExecutionMetric(buildCommandMetric(context, outcome));
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
      stageMetrics: readonly StageMetricSummary[];
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

  /**
   * Attach the wide-event attributes and close the root span.
   *
   * One method rather than the enrich/end pair repeated at each exit, so a new exit path
   * cannot close the span without first enriching it.
   */
  private finishRootSpan(span: Span | undefined, outcome: RootSpanOutcome): void {
    this.enrichRootSpan(span, outcome);
    this.endSpanWithStatus(span, outcome.status, outcome.error);
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

/** A stage's thrown value, held so the caller can rethrow it after recording. */
interface StageFailure {
  readonly error: unknown;
}

interface StageRunResult {
  readonly summary: StageMetricSummary;
  /** Absent when the stage completed. */
  readonly failure?: StageFailure;
}

interface RootSpanOutcome {
  readonly context: ExecutionContext;
  readonly stageMetrics: readonly StageMetricSummary[];
  readonly pipelineStart: number;
  readonly status: MetricStatus;
  readonly error: Error | undefined;
  /** Set only when the pipeline threw, which the span reports separately from a failed response. */
  readonly errorType?: string;
}

/** Normalize a thrown value, which JavaScript does not guarantee is an Error. */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * A non-empty message as an Error, or undefined.
 *
 * An empty message yields undefined so `endSpanWithStatus` records no exception for it —
 * an Error carrying no message tells a reader nothing the status code does not.
 */
function messageAsError(message: string | undefined): Error | undefined {
  return message !== undefined && message.length > 0 ? new Error(message) : undefined;
}

interface ContextStateSnapshot {
  parsedCommand: boolean;
  executionPlan: boolean;
  frameworkContext: boolean;
  sessionContext: boolean;
  executionResults: boolean;
  response: boolean;
}
