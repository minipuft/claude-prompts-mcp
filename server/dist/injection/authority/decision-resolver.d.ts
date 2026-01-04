import type { Logger } from '../../logging/index.js';
import type { InjectionConfig, InjectionRuntimeOverride } from '../config-types.js';
import type { InjectionDecisionInput, InjectionDecisionSource, InjectionType, ResolvedInjectionConfig } from '../types.js';
/**
 * Resolves injection configuration from hierarchical sources.
 *
 * Resolution priority (highest to lowest):
 * 1. Runtime overrides (from system_control)
 * 2. Step config (step-specific rules)
 * 3. Chain config (chain-level rules)
 * 4. Category config (category-level rules)
 * 5. Global config (config.json defaults)
 * 6. System defaults (hardcoded fallbacks)
 *
 * Note: Modifiers (%clean, %lean) are NOT handled here.
 * They are checked first by InjectionDecisionAuthority before
 * consulting the resolver.
 */
export declare class DecisionResolver {
    private readonly config;
    private readonly logger;
    constructor(config: InjectionConfig, logger: Logger);
    /**
     * Resolve the effective configuration for an injection type.
     * Walks the hierarchy from most specific to least specific.
     */
    resolve(injectionType: InjectionType, input: InjectionDecisionInput, runtimeOverride?: InjectionRuntimeOverride): ResolvedInjectionConfig;
    /**
     * Check if a runtime override applies to the current input.
     */
    private isOverrideApplicable;
    /**
     * Find step-specific configuration.
     */
    private findStepConfig;
    /**
     * Check if a step target matches the current input.
     */
    private stepTargetMatches;
    /**
     * Find chain-level configuration using pattern matching.
     */
    private findChainConfig;
    /**
     * Match a chain ID against a glob-like pattern.
     * Supports: exact match, prefix-*, *-suffix, *contains*
     */
    private chainPatternMatches;
    /**
     * Find category-level configuration.
     */
    private findCategoryConfig;
    /**
     * Merge a partial config with system defaults.
     */
    private mergeWithDefaults;
    /**
     * Get frequency configuration from hierarchy (for runtime overrides).
     * Runtime overrides don't specify frequency, so we need to find it.
     */
    private getFrequencyFromHierarchy;
    /**
     * Get the resolution priority order for documentation/debugging.
     */
    getResolutionPriority(): readonly InjectionDecisionSource[];
}
