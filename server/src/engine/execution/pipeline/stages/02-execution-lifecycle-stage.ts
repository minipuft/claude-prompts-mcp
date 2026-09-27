// @lifecycle canonical - Registers lifecycle cleanup handlers for each execution.
import { randomUUID } from 'crypto';

import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type { TemporaryGateRegistry } from '../../../gates/core/temporary-gate-registry.js';
import type { ExecutionContext } from '../../context/index.js';
import type { CleanupHandler } from '../../context/internal-state.js';

/**
 * Pipeline Stage 02: Execution Lifecycle
 *
 * Establishes the per-request scope identifier and the cleanup hook that ends
 * this call's temporary gates. A gate the call's run adopted (the pipeline hands
 * them over after its stage loop) lives with the run and is released when the run
 * ends; every other gate this call registered is removed here, once the response
 * is set (R47).
 */
export class ExecutionLifecycleStage extends BasePipelineStage {
  readonly name = 'ExecutionLifecycle';

  constructor(
    private readonly temporaryGateRegistry: TemporaryGateRegistry,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    const scopeId = this.resolveScopeId(context);
    context.state.session.executionScopeId = scopeId;

    const cleanupHandlers = this.ensureCleanupHandlers(context);
    cleanupHandlers.push(async () => {
      this.temporaryGateRegistry.releaseUnowned(context.state.gates.temporaryGateIds);
    });

    context.state.lifecycle.startTimestamp = Date.now();

    this.logExit({ scopeId });
  }

  private ensureCleanupHandlers(context: ExecutionContext): CleanupHandler[] {
    if (!Array.isArray(context.state.lifecycle.cleanupHandlers)) {
      context.state.lifecycle.cleanupHandlers = [];
    }
    return context.state.lifecycle.cleanupHandlers;
  }

  private resolveScopeId(context: ExecutionContext): string {
    return (
      context.state.session.resumeSessionId ??
      context.mcpRequest.chain_id ??
      context.state.normalization.normalizedCommand ??
      context.mcpRequest.command ??
      randomUUID()
    );
  }
}
