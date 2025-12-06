import { BasePipelineStage } from '../stage.js';
import type { ChainSessionService } from '../../../chain-session/types.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
/**
 * Pipeline Stage 7: Session Management
 *
 * Manages chain execution sessions, handling session creation, resumption,
 * and state persistence for multi-step workflows.
 *
 * Dependencies: context.executionPlan
 * Output: context.sessionContext (session ID, step tracking, state)
 * Can Early Exit: No
 */
export declare class SessionManagementStage extends BasePipelineStage {
    private readonly chainSessionManager;
    readonly name = "SessionManagement";
    constructor(chainSessionManager: ChainSessionService, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    /**
     * Creates a PendingGateReview for the current step if gates are present
     * and no review already exists. Delegates to GateEnforcementAuthority.
     */
    private createPendingGateReviewIfNeeded;
    private createSessionId;
    private getBaseChainId;
    private buildChainId;
    private getTotalSteps;
    private getNextRunNumber;
    private stripRunCounter;
    private extractRunNumber;
    private isChainComplete;
    private buildSessionBlueprint;
    private cloneParsedCommand;
    private cloneExecutionPlan;
}
