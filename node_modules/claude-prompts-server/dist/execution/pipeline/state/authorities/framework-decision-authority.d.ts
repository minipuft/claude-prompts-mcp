import type { Logger } from '../../../../logging/index.js';
import type { FrameworkDecision } from '../types.js';
/**
 * Input data required for framework decision.
 * This interface decouples the authority from ExecutionContext.
 */
export interface FrameworkDecisionInput {
    /** Execution modifiers from parsing/planning */
    modifiers?: {
        clean?: boolean;
        lean?: boolean;
        guided?: boolean;
    };
    /** Framework override from @ operator in command */
    operatorOverride?: string;
    /** Client override from judge phase selection */
    clientOverride?: string;
    /** Global active framework from framework context */
    globalActiveFramework?: string;
}
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
export declare class FrameworkDecisionAuthority {
    private readonly logger;
    private decision;
    constructor(logger: Logger);
    /**
     * Get the framework decision. Computes on first call, returns cached thereafter.
     */
    decide(input: FrameworkDecisionInput): FrameworkDecision;
    /**
     * Check if decision has been made.
     */
    hasDecided(): boolean;
    /**
     * Get the cached decision without computing (returns null if not decided).
     */
    getCachedDecision(): FrameworkDecision | null;
    /**
     * Reset the authority (for testing or request reprocessing).
     */
    reset(): void;
    /**
     * Get the framework ID if applicable, or undefined if framework is disabled.
     * Convenience method for stages that just need the ID.
     */
    getFrameworkId(input: FrameworkDecisionInput): string | undefined;
    private computeDecision;
}
