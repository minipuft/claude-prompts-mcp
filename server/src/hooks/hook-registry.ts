// @lifecycle canonical - Server-side hook system for pipeline extensibility.
/**
 * HookRegistry - Server-side hook system for Claude Prompts MCP
 *
 * Provides extensible hooks for pipeline stages, gate evaluation, and chain execution.
 * Enables custom logic injection without modifying core pipeline stages.
 *
 * Architecture:
 * - Hooks are registered by consumers (internal services or extensions)
 * - Pipeline stages emit events at key points
 * - Registered hooks are invoked in registration order
 * - Errors in hooks are logged but don't halt pipeline execution
 */

import { EventEmitter } from 'events';

import type { GateDefinition } from '../gates/types.js';
import type { Logger } from '../logging/index.js';

/**
 * Minimal execution context for hook callbacks.
 * Provides read-only access to execution state.
 */
export interface HookExecutionContext {
  /** Unique ID for this execution */
  readonly executionId: string;
  /** Execution type (single prompt or chain) */
  readonly executionType: 'single' | 'chain';
  /** Chain ID if chain execution */
  readonly chainId?: string;
  /** Current step number if chain execution */
  readonly currentStep?: number;
  /** Whether framework enhancement is enabled */
  readonly frameworkEnabled: boolean;
  /** Active framework ID if any */
  readonly frameworkId?: string;
}

/**
 * Result from gate evaluation for hook callbacks.
 */
export interface GateEvaluationResult {
  /** Whether the gate passed */
  readonly passed: boolean;
  /** Reason for pass/fail */
  readonly reason?: string;
  /** Whether this gate has blockResponseOnFail enabled */
  readonly blocksResponse: boolean;
}

/**
 * Pipeline hooks for intercepting stage execution.
 * All methods are optional - implement only what you need.
 */
export interface PipelineHooks {
  /**
   * Called before a pipeline stage executes.
   * Can be used for logging, metrics, or pre-processing.
   */
  onBeforeStage?(stage: string, context: HookExecutionContext): Promise<void>;

  /**
   * Called after a pipeline stage completes successfully.
   * Can be used for logging, metrics, or post-processing.
   */
  onAfterStage?(stage: string, context: HookExecutionContext): Promise<void>;

  /**
   * Called when a pipeline stage throws an error.
   * The error will still propagate after hooks are called.
   */
  onStageError?(stage: string, error: Error, context: HookExecutionContext): Promise<void>;
}

/**
 * Gate hooks for responding to gate evaluation events.
 * All methods are optional - implement only what you need.
 */
export interface GateHooks {
  /**
   * Called after a gate is evaluated (pass or fail).
   */
  onGateEvaluated?(
    gate: GateDefinition,
    result: GateEvaluationResult,
    context: HookExecutionContext
  ): Promise<void>;

  /**
   * Called when a gate fails evaluation.
   */
  onGateFailed?(gate: GateDefinition, reason: string, context: HookExecutionContext): Promise<void>;

  /**
   * Called when all retry attempts for a gate are exhausted.
   */
  onRetryExhausted?(
    gateIds: string[],
    chainId: string,
    context: HookExecutionContext
  ): Promise<void>;

  /**
   * Called when response content is blocked due to gate failure.
   */
  onResponseBlocked?(gateIds: string[], context: HookExecutionContext): Promise<void>;
}

/**
 * Chain hooks for responding to chain execution events.
 * All methods are optional - implement only what you need.
 */
export interface ChainHooks {
  /**
   * Called when a chain step completes successfully.
   */
  onStepComplete?(
    chainId: string,
    stepIndex: number,
    output: string,
    context: HookExecutionContext
  ): Promise<void>;

  /**
   * Called when an entire chain completes successfully.
   */
  onChainComplete?(chainId: string, context: HookExecutionContext): Promise<void>;

  /**
   * Called when a chain fails (unrecoverable error).
   */
  onChainFailed?(chainId: string, reason: string, context: HookExecutionContext): Promise<void>;
}

/**
 * HookRegistry manages server-side hooks for the execution pipeline.
 *
 * Usage:
 * ```typescript
 * const registry = new HookRegistry(logger);
 *
 * // Register hooks
 * registry.registerPipelineHooks({
 *   onBeforeStage: async (stage, ctx) => console.log(`Starting ${stage}`),
 *   onAfterStage: async (stage, ctx) => console.log(`Finished ${stage}`),
 * });
 *
 * // In pipeline stages
 * await registry.emitBeforeStage('ResponseFormatting', context);
 * // ... stage logic ...
 * await registry.emitAfterStage('ResponseFormatting', context);
 * ```
 */
export class HookRegistry extends EventEmitter {
  private readonly pipelineHooks: PipelineHooks[] = [];
  private readonly gateHooks: GateHooks[] = [];
  private readonly chainHooks: ChainHooks[] = [];
  private readonly logger: Logger;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.logger.debug('[HookRegistry] Initialized');
  }

  // ===== Registration Methods =====

  /**
   * Register pipeline lifecycle hooks.
   */
  registerPipelineHooks(hooks: PipelineHooks): void {
    this.pipelineHooks.push(hooks);
    this.logger.debug('[HookRegistry] Registered pipeline hooks', {
      hasBeforeStage: hooks.onBeforeStage !== undefined,
      hasAfterStage: hooks.onAfterStage !== undefined,
      hasStageError: hooks.onStageError !== undefined,
    });
  }

  /**
   * Register gate evaluation hooks.
   */
  registerGateHooks(hooks: GateHooks): void {
    this.gateHooks.push(hooks);
    this.logger.debug('[HookRegistry] Registered gate hooks', {
      hasGateEvaluated: hooks.onGateEvaluated !== undefined,
      hasGateFailed: hooks.onGateFailed !== undefined,
      hasRetryExhausted: hooks.onRetryExhausted !== undefined,
      hasResponseBlocked: hooks.onResponseBlocked !== undefined,
    });
  }

  /**
   * Register chain execution hooks.
   */
  registerChainHooks(hooks: ChainHooks): void {
    this.chainHooks.push(hooks);
    this.logger.debug('[HookRegistry] Registered chain hooks', {
      hasStepComplete: hooks.onStepComplete !== undefined,
      hasChainComplete: hooks.onChainComplete !== undefined,
      hasChainFailed: hooks.onChainFailed !== undefined,
    });
  }

  // ===== Pipeline Hook Emission =====

  /**
   * Emit before-stage event to all registered pipeline hooks.
   */
  async emitBeforeStage(stage: string, context: HookExecutionContext): Promise<void> {
    for (const hooks of this.pipelineHooks) {
      if (hooks.onBeforeStage !== undefined) {
        try {
          await hooks.onBeforeStage(stage, context);
        } catch (error) {
          this.logger.warn('[HookRegistry] onBeforeStage hook failed', {
            stage,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    this.emit('stage:before', { stage, executionId: context.executionId });
  }

  /**
   * Emit after-stage event to all registered pipeline hooks.
   */
  async emitAfterStage(stage: string, context: HookExecutionContext): Promise<void> {
    for (const hooks of this.pipelineHooks) {
      if (hooks.onAfterStage !== undefined) {
        try {
          await hooks.onAfterStage(stage, context);
        } catch (error) {
          this.logger.warn('[HookRegistry] onAfterStage hook failed', {
            stage,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    this.emit('stage:after', { stage, executionId: context.executionId });
  }

  /**
   * Emit stage-error event to all registered pipeline hooks.
   */
  async emitStageError(stage: string, error: Error, context: HookExecutionContext): Promise<void> {
    for (const hooks of this.pipelineHooks) {
      if (hooks.onStageError !== undefined) {
        try {
          await hooks.onStageError(stage, error, context);
        } catch (hookError) {
          this.logger.warn('[HookRegistry] onStageError hook failed', {
            stage,
            originalError: error.message,
            hookError: hookError instanceof Error ? hookError.message : String(hookError),
          });
        }
      }
    }
    this.emit('stage:error', { stage, error: error.message, executionId: context.executionId });
  }

  // ===== Gate Hook Emission =====

  /**
   * Emit gate-evaluated event to all registered gate hooks.
   */
  async emitGateEvaluated(
    gate: GateDefinition,
    result: GateEvaluationResult,
    context: HookExecutionContext
  ): Promise<void> {
    for (const hooks of this.gateHooks) {
      if (hooks.onGateEvaluated !== undefined) {
        try {
          await hooks.onGateEvaluated(gate, result, context);
        } catch (error) {
          this.logger.warn('[HookRegistry] onGateEvaluated hook failed', {
            gateId: gate.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    this.emit('gate:evaluated', { gateId: gate.id, passed: result.passed });
  }

  /**
   * Emit gate-failed event to all registered gate hooks.
   */
  async emitGateFailed(
    gate: GateDefinition,
    reason: string,
    context: HookExecutionContext
  ): Promise<void> {
    for (const hooks of this.gateHooks) {
      if (hooks.onGateFailed !== undefined) {
        try {
          await hooks.onGateFailed(gate, reason, context);
        } catch (error) {
          this.logger.warn('[HookRegistry] onGateFailed hook failed', {
            gateId: gate.id,
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    this.emit('gate:failed', { gateId: gate.id, reason });
  }

  /**
   * Emit retry-exhausted event to all registered gate hooks.
   */
  async emitRetryExhausted(
    gateIds: string[],
    chainId: string,
    context: HookExecutionContext
  ): Promise<void> {
    for (const hooks of this.gateHooks) {
      if (hooks.onRetryExhausted !== undefined) {
        try {
          await hooks.onRetryExhausted(gateIds, chainId, context);
        } catch (error) {
          this.logger.warn('[HookRegistry] onRetryExhausted hook failed', {
            gateIds,
            chainId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    this.emit('gate:retryExhausted', { gateIds, chainId });
  }

  /**
   * Emit response-blocked event to all registered gate hooks.
   */
  async emitResponseBlocked(gateIds: string[], context: HookExecutionContext): Promise<void> {
    for (const hooks of this.gateHooks) {
      if (hooks.onResponseBlocked !== undefined) {
        try {
          await hooks.onResponseBlocked(gateIds, context);
        } catch (error) {
          this.logger.warn('[HookRegistry] onResponseBlocked hook failed', {
            gateIds,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    this.emit('gate:responseBlocked', { gateIds });
  }

  // ===== Chain Hook Emission =====

  /**
   * Emit step-complete event to all registered chain hooks.
   */
  async emitStepComplete(
    chainId: string,
    stepIndex: number,
    output: string,
    context: HookExecutionContext
  ): Promise<void> {
    for (const hooks of this.chainHooks) {
      if (hooks.onStepComplete !== undefined) {
        try {
          await hooks.onStepComplete(chainId, stepIndex, output, context);
        } catch (error) {
          this.logger.warn('[HookRegistry] onStepComplete hook failed', {
            chainId,
            stepIndex,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    this.emit('chain:stepComplete', { chainId, stepIndex });
  }

  /**
   * Emit chain-complete event to all registered chain hooks.
   */
  async emitChainComplete(chainId: string, context: HookExecutionContext): Promise<void> {
    for (const hooks of this.chainHooks) {
      if (hooks.onChainComplete !== undefined) {
        try {
          await hooks.onChainComplete(chainId, context);
        } catch (error) {
          this.logger.warn('[HookRegistry] onChainComplete hook failed', {
            chainId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    this.emit('chain:complete', { chainId });
  }

  /**
   * Emit chain-failed event to all registered chain hooks.
   */
  async emitChainFailed(
    chainId: string,
    reason: string,
    context: HookExecutionContext
  ): Promise<void> {
    for (const hooks of this.chainHooks) {
      if (hooks.onChainFailed !== undefined) {
        try {
          await hooks.onChainFailed(chainId, reason, context);
        } catch (error) {
          this.logger.warn('[HookRegistry] onChainFailed hook failed', {
            chainId,
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    this.emit('chain:failed', { chainId, reason });
  }

  // ===== Utility Methods =====

  /**
   * Clear all registered hooks (useful for testing).
   */
  clearAll(): void {
    this.pipelineHooks.length = 0;
    this.gateHooks.length = 0;
    this.chainHooks.length = 0;
    this.logger.debug('[HookRegistry] All hooks cleared');
  }

  /**
   * Get counts of registered hooks (useful for diagnostics).
   */
  getCounts(): { pipeline: number; gate: number; chain: number } {
    return {
      pipeline: this.pipelineHooks.length,
      gate: this.gateHooks.length,
      chain: this.chainHooks.length,
    };
  }
}
