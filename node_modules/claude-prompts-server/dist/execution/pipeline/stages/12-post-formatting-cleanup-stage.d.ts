import { BasePipelineStage } from '../stage.js';
import type { ChainSessionService } from '../../../chain-session/types.js';
import type { TemporaryGateRegistry } from '../../../gates/core/temporary-gate-registry.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
/**
 * Pipeline Stage 12: Post-Formatting Cleanup
 *
 * Persists inline gate metadata back into the session blueprint and cleans up
 * temporary gates so resumed executions rebuild the same inline requirements.
 *
 * Dependencies: context.executionPlan, context.parsedCommand
 * Output: Updated session blueprint + cleaned temporary gate scopes
 * Can Early Exit: Yes (for non-session executions)
 */
export declare class PostFormattingCleanupStage extends BasePipelineStage {
    private readonly chainSessionManager;
    private readonly temporaryGateRegistry;
    readonly name = "PostFormattingCleanup";
    constructor(chainSessionManager: ChainSessionService | null, temporaryGateRegistry: TemporaryGateRegistry | null, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    private persistBlueprint;
    private cleanupTemporaryGates;
    private getTrackedScopes;
    private clone;
}
