// @lifecycle canonical - Controls framework system prompt injection frequency for chains.
import { BasePipelineStage } from '../../execution/pipeline/stage.js';
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
export class FrameworkInjectionControlStage extends BasePipelineStage {
    constructor(getReinjectionFrequency, logger) {
        super(logger);
        this.getReinjectionFrequency = getReinjectionFrequency;
        this.name = 'FrameworkInjectionControl';
    }
    async execute(context) {
        this.logEntry(context);
        // Only applies to chains - single prompts are handled by Framework Stage (06)
        if (!context.hasChainCommand()) {
            this.logExit({ skipped: 'Not a chain command' });
            return;
        }
        // Check if framework context exists (Framework Stage must have run)
        if (!context.frameworkContext) {
            this.logExit({ skipped: 'No framework context' });
            return;
        }
        // Get current step from session context (populated by Session Stage 07)
        const currentStep = context.sessionContext?.currentStep ?? 1;
        const frequency = this.getReinjectionFrequency();
        const shouldInject = this.shouldInjectFrameworkForStep(currentStep, frequency);
        this.logger.debug(`[${this.name}] Injection decision`, {
            currentStep,
            frequency,
            shouldInject,
            chainId: context.mcpRequest.chain_id,
        });
        // Control injection for downstream stages
        // systemPromptApplied = true tells downstream to SKIP injection
        // systemPromptApplied = false tells downstream to INJECT
        context.state.framework.systemPromptApplied = !shouldInject;
        // Set metadata flag for Chain Operator Executor to check
        // This works for resumed chains where frameworkContext isn't persisted
        if (!shouldInject) {
            context.metadata['suppressFrameworkInjection'] = true;
            this.logger.debug(`[${this.name}] Set suppressFrameworkInjection=true for step ${currentStep}`);
        }
        // Track injection for metrics/debugging
        if (shouldInject) {
            context.state.framework.lastSystemPromptInjectionStep = currentStep;
        }
        this.logExit({
            currentStep,
            frequency,
            shouldInject,
            systemPromptApplied: context.state.framework.systemPromptApplied,
        });
    }
    /**
     * Determine if framework system prompt should be injected for this chain step.
     *
     * @param stepNumber - Current step number (1-based)
     * @param frequency - Reinjection frequency from config (0 = step 1 only, N = every N steps)
     * @returns true if framework system prompt should be injected
     */
    shouldInjectFrameworkForStep(stepNumber, frequency) {
        // Step 1: ALWAYS inject
        if (stepNumber === 1)
            return true;
        // Steps 2+: Never inject if frequency is 0 (step 1 only mode)
        if (frequency === 0)
            return false;
        // Steps 2+: Inject if enough steps have passed since step 1
        // Formula: inject if (stepNumber - 1) % frequency === 0
        // With frequency=2: step 1 (always), step 3, step 5, etc.
        return (stepNumber - 1) % frequency === 0;
    }
}
//# sourceMappingURL=framework-injection-control-stage.js.map