// @lifecycle canonical - Pure derivation of MetricsCollector payloads from execution outcomes.
/**
 * Execution metric payloads.
 *
 * Separate from `execution-telemetry.ts`, which builds OTel `Attributes` for the span
 * exporter. These functions build `PipelineStageMetric` / `CommandExecutionMetric` for
 * `MetricsCollector`. Different consumers and different contracts, so they change for
 * different reasons.
 *
 * The memory deltas were previously derived twice from the same two snapshots — once for
 * the debug log and once for the metric metadata. `summarizeStageAttempt` is now the only
 * place that subtraction happens, and `buildStageMetric` reads its result.
 */
import { resolveStageType, type StageMetricSummary } from './execution-telemetry.js';

import type {
  CommandExecutionMetric,
  MetricStatus,
  PipelineStageMetric,
  PipelineStageStatus,
} from '#shared/types/index.js';
import type { ExecutionContext } from '../context/index.js';

/**
 * What one stage did, as observed by the loop that ran it.
 *
 * Recorded for every stage that started, including one that threw — `status` and
 * `errorMessage` carry that, so a failed stage still produces both payloads.
 */
export interface StageAttempt {
  readonly stageName: string;
  readonly startTime: number;
  readonly durationMs: number;
  readonly status: PipelineStageStatus;
  readonly errorMessage: string | undefined;
  readonly memoryBefore: NodeJS.MemoryUsage;
  readonly memoryAfter: NodeJS.MemoryUsage;
}

/**
 * How the whole command ended.
 *
 * `endTime` is passed in rather than read from the clock here so the builder stays pure
 * and the metric's duration matches the moment the caller decided the command was over.
 */
export interface CommandOutcome {
  readonly commandId: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly status: MetricStatus;
  readonly errorMessage: string | undefined;
}

/**
 * Reduce a stage attempt to its timing and memory sample.
 *
 * The single site where the memory deltas are computed. Its result feeds the debug log,
 * the root span's `cpm.stages.slowest` / `cpm.stages.skipped`, and the stage metric's
 * metadata.
 */
export function summarizeStageAttempt(attempt: StageAttempt): StageMetricSummary {
  return {
    stage: attempt.stageName,
    durationMs: attempt.durationMs,
    heapUsed: attempt.memoryAfter.heapUsed,
    rss: attempt.memoryAfter.rss,
    heapUsedDelta: attempt.memoryAfter.heapUsed - attempt.memoryBefore.heapUsed,
    rssDelta: attempt.memoryAfter.rss - attempt.memoryBefore.rss,
  };
}

/**
 * Build the per-stage payload for `MetricsCollector.recordPipelineStage`.
 *
 * `sessionId` and `errorMessage` are assigned conditionally rather than set to
 * `undefined`, because the collector's payload treats an absent key and an explicit
 * `undefined` differently once serialized.
 */
export function buildStageMetric(
  attempt: StageAttempt,
  context: ExecutionContext
): PipelineStageMetric {
  const summary = summarizeStageAttempt(attempt);
  const sessionId = context.getSessionId();

  const metric: PipelineStageMetric = {
    stageId: `${attempt.stageName}:${sessionId ?? 'sessionless'}:${attempt.startTime}`,
    stageName: attempt.stageName,
    stageType: resolveStageType(attempt.stageName),
    toolName: 'prompt_engine',
    startTime: attempt.startTime,
    endTime: attempt.startTime + attempt.durationMs,
    durationMs: attempt.durationMs,
    status: attempt.status,
    metadata: {
      heapUsed: summary.heapUsed,
      rss: summary.rss,
      heapUsedDelta: summary.heapUsedDelta,
      rssDelta: summary.rssDelta,
      responseReady: Boolean(context.response),
    },
  };

  if (sessionId !== undefined) {
    metric.sessionId = sessionId;
  }
  if (attempt.errorMessage !== undefined) {
    metric.errorMessage = attempt.errorMessage;
  }

  return metric;
}

/** Build the per-command payload for `MetricsCollector.recordCommandExecutionMetric`. */
export function buildCommandMetric(
  context: ExecutionContext,
  outcome: CommandOutcome
): CommandExecutionMetric {
  const sessionId = context.getSessionId();

  const metric: CommandExecutionMetric = {
    commandId: outcome.commandId,
    commandName: context.mcpRequest.command ?? '<response-only>',
    toolName: 'prompt_engine',
    executionMode: resolveExecutionMode(context),
    startTime: outcome.startTime,
    endTime: outcome.endTime,
    durationMs: outcome.endTime - outcome.startTime,
    status: outcome.status,
    appliedGates: context.executionPlan?.gates ?? [],
    // Typed slot, not `metadata` — every writer moved to `state.gates` and the
    // metadata key stopped being set, which pinned this count at zero.
    temporaryGatesApplied: context.state.gates.temporaryGateIds.length,
    metadata: buildCommandMetricMetadata(context),
  };

  if (sessionId !== undefined) {
    metric.sessionId = sessionId;
  }
  if (outcome.errorMessage !== undefined) {
    metric.errorMessage = outcome.errorMessage;
  }

  return metric;
}

/**
 * Classify the command for `CommandExecutionMetric.executionMode`.
 *
 * Falls back to `'single'` when the planning stage has not run — a command that fails
 * before planning still gets a metric, and the field is not optional.
 */
export function resolveExecutionMode(
  context: ExecutionContext
): CommandExecutionMetric['executionMode'] {
  if (context.isChainExecution()) {
    return 'chain';
  }

  const strategy = context.executionPlan?.strategy;
  if (strategy === 'single' || strategy === 'chain') {
    return strategy;
  }

  return 'single';
}

function buildCommandMetricMetadata(context: ExecutionContext): Record<string, unknown> {
  return {
    strategy: context.executionPlan?.strategy,
    category: context.executionPlan?.category,
    hasSessionContext: Boolean(context.sessionContext),
    isChainExecution: context.isChainExecution(),
    frameworkEnabled: Boolean(context.frameworkContext),
    responseReady: Boolean(context.response),
  };
}
