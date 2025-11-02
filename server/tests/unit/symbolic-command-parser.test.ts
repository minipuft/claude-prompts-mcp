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

  // Framework Operator Tests - NEW
  describe('Framework Operator Detection', () => {
    test('detects @FRAMEWORK prefix at start of command', () => {
      const result = parser.detectOperators('@REACT >>analyze');
      
      expect(result.hasOperators).toBe(true);
      expect(result.operatorTypes).toContain('framework');
      const frameworkOp = result.operators.find((op) => op.type === 'framework');
      expect(frameworkOp).toBeDefined();
      if (frameworkOp && frameworkOp.type === 'framework') {
        expect(frameworkOp.frameworkId).toBe('REACT');
        expect(frameworkOp.normalizedId).toBe('REACT');
      }
    });

    test('detects @FRAMEWORK with various whitespace patterns', () => {
      const testCases = [
        '@REACT>>analyze',           // no space
        '@REACT >>analyze',          // single space
        '@REACT  >>analyze',         // multiple spaces
        '@REACT\t>>analyze',         // tab character
        '@REACT \t >>analyze',       // mixed whitespace
      ];

      testCases.forEach(command => {
        const result = parser.detectOperators(command);
        expect(result.operatorTypes).toContain('framework');
        const frameworkOp = result.operators.find((op) => op.type === 'framework');
        if (frameworkOp && frameworkOp.type === 'framework') {
          expect(frameworkOp.frameworkId).toBe('REACT');
        }
      });
    });

    test('does not detect framework when @ prefix is absent', () => {
      const result = parser.detectOperators('>>analyze --> summarize');
      
      expect(result.operatorTypes).not.toContain('framework');
      const frameworkOp = result.operators.find((op) => op.type === 'framework');
      expect(frameworkOp).toBeUndefined();
    });
  });

  describe('Framework ID Extraction and Normalization', () => {
    test('normalizes framework ID to uppercase', () => {
      const testCases = [
        { input: '@react', expected: 'REACT' },
        { input: '@React', expected: 'REACT' },
        { input: '@REACT', expected: 'REACT' },
        { input: '@ReAcT', expected: 'REACT' },
      ];

      testCases.forEach(({ input, expected }) => {
        const result = parser.detectOperators(input);
        const frameworkOp = result.operators.find((op) => op.type === 'framework');
        if (frameworkOp && frameworkOp.type === 'framework') {
          expect(frameworkOp.normalizedId).toBe(expected);
        }
      });
    });

    test('handles framework IDs with numbers and underscores', () => {
      const testCases = [
        { input: '@framework_v2', expected: 'FRAMEWORK_V2' },
        { input: '@test123', expected: 'TEST123' },
        { input: '@my_framework_1', expected: 'MY_FRAMEWORK_1' },
      ];

      testCases.forEach(({ input, expected }) => {
        const result = parser.detectOperators(input);
        const frameworkOp = result.operators.find((op) => op.type === 'framework');
        if (frameworkOp && frameworkOp.type === 'framework') {
          expect(frameworkOp.normalizedId).toBe(expected);
          expect(frameworkOp.frameworkId).toBe(input.substring(1).split(' ')[0]);
        }
      });
    });

    test('correctly identifies framework ID boundaries', () => {
      const result = parser.detectOperators('@REACT-SPECIAL >>analyze');
      const frameworkOp = result.operators.find((op) => op.type === 'framework');
      
      if (frameworkOp && frameworkOp.type === 'framework') {
        expect(frameworkOp.frameworkId).toBe('REACT-SPECIAL');
        expect(frameworkOp.normalizedId).toBe('REACT-SPECIAL');
      }
    });
  });

  describe('Case-Insensitive Input Handling', () => {
    test('handles mixed case framework names consistently', () => {
      const commands = [
        '@react >>step1',
        '@React >>step1',
        '@REACT >>step1',
        '@ReAcT >>step1',
      ];

      const results = commands.map(cmd => parser.detectOperators(cmd));
      
      // All should produce the same normalized result
      results.forEach(result => {
        const frameworkOp = result.operators.find((op) => op.type === 'framework');
        if (frameworkOp && frameworkOp.type === 'framework') {
          expect(frameworkOp.normalizedId).toBe('REACT');
          expect(frameworkOp.temporary).toBe(true);
          expect(frameworkOp.scopeType).toBe('execution');
        }
      });
    });

    test('preserves original case in frameworkId property', () => {
      const testCases = [
        { input: '@react', original: 'react' },
        { input: '@React', original: 'React' },
        { input: '@REACT', original: 'REACT' },
      ];

      testCases.forEach(({ input, original }) => {
        const result = parser.detectOperators(input);
        const frameworkOp = result.operators.find((op) => op.type === 'framework');
        if (frameworkOp && frameworkOp.type === 'framework') {
          expect(frameworkOp.frameworkId).toBe(original);
          expect(frameworkOp.normalizedId).toBe('REACT');
        }
      });
    });
  });

  describe('Combined Operators Parsing', () => {
    test('parses framework + chain + gate combination correctly', () => {
      const command = '@CAGEERF >>step1 input="test" --> step2 :: "quality check"';
      const result = parser.detectOperators(command);
      
      expect(result.operatorTypes).toEqual(expect.arrayContaining(['framework', 'chain', 'gate']));
      expect(result.operators).toHaveLength(3);
      
      const frameworkOp = result.operators.find((op) => op.type === 'framework');
      const chainOp = result.operators.find((op) => op.type === 'chain');
      const gateOp = result.operators.find((op) => op.type === 'gate');
      
      // Framework validation
      if (frameworkOp && frameworkOp.type === 'framework') {
        expect(frameworkOp.normalizedId).toBe('CAGEERF');
      }
      
      // Chain validation
      if (chainOp && chainOp.type === 'chain') {
        expect(chainOp.steps).toHaveLength(2);
        expect(chainOp.steps[0].promptId).toBe('step1');
        expect(chainOp.steps[1].promptId).toBe('step2');
      }
      
      // Gate validation
      if (gateOp && gateOp.type === 'gate') {
        expect(gateOp.criteria).toBe('quality check');
        expect(gateOp.parsedCriteria).toEqual(['quality check']);
      }
    });

    test('handles framework with complex chain arguments containing special chars', () => {
      const command = '@REACT >>analyze text="data --> analysis" --> summarize criteria="comprehensive"';
      const result = parser.detectOperators(command);
      
      const chainOp = result.operators.find((op) => op.type === 'chain');
      if (chainOp && chainOp.type === 'chain') {
        expect(chainOp.steps).toHaveLength(2);
        expect(chainOp.steps[0].args).toBe('text="data --> analysis"');
        expect(chainOp.steps[1].args).toBe('criteria="comprehensive"');
      }
    });

    test('handles multiple framework prefixes gracefully', () => {
      const command = '@REACT @CAGEERF >>analyze';
      
      // Should detect first framework only
      const result = parser.detectOperators(command);
      const frameworkOps = result.operators.filter((op) => op.type === 'framework');
      expect(frameworkOps).toHaveLength(1);
      expect(frameworkOps[0] && frameworkOps[0].type === 'framework' ? frameworkOps[0].normalizedId : undefined).toBe('REACT');
    });
  });

  describe('Framework Prefix Stripping', () => {
    test('strips framework prefix before chain parsing', () => {
      const chainOp = parser['parseChainOperator']('@REACT >>step1 --> step2');
      
      expect(chainOp.steps).toHaveLength(2);
      expect(chainOp.steps[0].promptId).toBe('step1');
      expect(chainOp.steps[1].promptId).toBe('step2');
      // Should not include @REACT in any step
      expect(chainOp.steps[0].promptId).not.toContain('@');
      expect(chainOp.steps[1].promptId).not.toContain('@');
    });

    test('strips framework prefix with arguments correctly', () => {
      const chainOp = parser['parseChainOperator']('@REACT >>analyze data="test" --> summarize');
      
      expect(chainOp.steps[0].promptId).toBe('analyze');
      expect(chainOp.steps[0].args).toBe('data="test"');
      expect(chainOp.steps[1].promptId).toBe('summarize');
    });
  });

  describe('Quoted Arguments Preservation', () => {
    test('preserves quoted arguments containing special characters', () => {
      const command = '@REACT >>analyze text="data --> contains --> arrows" :: "check --> arrows"';
      const result = parser.detectOperators(command);
      
      const chainOp = result.operators.find((op) => op.type === 'chain');
      if (chainOp && chainOp.type === 'chain') {
        expect(chainOp.steps[0].args).toBe('text="data --> contains --> arrows"');
        // Should not split on quoted arrows
        expect(chainOp.steps).toHaveLength(1);
      }
      
      const gateOp = result.operators.find((op) => op.type === 'gate');
      if (gateOp && gateOp.type === 'gate') {
        expect(gateOp.criteria).toBe('check --> arrows');
      }
    });

    test('handles escaped quotes in arguments', () => {
      const command = '@REACT >>analyze text="He said \\"hello\\" to the world"';
      const result = parser.detectOperators(command);
      
      const chainOp = result.operators.find((op) => op.type === 'chain');
      if (chainOp && chainOp.type === 'chain') {
        expect(chainOp.steps[0].args).toBe('text="He said \\"hello\\" to the world"');
      }
    });
  });
});
