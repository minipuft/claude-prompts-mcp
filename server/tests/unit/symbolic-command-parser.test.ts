import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { createSymbolicCommandParser } from '../../src/execution/parsers/symbolic-command-parser.js';
import type { Logger } from '../../src/logging/index.js';

const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

describe('SymbolicCommandParser', () => {
  let parser: ReturnType<typeof createSymbolicCommandParser>;

  beforeEach(() => {
    jest.clearAllMocks();
    parser = createSymbolicCommandParser(mockLogger);
  });

  test('detects chain operators', () => {
    const result = parser.detectOperators('>>step_one input="value" --> step_two');

    expect(result.hasOperators).toBe(true);
    expect(result.operatorTypes).toContain('chain');
    const chainOp = result.operators.find((op) => op.type === 'chain');
    expect(chainOp).toBeDefined();
    if (chainOp && chainOp.type === 'chain') {
      expect(chainOp.steps).toHaveLength(2);
      expect(chainOp.steps[0].promptId).toBe('step_one');
      expect(chainOp.steps[1].promptId).toBe('step_two');
    }
  });

  test('detects framework and gate operators together with :: syntax', () => {
    const result = parser.detectOperators('@ReACT >>debug_issue :: "no errors"');

    expect(result.operatorTypes).toEqual(expect.arrayContaining(['framework', 'gate']));
    const frameworkOp = result.operators.find((op) => op.type === 'framework');
    const gateOp = result.operators.find((op) => op.type === 'gate');

    expect(frameworkOp && frameworkOp.type === 'framework' ? frameworkOp.normalizedId : undefined).toBe('REACT');
    if (!gateOp || gateOp.type !== 'gate') {
      throw new Error('Expected gate operator');
    }
    expect(gateOp.parsedCriteria).toEqual(['no errors']);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  test('supports legacy = gate operator with deprecation warning', () => {
    mockLogger.warn = jest.fn();
    const result = parser.detectOperators('@ReACT >>debug_issue = "legacy syntax"');

    expect(result.operatorTypes).toEqual(expect.arrayContaining(['framework', 'gate']));
    const gateOp = result.operators.find((op) => op.type === 'gate');
    if (!gateOp || gateOp.type !== 'gate') {
      throw new Error('Expected gate operator for legacy syntax test');
    }
    expect(gateOp.parsedCriteria).toEqual(['legacy syntax']);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Gate operator "=" is deprecated'));
  });

  test('buildParseResult produces execution plan', () => {
    const operators = parser.detectOperators('>>analyze text="value" --> summarize');
    const parseResult = parser.buildParseResult(
      '>>analyze text="value" --> summarize',
      operators,
      'analyze',
      'text="value"',
    );

    expect(parseResult.format).toBe('symbolic');
    expect(parseResult.executionPlan.steps).toHaveLength(2);
    expect(parseResult.executionPlan.steps[0].promptId).toBe('analyze');
    expect(parseResult.executionPlan.steps[1].promptId).toBe('summarize');
  });

  test('detects gate operator with arguments containing equals signs', () => {
    const result = parser.detectOperators('>>test_api_message_v2 input="test" :: "clear output"');

    expect(result.operatorTypes).toContain('gate');
    const gateOp = result.operators.find((op) => op.type === 'gate');

    if (!gateOp || gateOp.type !== 'gate') {
      throw new Error('Expected gate operator');
    }

    expect(gateOp.criteria).toBe('clear output');
    expect(gateOp.parsedCriteria).toEqual(['clear output']);
  });

  test('does not match argument assignments as gate operators', () => {
    const result = parser.detectOperators('>>prompt arg="value"');

    const gateOp = result.operators.find((op) => op.type === 'gate');
    expect(gateOp).toBeUndefined();
  });

  test('handles multiple arguments before gate operator', () => {
    const result = parser.detectOperators('>>analyze arg1="a" arg2="b" :: "comprehensive"');

    expect(result.operatorTypes).toContain('gate');
    const gateOp = result.operators.find((op) => op.type === 'gate');

    if (!gateOp || gateOp.type !== 'gate') {
      throw new Error('Expected gate operator');
    }

    expect(gateOp.criteria).toBe('comprehensive');
    expect(gateOp.parsedCriteria).toEqual(['comprehensive']);
  });
});
