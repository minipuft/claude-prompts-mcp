import type { InjectionConfig, InjectionDecision, InjectionDecisionInput, InjectionRuntimeOverride, InjectionState, InjectionType } from './types.js';
import type { Logger } from '../../../../logging/index.js';
/**
 * Single source of truth for all injection decisions.
 *
 * All pipeline stages MUST consult this service instead of
 * making injection decisions independently. Decisions are computed
 * once per injection type and cached for the duration of the request.
 *
 * Resolution Priority:
 * 1. Modifiers (%clean, %lean, %judge) - highest priority
 * 2. Runtime overrides (session_control injection:override)
 * 3. Step config (step-specific rules)
 * 4. Chain config (chain-level rules)
 * 5. Category config (category-level rules)
 * 6. Global config (config.json defaults)
 * 7. System defaults (hardcoded fallbacks)
 *
 * @example
 * ```typescript
 * // In a pipeline stage
 * const decision = injectionService.decide({
 *   injectionType: 'system-prompt',
 *   currentStep: 2,
 *   totalSteps: 5,
 *   modifiers: context.executionPlan?.modifiers,
 *   categoryId: context.prompt?.category,
 *   chainId: context.mcpRequest.chain_id,
 * });
 *
 * if (decision.inject) {
 *   // Inject the system prompt
 * }
 * ```
 */
export declare class InjectionDecisionService {
    private readonly logger;
    private readonly resolver;
    private readonly conditionEvaluator;
    /** Cached decisions by injection type. */
    private decisions;
    /** Active runtime overrides. */
    private runtimeOverrides;
    /** Track last injection step for each type. */
    private lastInjectionStep;
    constructor(config: InjectionConfig, logger: Logger);
    /**
     * Replace all runtime overrides at once (e.g., from SessionOverrideManager)
     * and clear cached decisions so new overrides take effect immediately.
     */
    syncRuntimeOverrides(overrides: Map<InjectionType, InjectionRuntimeOverride>): void;
    /**
     * Get the injection decision for a specific type.
     * Computes on first call, returns cached thereafter.
     *
     * IMPORTANT: `inject: true` means INJECT, `inject: false` means SKIP.
     * No inversions, no confusion.
     */
    decide(input: InjectionDecisionInput): InjectionDecision;
    /**
     * Decide for all injection types at once.
     * Useful for pipeline stages that need all decisions.
     */
    decideAll(input: Omit<InjectionDecisionInput, 'injectionType'>): InjectionState;
    /**
     * Check if a decision has been made for a type.
     */
    hasDecided(type: InjectionType): boolean;
    /**
     * Get cached decision without computing.
     */
    getCachedDecision(type: InjectionType): InjectionDecision | undefined;
    /**
     * Reset all cached decisions (for new request or testing).
     */
    reset(): void;
    /**
     * Set a runtime override for an injection type.
     */
    setRuntimeOverride(override: InjectionRuntimeOverride): void;
    /**
     * Clear a runtime override.
     */
    clearRuntimeOverride(type: InjectionType): void;
    /**
     * Clear all runtime overrides.
     */
    clearAllRuntimeOverrides(): void;
    /**
     * Get current runtime overrides for status reporting.
     */
    getRuntimeOverrides(): ReadonlyMap<InjectionType, InjectionRuntimeOverride>;
    /**
     * Get last injection step for a type.
     */
    getLastInjectionStep(type: InjectionType): number | undefined;
    /**
     * Compute the injection decision.
     */
    private computeDecision;
    /**
     * Apply target filtering to an injection decision.
     * If the decision is to inject but the target doesn't match the execution context,
     * convert it to a skip decision.
     *
     * @param decision - The base injection decision
     * @param executionContext - Current execution context ('step' or 'gate_review')
     * @returns Modified decision if target doesn't match, original otherwise
     */
    private applyTargetFilter;
    /**
     * Check modifiers for injection control.
     * Returns a decision if modifiers override normal behavior.
     */
    private checkModifiers;
    /**
     * Check if injection should happen based on frequency rules.
     */
    private checkFrequency;
}
