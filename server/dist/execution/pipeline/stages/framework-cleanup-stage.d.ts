import { BasePipelineStage } from '../stage.js';
import type { FrameworkStateManager } from '../../../frameworks/framework-state-manager.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
/**
 * Stage 10: Framework Cleanup - Restore original framework after override
 *
 * This stage runs after response formatting to restore the original framework
 * when a framework override (@) was applied during execution. Uses a finally-block
 * pattern similar to GateOperatorExecutor for guaranteed cleanup.
 */
export declare class FrameworkCleanupStage extends BasePipelineStage {
    private readonly frameworkStateManager;
    readonly name = "FrameworkCleanup";
    constructor(frameworkStateManager: FrameworkStateManager | null, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    /**
     * Restore the original framework that was active before override
     * Uses finally-block pattern to ensure restoration even if errors occur
     */
    private restoreOriginalFramework;
}
