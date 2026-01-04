import { BasePipelineStage } from '../stage.js';
import type { FrameworkManager } from '../../../frameworks/framework-manager.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
type FrameworkEnabledProvider = () => boolean;
/**
 * Stage 3: Framework resolution and system prompt generation.
 *
 * Handles both normal framework resolution and framework overrides from symbolic operators (@).
 * Framework overrides use userPreference parameter for temporary selection without global state changes.
 */
export declare class FrameworkResolutionStage extends BasePipelineStage {
    private readonly frameworkManager;
    private readonly frameworkEnabled;
    readonly name = "FrameworkResolution";
    constructor(frameworkManager: FrameworkManager, frameworkEnabled: FrameworkEnabledProvider | null, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
}
export {};
