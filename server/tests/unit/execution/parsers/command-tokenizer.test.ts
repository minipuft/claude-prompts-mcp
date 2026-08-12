import { describe, expect, test } from '@jest/globals';

import { tokenizeCommand } from '../../../../src/engine/execution/parsers/command-tokenizer.js';
import type { TokenizedOperator } from '../../../../src/engine/execution/parsers/command-tokenizer.js';

// Helper: collect operator types from result
const opTypes = (ops: TokenizedOperator[]): string[] => ops.map((o) => o.type);

describe('tokenizeCommand', () => {
  // =========================================================================
  // Format detection
  // =========================================================================
  describe('format detection', () => {
    test('detects JSON format', () => {
      const result = tokenizeCommand('{"command": ">>analyze"}');
      expect(result.format).toBe('json');
      expect(result.operators).toHaveLength(0);
      expect(result.hasSymbolicOperators).toBe(false);
      expect(result.promptId).toBeNull();
    });

    test('detects simple format (no operators)', () => {
      const result = tokenizeCommand('>>analyze some args');
      expect(result.format).toBe('simple');
      expect(result.operators).toHaveLength(0);
      expect(result.hasSymbolicOperators).toBe(false);
    });

    test('detects symbolic format (has operators)', () => {
      const result = tokenizeCommand('>>analyze --> >>summarize');
      expect(result.format).toBe('symbolic');
      expect(result.hasSymbolicOperators).toBe(true);
    });
  });

  // =========================================================================
  // Chain operator (-->)
  // =========================================================================
  describe('chain operator (-->)', () => {
    test('detects single chain operator', () => {
      const result = tokenizeCommand('>>step1 --> >>step2');
      expect(opTypes(result.operators)).toContain('chain');
      const chain = result.operators.find((o) => o.type === 'chain');
      expect(chain?.raw).toBe('-->');
    });

    test('detects multiple chain operators', () => {
      const result = tokenizeCommand('>>a --> >>b --> >>c');
      const chains = result.operators.filter((o) => o.type === 'chain');
      expect(chains).toHaveLength(2);
    });

    test('does not detect --> inside quotes', () => {
      const result = tokenizeCommand('>>analyze content:"step1 --> step2"');
      expect(result.operators.filter((o) => o.type === 'chain')).toHaveLength(0);
      expect(result.format).toBe('simple');
    });
  });

  // =========================================================================
  // Delegation operator (==>)
  // =========================================================================
  describe('delegation operator (==>)', () => {
    test('detects delegation operator', () => {
      const result = tokenizeCommand('>>step1 ==> >>step2');
      expect(opTypes(result.operators)).toContain('delegation');
    });

    test('detects mixed chain and delegation', () => {
      const result = tokenizeCommand('>>a --> >>b ==> >>c');
      expect(opTypes(result.operators)).toContain('chain');
      expect(opTypes(result.operators)).toContain('delegation');
    });

    test('does not detect ==> inside quotes', () => {
      const result = tokenizeCommand('>>analyze content:"delegate ==> here"');
      expect(result.operators.filter((o) => o.type === 'delegation')).toHaveLength(0);
    });
  });

  // =========================================================================
  // Gate operator (::)
  // =========================================================================
  describe('gate operator (:: and =)', () => {
    test('detects anonymous quoted gate', () => {
      const result = tokenizeCommand('>>analyze :: "cite sources"');
      const gates = result.operators.filter((o) => o.type === 'gate');
      expect(gates).toHaveLength(1);
      expect(gates[0]?.value).toBe('cite sources');
    });

    test('detects named gate with colon syntax', () => {
      const result = tokenizeCommand('>>analyze :: security:"no secrets"');
      const gates = result.operators.filter((o) => o.type === 'gate');
      expect(gates).toHaveLength(1);
      expect(gates[0]?.value).toBe('security:no secrets');
    });

    test('detects canonical/unquoted gate', () => {
      const result = tokenizeCommand('>>analyze :: code-quality');
      const gates = result.operators.filter((o) => o.type === 'gate');
      expect(gates).toHaveLength(1);
      expect(gates[0]?.value).toBe('code-quality');
    });

    test('detects deprecated = gate operator', () => {
      const result = tokenizeCommand('>>analyze = "check quality"');
      const gates = result.operators.filter((o) => o.type === 'gate');
      expect(gates).toHaveLength(1);
    });

    test('does not detect :: inside quotes', () => {
      const result = tokenizeCommand('>>analyze content:"use :: for gates"');
      expect(result.operators.filter((o) => o.type === 'gate')).toHaveLength(0);
    });

    test('does not false-match gate on ==> delegation', () => {
      // The = in ==> must not trigger gate detection
      const result = tokenizeCommand('>>step1 ==> >>step2');
      expect(result.operators.filter((o) => o.type === 'gate')).toHaveLength(0);
      expect(result.operators.filter((o) => o.type === 'delegation')).toHaveLength(1);
    });

    test('does not match argument assignment (key=value)', () => {
      // = in key=value has no preceding whitespace separator
      const result = tokenizeCommand('>>analyze input=test');
      expect(result.operators.filter((o) => o.type === 'gate')).toHaveLength(0);
      expect(result.format).toBe('simple');
    });
  });

  // =========================================================================
  // Framework operator (@)
  // =========================================================================
  describe('framework operator (@)', () => {
    test('detects framework at start', () => {
      const result = tokenizeCommand('@CAGEERF >>analyze');
      const fw = result.operators.find((o) => o.type === 'framework');
      expect(fw).toBeDefined();
      expect(fw?.value).toBe('CAGEERF');
    });

    test('detects framework after whitespace', () => {
      const result = tokenizeCommand('>>analyze @ReACT');
      const fw = result.operators.find((o) => o.type === 'framework');
      expect(fw).toBeDefined();
      expect(fw?.value).toBe('ReACT');
    });

    test('skips @path/reference patterns', () => {
      const result = tokenizeCommand('>>analyze @docs/path');
      expect(result.operators.filter((o) => o.type === 'framework')).toHaveLength(0);
    });

    test('skips @file.ext patterns', () => {
      const result = tokenizeCommand('>>analyze @config.json');
      expect(result.operators.filter((o) => o.type === 'framework')).toHaveLength(0);
    });

    test('does not detect @ inside quotes', () => {
      const result = tokenizeCommand('>>analyze content:"use @CAGEERF here"');
      expect(result.operators.filter((o) => o.type === 'framework')).toHaveLength(0);
    });
  });

  // =========================================================================
  // Style operator (#)
  // =========================================================================
  describe('style operator (#)', () => {
    test('detects style operator', () => {
      const result = tokenizeCommand('#analytical >>analyze');
      const style = result.operators.find((o) => o.type === 'style');
      expect(style).toBeDefined();
      expect(style?.value).toBe('analytical');
    });

    test('detects style after whitespace', () => {
      const result = tokenizeCommand('>>analyze #procedural');
      const style = result.operators.find((o) => o.type === 'style');
      expect(style).toBeDefined();
      expect(style?.value).toBe('procedural');
    });

    test('does not detect # inside quotes', () => {
      const result = tokenizeCommand('>>analyze content:"use #analytical"');
      expect(result.operators.filter((o) => o.type === 'style')).toHaveLength(0);
    });
  });

  // =========================================================================
  // Repetition operator (*N)
  // =========================================================================
  describe('repetition operator (*N)', () => {
    test('detects repetition', () => {
      const result = tokenizeCommand('>>prompt *3');
      const rep = result.operators.find((o) => o.type === 'repetition');
      expect(rep).toBeDefined();
      expect(rep?.value).toBe('3');
    });

    test('detects repetition with spaces', () => {
      const result = tokenizeCommand('>>prompt * 5');
      const rep = result.operators.find((o) => o.type === 'repetition');
      expect(rep).toBeDefined();
      expect(rep?.value).toBe('5');
    });

    test('does not detect * inside quotes', () => {
      const result = tokenizeCommand('>>analyze content:"rate * 10"');
      expect(result.operators.filter((o) => o.type === 'repetition')).toHaveLength(0);
    });
  });

  // =========================================================================
  // Parallel operator (+)
  // =========================================================================
  describe('parallel operator (+)', () => {
    test('detects parallel operator', () => {
      const result = tokenizeCommand('>>task1 + >>task2');
      expect(opTypes(result.operators)).toContain('parallel');
    });

    test('does not detect + inside quotes', () => {
      const result = tokenizeCommand('>>analyze content:"R3F + Visx"');
      expect(result.operators.filter((o) => o.type === 'parallel')).toHaveLength(0);
      expect(result.format).toBe('simple');
    });

    test('detects + alongside a chain while + is reserved', () => {
      // Inverted from "chain takes precedence" (plan row 0.5.15). The precedence rule protects a
      // chain from having its `+` consumed as a parallel STEP — irrelevant while `+` is
      // `status: reserved` in operators.json, because no strategy may consume the token and
      // CommandParser throws on it first. Emitting it is what lets that rejection happen; the
      // suppression is restored automatically if `+` ever becomes implemented.
      const result = tokenizeCommand('>>a --> >>b + >>c');
      expect(opTypes(result.operators)).toContain('chain');
      expect(opTypes(result.operators)).toContain('parallel');
    });
  });

  // =========================================================================
  // Conditional operator (?)
  // =========================================================================
  describe('conditional operator (?)', () => {
    test('detects conditional with full pattern', () => {
      const result = tokenizeCommand('>>check ? "has tests" : >>fallback');
      const cond = result.operators.find((o) => o.type === 'conditional');
      expect(cond).toBeDefined();
      expect(cond?.value).toBe('has tests');
    });

    test('does not detect bare ? (natural language)', () => {
      const result = tokenizeCommand('>>analyze is there a bug?');
      expect(result.operators.filter((o) => o.type === 'conditional')).toHaveLength(0);
    });
  });

  // =========================================================================
  // Quoted arguments with special characters (REGRESSION suite)
  // =========================================================================
  describe('quoted arguments with special characters', () => {
    test('"R3F + Visx" does not produce parallel operator', () => {
      const result = tokenizeCommand(
        '>>implementation_plan feature:"R3F + Visx charts" constraints:"target <200KB"'
      );
      expect(result.format).toBe('simple');
      expect(result.operators).toHaveLength(0);
      expect(result.promptId).toBe('implementation_plan');
    });

    test('"modes: (1)" does not produce gate operator', () => {
      const result = tokenizeCommand(
        '>>implementation_plan feature:"Two modes: (1) standalone, (2) embedded"'
      );
      expect(result.operators.filter((o) => o.type === 'gate')).toHaveLength(0);
    });

    test('"step1 --> step2" inside quotes does not produce chain', () => {
      const result = tokenizeCommand('>>analyze content:"step1 --> step2 --> step3"');
      expect(result.operators.filter((o) => o.type === 'chain')).toHaveLength(0);
      expect(result.format).toBe('simple');
    });

    test('multiple quoted args with mixed special chars', () => {
      const result = tokenizeCommand(
        '>>plan feature:"R3F + Visx" constraints:"target <200KB, works with node:sqlite" scope:"(1) dashboard + (2) SSE"'
      );
      expect(result.format).toBe('simple');
      expect(result.operators).toHaveLength(0);
      expect(result.promptId).toBe('plan');
      expect(result.rawArgs).toContain('R3F + Visx');
      expect(result.rawArgs).toContain('node:sqlite');
    });

    test('single-quoted values with special chars', () => {
      const result = tokenizeCommand(">>analyze content:'use :: and --> here'");
      expect(result.operators).toHaveLength(0);
      expect(result.format).toBe('simple');
    });
  });

  // =========================================================================
  // Mixed operators
  // =========================================================================
  describe('mixed operators', () => {
    test('chain + gate', () => {
      const result = tokenizeCommand('>>analyze --> >>summarize :: "cite sources"');
      expect(opTypes(result.operators)).toContain('chain');
      expect(opTypes(result.operators)).toContain('gate');
    });

    test('framework + chain', () => {
      const result = tokenizeCommand('@CAGEERF >>analyze --> >>summarize');
      expect(opTypes(result.operators)).toContain('framework');
      expect(opTypes(result.operators)).toContain('chain');
      expect(result.promptId).toBe('analyze');
    });

    test('style + framework + chain', () => {
      const result = tokenizeCommand('#analytical @CAGEERF >>analyze --> >>summarize');
      expect(opTypes(result.operators)).toContain('style');
      expect(opTypes(result.operators)).toContain('framework');
      expect(opTypes(result.operators)).toContain('chain');
    });

    test('chain + delegation mixed', () => {
      const result = tokenizeCommand('>>research --> >>summarize ==> >>review');
      const types = opTypes(result.operators);
      expect(types).toContain('chain');
      expect(types).toContain('delegation');
    });
  });

  // =========================================================================
  // Prompt ID extraction
  // =========================================================================
  describe('prompt ID extraction', () => {
    test('extracts from >>prompt', () => {
      const result = tokenizeCommand('>>analyze');
      expect(result.promptId).toBe('analyze');
    });

    test('extracts from bare prompt name', () => {
      const result = tokenizeCommand('analyze some args');
      expect(result.promptId).toBe('analyze');
      expect(result.rawArgs).toBe('some args');
    });

    test('returns null for JSON format', () => {
      const result = tokenizeCommand('{"command": ">>analyze"}');
      expect(result.promptId).toBeNull();
    });

    test('extracts args after prompt ID', () => {
      const result = tokenizeCommand('>>plan feature:"auth" scope:"backend"');
      expect(result.promptId).toBe('plan');
      expect(result.rawArgs).toContain('feature:"auth"');
    });

    test('extracts first prompt in chain', () => {
      const result = tokenizeCommand('>>step1 arg:"val" --> >>step2');
      expect(result.promptId).toBe('step1');
      expect(result.rawArgs).toBe('arg:"val"');
    });
  });

  // =========================================================================
  // Cleaned command
  // =========================================================================
  describe('cleaned command', () => {
    test('strips gate operators from cleaned command', () => {
      const result = tokenizeCommand('>>analyze :: "cite sources"');
      expect(result.cleanedCommand).not.toContain('::');
      expect(result.cleanedCommand).toContain('analyze');
    });

    test('strips framework operator from cleaned command', () => {
      const result = tokenizeCommand('@CAGEERF >>analyze some args');
      expect(result.cleanedCommand).not.toContain('@CAGEERF');
      expect(result.cleanedCommand).toContain('>>analyze');
    });

    test('strips style operator from cleaned command', () => {
      const result = tokenizeCommand('#analytical >>report');
      expect(result.cleanedCommand).not.toContain('#analytical');
      expect(result.cleanedCommand).toContain('>>report');
    });

    test('preserves chain delimiters in cleaned command', () => {
      const result = tokenizeCommand('>>analyze --> >>summarize :: "quality"');
      expect(result.cleanedCommand).toContain('-->');
      expect(result.cleanedCommand).not.toContain('::');
    });

    test('strips verify options from cleaned command', () => {
      const result = tokenizeCommand('>>analyze :: verify:"npm test" :full loop:true max:5');
      expect(result.cleanedCommand).not.toContain(':full');
      expect(result.cleanedCommand).not.toContain('loop:true');
      expect(result.cleanedCommand).not.toContain('max:5');
    });

    test('normalizes whitespace after stripping', () => {
      const result = tokenizeCommand('@CAGEERF  #analytical  >>analyze');
      // After stripping framework and style, no double spaces should remain
      expect(result.cleanedCommand).not.toContain('  ');
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('edge cases', () => {
    test('empty string', () => {
      const result = tokenizeCommand('');
      expect(result.format).toBe('simple');
      expect(result.operators).toHaveLength(0);
      expect(result.promptId).toBeNull();
    });

    test('whitespace only', () => {
      const result = tokenizeCommand('   ');
      expect(result.format).toBe('simple');
      expect(result.operators).toHaveLength(0);
    });

    test('preserves raw field as original input', () => {
      const input = '  >>analyze  ';
      const result = tokenizeCommand(input);
      expect(result.raw).toBe(input);
    });

    test('handles escaped quotes', () => {
      // Escaped quote should not toggle quote state
      const result = tokenizeCommand('>>analyze content:"test \\"nested\\" --> value"');
      // The --> is inside quotes (escaped quotes don't close), so no chain
      expect(result.operators.filter((o) => o.type === 'chain')).toHaveLength(0);
    });
  });
});
