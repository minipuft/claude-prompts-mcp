import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { createSymbolicCommandParser } from '../../../../dist/execution/parsers/symbolic-operator-parser.js';

import type { Logger } from '../../../../dist/logging/index.js';

describe('SymbolicCommandParser', () => {
  let parser: ReturnType<typeof createSymbolicCommandParser>;
  let logger: Logger;

  beforeEach(() => {
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;

    parser = createSymbolicCommandParser(logger);
    jest.clearAllMocks();
  });

  test('detectOperators identifies chained steps with parsed metadata', () => {
    const command = '>>first_task input="value" --> second_task';
    const result = parser.detectOperators(command);

    expect(result.hasOperators).toBe(true);
    expect(result.operatorTypes).toContain('chain');

    const chainOp = result.operators.find((op) => op.type === 'chain');
    expect(chainOp?.type).toBe('chain');
    if (chainOp?.type === 'chain') {
      expect(chainOp.steps).toHaveLength(2);
      expect(chainOp.steps[0].promptId).toBe('first_task');
      expect(chainOp.steps[0].args).toBe('input="value"');
      expect(chainOp.steps[1].promptId).toBe('second_task');
      expect(chainOp.steps[1].args).toBe('');
    }
  });

  test('detectOperators parses gate operators and emits deprecation warnings for "="', () => {
    const result = parser.detectOperators('>>prompt = "legacy criteria"');

    expect(result.operatorTypes).toContain('gate');
    const gateOp = result.operators.find((op) => op.type === 'gate');
    expect(gateOp?.type).toBe('gate');
    if (gateOp?.type === 'gate') {
      expect(gateOp.criteria).toBe('legacy criteria');
      expect(gateOp.parsedCriteria).toEqual(['legacy criteria']);
      expect(gateOp.scope).toBe('execution');
      expect(gateOp.retryOnFailure).toBe(true);
      expect(gateOp.maxRetries).toBe(1);
    }
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Gate operator "=" is deprecated')
    );
  });

  test('detectOperators captures framework overrides and normalizes identifiers', () => {
    const result = parser.detectOperators('@ReACT >>debug_issue');

    expect(result.operatorTypes).toContain('framework');
    const frameworkOp = result.operators.find((op) => op.type === 'framework');
    expect(frameworkOp?.type).toBe('framework');
    if (frameworkOp?.type === 'framework') {
      expect(frameworkOp.frameworkId).toBe('ReACT');
      expect(frameworkOp.normalizedId).toBe('REACT');
      expect(frameworkOp.scopeType).toBe('execution');
    }
  });

  test('buildParseResult emits execution plan metadata for symbolic chains', () => {
    const operators = parser.detectOperators('>>plan_one arg=1 --> plan_two :: "quality"');
    const result = parser.buildParseResult(
      '>>plan_one arg=1 --> plan_two :: "quality"',
      operators,
      'plan_one',
      'arg=1'
    );

    expect(result.format).toBe('symbolic');
    expect(result.executionPlan.steps).toHaveLength(2);
    expect(result.executionPlan.steps[0].promptId).toBe('plan_one');
    expect(result.executionPlan.steps[1].promptId).toBe('plan_two');
    const gateOp = operators.operators.find((op) => op.type === 'gate');
    expect(gateOp?.type).toBe('gate');
    if (gateOp?.type === 'gate') {
      expect(gateOp.parsedCriteria).toEqual(['quality']);
    }
  });

  test('detectOperators handles parallel commands when no chain operator is present', () => {
    const command = '>>first + >>second arg="value"';
    const result = parser.detectOperators(command);

    expect(result.operatorTypes).toContain('parallel');
    const parallelOp = result.operators.find((op) => op.type === 'parallel');
    expect(parallelOp?.type).toBe('parallel');
    if (parallelOp?.type === 'parallel') {
      expect(parallelOp.prompts).toHaveLength(2);
      expect(parallelOp.prompts[0].promptId).toBe('first');
      expect(parallelOp.prompts[1].promptId).toBe('second');
    }
  });

  test('detectOperators correctly parses gate operator followed by chain operator', () => {
    const command = 'test_prompt input:"testing" :: "code-quality-gate" -->';
    const result = parser.detectOperators(command);

    expect(result.hasOperators).toBe(true);
    expect(result.operatorTypes).toContain('gate');
    expect(result.operatorTypes).toContain('chain');

    const gateOp = result.operators.find((op) => op.type === 'gate');
    expect(gateOp?.type).toBe('gate');
    if (gateOp?.type === 'gate') {
      expect(gateOp.criteria).toBe('code-quality-gate');
      expect(gateOp.parsedCriteria).toEqual(['code-quality-gate']);
      expect(gateOp.scope).toBe('execution');
    }
  });

  test('detectOperators parses gate operator in middle of chain sequence', () => {
    const command = 'prompt1 :: "gate-id" --> prompt2 --> prompt3';
    const result = parser.detectOperators(command);

    expect(result.hasOperators).toBe(true);
    expect(result.operatorTypes).toContain('gate');
    expect(result.operatorTypes).toContain('chain');

    const gateOp = result.operators.find((op) => op.type === 'gate');
    expect(gateOp?.type).toBe('gate');
    if (gateOp?.type === 'gate') {
      expect(gateOp.criteria).toBe('gate-id');
      expect(gateOp.parsedCriteria).toEqual(['gate-id']);
    }

    const chainOp = result.operators.find((op) => op.type === 'chain');
    expect(chainOp?.type).toBe('chain');
    if (chainOp?.type === 'chain') {
      expect(chainOp.steps).toHaveLength(3);
      expect(chainOp.steps[0].promptId).toBe('prompt1');
      expect(chainOp.steps[1].promptId).toBe('prompt2');
      expect(chainOp.steps[2].promptId).toBe('prompt3');
    }
  });

  test('generateExecutionPlan includes gate operator in finalValidation', () => {
    const operators = parser.detectOperators('task :: "quality-check" -->');
    const plan = parser.generateExecutionPlan(operators, 'task', '');

    expect(plan.finalValidation).toBeDefined();
    expect(plan.finalValidation?.type).toBe('gate');
    if (plan.finalValidation?.type === 'gate') {
      expect(plan.finalValidation.criteria).toBe('quality-check');
      expect(plan.finalValidation.parsedCriteria).toEqual(['quality-check']);
    }
  });

  describe('>> Prefix Normalization (Defense-in-Depth)', () => {
    test('handles >> prefix in chain steps', () => {
      const command = '>>p1 input="test" --> >>p2 --> >>p3';
      const result = parser.detectOperators(command);

      expect(result.hasOperators).toBe(true);
      expect(result.operatorTypes).toContain('chain');

      const chainOp = result.operators.find((op) => op.type === 'chain');
      expect(chainOp?.type).toBe('chain');
      if (chainOp?.type === 'chain') {
        expect(chainOp.steps).toHaveLength(3);
        expect(chainOp.steps[0].promptId).toBe('p1');
        expect(chainOp.steps[1].promptId).toBe('p2');
        expect(chainOp.steps[2].promptId).toBe('p3');
      }
    });

    test('handles >> prefix in parallel prompts', () => {
      const command = '>>p1 arg="val1" + >>p2 arg="val2"';
      const result = parser.detectOperators(command);

      expect(result.operatorTypes).toContain('parallel');
      const parallelOp = result.operators.find((op) => op.type === 'parallel');
      expect(parallelOp?.type).toBe('parallel');
      if (parallelOp?.type === 'parallel') {
        expect(parallelOp.prompts).toHaveLength(2);
        expect(parallelOp.prompts[0].promptId).toBe('p1');
        expect(parallelOp.prompts[0].args).toBe('arg="val1"');
        expect(parallelOp.prompts[1].promptId).toBe('p2');
        expect(parallelOp.prompts[1].args).toBe('arg="val2"');
      }
    });

    test('handles >> prefix in conditional branches', () => {
      const command = '>>p1 ? "condition" : >>trueBranch';
      const result = parser.detectOperators(command);

      expect(result.operatorTypes).toContain('conditional');
      const conditionalOp = result.operators.find((op) => op.type === 'conditional');
      expect(conditionalOp?.type).toBe('conditional');
      if (conditionalOp?.type === 'conditional') {
        expect(conditionalOp.condition).toBe('condition');
        expect(conditionalOp.trueBranch).toBe('trueBranch'); // >> should be stripped
        expect(conditionalOp.conditionType).toBe('presence');
      }
    });

    test('handles mixed >> prefixes with framework operator', () => {
      const command = '@react >>p1 --> >>p2';
      const result = parser.detectOperators(command);

      expect(result.operatorTypes).toContain('framework');
      expect(result.operatorTypes).toContain('chain');

      const frameworkOp = result.operators.find((op) => op.type === 'framework');
      expect(frameworkOp?.type).toBe('framework');
      if (frameworkOp?.type === 'framework') {
        expect(frameworkOp.frameworkId).toBe('react');
      }

      const chainOp = result.operators.find((op) => op.type === 'chain');
      expect(chainOp?.type).toBe('chain');
      if (chainOp?.type === 'chain') {
        expect(chainOp.steps).toHaveLength(2);
        expect(chainOp.steps[0].promptId).toBe('p1');
        expect(chainOp.steps[1].promptId).toBe('p2');
      }
    });

    test('handles mixed operators with multiple >> prefixes and gate', () => {
      const command = '@cageerf >>p1 + >>p2 :: "quality-gate"';
      const result = parser.detectOperators(command);

      expect(result.operatorTypes).toContain('framework');
      expect(result.operatorTypes).toContain('parallel');
      expect(result.operatorTypes).toContain('gate');

      const parallelOp = result.operators.find((op) => op.type === 'parallel');
      expect(parallelOp?.type).toBe('parallel');
      if (parallelOp?.type === 'parallel') {
        expect(parallelOp.prompts).toHaveLength(2);
        expect(parallelOp.prompts[0].promptId).toBe('p1');
        expect(parallelOp.prompts[1].promptId).toBe('p2');
      }

      const gateOp = result.operators.find((op) => op.type === 'gate');
      expect(gateOp?.type).toBe('gate');
      if (gateOp?.type === 'gate') {
        expect(gateOp.criteria).toBe('quality-gate');
      }
    });

    test('handles >> prefix with complex chain and arguments', () => {
      const command = '>>prompt1 input:"test --> quoted" --> >>prompt2 data="value"';
      const result = parser.detectOperators(command);

      expect(result.hasOperators).toBe(true);
      expect(result.operatorTypes).toContain('chain');

      const chainOp = result.operators.find((op) => op.type === 'chain');
      expect(chainOp?.type).toBe('chain');
      if (chainOp?.type === 'chain') {
        expect(chainOp.steps).toHaveLength(2);
        expect(chainOp.steps[0].promptId).toBe('prompt1');
        expect(chainOp.steps[0].args).toBe('input:"test --> quoted"');
        expect(chainOp.steps[1].promptId).toBe('prompt2');
        expect(chainOp.steps[1].args).toBe('data="value"');
      }
    });
  });

  describe('Chain operator with modifiers and framework operators', () => {
    test('parses chain with framework operator at start', () => {
      const command = '@CAGEERF >>step1 input:"test" --> >>step2';
      const result = parser.detectOperators(command);

      expect(result.hasOperators).toBe(true);
      expect(result.operatorTypes).toContain('chain');
      expect(result.operatorTypes).toContain('framework');

      const chainOp = result.operators.find((op) => op.type === 'chain');
      expect(chainOp?.type).toBe('chain');
      if (chainOp?.type === 'chain') {
        expect(chainOp.steps).toHaveLength(2);
        expect(chainOp.steps[0].promptId).toBe('step1');
        expect(chainOp.steps[0].args).toBe('input:"test"');
        expect(chainOp.steps[1].promptId).toBe('step2');
      }

      const frameworkOp = result.operators.find((op) => op.type === 'framework');
      expect(frameworkOp?.type).toBe('framework');
      if (frameworkOp?.type === 'framework') {
        expect(frameworkOp.frameworkId).toBe('CAGEERF');
        expect(frameworkOp.normalizedId).toBe('CAGEERF');
      }
    });

    test('parses chain with operators on later steps (syntax tolerance)', () => {
      const command = '>>step1 --> %lean @ReACT >>step2 input:"value"';
      const result = parser.detectOperators(command);

      expect(result.hasOperators).toBe(true);
      expect(result.operatorTypes).toContain('chain');

      const chainOp = result.operators.find((op) => op.type === 'chain');
      expect(chainOp?.type).toBe('chain');
      if (chainOp?.type === 'chain') {
        expect(chainOp.steps).toHaveLength(2);
        expect(chainOp.steps[0].promptId).toBe('step1');
        expect(chainOp.steps[1].promptId).toBe('step2');
        expect(chainOp.steps[1].args).toBe('input:"value"');
      }
    });

    test('parses chain with operators on each step (syntax tolerance)', () => {
      const command = '@CAGEERF >>step1 input:"test" --> @ReACT >>step2 --> @5W1H >>step3';
      const result = parser.detectOperators(command);

      expect(result.hasOperators).toBe(true);
      expect(result.operatorTypes).toContain('chain');
      expect(result.operatorTypes).toContain('framework');

      const chainOp = result.operators.find((op) => op.type === 'chain');
      expect(chainOp?.type).toBe('chain');
      if (chainOp?.type === 'chain') {
        expect(chainOp.steps).toHaveLength(3);
        expect(chainOp.steps[0].promptId).toBe('step1');
        expect(chainOp.steps[0].args).toBe('input:"test"');
        expect(chainOp.steps[1].promptId).toBe('step2');
        expect(chainOp.steps[2].promptId).toBe('step3');
      }

      // Note: Only the first framework operator is captured (execution-level)
      // Operators on later steps are cleaned for parsing but not detected as operators
      const frameworkOp = result.operators.find((op) => op.type === 'framework');
      expect(frameworkOp?.type).toBe('framework');
      if (frameworkOp?.type === 'framework') {
        expect(frameworkOp.frameworkId).toBe('CAGEERF');
      }
    });

    test('parses chain with only framework operators on steps', () => {
      const command = '@CAGEERF >>step1 --> @ReACT >>step2';
      const result = parser.detectOperators(command);

      expect(result.hasOperators).toBe(true);
      expect(result.operatorTypes).toContain('chain');
      expect(result.operatorTypes).toContain('framework');

      const chainOp = result.operators.find((op) => op.type === 'chain');
      expect(chainOp?.type).toBe('chain');
      if (chainOp?.type === 'chain') {
        expect(chainOp.steps).toHaveLength(2);
        expect(chainOp.steps[0].promptId).toBe('step1');
        expect(chainOp.steps[1].promptId).toBe('step2');
      }
    });

    test('parses chain with modifiers on steps (syntax tolerance)', () => {
      // Note: Modifiers are handled by UnifiedCommandParser, not SymbolicCommandParser
      // This test verifies that modifiers on individual steps are cleaned during parsing
      const command = '>>step1 input:"test" --> %lean >>step2';
      const result = parser.detectOperators(command);

      expect(result.hasOperators).toBe(true);
      expect(result.operatorTypes).toContain('chain');

      const chainOp = result.operators.find((op) => op.type === 'chain');
      expect(chainOp?.type).toBe('chain');
      if (chainOp?.type === 'chain') {
        expect(chainOp.steps).toHaveLength(2);
        expect(chainOp.steps[0].promptId).toBe('step1');
        expect(chainOp.steps[0].args).toBe('input:"test"');
        expect(chainOp.steps[1].promptId).toBe('step2');
      }
    });
  });
});
