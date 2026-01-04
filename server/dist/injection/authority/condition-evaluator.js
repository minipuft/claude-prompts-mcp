// @lifecycle canonical - Evaluates conditional injection rules.
/**
 * Evaluates conditional injection rules against execution context.
 *
 * Conditions are evaluated in order. First match wins.
 * If no conditions match, returns { matched: false } to allow
 * fallback to default configuration.
 */
export class ConditionEvaluator {
    constructor(logger) {
        this.logger = logger;
    }
    /**
     * Evaluate a list of conditions against the current input.
     * Returns the first matching condition's result, or no-match if none apply.
     */
    evaluate(conditions, input) {
        if (!conditions || conditions.length === 0) {
            return {
                matched: false,
                reason: 'No conditions defined',
            };
        }
        for (const condition of conditions) {
            const whenResult = this.evaluateWhen(condition.when, input);
            if (whenResult.matched) {
                this.logger.debug('[ConditionEvaluator] Condition matched', {
                    conditionId: condition.id,
                    when: condition.when.type,
                    action: condition.then,
                });
                return {
                    matched: true,
                    action: condition.then,
                    reason: condition.reason ?? `Matched condition: ${condition.id}`,
                    matchedCondition: condition,
                };
            }
        }
        return {
            matched: false,
            reason: 'No conditions matched',
        };
    }
    /**
     * Evaluate a single "when" clause against the input.
     */
    evaluateWhen(when, input) {
        switch (when.type) {
            case 'always':
                return { matched: true, reason: 'Always condition' };
            case 'gate-status':
                return this.evaluateGateStatus(when, input);
            case 'step-type':
                return this.evaluateStepType(when, input);
            case 'step-number':
                return this.evaluateStepNumber(when, input);
            case 'previous-step-result':
                return this.evaluatePreviousStepResult(when, input);
            case 'chain-position':
                return this.evaluateChainPosition(when, input);
            default: {
                // Exhaustive check
                const _exhaustive = when;
                return { matched: false, reason: `Unknown condition type: ${_exhaustive.type}` };
            }
        }
    }
    evaluateGateStatus(when, input) {
        if (!input.gateStatuses) {
            return { matched: false, reason: 'No gate statuses available' };
        }
        const status = input.gateStatuses.get(when.gateId);
        if (status === undefined) {
            return { matched: false, reason: `Gate ${when.gateId} not found` };
        }
        const matched = status === when.status;
        return {
            matched,
            reason: matched
                ? `Gate ${when.gateId} has status ${when.status}`
                : `Gate ${when.gateId} has status ${status}, not ${when.status}`,
        };
    }
    evaluateStepType(when, input) {
        if (!input.stepType) {
            return { matched: false, reason: 'No step type available' };
        }
        const matched = input.stepType.toLowerCase() === when.stepType.toLowerCase();
        return {
            matched,
            reason: matched
                ? `Step type is ${when.stepType}`
                : `Step type is ${input.stepType}, not ${when.stepType}`,
        };
    }
    evaluateStepNumber(when, input) {
        if (input.currentStep === undefined) {
            return { matched: false, reason: 'No current step number' };
        }
        const step = input.currentStep;
        const value = when.value;
        let matched;
        switch (when.comparison) {
            case 'eq':
                matched = step === value;
                break;
            case 'gt':
                matched = step > value;
                break;
            case 'lt':
                matched = step < value;
                break;
            case 'gte':
                matched = step >= value;
                break;
            case 'lte':
                matched = step <= value;
                break;
            default: {
                const _exhaustive = when.comparison;
                matched = false;
                void _exhaustive;
            }
        }
        return {
            matched,
            reason: matched
                ? `Step ${step} ${when.comparison} ${value}`
                : `Step ${step} not ${when.comparison} ${value}`,
        };
    }
    evaluatePreviousStepResult(when, input) {
        if (!input.previousStepResult) {
            return { matched: false, reason: 'No previous step result' };
        }
        const matched = input.previousStepResult === when.status;
        return {
            matched,
            reason: matched
                ? `Previous step result is ${when.status}`
                : `Previous step result is ${input.previousStepResult}, not ${when.status}`,
        };
    }
    evaluateChainPosition(when, input) {
        if (input.currentStep === undefined || input.totalSteps === undefined) {
            return { matched: false, reason: 'No chain position information' };
        }
        const step = input.currentStep;
        const total = input.totalSteps;
        let matched;
        let position;
        switch (when.position) {
            case 'first':
                matched = step === 1;
                position = 'first';
                break;
            case 'last':
                matched = step === total;
                position = 'last';
                break;
            case 'middle':
                matched = step > 1 && step < total;
                position = 'middle';
                break;
            default: {
                const _exhaustive = when.position;
                matched = false;
                position = 'unknown';
                void _exhaustive;
            }
        }
        return {
            matched,
            reason: matched
                ? `Step ${step}/${total} is ${position}`
                : `Step ${step}/${total} is not ${when.position}`,
        };
    }
}
//# sourceMappingURL=condition-evaluator.js.map