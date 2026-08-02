// @lifecycle canonical - Pure derivation of telemetry payloads from pipeline execution data.
import type { PipelineStageType } from '#shared/types/index.js';
import type { ExecutionContext } from '../context/index.js';
import type { Attributes } from '@opentelemetry/api';

/** Per-stage timing and memory sample collected while the pipeline runs. */
export interface StageMetricSummary {
  stage: string;
  durationMs: number;
  heapUsed: number;
  rss: number;
  heapUsedDelta: number;
  rssDelta: number;
}

/**
 * Stage name -> metric classification.
 *
 * Keys are the `readonly name` literals declared by the stage classes in
 * `stages/`. A name absent from this table classifies as `'other'`, so adding a
 * stage without adding a row here degrades the metric silently — the
 * `stageType classification` suite in `pipeline-telemetry.test.ts` asserts that
 * no registered stage reports `'other'`.
 */
const STAGE_TYPES: Readonly<Record<string, PipelineStageType>> = {
  RequestNormalization: 'normalization',
  DependencyInjection: 'lifecycle',
  ExecutionLifecycle: 'lifecycle',
  IdentityResolution: 'identity',
  CommandParsing: 'parsing',
  InlineGateExtraction: 'inline_gate',
  OperatorValidation: 'operator_validation',
  ExecutionPlanning: 'planning',
  ScriptExecution: 'script',
  ScriptAutoExecute: 'script',
  JudgeSelection: 'judge_selection',
  GateEnhancement: 'gate_enhancement',
  FrameworkResolution: 'framework',
  SessionManagement: 'session',
  InjectionControl: 'injection_control',
  PromptGuidance: 'prompt_guidance',
  StepResponseCapture: 'response_capture',
  ShellVerification: 'verification',
  StepExecution: 'execution',
  PhaseGuardVerification: 'verification',
  GateReview: 'gate_review',
  ResponseFormatting: 'post_processing',
  PostFormattingCleanup: 'post_processing',
};

/** Classify a stage for `PipelineStageMetric.stageType`. */
export function resolveStageType(stageName: string): PipelineStageType {
  return STAGE_TYPES[stageName] ?? 'other';
}

export interface RootSpanAttributeInput {
  context: ExecutionContext;
  /** One entry per stage that started, in execution order. */
  stageMetrics: readonly StageMetricSummary[];
  /** Every stage the pipeline registered, in execution order. */
  registeredStageNames: readonly string[];
  pipelineStart: number;
  /** Present only when the pipeline threw. */
  errorType?: string;
}

/**
 * Build the wide-event attribute bag for the root span.
 *
 * One span carries the whole execution, so every field a query might filter on
 * is set here rather than spread across child spans.
 */
export function buildRootSpanAttributes(input: RootSpanAttributeInput): Attributes {
  return {
    ...buildPerformanceAttributes(input),
    ...buildGateAttributes(input.context),
    ...buildExecutionAttributes(input.context),
    ...(input.errorType !== undefined ? { 'cpm.error.type': input.errorType } : {}),
  };
}

/**
 * A stage gets a metric entry the moment it starts, including the one that
 * throws — so the stages beyond `stageMetrics.length` are exactly those that
 * never ran, whether the pipeline exited early or failed.
 */
function buildPerformanceAttributes({
  stageMetrics,
  registeredStageNames,
  pipelineStart,
}: RootSpanAttributeInput): Attributes {
  const slowest = stageMetrics.reduce<Pick<StageMetricSummary, 'stage' | 'durationMs'>>(
    (max, s) => (s.durationMs > max.durationMs ? s : max),
    { stage: 'none', durationMs: 0 }
  );
  const skipped = registeredStageNames.slice(stageMetrics.length);

  return {
    'cpm.duration.total_ms': Date.now() - pipelineStart,
    'cpm.stages.executed_count': stageMetrics.length,
    'cpm.stages.skipped': skipped.join(','),
    'cpm.stages.slowest': slowest.stage,
    'cpm.stages.slowest_ms': slowest.durationMs,
    'cpm.had_early_exit': skipped.length > 0,
  };
}

function buildGateAttributes(context: ExecutionContext): Attributes {
  const gateState = context.state.gates;
  const allGateIds = [
    ...gateState.temporaryGateIds,
    ...gateState.frameworkGateIds,
    ...gateState.registeredInlineGateIds,
  ];
  const failedCount = gateState.blockedGateIds?.length ?? 0;

  return {
    'cpm.gates.names': allGateIds.join(','),
    'cpm.gates.passed_count': allGateIds.length - failedCount,
    'cpm.gates.failed_count': failedCount,
    'cpm.gates.blocked': gateState.responseBlocked ?? false,
    'cpm.gates.retry_exhausted': gateState.retryLimitExceeded ?? false,
    'cpm.gates.enforcement_mode': gateState.enforcementMode ?? 'standard',
  };
}

function buildExecutionAttributes(context: ExecutionContext): Attributes {
  return {
    'cpm.chain.is_chain': context.isChainExecution(),
    'cpm.chain.step_index': context.sessionContext?.currentStep ?? 0,
    'cpm.chain.id': context.sessionContext?.chainId ?? '',
    'cpm.framework.id': context.frameworkContext?.selectedFramework.id ?? '',
    'cpm.framework.enabled': Boolean(context.frameworkContext),
    'cpm.scope.source': context.state.scope.source,
  };
}
