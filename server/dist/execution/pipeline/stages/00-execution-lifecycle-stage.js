// @lifecycle canonical - Registers lifecycle cleanup handlers for each execution.
import { randomUUID } from 'crypto';
import { BasePipelineStage } from '../stage.js';
/**
 * Canonical Pipeline Stage 0.3: Execution Lifecycle
 *
 * Establishes per-request scope identifiers and cleanup hooks so temporary
 * gates, inline guidance, and other execution-scoped resources are removed
 * once the pipeline completes.
 */
export class ExecutionLifecycleStage extends BasePipelineStage {
    constructor(temporaryGateRegistry, logger) {
        super(logger);
        this.temporaryGateRegistry = temporaryGateRegistry;
        this.name = 'ExecutionLifecycle';
    }
    async execute(context) {
        this.logEntry(context);
        const scopeId = this.resolveScopeId(context);
        context.state.session.executionScopeId = scopeId;
        const cleanupHandlers = this.ensureCleanupHandlers(context);
        cleanupHandlers.push(async () => {
            try {
                this.temporaryGateRegistry.cleanupScope('execution', scopeId);
            }
            catch (error) {
                this.logger.warn('[ExecutionLifecycleStage] Failed to cleanup execution scope', {
                    scopeId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        });
        context.state.lifecycle.startTimestamp = Date.now();
        this.logExit({ scopeId });
    }
    ensureCleanupHandlers(context) {
        if (!Array.isArray(context.state.lifecycle.cleanupHandlers)) {
            context.state.lifecycle.cleanupHandlers = [];
        }
        return context.state.lifecycle.cleanupHandlers;
    }
    resolveScopeId(context) {
        return (context.state.session.resumeSessionId ??
            context.mcpRequest.chain_id ??
            context.state.normalization.normalizedCommand ??
            context.mcpRequest.command ??
            randomUUID());
    }
}
//# sourceMappingURL=00-execution-lifecycle-stage.js.map