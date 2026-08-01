// @lifecycle canonical - Records gate usage metrics for analytics.
import type {
  MetricsCollector,
  GateUsageMetric,
  GateValidationResult as MetricGateValidationResult,
} from '#shared/types/index.js';
import type { GateValidationResult as ServiceGateValidationResult } from './gate-service-interface.js';
import type { ExecutionContext } from '../../execution/context/index.js';

/**
 * Records gate usage metrics for the analytics system.
 */
export class GateMetricsRecorder {
  constructor(
    private readonly metricsProvider: (() => MetricsCollector | undefined) | undefined,
    private readonly gateServiceType?: string
  ) {}

  recordGateUsageMetrics(
    context: ExecutionContext,
    gateIds: string[],
    instructionLength?: number,
    validationResults?: ServiceGateValidationResult[]
  ): void {
    const metrics = this.metricsProvider?.();
    if (metrics === undefined || gateIds.length === 0) {
      return;
    }

    const temporaryIds = new Set<string>(context.state.gates.temporaryGateIds ?? []);

    const validationMap = new Map<string, ServiceGateValidationResult>();
    validationResults?.forEach((result) => validationMap.set(result.gateId, result));

    const baseCharacters =
      instructionLength !== undefined && gateIds.length > 0
        ? Math.floor(instructionLength / gateIds.length)
        : 0;
    let remainder =
      instructionLength !== undefined && gateIds.length > 0
        ? instructionLength % gateIds.length
        : 0;

    for (const gateId of gateIds) {
      const isTemporary = temporaryIds.has(gateId) || gateId.startsWith('temp_');
      const validation = validationMap.get(gateId);
      const instructionCharacters = baseCharacters + (remainder > 0 ? 1 : 0);
      if (remainder > 0) {
        remainder--;
      }

      const metric: GateUsageMetric = {
        gateId,
        gateType: isTemporary ? 'temporary' : 'canonical',
        instructionCount: 1,
        instructionCharacters,
        temporary: isTemporary,
      };

      const sessionId = context.getSessionId();
      if (sessionId !== undefined) {
        metric.sessionId = sessionId;
      }

      const resolvedValidation =
        validation !== undefined
          ? this.toMetricValidationResult(validation)
          : validationResults !== undefined && validationResults.length > 0
            ? 'skipped'
            : undefined;
      if (resolvedValidation !== undefined) {
        metric.validationResult = resolvedValidation;
      }

      const metadata: Record<string, unknown> = {};
      if (context.executionPlan?.strategy !== undefined) {
        metadata['strategy'] = context.executionPlan.strategy;
      }
      if (context.executionPlan?.category !== undefined) {
        metadata['category'] = context.executionPlan.category;
      }
      if (this.gateServiceType !== undefined) {
        metadata['serviceType'] = this.gateServiceType;
      }
      if (Object.keys(metadata).length > 0) {
        metric.metadata = metadata;
      }

      metrics.recordGateUsage(metric);
    }
  }

  private toMetricValidationResult(
    validation: ServiceGateValidationResult
  ): MetricGateValidationResult {
    return validation.passed ? 'passed' : 'failed';
  }
}
