import { BasePipelineStage } from '../../execution/pipeline/stage.js';
import type { Logger } from '../../logging/index.js';
import type { ExecutionContext } from '../../execution/context/execution-context.js';
type ReinjectionFrequencyProvider = () => number;
/**
 * Pipeline Stage 07b: Framework Injection Control
 *
 * Controls when framework system prompts are injected during chain execution.
 * This stage runs AFTER Session Stage (07) so it has access to currentStep.
 *
 * For chains:
 * - Step 1: ALWAYS inject framework system prompt
 * - Step N>1: Inject based on configured frequency (e.g., every 2 steps)
 *
 * For single prompts:
 * - No action needed (Framework Stage already handles single prompts)
 *
 * Dependencies: context.sessionContext.currentStep (from Session Stage 07)
 * Output: context.state.framework.systemPromptApplied, step.frameworkContext.systemPrompt
 * Can Early Exit: No
 */
export declare class FrameworkInjectionControlStage extends BasePipelineStage {
    private readonly getReinjectionFrequency;
    readonly name = "FrameworkInjectionControl";
    constructor(getReinjectionFrequency: ReinjectionFrequencyProvider, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    /**
     * Determine if framework system prompt should be injected for this chain step.
     *
     * @param stepNumber - Current step number (1-based)
     * @param frequency - Reinjection frequency from config (0 = step 1 only, N = every N steps)
     * @returns true if framework system prompt should be injected
     */
    private shouldInjectFrameworkForStep;
}
export {};
