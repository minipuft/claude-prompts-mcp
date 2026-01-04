import { BasePipelineStage } from '../stage.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
/**
 * Pipeline Stage: Call To Action
 *
 * Appends standardized CTA footers to rendered content so ExecutionStage
 * focuses on building the core instructions.
 */
export declare class CallToActionStage extends BasePipelineStage {
    readonly name = "CallToAction";
    constructor(logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    private isFinalCallToAction;
    private isFinalChainStep;
    private appendFinalCallToAction;
    private buildHeading;
}
