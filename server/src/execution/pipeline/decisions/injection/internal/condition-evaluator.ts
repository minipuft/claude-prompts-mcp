// @lifecycle canonical - Evaluates conditional injection rules.

import type { Logger } from '../../../../../logging/index.js';
import type {
  InjectionCondition,
  InjectionConditionWhen,
  InjectionDecisionInput,
} from '../types.js';

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
export class ConditionEvaluator {
  constructor(private readonly logger: Logger) {}

  /**
   * Evaluate a list of conditions against the current input.
   * Returns the first matching condition's result, or no-match if none apply.
   */
  evaluate(
    conditions: InjectionCondition[] | undefined,
    input: InjectionDecisionInput
  ): ConditionEvaluationResult {
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
  private evaluateWhen(
    when: InjectionConditionWhen,
    input: InjectionDecisionInput
  ): { matched: boolean; reason: string } {
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
        const _exhaustive: never = when;
        return {
          matched: false,
          reason: `Unknown condition type: ${(_exhaustive as { type: string }).type}`,
        };
      }
    }
  }

  private evaluateGateStatus(
    when: Extract<InjectionConditionWhen, { type: 'gate-status' }>,
    input: InjectionDecisionInput
  ): { matched: boolean; reason: string } {
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

  private evaluateStepType(
    when: Extract<InjectionConditionWhen, { type: 'step-type' }>,
    input: InjectionDecisionInput
  ): { matched: boolean; reason: string } {
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

  private evaluateStepNumber(
    when: Extract<InjectionConditionWhen, { type: 'step-number' }>,
    input: InjectionDecisionInput
  ): { matched: boolean; reason: string } {
    if (input.currentStep === undefined) {
      return { matched: false, reason: 'No current step number' };
    }

    const step = input.currentStep;
    const value = when.value;
    let matched: boolean;

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
        const _exhaustive: never = when.comparison;
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

  private evaluatePreviousStepResult(
    when: Extract<InjectionConditionWhen, { type: 'previous-step-result' }>,
    input: InjectionDecisionInput
  ): { matched: boolean; reason: string } {
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

  private evaluateChainPosition(
    when: Extract<InjectionConditionWhen, { type: 'chain-position' }>,
    input: InjectionDecisionInput
  ): { matched: boolean; reason: string } {
    if (input.currentStep === undefined || input.totalSteps === undefined) {
      return { matched: false, reason: 'No chain position information' };
    }

    const step = input.currentStep;
    const total = input.totalSteps;
    let matched: boolean;
    let position: string;

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
        const _exhaustive: never = when.position;
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
