// @lifecycle canonical - Bridges hook events into OTel trace events.
/**
 * Telemetry Hook Observer
 *
 * Registers as a consumer of HookRegistry events and converts them
 * into OpenTelemetry trace events (span events). This is the single
 * telemetry consumer that listens to the hook fan-out point.
 *
 * Architecture:
 * - Pipeline stages emit hook events (Phase 1.3b)
 * - HookRegistry fans out to registered consumers
 * - This observer converts hook events → OTel span events
 * - Attribute policy enforces data safety on all emitted attributes
 *
 * Does NOT create spans — spans are managed by the pipeline instrumentation (Phase 1.4).
 * This observer only adds events to the active span context.
 */

import { trace, SpanStatusCode } from '@opentelemetry/api';

import { AttributePolicyEnforcer } from './attribute-policy.js';
import { TRACE_EVENTS } from './types.js';

import type { Logger } from '#shared/types/index.js';
import type { TelemetryRuntime } from './types.js';
import type {
  HookExecutionContext,
  GateEvaluationResult,
  PipelineHooks,
  GateHooks,
  ChainHooks,
  HookRegistry,
} from '../../hooks/hook-registry.js';

// ===== Pure Functions =====

/**
 * Build safe gate event attributes from hook data.
 */
function buildGateAttributes(
  gateId: string,
  result: GateEvaluationResult
): Record<string, unknown> {
  return {
    'cpm.gate.id': gateId,
    'cpm.gate.passed': result.passed,
    'cpm.gate.reason': result.reason,
    'cpm.gate.blocks_response': result.blocksResponse,
  };
}

/**
 * Build safe chain event attributes from hook data.
 */
function buildChainAttributes(
  chainId: string,
  context: HookExecutionContext,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return {
    'cpm.chain.id': chainId,
    'cpm.chain.current_step': context.currentStep,
    ...extra,
  };
}

// ===== Service Class =====

/**
 * Observes hook events and emits them as OTel trace events.
 *
 * Usage:
 * ```typescript
 * const observer = new TelemetryHookObserver(runtime, policy, logger);
 * observer.register(hookRegistry);
 * // Now hook events automatically become trace events
 * ```
 */
export class TelemetryHookObserver {
  private readonly runtime: TelemetryRuntime;
  private readonly policy: AttributePolicyEnforcer;
  private readonly logger: Logger;

  constructor(runtime: TelemetryRuntime, policy: AttributePolicyEnforcer, logger: Logger) {
    this.runtime = runtime;
    this.policy = policy;
    this.logger = logger;
  }

  /**
   * Register as a hook consumer on the given HookRegistry.
   * Safe to call when telemetry is disabled — hooks will no-op.
   */
  register(hookRegistry: HookRegistry): void {
    hookRegistry.registerPipelineHooks(this.buildPipelineHooks());
    hookRegistry.registerGateHooks(this.buildGateHooks());
    hookRegistry.registerChainHooks(this.buildChainHooks());

    this.logger.debug('[TelemetryHookObserver] Registered with HookRegistry');
  }

  // ===== Hook Builders (Private) =====

  private buildPipelineHooks(): PipelineHooks {
    return {
      onBeforeStage: async (stage: string, _context: HookExecutionContext): Promise<void> => {
        this.addEventToActiveSpan(`stage.before.${stage}`, {
          'cpm.stage.name': stage,
        });
      },

      onAfterStage: async (stage: string, _context: HookExecutionContext): Promise<void> => {
        this.addEventToActiveSpan(`stage.after.${stage}`, {
          'cpm.stage.name': stage,
        });
      },

      onStageError: async (
        stage: string,
        error: Error,
        _context: HookExecutionContext
      ): Promise<void> => {
        const activeSpan = trace.getActiveSpan();
        if (activeSpan !== undefined) {
          activeSpan.recordException(error);
          activeSpan.setStatus({
            code: SpanStatusCode.ERROR,
            message: `Stage ${stage} failed: ${error.message}`,
          });
        }
      },
    };
  }

  private buildGateHooks(): GateHooks {
    return {
      onGateEvaluated: async (
        gate: { id: string },
        result: GateEvaluationResult,
        _context: HookExecutionContext
      ): Promise<void> => {
        const eventName = result.passed ? TRACE_EVENTS.GATE_PASSED : TRACE_EVENTS.GATE_FAILED;
        this.addEventToActiveSpan(eventName, buildGateAttributes(gate.id, result));
      },

      onGateFailed: async (
        gate: { id: string },
        reason: string,
        _context: HookExecutionContext
      ): Promise<void> => {
        this.addEventToActiveSpan(TRACE_EVENTS.GATE_FAILED, {
          'cpm.gate.id': gate.id,
          'cpm.gate.passed': false,
          'cpm.gate.reason': reason,
          'cpm.gate.blocks_response': false,
        });
      },

      onRetryExhausted: async (
        gateIds: string[],
        chainId: string,
        _context: HookExecutionContext
      ): Promise<void> => {
        this.addEventToActiveSpan(TRACE_EVENTS.GATE_RETRY_EXHAUSTED, {
          'cpm.gate.id': gateIds.join(','),
          'cpm.chain.id': chainId,
        });
      },

      onResponseBlocked: async (
        gateIds: string[],
        _context: HookExecutionContext
      ): Promise<void> => {
        this.addEventToActiveSpan(TRACE_EVENTS.GATE_RESPONSE_BLOCKED, {
          'cpm.gate.id': gateIds.join(','),
          'cpm.gate.blocks_response': true,
        });
      },
    };
  }

  private buildChainHooks(): ChainHooks {
    return {
      onStepComplete: async (
        chainId: string,
        stepIndex: number,
        _output: string,
        context: HookExecutionContext
      ): Promise<void> => {
        // Note: _output is intentionally NOT passed to trace events (raw content)
        this.addEventToActiveSpan(
          TRACE_EVENTS.CHAIN_STEP_COMPLETE,
          buildChainAttributes(chainId, context, { 'cpm.chain.step_index': stepIndex })
        );
      },

      onChainComplete: async (chainId: string, context: HookExecutionContext): Promise<void> => {
        this.addEventToActiveSpan(
          TRACE_EVENTS.CHAIN_COMPLETE,
          buildChainAttributes(chainId, context)
        );
      },

      onChainFailed: async (
        chainId: string,
        reason: string,
        context: HookExecutionContext
      ): Promise<void> => {
        this.addEventToActiveSpan(
          TRACE_EVENTS.CHAIN_FAILED,
          buildChainAttributes(chainId, context, { 'cpm.chain.failure_reason': reason })
        );
      },
    };
  }

  // ===== Private Helpers =====

  /**
   * Add an event to the currently active span, if any.
   * Applies attribute policy before emission.
   */
  private addEventToActiveSpan(eventName: string, rawAttributes: Record<string, unknown>): void {
    if (!this.runtime.isEnabled()) return;

    const activeSpan = trace.getActiveSpan();
    if (activeSpan === undefined) return;

    try {
      const safeAttributes = this.policy.sanitize(rawAttributes);
      activeSpan.addEvent(eventName, safeAttributes);
    } catch (error) {
      this.logger.debug('[TelemetryHookObserver] Failed to add event', {
        eventName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
