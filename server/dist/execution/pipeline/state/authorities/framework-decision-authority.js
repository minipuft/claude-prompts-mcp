// @lifecycle canonical - Single source of truth for framework application decisions.
/**
 * Single source of truth for framework application decisions.
 *
 * All pipeline stages MUST consult this authority instead of
 * resolving framework ID independently. The decision is computed
 * once and cached for the duration of the request.
 *
 * Resolution Priority:
 * 1. Modifiers (%clean, %lean) - disable framework
 * 2. @ operator override - explicit user intent
 * 3. Client selection from judge phase - user chose
 * 4. Global active framework - system default
 *
 * @example
 * ```typescript
 * // In a pipeline stage
 * const decision = frameworkAuthority.decide({
 *   modifiers: context.executionPlan?.modifiers,
 *   operatorOverride: context.parsedCommand?.executionPlan?.frameworkOverride,
 *   clientOverride: context.state.framework.clientOverride,
 *   globalActiveFramework: context.frameworkContext?.selectedFramework?.id,
 * });
 *
 * if (decision.shouldApply) {
 *   // Use decision.frameworkId
 * }
 * ```
 */
export class FrameworkDecisionAuthority {
    constructor(logger) {
        this.decision = null;
        this.logger = logger;
    }
    /**
     * Get the framework decision. Computes on first call, returns cached thereafter.
     */
    decide(input) {
        if (this.decision !== null) {
            return this.decision;
        }
        this.decision = this.computeDecision(input);
        this.logger.debug('[FrameworkDecisionAuthority] Decision made', {
            shouldApply: this.decision.shouldApply,
            frameworkId: this.decision.frameworkId,
            reason: this.decision.reason,
            source: this.decision.source,
        });
        return this.decision;
    }
    /**
     * Check if decision has been made.
     */
    hasDecided() {
        return this.decision !== null;
    }
    /**
     * Get the cached decision without computing (returns null if not decided).
     */
    getCachedDecision() {
        return this.decision;
    }
    /**
     * Reset the authority (for testing or request reprocessing).
     */
    reset() {
        this.decision = null;
    }
    /**
     * Get the framework ID if applicable, or undefined if framework is disabled.
     * Convenience method for stages that just need the ID.
     */
    getFrameworkId(input) {
        const decision = this.decide(input);
        return decision.shouldApply ? decision.frameworkId : undefined;
    }
    computeDecision(input) {
        const timestamp = Date.now();
        // Priority 1: Check modifiers that disable framework
        if (input.modifiers?.clean === true) {
            return {
                shouldApply: false,
                reason: 'Disabled by %clean modifier',
                source: 'disabled',
                decidedAt: timestamp,
            };
        }
        if (input.modifiers?.lean === true) {
            return {
                shouldApply: false,
                reason: 'Disabled by %lean modifier',
                source: 'disabled',
                decidedAt: timestamp,
            };
        }
        // Priority 2: @ operator override (explicit user intent)
        if (input.operatorOverride) {
            return {
                shouldApply: true,
                frameworkId: input.operatorOverride.toLowerCase(),
                reason: 'Set by @ operator in command',
                source: 'operator',
                decidedAt: timestamp,
            };
        }
        // Priority 3: Client selection from judge phase
        if (input.clientOverride) {
            return {
                shouldApply: true,
                frameworkId: input.clientOverride.toLowerCase(),
                reason: 'Selected in judge phase',
                source: 'client-selection',
                decidedAt: timestamp,
            };
        }
        // Priority 4: Global active framework
        if (input.globalActiveFramework) {
            return {
                shouldApply: true,
                frameworkId: input.globalActiveFramework.toLowerCase(),
                reason: 'Global active framework',
                source: 'global-active',
                decidedAt: timestamp,
            };
        }
        // No framework configured
        return {
            shouldApply: false,
            reason: 'No framework configured or selected',
            source: 'disabled',
            decidedAt: timestamp,
        };
    }
}
//# sourceMappingURL=framework-decision-authority.js.map