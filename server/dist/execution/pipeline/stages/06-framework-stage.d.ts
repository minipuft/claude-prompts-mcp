import { BasePipelineStage } from '../stage.js';
import type { FrameworkManager } from '../../../frameworks/framework-manager.js';
import type { GateDefinitionProvider } from '../../../gates/core/gate-loader.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
type FrameworkEnabledProvider = () => boolean;
/**
 * Pipeline Stage 6: Framework Resolution
 *
 * Injects methodology-specific system prompts and framework context,
 * supporting both default framework and temporary overrides via symbolic operators (@).
 *
 * Dependencies: context.executionPlan, context.convertedPrompt
 * Output: context.frameworkContext (methodology, system prompts)
 * Can Early Exit: No
 */
export declare class FrameworkResolutionStage extends BasePipelineStage {
    private readonly frameworkManager;
    private readonly frameworkEnabled;
    private readonly gateLoader?;
    readonly name = "FrameworkResolution";
    /** Cached methodology gate IDs loaded from GateLoader */
    private methodologyGateIdsCache;
    constructor(frameworkManager: FrameworkManager, frameworkEnabled: FrameworkEnabledProvider | null, logger: Logger, gateLoader?: GateDefinitionProvider | undefined);
    /**
     * Get methodology gate IDs dynamically from GateLoader.
     * Caches the result to avoid repeated disk reads.
     */
    private getMethodologyGateIds;
    execute(context: ExecutionContext): Promise<void>;
    /**
     * Build decision input from context for FrameworkDecisionAuthority.
     * This extracts all relevant data for the centralized framework decision.
     */
    private buildDecisionInput;
    /**
     * Resolve framework context for a single prompt.
     * @param context - Execution context
     * @param authorityFrameworkId - Framework ID from FrameworkDecisionAuthority (already resolved)
     */
    private resolveSinglePromptFramework;
    /**
     * Resolve framework context for chain steps.
     * Generates framework context for each step but does NOT make injection decisions.
     * Injection frequency control is handled by InjectionControlStage (07b)
     * which runs after Session Stage when currentStep is known.
     *
     * @param context - Execution context
     * @param authorityFrameworkId - Framework ID from FrameworkDecisionAuthority (already resolved)
     */
    private resolveChainFrameworks;
    /**
     * Check if a step has modifiers that disable framework.
     * This is for per-step control within chains.
     */
    private stepHasDisablingModifiers;
    private chainStepsRequireFramework;
    private stepRequiresFramework;
    /**
     * Check if any gates in the array are methodology gates (synchronous check using cache).
     */
    private hasMethodologyGate;
}
export {};
