// @lifecycle canonical - Registers lifecycle cleanup handlers for each execution.
import { randomUUID } from 'crypto';

import { BasePipelineStage } from '../stage.js';

import type { TemporaryGateRegistry } from '../../../gates/core/temporary-gate-registry.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { CleanupHandler } from '../../context/internal-state.js';

/**
 * Canonical Pipeline Stage 0.3: Execution Lifecycle
 *
 * Establishes per-request scope identifiers and cleanup hooks so temporary
 * gates, inline guidance, and other execution-scoped resources are removed
 * once the pipeline completes.
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
      try {
        this.temporaryGateRegistry.cleanupScope('execution', scopeId);
      } catch (error) {
        this.logger.warn('[ExecutionLifecycleStage] Failed to cleanup execution scope', {
          scopeId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
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
