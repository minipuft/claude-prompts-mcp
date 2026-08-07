// @lifecycle canonical - Records gate usage metrics for analytics.
import type { MetricsCollector, GateUsageMetric } from '#shared/types/index.js';
import type { ExecutionContext } from '../../execution/context/index.js';

/**
 * Records gate usage metrics for the analytics system.
 *
 * Records injection facts only — which gates were applied, how much instruction text each
 * carried. It does not record pass/fail: gate services render guidance and never evaluate, so
 * there is no verdict to observe at this point in the pipeline. Verdicts arrive later through
 * `gate_verdict` and are owned by `GateVerdictProcessor`.
 */
export class GateMetricsRecorder {
  constructor(private readonly metricsProvider: (() => MetricsCollector | undefined) | undefined) {}

  recordGateUsageMetrics(
    context: ExecutionContext,
    gateIds: string[],
    instructionLength?: number
  ): void {
    const metrics = this.metricsProvider?.();
    if (metrics === undefined || gateIds.length === 0) {
      return;
    }

    const temporaryIds = new Set<string>(context.state.gates.temporaryGateIds ?? []);

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

      const metadata: Record<string, unknown> = {};
      if (context.executionPlan?.strategy !== undefined) {
        metadata['strategy'] = context.executionPlan.strategy;
      }
      if (context.executionPlan?.category !== undefined) {
        metadata['category'] = context.executionPlan.category;
      }
      if (Object.keys(metadata).length > 0) {
        metric.metadata = metadata;
      }

      metrics.recordGateUsage(metric);
    }
  }
}
