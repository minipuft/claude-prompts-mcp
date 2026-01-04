// @lifecycle canonical - Single source of truth for all injection decisions.
import { DISABLE_INJECT_MODIFIERS, FORCE_INJECT_MODIFIERS, INJECTION_TYPES, MODIFIER_EFFECTS, } from './constants.js';
import { ConditionEvaluator, HierarchyResolver } from './internal/index.js';
/**
 * Single source of truth for all injection decisions.
 *
 * All pipeline stages MUST consult this service instead of
 * making injection decisions independently. Decisions are computed
 * once per injection type and cached for the duration of the request.
 *
 * Resolution Priority:
 * 1. Modifiers (%clean, %lean, %guided) - highest priority
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
export class InjectionDecisionService {
    constructor(config, logger) {
        /** Cached decisions by injection type. */
        this.decisions = new Map();
        /** Active runtime overrides. */
        this.runtimeOverrides = new Map();
        /** Track last injection step for each type. */
        this.lastInjectionStep = new Map();
        this.logger = logger;
        this.resolver = new HierarchyResolver(config, logger);
        this.conditionEvaluator = new ConditionEvaluator(logger);
    }
    /**
     * Get the injection decision for a specific type.
     * Computes on first call, returns cached thereafter.
     *
     * IMPORTANT: `inject: true` means INJECT, `inject: false` means SKIP.
     * No inversions, no confusion.
     */
    decide(input) {
        const cacheKey = input.injectionType;
        // Return cached decision if available
        const cached = this.decisions.get(cacheKey);
        if (cached) {
            return cached;
        }
        // Compute new decision
        const decision = this.computeDecision(input);
        // Cache it
        this.decisions.set(cacheKey, decision);
        // Track injection step if we're injecting
        if (decision.inject && input.currentStep !== undefined) {
            this.lastInjectionStep.set(input.injectionType, input.currentStep);
        }
        this.logger.debug('[InjectionDecisionService] Decision made', {
            type: input.injectionType,
            inject: decision.inject,
            reason: decision.reason,
            source: decision.source,
            currentStep: input.currentStep,
        });
        return decision;
    }
    /**
     * Decide for all injection types at once.
     * Useful for pipeline stages that need all decisions.
     */
    decideAll(input) {
        const state = {
            currentStep: input.currentStep,
            sessionOverrides: input.sessionOverrides,
        };
        for (const type of INJECTION_TYPES) {
            const decision = this.decide({ ...input, injectionType: type });
            switch (type) {
                case 'system-prompt':
                    state.systemPrompt = decision;
                    if (decision.inject && input.currentStep !== undefined) {
                        state.lastSystemPromptStep = input.currentStep;
                    }
                    break;
                case 'gate-guidance':
                    state.gateGuidance = decision;
                    break;
                case 'style-guidance':
                    state.styleGuidance = decision;
                    break;
            }
        }
        return state;
    }
    /**
     * Check if a decision has been made for a type.
     */
    hasDecided(type) {
        return this.decisions.has(type);
    }
    /**
     * Get cached decision without computing.
     */
    getCachedDecision(type) {
        return this.decisions.get(type);
    }
    /**
     * Reset all cached decisions (for new request or testing).
     */
    reset() {
        this.decisions.clear();
        this.lastInjectionStep.clear();
    }
    /**
     * Set a runtime override for an injection type.
     */
    setRuntimeOverride(override) {
        this.runtimeOverrides.set(override.type, override);
        // Invalidate cached decision for this type
        this.decisions.delete(override.type);
        this.logger.debug('[InjectionDecisionService] Runtime override set', {
            type: override.type,
            enabled: override.enabled,
            scope: override.scope,
        });
    }
    /**
     * Clear a runtime override.
     */
    clearRuntimeOverride(type) {
        this.runtimeOverrides.delete(type);
        // Invalidate cached decision
        this.decisions.delete(type);
        this.logger.debug('[InjectionDecisionService] Runtime override cleared', {
            type,
        });
    }
    /**
     * Clear all runtime overrides.
     */
    clearAllRuntimeOverrides() {
        this.runtimeOverrides.clear();
        this.decisions.clear();
        this.logger.debug('[InjectionDecisionService] All runtime overrides cleared');
    }
    /**
     * Get current runtime overrides for status reporting.
     */
    getRuntimeOverrides() {
        return this.runtimeOverrides;
    }
    /**
     * Get last injection step for a type.
     */
    getLastInjectionStep(type) {
        return this.lastInjectionStep.get(type);
    }
    /**
     * Compute the injection decision.
     */
    computeDecision(input) {
        const timestamp = Date.now();
        // Priority 1: Check modifiers that disable injection
        const modifierDecision = this.checkModifiers(input, timestamp);
        if (modifierDecision) {
            return modifierDecision;
        }
        // Priority 2-6: Resolve from hierarchy
        const runtimeOverride = this.runtimeOverrides.get(input.injectionType);
        const resolved = this.resolver.resolve(input.injectionType, input, runtimeOverride);
        // Check if globally disabled
        if (!resolved.config.enabled) {
            return {
                inject: false,
                reason: `Disabled in ${resolved.source}`,
                source: resolved.source,
                decidedAt: timestamp,
            };
        }
        // Check conditional rules
        const conditionResult = this.conditionEvaluator.evaluate(resolved.config.conditions, input);
        if (conditionResult.matched) {
            if (conditionResult.action === 'skip') {
                return {
                    inject: false,
                    reason: conditionResult.reason,
                    source: resolved.source,
                    decidedAt: timestamp,
                };
            }
            if (conditionResult.action === 'inject') {
                return {
                    inject: true,
                    reason: conditionResult.reason,
                    source: resolved.source,
                    decidedAt: timestamp,
                };
            }
            // 'inherit' falls through to frequency check
        }
        // Check frequency for chains
        if (input.currentStep !== undefined && resolved.config.frequency) {
            const frequencyDecision = this.checkFrequency(input.injectionType, input.currentStep, input.totalSteps, resolved.config.frequency, timestamp, resolved.source);
            return frequencyDecision;
        }
        // Default: inject
        return {
            inject: true,
            reason: `Enabled by ${resolved.source}`,
            source: resolved.source,
            decidedAt: timestamp,
        };
    }
    /**
     * Check modifiers for injection control.
     * Returns a decision if modifiers override normal behavior.
     */
    checkModifiers(input, timestamp) {
        if (!input.modifiers) {
            return null;
        }
        // Check force-inject modifiers (e.g., %guided)
        for (const modifier of FORCE_INJECT_MODIFIERS) {
            if (input.modifiers[modifier]) {
                // %guided only affects system-prompt
                if (modifier === 'guided' && input.injectionType === 'system-prompt') {
                    return {
                        inject: true,
                        reason: `Forced by %${modifier} modifier`,
                        source: 'modifier',
                        decidedAt: timestamp,
                    };
                }
            }
        }
        // Check disable-inject modifiers (e.g., %clean, %lean)
        for (const modifier of DISABLE_INJECT_MODIFIERS) {
            if (input.modifiers[modifier]) {
                const affectedTypes = MODIFIER_EFFECTS[modifier];
                if (affectedTypes?.includes(input.injectionType)) {
                    return {
                        inject: false,
                        reason: `Disabled by %${modifier} modifier`,
                        source: 'modifier',
                        decidedAt: timestamp,
                    };
                }
            }
        }
        return null;
    }
    /**
     * Check if injection should happen based on frequency rules.
     */
    checkFrequency(type, currentStep, totalSteps, frequency, timestamp, source) {
        switch (frequency.mode) {
            case 'never':
                return {
                    inject: false,
                    reason: 'Frequency mode is never',
                    source,
                    decidedAt: timestamp,
                };
            case 'first-only':
                if (currentStep === 1) {
                    return {
                        inject: true,
                        reason: 'First step (first-only mode)',
                        source,
                        decidedAt: timestamp,
                    };
                }
                return {
                    inject: false,
                    reason: `Step ${currentStep} > 1 (first-only mode)`,
                    source,
                    decidedAt: timestamp,
                };
            case 'every': {
                const interval = frequency.interval ?? 1;
                // Step 1 always injects
                if (currentStep === 1) {
                    return {
                        inject: true,
                        reason: 'First step always injects',
                        source,
                        decidedAt: timestamp,
                    };
                }
                // For subsequent steps, check interval
                // With interval=2: inject on steps 1, 3, 5, etc.
                // Formula: inject if (step - 1) % interval === 0
                const shouldInject = (currentStep - 1) % interval === 0;
                if (shouldInject) {
                    return {
                        inject: true,
                        reason: `Step ${currentStep} matches interval ${interval}`,
                        source,
                        decidedAt: timestamp,
                    };
                }
                return {
                    inject: false,
                    reason: `Step ${currentStep} doesn't match interval ${interval}`,
                    source,
                    decidedAt: timestamp,
                };
            }
            default: {
                // Fallback for unknown mode
                const _exhaustive = frequency.mode;
                void _exhaustive;
                return {
                    inject: true,
                    reason: 'Unknown frequency mode, defaulting to inject',
                    source,
                    decidedAt: timestamp,
                };
            }
        }
    }
}
/**
 * @deprecated Use InjectionDecisionService instead.
 * This alias exists for backward compatibility during migration.
 */
export const InjectionDecisionAuthority = InjectionDecisionService;
//# sourceMappingURL=injection-decision-service.js.map