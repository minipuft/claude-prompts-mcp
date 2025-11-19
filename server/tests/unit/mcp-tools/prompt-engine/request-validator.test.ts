/**
 * Unit Tests for McpToolRequestValidator
 *
 * Tests comprehensive validation logic for MCP tool requests
 * including edge cases, error handling, and type safety.
 */
import { McpToolRequestValidator } from '../../../../dist/execution/validation/request-validator';

import type { McpToolRequest } from '../../../../dist/types/execution';

describe('McpToolRequestValidator', () => {
  describe('validate()', () => {
    it('should validate a minimal valid request', () => {
      const raw = { command: '>>test_prompt' };
      const result = McpToolRequestValidator.validate(raw);

      expect(result.command).toBe('>>test_prompt');
      expect(result.gate_verdict).toBeUndefined();
      expect(result.force_restart).toBeUndefined();
      expect(result.execution_mode).toBeUndefined();
      expect(result.api_validation).toBe(false);
      expect(result.quality_gates).toBeUndefined();
      expect(result.custom_checks).toBeUndefined();
      expect(result.temporary_gates).toBeUndefined();
      expect(result.gate_scope).toBeUndefined();
    });

    it('should validate a complete valid request', () => {
      const raw: McpToolRequest = {
        command: '>>test_prompt',
        chain_id: 'chain-test_prompt',
        gate_verdict: 'GATE_REVIEW: PASS - All criteria met',
        force_restart: true,
        execution_mode: 'chain',
        api_validation: true,
        quality_gates: ['technical-accuracy', 'code-quality'],
        custom_checks: [{ name: 'custom-check', description: 'Custom validation' }],
        temporary_gates: [{ id: 'temp-gate', criteria: ['criteria'], severity: 'high' }],
        gate_scope: 'session',
      };

      const result = McpToolRequestValidator.validate(raw);
      expect(result).toMatchObject(raw);
    });

    it('should reject empty command', () => {
      const raw = { command: '' };

      expect(() => McpToolRequestValidator.validate(raw)).toThrow(
        'McpToolRequest validation failed: command: Command cannot be empty'
      );
    });

    it('should reject whitespace-only command', () => {
      const raw = { command: '   ' };

      expect(() => McpToolRequestValidator.validate(raw)).toThrow(
        'McpToolRequest validation failed: command: Command cannot be empty'
      );
    });

    it('should reject null command', () => {
      const raw = { command: null };

      expect(() => McpToolRequestValidator.validate(raw)).toThrow(
        'McpToolRequest validation failed: command: Expected string, received null'
      );
    });

    it('should reject legacy session_id usage', () => {
      const raw = {
        command: '>>test',
        session_id: 'session-123',
      } as any;

      expect(() => McpToolRequestValidator.validate(raw)).toThrow(
        "session_id is no longer supported. Use 'chain_id' from the response footer to resume."
      );
    });

    it('should reject invalid gate_verdict format', () => {
      const raw = {
        command: '>>test',
        gate_verdict: 'INVALID FORMAT',
      };

      expect(() => McpToolRequestValidator.validate(raw)).toThrow(
        'McpToolRequest validation failed: gate_verdict: Gate verdict must follow format: "GATE_REVIEW: PASS/FAIL - reason"'
      );
    });

    it('should reject invalid execution_mode', () => {
      const raw = {
        command: '>>test',
        execution_mode: 'invalid-mode' as any,
      };

      expect(() => McpToolRequestValidator.validate(raw)).toThrow(
        'McpToolRequest validation failed: execution_mode: Execution mode must be one of: auto, prompt, template, chain'
      );
    });

    it('should reject invalid gate_scope', () => {
      const raw = {
        command: '>>test',
        gate_scope: 'invalid-scope' as any,
      };

      expect(() => McpToolRequestValidator.validate(raw)).toThrow(
        'McpToolRequest validation failed: gate_scope: Gate scope must be one of: execution, session, chain, step'
      );
    });

    it('should reject invalid custom_checks structure', () => {
      const raw = {
        command: '>>test',
        custom_checks: [
          { name: 'valid-check', description: 'valid description' },
          { name: 'test', description: '' }, // empty description
        ],
      };

      expect(() => McpToolRequestValidator.validate(raw)).toThrow(
        'McpToolRequest validation failed: custom_checks.1.description: Custom check description cannot be empty'
      );
    });

    it('should reject invalid temporary_gates structure', () => {
      const raw = {
        command: '>>test',
        temporary_gates: [
          { id: 'valid', criteria: ['criterion'] },
          { id: 'test', criteria: [] }, // missing criteria entries
        ],
      };

      expect(() => McpToolRequestValidator.validate(raw)).toThrow(
        'McpToolRequest validation failed: temporary_gates.1.criteria: Gate criteria cannot be empty'
      );
    });

    it('should freeze the returned object', () => {
      const raw = { command: '>>test' };
      const result = McpToolRequestValidator.validate(raw);

      expect(() => {
        (result as any).newField = 'test';
      }).toThrow();

      expect(() => {
        (result as any).command = 'modified';
      }).toThrow();
    });

    it('should handle multiple validation errors', () => {
      const raw = {
        command: '',
        execution_mode: 'invalid' as any,
      };

      expect(() => McpToolRequestValidator.validate(raw)).toThrow(
        /McpToolRequest validation failed:.*command.*execution_mode/
      );
    });

    it('should validate chain-only resume requests', () => {
      const raw = { chain_id: 'chain-demo' };
      const result = McpToolRequestValidator.validate(raw);
      expect(result.chain_id).toBe('chain-demo');
      expect(result.command).toBeUndefined();
    });

    it('should reject invalid chain ids', () => {
      const raw = { chain_id: 'invalid_chain' } as any;
      expect(() => McpToolRequestValidator.validate(raw)).toThrow(/Chain ID must follow format/);
    });

    it('should validate response-only requests without command', () => {
      const raw = {
        chain_id: 'chain-demo',
        user_response: 'Here is my answer',
      };

      const result = McpToolRequestValidator.validate(raw);
      expect(result.command).toBeUndefined();
      expect(result.chain_id).toBe('chain-demo');
      expect(result.user_response).toBe('Here is my answer');
    });

    it('should allow resume requests without user_response content', () => {
      const raw = {
        chain_id: 'chain-demo',
        user_response: '   ',
      };

      const result = McpToolRequestValidator.validate(raw);
      expect(result.chain_id).toBe('chain-demo');
      expect(result.user_response).toBe('');
    });

    it('should reject requests missing command and resume identifier', () => {
      const raw = {
        user_response: 'Next answer',
      };

      expect(() => McpToolRequestValidator.validate(raw)).toThrow(
        /Request must include a command or chain identifier/
      );
    });
  });

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
      expect(McpToolRequestValidator.isValidGateVerdict('pass - reason')).toBe(false);
      expect(McpToolRequestValidator.isValidGateVerdict('')).toBe(false);
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
    it('should validate partial request with valid fields', () => {
      const partial = {
        command: '>>test',
        chain_id: 'chain-test',
        api_validation: true,
      };

      const result = McpToolRequestValidator.validatePartial(partial);

      expect(result.command).toBe('>>test');
      expect(result.chain_id).toBe('chain-test');
      expect(result.api_validation).toBe(true);
      expect(result.force_restart).toBeUndefined();
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

    it('should throw for session_id in partial request', () => {
      const partial = {
        session_id: 'invalid!',
      };

      expect(() => McpToolRequestValidator.validatePartial(partial)).toThrow(
        "session_id is no longer supported. Use 'chain_id' from the response footer to resume."
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
        execution_mode: 'chain' as const,
        quality_gates: ['gate', 'gate'],
        custom_checks: [{ name: 'test', description: 'test desc' }],
        temporary_gates: [{ id: 'temp', criteria: ['crit'] }],
        gate_scope: 'session' as const,
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
