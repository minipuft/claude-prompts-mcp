import { BasePipelineStage } from '../stage.js';
import type { ChainSessionManager } from '../../../chain-session/manager.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { ChainOperatorExecutor } from '../../operators/chain-operator-executor.js';
/**
 * Stage 5: Step execution (chains and single prompts).
 */
export declare class StepExecutionStage extends BasePipelineStage {
    private readonly chainOperatorExecutor;
    private readonly chainSessionManager;
    readonly name = "StepExecution";
    constructor(chainOperatorExecutor: ChainOperatorExecutor, chainSessionManager: ChainSessionManager, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    private executeChainStep;
    private executeSinglePrompt;
    private createExecutionResults;
    /**
     * Detects if a system message already contains framework methodology guidance.
     * Used to prevent duplicate framework injection.
     */
    private hasFrameworkGuidance;
}
