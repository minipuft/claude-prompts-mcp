// @lifecycle canonical - Unit tests for ConditionEvaluator
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  ConditionEvaluator,
  type ConditionEvaluationResult,
} from '../../../../src/execution/pipeline/decisions/injection/index.js';

import type {
  InjectionCondition,
  InjectionDecisionInput,
} from '../../../../src/execution/pipeline/decisions/injection/types.js';

describe('ConditionEvaluator', () => {
  let mockLogger: any;
  let evaluator: ConditionEvaluator;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    evaluator = new ConditionEvaluator(mockLogger);
  });

  describe('evaluate', () => {
    it('should return matched=false when no conditions exist', () => {
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
      };

      const result = evaluator.evaluate(undefined, input);

      expect(result.matched).toBe(false);
      expect(result.reason).toContain('No conditions');
    });

    it('should return matched=false when empty conditions array', () => {
      const conditions: InjectionCondition[] = [];
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
      };

      const result = evaluator.evaluate(conditions, input);

      expect(result.matched).toBe(false);
    });
  });

  describe('gate-status condition', () => {
    it('should match when gate has expected status', () => {
      const conditions: InjectionCondition[] = [
        {
          id: 'gate-check',
          when: { type: 'gate-status', gateId: 'quality-check', status: 'pass' },
          then: 'inject',
        },
      ];
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
        gateStatuses: new Map([['quality-check', 'pass']]),
      };

      const result = evaluator.evaluate(conditions, input);

      expect(result.matched).toBe(true);
      expect(result.action).toBe('inject');
    });

    it('should not match when gate status differs', () => {
      const conditions: InjectionCondition[] = [
        {
          id: 'gate-check',
          when: { type: 'gate-status', gateId: 'quality-check', status: 'pass' },
          then: 'skip',
        },
      ];
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
        gateStatuses: new Map([['quality-check', 'fail']]),
      };

      const result = evaluator.evaluate(conditions, input);

      expect(result.matched).toBe(false);
    });

    it('should not match when no gate statuses provided', () => {
      const conditions: InjectionCondition[] = [
        {
          id: 'gate-check',
          when: { type: 'gate-status', gateId: 'any-gate', status: 'pass' },
          then: 'inject',
        },
      ];
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
      };

      const result = evaluator.evaluate(conditions, input);

      expect(result.matched).toBe(false);
    });
  });

  describe('step-type condition', () => {
    it('should match when step type matches', () => {
      const conditions: InjectionCondition[] = [
        {
          id: 'type-check',
          when: { type: 'step-type', stepType: 'analysis' },
          then: 'inject',
        },
      ];
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
        stepType: 'analysis',
      };

      const result = evaluator.evaluate(conditions, input);

      expect(result.matched).toBe(true);
      expect(result.action).toBe('inject');
    });

    it('should not match when step type differs', () => {
      const conditions: InjectionCondition[] = [
        {
          id: 'type-check',
          when: { type: 'step-type', stepType: 'analysis' },
          then: 'skip',
        },
      ];
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
        stepType: 'execution',
      };

      const result = evaluator.evaluate(conditions, input);

      expect(result.matched).toBe(false);
    });
  });

  describe('step-number condition', () => {
    it('should match with eq comparison', () => {
      const conditions: InjectionCondition[] = [
        {
          id: 'step-eq',
          when: { type: 'step-number', comparison: 'eq', value: 3 },
          then: 'inject',
        },
      ];
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 3,
      };

      const result = evaluator.evaluate(conditions, input);

      expect(result.matched).toBe(true);
    });

    it('should match with gt comparison', () => {
      const conditions: InjectionCondition[] = [
        {
          id: 'step-gt',
          when: { type: 'step-number', comparison: 'gt', value: 2 },
          then: 'skip',
        },
      ];
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 5,
      };

      const result = evaluator.evaluate(conditions, input);

      expect(result.matched).toBe(true);
      expect(result.action).toBe('skip');
    });

    it('should not match when comparison fails', () => {
      const conditions: InjectionCondition[] = [
        {
          id: 'step-lt',
          when: { type: 'step-number', comparison: 'lt', value: 3 },
          then: 'inject',
        },
      ];
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 5,
      };

      const result = evaluator.evaluate(conditions, input);

      expect(result.matched).toBe(false);
    });
  });

  describe('previous-step-result condition', () => {
    it('should match when previous result matches', () => {
      const conditions: InjectionCondition[] = [
        {
          id: 'prev-success',
          when: { type: 'previous-step-result', status: 'success' },
          then: 'inject',
        },
      ];
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 2,
        previousStepResult: 'success',
      };

      const result = evaluator.evaluate(conditions, input);

      expect(result.matched).toBe(true);
    });

    it('should not match when previous result differs', () => {
      const conditions: InjectionCondition[] = [
        {
          id: 'prev-success',
          when: { type: 'previous-step-result', status: 'success' },
          then: 'skip',
        },
      ];
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 2,
        previousStepResult: 'failure',
      };

      const result = evaluator.evaluate(conditions, input);

      expect(result.matched).toBe(false);
    });
  });

  describe('chain-position condition', () => {
    it('should match first position', () => {
      const conditions: InjectionCondition[] = [
        {
          id: 'first-step',
          when: { type: 'chain-position', position: 'first' },
          then: 'inject',
        },
      ];
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
        totalSteps: 5,
      };

      const result = evaluator.evaluate(conditions, input);

      expect(result.matched).toBe(true);
    });

    it('should match last position', () => {
      const conditions: InjectionCondition[] = [
        {
          id: 'last-step',
          when: { type: 'chain-position', position: 'last' },
          then: 'skip',
        },
      ];
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 5,
        totalSteps: 5,
      };

      const result = evaluator.evaluate(conditions, input);

      expect(result.matched).toBe(true);
      expect(result.action).toBe('skip');
    });

    it('should match middle position', () => {
      const conditions: InjectionCondition[] = [
        {
          id: 'middle-step',
          when: { type: 'chain-position', position: 'middle' },
          then: 'inherit',
        },
      ];
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 3,
        totalSteps: 5,
      };

      const result = evaluator.evaluate(conditions, input);

      expect(result.matched).toBe(true);
      expect(result.action).toBe('inherit');
    });
  });

  describe('always condition', () => {
    it('should always match', () => {
      const conditions: InjectionCondition[] = [
        {
          id: 'always-inject',
          when: { type: 'always' },
          then: 'inject',
        },
      ];
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
      };

      const result = evaluator.evaluate(conditions, input);

      expect(result.matched).toBe(true);
      expect(result.action).toBe('inject');
    });
  });

  describe('first match wins', () => {
    it('should return first matching condition', () => {
      const conditions: InjectionCondition[] = [
        {
          id: 'step-1',
          when: { type: 'step-number', comparison: 'eq', value: 1 },
          then: 'inject',
          reason: 'First step special handling',
        },
        {
          id: 'always-skip',
          when: { type: 'always' },
          then: 'skip',
        },
      ];
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 1,
      };

      const result = evaluator.evaluate(conditions, input);

      expect(result.matched).toBe(true);
      expect(result.action).toBe('inject');
      expect(result.matchedCondition?.id).toBe('step-1');
    });

    it('should skip to second condition if first does not match', () => {
      const conditions: InjectionCondition[] = [
        {
          id: 'step-1',
          when: { type: 'step-number', comparison: 'eq', value: 1 },
          then: 'inject',
        },
        {
          id: 'always-skip',
          when: { type: 'always' },
          then: 'skip',
        },
      ];
      const input: InjectionDecisionInput = {
        injectionType: 'system-prompt',
        currentStep: 3,
      };

      const result = evaluator.evaluate(conditions, input);

      expect(result.matched).toBe(true);
      expect(result.action).toBe('skip');
      expect(result.matchedCondition?.id).toBe('always-skip');
    });
  });
});
