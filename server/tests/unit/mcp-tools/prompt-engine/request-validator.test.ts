/**
 * Unit Tests for McpToolRequestValidator
 *
 * Tests comprehensive validation logic for MCP tool requests
 * including edge cases, error handling, and type safety.
 */
import { jest } from '@jest/globals';

import { McpToolRequestValidator } from '../../../../src/engine/execution/validation/request-validator.js';

describe('McpToolRequestValidator', () => {
  describe('isValidCommand()', () => {
    it('should return true for non-empty strings', () => {
      expect(McpToolRequestValidator.isValidCommand('>>test')).toBe(true);
      expect(McpToolRequestValidator.isValidCommand('test command')).toBe(true);
      expect(McpToolRequestValidator.isValidCommand('a')).toBe(true);
    });

    it('should return false for empty strings', () => {
      expect(McpToolRequestValidator.isValidCommand('')).toBe(false);
      expect(McpToolRequestValidator.isValidCommand('   ')).toBe(false);
      expect(McpToolRequestValidator.isValidCommand('\t\n')).toBe(false);
    });

    it('should return false for non-strings', () => {
      expect(McpToolRequestValidator.isValidCommand(null)).toBe(false);
      expect(McpToolRequestValidator.isValidCommand(undefined)).toBe(false);
      expect(McpToolRequestValidator.isValidCommand()).toBe(false);
      expect(McpToolRequestValidator.isValidCommand({})).toBe(false);
      expect(McpToolRequestValidator.isValidCommand([])).toBe(false);
    });
  });

  describe('isValidGateVerdict()', () => {
    it('should return true for valid gate verdicts', () => {
      expect(McpToolRequestValidator.isValidGateVerdict('GATE_REVIEW: PASS - All good')).toBe(true);
      expect(
        McpToolRequestValidator.isValidGateVerdict('GATE_REVIEW: FAIL - Missing criteria')
      ).toBe(true);
      expect(
        McpToolRequestValidator.isValidGateVerdict('GATE_REVIEW: PASS -   spaced reason')
      ).toBe(true);
      expect(
        McpToolRequestValidator.isValidGateVerdict('GATE_REVIEW: FAIL - reason with - dash')
      ).toBe(true);
    });

    it('should return false for invalid gate verdicts', () => {
      expect(McpToolRequestValidator.isValidGateVerdict('INVALID FORMAT')).toBe(false);
      expect(McpToolRequestValidator.isValidGateVerdict('GATE_REVIEW: PASS')).toBe(false); // missing reason
      expect(McpToolRequestValidator.isValidGateVerdict('GATE_REVIEW: INVALID - reason')).toBe(
        false
      );
      expect(McpToolRequestValidator.isValidGateVerdict('')).toBe(false);
    });

    it('should accept case-insensitive verdict formats', () => {
      // Minimal form is case-insensitive per runtime parser
      expect(McpToolRequestValidator.isValidGateVerdict('pass - reason')).toBe(true);
      expect(McpToolRequestValidator.isValidGateVerdict('fail - reason')).toBe(true);
      expect(McpToolRequestValidator.isValidGateVerdict('PASS - reason')).toBe(true);
      expect(McpToolRequestValidator.isValidGateVerdict('FAIL - reason')).toBe(true);
    });

    it('should return false for non-strings', () => {
      expect(McpToolRequestValidator.isValidGateVerdict(null)).toBe(false);
      expect(McpToolRequestValidator.isValidGateVerdict(undefined)).toBe(false);
      expect(McpToolRequestValidator.isValidGateVerdict()).toBe(false);
      expect(McpToolRequestValidator.isValidGateVerdict({})).toBe(false);
    });
  });

  describe('validateCommand()', () => {
    it('should return trimmed command for valid input', () => {
      expect(McpToolRequestValidator.validateCommand('  >>test  ')).toBe('>>test');
      expect(McpToolRequestValidator.validateCommand('>>test\n')).toBe('>>test');
      expect(McpToolRequestValidator.validateCommand('>>test\t')).toBe('>>test');
    });

    it('should throw for invalid command', () => {
      expect(() => McpToolRequestValidator.validateCommand('')).toThrow(
        'Command must be a non-empty string'
      );
      expect(() => McpToolRequestValidator.validateCommand('   ')).toThrow(
        'Command must be a non-empty string'
      );
      expect(() => McpToolRequestValidator.validateCommand(null as any)).toThrow(
        'Command must be a non-empty string'
      );
    });
  });

  describe('validateGateVerdict()', () => {
    it('should return trimmed verdict for valid input', () => {
      expect(McpToolRequestValidator.validateGateVerdict('  GATE_REVIEW: PASS - test  ')).toBe(
        'GATE_REVIEW: PASS - test'
      );
      expect(McpToolRequestValidator.validateGateVerdict('GATE_REVIEW: FAIL - reason\n')).toBe(
        'GATE_REVIEW: FAIL - reason'
      );
    });

    it('should throw for invalid gate verdict', () => {
      expect(() => McpToolRequestValidator.validateGateVerdict('INVALID')).toThrow(
        'Gate verdict must follow format: "GATE_REVIEW: PASS/FAIL - reason"'
      );
      expect(() => McpToolRequestValidator.validateGateVerdict('')).toThrow(
        'Gate verdict must follow format: "GATE_REVIEW: PASS/FAIL - reason"'
      );
      expect(() => McpToolRequestValidator.validateGateVerdict(null as any)).toThrow(
        'Gate verdict must follow format: "GATE_REVIEW: PASS/FAIL - reason"'
      );
    });
  });

  describe('validatePartial()', () => {
    test('preserves typed inputs without string coercion', () => {
      const inputs = {
        palette: ['ochre', 'ultramarine'],
        composition: { weights: { edge: 0.7 } },
      };

      expect(McpToolRequestValidator.validatePartial({ inputs })).toEqual({ inputs });
    });

    it('should validate partial request with valid fields', () => {
      const partial = {
        command: '>>test',
        chain_id: 'chain-test',
        force_restart: false,
      };

      const result = McpToolRequestValidator.validatePartial(partial);

      expect(result.command).toBe('>>test');
      expect(result.chain_id).toBe('chain-test');
      expect(result.force_restart).toBe(false);
    });

    it('should validate and trim command in partial request', () => {
      const partial = {
        command: '  >>test  ',
      };

      const result = McpToolRequestValidator.validatePartial(partial);
      expect(result.command).toBe('>>test');
    });

    it('should validate chain_id in partial request', () => {
      const partial = {
        chain_id: 'chain-demo',
      };

      const result = McpToolRequestValidator.validatePartial(partial);
      expect(result.chain_id).toBe('chain-demo');
    });

    it('should validate gate_verdict in partial request', () => {
      const partial = {
        gate_verdict: 'GATE_REVIEW: PASS - test',
      };

      const result = McpToolRequestValidator.validatePartial(partial);
      expect(result.gate_verdict).toBe('GATE_REVIEW: PASS - test');
    });

    it('should throw for invalid command in partial request', () => {
      const partial = {
        command: '',
      };

      expect(() => McpToolRequestValidator.validatePartial(partial)).toThrow(
        'Command must be a non-empty string'
      );
    });

    it('should throw for invalid gate_verdict in partial request', () => {
      const partial = {
        gate_verdict: 'INVALID',
      };

      expect(() => McpToolRequestValidator.validatePartial(partial)).toThrow(
        'Gate verdict must follow format: "GATE_REVIEW: PASS/FAIL - reason"'
      );
    });

    it('should copy other fields as-is', () => {
      const partial = {
        gates: [
          'gate-id',
          { name: 'test', description: 'test desc' },
          { id: 'temp', criteria: ['crit'] },
        ],
      };

      const result = McpToolRequestValidator.validatePartial(partial);
      expect(result).toMatchObject(partial);
    });

    it('should freeze the partial result', () => {
      const partial = { command: '>>test' };
      const result = McpToolRequestValidator.validatePartial(partial);

      expect(() => {
        (result as any).newField = 'test';
      }).toThrow();
    });
  });
});
