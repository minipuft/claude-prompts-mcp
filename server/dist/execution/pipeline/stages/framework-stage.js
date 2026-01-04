import { BasePipelineStage } from '../stage.js';
/**
 * Stage 3: Framework resolution and system prompt generation.
 *
 * Handles both normal framework resolution and framework overrides from symbolic operators (@).
 * Framework overrides use userPreference parameter for temporary selection without global state changes.
 */
export class FrameworkResolutionStage extends BasePipelineStage {
    constructor(frameworkManager, frameworkEnabled, logger) {
        super(logger);
        this.frameworkManager = frameworkManager;
        this.frameworkEnabled = frameworkEnabled;
        this.name = 'FrameworkResolution';
    }
    async execute(context) {
        this.logEntry(context);
        const plan = context.requireExecutionPlan();
        if (!plan.requiresFramework) {
            this.logExit({ skipped: 'Framework not required' });
            return;
        }
        if (!this.frameworkEnabled?.()) {
            this.logExit({ skipped: 'Framework system disabled' });
            return;
        }
        if (!context.hasSinglePromptCommand()) {
            this.handleError(new Error('Single prompt command required for framework resolution'));
            return;
        }
        try {
            const prompt = context.requireConvertedPrompt();
            // Check for framework override from symbolic operators (@)
            const frameworkOverride = context.parsedCommand?.executionPlan?.frameworkOverride;
            // Generate execution context with optional framework override via userPreference
            const frameworkContext = this.frameworkManager.generateExecutionContext(prompt, frameworkOverride ? { userPreference: frameworkOverride } : {});
            context.frameworkContext = frameworkContext;
            this.logExit({
                framework: frameworkContext.selectedFramework?.name,
                override: Boolean(frameworkOverride),
            });
        }
        catch (error) {
            this.handleError(error, 'Framework resolution failed');
        }
    }
}
//# sourceMappingURL=framework-stage.js.map