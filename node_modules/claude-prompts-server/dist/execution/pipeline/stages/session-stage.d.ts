import { BasePipelineStage } from '../stage.js';
import type { ChainSessionManager } from '../../../chain-session/manager.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
/**
 * Stage 4: Session management and continuity.
 */
export declare class SessionManagementStage extends BasePipelineStage {
    private readonly chainSessionManager;
    readonly name = "SessionManagement";
    constructor(chainSessionManager: ChainSessionManager, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    private createSessionId;
    private buildChainId;
    private getTotalSteps;
}
