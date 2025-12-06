import { BasePipelineStage } from '../stage.js';
import type { ChainSessionService } from '../../../chain-session/types.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { ChainOperatorExecutor } from '../../operators/chain-operator-executor.js';
/**
 * Pipeline Stage: Gate Review Rendering
 *
 * Renders synthetic gate review steps when a session has a pending review.
 * Keeps ChainOperatorExecutor focused on normal step rendering while this
 * stage handles review-specific content.
 */
export declare class GateReviewStage extends BasePipelineStage {
    private readonly chainOperatorExecutor;
    private readonly chainSessionManager;
    readonly name = "GateReview";
    constructor(chainOperatorExecutor: ChainOperatorExecutor, chainSessionManager: ChainSessionService, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
}
