import { BasePipelineStage } from '../stage.js';
import type { ChainSessionService } from '../../../chain-session/types.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
/**
 * Pipeline Stage 8: Step Response Capture
 *
 * Captures results from previous chain steps for STDIO transport compatibility,
 * recording placeholder results to enable {{previous_step_result}} references
 * in downstream steps.
 *
 * Dependencies: context.sessionContext
 * Output: Captured step results in TextReferenceManager
 * Can Early Exit: No
 */
export declare class StepResponseCaptureStage extends BasePipelineStage {
    private readonly chainSessionManager;
    readonly name = "StepResponseCapture";
    constructor(chainSessionManager: ChainSessionService, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    private shouldCaptureStep;
    private capturePlaceholder;
    private captureRealResponse;
    private getStepOutputMapping;
    private buildPlaceholderContent;
    /**
     * Handle user choice action when retry limit is exceeded.
     * Delegates to GateEnforcementAuthority for session manager interactions,
     * handles context state updates locally.
     */
    private handleGateAction;
    private parseGateVerdict;
}
