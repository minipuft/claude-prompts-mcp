import type { Logger } from '../../logging/index.js';
import type { InjectionCondition, InjectionDecisionInput } from './types.js';
/**
 * Result of evaluating a condition.
 */
export interface ConditionEvaluationResult {
    /** Whether the condition matched. */
    matched: boolean;
    /** The action to take if matched. */
    action?: 'inject' | 'skip' | 'inherit';
    /** Reason for the match (or why it didn't match). */
    reason: string;
    /** The condition that matched (if any). */
    matchedCondition?: InjectionCondition;
}
/**
 * Evaluates conditional injection rules against execution context.
 *
 * Conditions are evaluated in order. First match wins.
 * If no conditions match, returns { matched: false } to allow
 * fallback to default configuration.
 */
export declare class ConditionEvaluator {
    private readonly logger;
    constructor(logger: Logger);
    /**
     * Evaluate a list of conditions against the current input.
     * Returns the first matching condition's result, or no-match if none apply.
     */
    evaluate(conditions: InjectionCondition[] | undefined, input: InjectionDecisionInput): ConditionEvaluationResult;
    /**
     * Evaluate a single "when" clause against the input.
     */
    private evaluateWhen;
    private evaluateGateStatus;
    private evaluateStepType;
    private evaluateStepNumber;
    private evaluatePreviousStepResult;
    private evaluateChainPosition;
}
