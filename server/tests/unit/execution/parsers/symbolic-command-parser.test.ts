import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { createSymbolicCommandParser } from '../../../../dist/execution/parsers/symbolic-command-parser.js';
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
      expect(chainOp.steps[0]!.promptId).toBe('first_task');
      expect(chainOp.steps[0]!.args).toBe('input="value"');
      expect(chainOp.steps[1]!.promptId).toBe('second_task');
      expect(chainOp.steps[1]!.args).toBe('');
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
    expect(result.executionPlan.steps[0]!.promptId).toBe('plan_one');
    expect(result.executionPlan.steps[1]!.promptId).toBe('plan_two');
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
      expect(parallelOp.prompts[0]!.promptId).toBe('first');
      expect(parallelOp.prompts[1]!.promptId).toBe('second');
    }
  });
});
