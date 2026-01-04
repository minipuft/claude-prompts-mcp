import { BasePipelineStage } from '../stage.js';
import type { ChainSessionManager } from '../../../chain-session/manager.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
/**
 * Stage 6: Capture the result of the previous step (placeholder-based MVP).
 *
 * Since STDIO transports cannot stream the assistant's response back into the
 * MCP invocation automatically, we record a placeholder result whenever the
 * same chain session is resumed. This keeps TextReferenceManager populated so
 * downstream steps can reference {{previous_step_result}}.
 */
export declare class StepResponseCaptureStage extends BasePipelineStage {
    private readonly chainSessionManager;
    readonly name = "StepResponseCapture";
    constructor(chainSessionManager: ChainSessionManager, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    private shouldCaptureStep;
    private capturePlaceholder;
    private buildPlaceholderContent;
}
