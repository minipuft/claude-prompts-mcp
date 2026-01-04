import { InjectionDecisionService } from '../decisions/injection/index.js';
import { BasePipelineStage } from '../stage.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { InjectionConfig } from '../decisions/injection/index.js';
type InjectionConfigProvider = () => InjectionConfig;
/**
 * Pipeline Stage 07b: Injection Control
 *
 * Controls when system prompts, gate guidance, and style guidance are injected
 * during prompt and chain execution. Uses a modular design with
 * InjectionDecisionService for hierarchical configuration resolution.
 *
 * Key improvements over the old system:
 * - Clear boolean semantics: inject=true means INJECT, inject=false means SKIP
 * - Hierarchical configuration: Global → Category → Chain → Step
 * - Multiple injection types controlled separately
 * - Conditional injection based on gate status, step type, etc.
 * - Runtime overrides via system_control
 *
 * For chains:
 * - Step 1: Default behavior based on config (usually inject)
 * - Step N>1: Inject based on configured frequency
 *
 * For single prompts:
 * - Always inject unless modifiers (%clean, %lean) disable it
 *
 * Dependencies: context.sessionContext.currentStep (from Session Stage 07)
 * Output: context.state.injection (InjectionState)
 * Can Early Exit: No
 */
export declare class InjectionControlStage extends BasePipelineStage {
    private readonly getInjectionConfig;
    readonly name = "InjectionControl";
    private injectionService;
    constructor(getInjectionConfig: InjectionConfigProvider, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    /**
     * Build the decision input from execution context.
     */
    private buildDecisionInput;
    /**
     * Build a map of gate IDs to their current status.
     */
    private buildGateStatusMap;
    /**
     * Get the category ID from the context.
     */
    private getCategoryId;
    /**
     * Get the step type from the context.
     * Step type can be defined in step metadata.
     */
    private getStepType;
    /**
     * Retrieve active session overrides from the SessionOverrideManager if available.
     */
    private getSessionOverrides;
    /**
     * Convert runtime overrides map to the lightweight record stored on pipeline state.
     */
    private toSessionOverrideRecord;
    /**
     * Reset the service (for testing or when config changes).
     */
    resetService(): void;
    /**
     * Get the current service instance (for testing).
     */
    getService(): InjectionDecisionService | null;
}
export {};
