import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { SymbolicCommandParser } from '../../../../src/execution/parsers/symbolic-operator-parser.js';

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

describe('Repetition Operator (* N)', () => {
  let parser: SymbolicCommandParser;

  beforeEach(() => {
    jest.clearAllMocks();
    parser = new SymbolicCommandParser(mockLogger);
  });

  describe('preprocessRepetition()', () => {
    test('expands >>prompt * 3 to chain (standard syntax with spaces)', () => {
      const result = parser.preprocessRepetition('>>prompt * 3');
      expect(result).toBe('>>prompt --> >>prompt --> >>prompt');
    });

    test('expands >>prompt *3 (no space after asterisk)', () => {
      const result = parser.preprocessRepetition('>>prompt *3');
      expect(result).toBe('>>prompt --> >>prompt --> >>prompt');
    });

    test('expands prompt * 2 (bare prompt name)', () => {
      const result = parser.preprocessRepetition('prompt * 2');
      expect(result).toBe('prompt --> prompt');
    });

    test('handles >>prompt topic:"AI" * 2 with arguments', () => {
      const result = parser.preprocessRepetition('>>prompt topic:"AI" * 2');
      expect(result).toBe('>>prompt topic:"AI" --> >>prompt topic:"AI"');
    });

    test('handles >>step1 * 2 --> >>step2 (mid-chain repetition)', () => {
      const result = parser.preprocessRepetition('>>step1 * 2 --> >>step2');
      expect(result).toBe('>>step1 --> >>step1 --> >>step2');
    });

    test('handles >>step1 --> >>step2 * 3 (end-chain repetition)', () => {
      const result = parser.preprocessRepetition('>>step1 --> >>step2 * 3');
      expect(result).toBe('>>step1 --> >>step2 --> >>step2 --> >>step2');
    });

    test('returns unchanged when no repetition operator', () => {
      const result = parser.preprocessRepetition('>>analyze input:"test"');
      expect(result).toBe('>>analyze input:"test"');
    });

    test('handles * 1 (single repetition)', () => {
      const result = parser.preprocessRepetition('>>prompt * 1');
      expect(result).toBe('>>prompt');
    });

    test('handles large repetition count * 5', () => {
      const result = parser.preprocessRepetition('>>brainstorm * 5');
      const expectedParts = Array(5).fill('>>brainstorm');
      expect(result).toBe(expectedParts.join(' --> '));
    });

    test('preserves complex arguments with special characters', () => {
      const result = parser.preprocessRepetition('>>analyze query:"how does X --> Y work?" * 2');
      // Arguments containing --> should be preserved in quotes
      expect(result).toContain('query:"how does X --> Y work?"');
    });

    test('handles multiple key:value arguments', () => {
      const result = parser.preprocessRepetition('>>task key1:"val1" key2:"val2" * 2');
      expect(result).toBe('>>task key1:"val1" key2:"val2" --> >>task key1:"val1" key2:"val2"');
    });

    // Arguments AFTER * N operator tests (bug fix)
    test('preserves arguments AFTER * N operator', () => {
      const result = parser.preprocessRepetition('>>prompt * 2 arg:"value"');
      expect(result).toBe('>>prompt arg:"value" --> >>prompt arg:"value"');
    });

    test('handles arguments after * N with chain continuation', () => {
      const result = parser.preprocessRepetition('>>prompt * 2 arg:"x" --> >>final');
      expect(result).toBe('>>prompt arg:"x" --> >>prompt arg:"x" --> >>final');
    });

    test('handles multiple arguments after * N', () => {
      const result = parser.preprocessRepetition('>>prompt * 2 a:"1" b:"2"');
      expect(result).toBe('>>prompt a:"1" b:"2" --> >>prompt a:"1" b:"2"');
    });

    test('handles single-quoted arguments after * N', () => {
      const result = parser.preprocessRepetition(">>prompt * 2 arg:'value'");
      expect(result).toBe(">>prompt arg:'value' --> >>prompt arg:'value'");
    });

    test('handles mixed args before and after * N', () => {
      const result = parser.preprocessRepetition('>>prompt before:"x" * 2 after:"y"');
      expect(result).toBe('>>prompt before:"x" after:"y" --> >>prompt before:"x" after:"y"');
    });
  });

  describe('expandRepetition() error handling', () => {
    test('throws for count < 1', () => {
      expect(() => parser.preprocessRepetition('>>prompt * 0')).toThrow(
        'Repetition count must be at least 1'
      );
    });

    test('throws for negative count', () => {
      expect(() => parser.preprocessRepetition('>>prompt * -1')).not.toThrow();
      // Negative numbers don't match the pattern (\\d+ requires digits)
      // So it returns unchanged
      const result = parser.preprocessRepetition('>>prompt * -1');
      expect(result).toBe('>>prompt * -1');
    });

    test('returns unchanged for non-numeric count', () => {
      // Non-numeric doesn't match the pattern
      const result = parser.preprocessRepetition('>>prompt * abc');
      expect(result).toBe('>>prompt * abc');
    });
  });

  describe('detectOperators() with repetition', () => {
    test('detects repetition operator and expands command', () => {
      const result = parser.detectOperators('>>analyze * 3');

      expect(result.hasOperators).toBe(true);
      expect(result.operatorTypes).toContain('repetition');
      expect(result.operatorTypes).toContain('chain');

      // Should have both repetition and chain operators
      const repetitionOp = result.operators.find((op) => op.type === 'repetition');
      expect(repetitionOp).toBeDefined();
      if (repetitionOp?.type === 'repetition') {
        expect(repetitionOp.count).toBe(3);
      }

      // Chain should have 3 steps
      const chainOp = result.operators.find((op) => op.type === 'chain');
      expect(chainOp).toBeDefined();
      if (chainOp?.type === 'chain') {
        expect(chainOp.steps).toHaveLength(3);
        expect(chainOp.steps.every((step) => step.promptId === 'analyze')).toBe(true);
      }
    });

    test('repetition with framework operator', () => {
      const result = parser.detectOperators('@CAGEERF >>brainstorm * 2');

      expect(result.operatorTypes).toContain('framework');
      expect(result.operatorTypes).toContain('repetition');
      expect(result.operatorTypes).toContain('chain');

      const frameworkOp = result.operators.find((op) => op.type === 'framework');
      if (frameworkOp?.type === 'framework') {
        expect(frameworkOp.normalizedId).toBe('CAGEERF');
      }
    });

    test('repetition with gate operator', () => {
      // Gate operators are detected separately from chain steps
      // The gate applies to the whole execution, not as a chain step
      const result = parser.detectOperators(">>validate check:'security' * 2");

      expect(result.operatorTypes).toContain('repetition');
      expect(result.operatorTypes).toContain('chain');

      // Verify chain has 2 steps
      const chainOp = result.operators.find((op) => op.type === 'chain');
      if (chainOp?.type === 'chain') {
        expect(chainOp.steps).toHaveLength(2);
      }
    });

    test('repetition with style operator', () => {
      const result = parser.detectOperators('#analytical >>report * 2');

      expect(result.operatorTypes).toContain('style');
      expect(result.operatorTypes).toContain('repetition');
      expect(result.operatorTypes).toContain('chain');
    });
  });

  describe('Integration with generateExecutionPlan()', () => {
    test('creates correct execution plan with N steps from repetition', () => {
      const detection = parser.detectOperators('>>analyze * 3');
      const plan = parser.generateExecutionPlan(detection, 'analyze', '');

      expect(plan.steps).toHaveLength(3);
      expect(plan.steps.every((step) => step.promptId === 'analyze')).toBe(true);
      expect(plan.steps.map((step) => step.stepNumber)).toEqual([1, 2, 3]);
      expect(plan.requiresSessionState).toBe(true);
    });

    test('preserves arguments across repeated steps', () => {
      const detection = parser.detectOperators('>>task input:"test data" * 2');
      const plan = parser.generateExecutionPlan(detection, 'task', 'input:"test data"');

      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0]?.args).toBe('input:"test data"');
      expect(plan.steps[1]?.args).toBe('input:"test data"');
    });

    test('handles repetition in middle of chain', () => {
      const detection = parser.detectOperators('>>setup --> >>process * 2 --> >>cleanup');
      const plan = parser.generateExecutionPlan(detection, 'setup', '');

      expect(plan.steps).toHaveLength(4);
      expect(plan.steps.map((step) => step.promptId)).toEqual([
        'setup',
        'process',
        'process',
        'cleanup',
      ]);
    });

    test('sets framework override from combined operators', () => {
      const detection = parser.detectOperators('@ReACT >>debug * 2');
      const plan = parser.generateExecutionPlan(detection, 'debug', '');

      expect(plan.frameworkOverride).toBe('REACT');
      expect(plan.steps).toHaveLength(2);
    });
  });

  describe('buildParseResult() with repetition', () => {
    test('includes repetition in detected operators', () => {
      const detection = parser.detectOperators('>>analyze * 3');
      const result = parser.buildParseResult('>>analyze * 3', detection, 'analyze', '');

      expect(result.format).toBe('symbolic');
      expect(result.operators.operatorTypes).toContain('repetition');
      expect(result.operators.operatorTypes).toContain('chain');
      expect(result.executionPlan.steps).toHaveLength(3);
    });

    test('metadata includes original command with repetition', () => {
      const detection = parser.detectOperators('>>prompt * 2');
      const result = parser.buildParseResult('>>prompt * 2', detection, 'prompt', '');

      expect(result.metadata?.originalCommand).toBe('>>prompt * 2');
      expect(result.metadata?.detectedFormat).toContain('repetition');
      expect(result.metadata?.detectedFormat).toContain('chain');
    });
  });

  describe('Edge cases', () => {
    test('handles repetition with quoted strings containing asterisks', () => {
      // The * inside quotes should not be treated as repetition operator
      const result = parser.preprocessRepetition('>>search query:"a * b" * 2');
      expect(result).toContain('query:"a * b"');
      expect(result.split(' --> ')).toHaveLength(2);
    });

    test('handles whitespace variations', () => {
      // Multiple spaces
      const result1 = parser.preprocessRepetition('>>prompt  *  3');
      expect(result1).toBe('>>prompt --> >>prompt --> >>prompt');

      // Tab characters (if supported)
      const result2 = parser.preprocessRepetition('>>prompt\t* 3');
      expect(result2).toBe('>>prompt --> >>prompt --> >>prompt');
    });

    test('handles very long prompt IDs', () => {
      const longId = 'very_long_prompt_identifier_name';
      const result = parser.preprocessRepetition(`>>${longId} * 2`);
      expect(result).toBe(`>>${longId} --> >>${longId}`);
    });

    test('handles prompt ID with hyphens', () => {
      const result = parser.preprocessRepetition('>>my-prompt-name * 2');
      expect(result).toBe('>>my-prompt-name --> >>my-prompt-name');
    });

    test('handles prompt ID with underscores', () => {
      const result = parser.preprocessRepetition('>>my_prompt_name * 2');
      expect(result).toBe('>>my_prompt_name --> >>my_prompt_name');
    });
  });
});

describe('Repetition Operator Pattern Matching', () => {
  let parser: SymbolicCommandParser;

  beforeEach(() => {
    jest.clearAllMocks();
    parser = new SymbolicCommandParser(mockLogger);
  });

  describe('Pattern boundary tests (flexible whitespace)', () => {
    // Pattern: /\s*\*\s*(\d+)/ - allows optional leading/trailing space around *

    test('matches with space before asterisk', () => {
      const result = parser.preprocessRepetition('>>prompt * 3');
      expect(result).toBe('>>prompt --> >>prompt --> >>prompt');
    });

    test('matches with space before and no space after asterisk', () => {
      const result = parser.preprocessRepetition('>>prompt *3');
      expect(result).toBe('>>prompt --> >>prompt --> >>prompt');
    });

    test('matches without space before asterisk (>>prompt*3)', () => {
      const result = parser.preprocessRepetition('>>prompt*3');
      // Pattern \s* allows optional leading space - now matches and expands
      expect(result).toBe('>>prompt --> >>prompt --> >>prompt');
    });

    test('matches with space only after asterisk (>>prompt* 3)', () => {
      const result = parser.preprocessRepetition('>>prompt* 3');
      // Pattern \s* allows optional leading space - now matches and expands
      expect(result).toBe('>>prompt --> >>prompt --> >>prompt');
    });

    test('matches various whitespace combinations', () => {
      // All these should expand identically
      const inputs = ['>>prompt * 3', '>>prompt *3', '>>prompt* 3', '>>prompt*3'];
      const expected = '>>prompt --> >>prompt --> >>prompt';

      for (const input of inputs) {
        expect(parser.preprocessRepetition(input)).toBe(expected);
      }
    });
  });
});
