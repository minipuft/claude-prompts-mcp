import { Logger } from '../../logging/index.js';
import type { ChainStepExecutionInput, ChainStepRenderResult } from './types.js';
import type { PromptGuidanceService } from '../../frameworks/prompt-guidance/index.js';
import type { ConvertedPrompt } from '../../types/index.js';
import type { IScriptReferenceResolver } from '../../utils/jsonUtils.js';
import type { PromptReferenceResolver } from '../reference/index.js';
export declare class ChainOperatorExecutor {
    private readonly logger;
    private readonly convertedPrompts;
    private readonly gateGuidanceRenderer?;
    private readonly getFrameworkContext?;
    private readonly promptGuidanceService?;
    private readonly referenceResolver?;
    private readonly scriptReferenceResolver?;
    constructor(logger: Logger, convertedPrompts: ConvertedPrompt[], gateGuidanceRenderer?: any | undefined, getFrameworkContext?: ((promptId: string) => Promise<{
        selectedFramework?: {
            methodology: string;
            name: string;
        };
        category?: string;
        systemPrompt?: string;
    } | null>) | undefined, promptGuidanceService?: PromptGuidanceService | undefined, referenceResolver?: PromptReferenceResolver | undefined, scriptReferenceResolver?: IScriptReferenceResolver | undefined);
    renderStep(input: ChainStepExecutionInput): Promise<ChainStepRenderResult>;
    /**
     * Renders a gate review step (synthetic validation step)
     */
    private renderGateReviewStep;
    /**
     * Renders a normal step (non-review execution)
     */
    private renderNormalStep;
    private renderSimpleGateGuidance;
    /**
     * Determine whether gate guidance injection is enabled for the current chain context.
     */
    private isGateGuidanceEnabled;
    /**
     * Determine whether framework injection is enabled for gate reviews.
     * Checks both the inject flag and the target configuration.
     */
    private isFrameworkInjectionEnabledForGates;
    /**
     * Determine whether framework injection should be suppressed for normal steps.
     * Returns true if injection should be skipped (target is 'gates' only).
     */
    private shouldSuppressFrameworkForSteps;
    private buildFrameworkGuidance;
    private resolveFrameworkContext;
    private renderChainMetadataSection;
    private isInlineGateId;
    private hasFrameworkGuidance;
    private getStoredStepResult;
    private buildManualReviewBody;
    private normalizeStepArgs;
    private renderTemplate;
    private renderTemplateString;
    private getPromptDisplayName;
    private buildChainSummary;
    private resolveReviewStep;
    private extractStepIndexFromContext;
    private extractStepIndexFromMetadata;
    private clampStepIndex;
    private collectReviewGateIds;
    private extractInlineGateIdsFromMetadata;
}
