import { BasePipelineStage } from '../stage.js';
import type { TemporaryGateRegistry } from '../../../gates/core/temporary-gate-registry.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
/**
 * Canonical Pipeline Stage 0.3: Execution Lifecycle
 *
 * Establishes per-request scope identifiers and cleanup hooks so temporary
 * gates, inline guidance, and other execution-scoped resources are removed
 * once the pipeline completes.
 */
export declare class ExecutionLifecycleStage extends BasePipelineStage {
    private readonly temporaryGateRegistry;
    readonly name = "ExecutionLifecycle";
    constructor(temporaryGateRegistry: TemporaryGateRegistry, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    private ensureCleanupHandlers;
    private resolveScopeId;
}
