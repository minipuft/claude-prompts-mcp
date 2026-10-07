/**
 * Unit Tests for McpToolRequestValidator
 *
 * Tests comprehensive validation logic for MCP tool requests
 * including edge cases, error handling, and type safety.
 */
import { describe, expect, it, test } from '@jest/globals';

import { McpToolRequestValidator } from '../../../../src/engine/execution/validation/request-validator.js';
import {
  isValidGateVerdict,
  parseGateVerdict,
} from '../../../../src/engine/gates/core/gate-verdict-contract.js';
import { hashBytes } from '../../../../src/shared/utils/hash.js';

import type { GateVerdictSubmission } from '../../../../src/shared/types/gate-evaluation.js';

function richVerdict(): GateVerdictSubmission {
  const targetDigest = hashBytes('A😀e\u0301 Z');
  return {
    overall: 'PASS',
    rationale: 'Reviewed',
    per_gate: [
      {
        index: 1,
        passed: true,
        rationale: 'Evidence supplied',
        evaluation: {
          binding: {
            gate_id: 'contract-gate',
            node_id: 'n1',
            attempt_id: 'attempt-1',
            definition_digest: hashBytes('frozen definition'),
            target_digest: targetDigest,
          },
          observations: [
            {
              criterion_id: 'preserves-contract',
              state: 'met',
              value: true,
              evidence: [{ target_digest: targetDigest, start: 1, end: 5, quote: '😀e\u0301' }],
              rationale: 'Unicode citation.\nReport rationale remains multiline.',
            },
          ],
          reviewer: {
            provenance: 'client_reported',
            provider: 'claimed-provider',
            model: 'claimed-model',
            revision: 'claimed-revision',
            context: 'isolated_judge',
          },
        },
      },
    ],
    reminders: {
      satisfied: ['review-notes'],
      not_applicable: [{ id: 'network', reason: 'No network changes' }],
    },
  };
}

describe('McpToolRequestValidator', () => {
  describe('structured gate review custody and defensive syntax', () => {
    test('retains a rich Unicode report and reviewer through validation and canonical parsing', () => {
      const submission = richVerdict();
      const before = structuredClone(submission);

      expect(isValidGateVerdict(submission)).toBe(true);
      expect(McpToolRequestValidator.isValidGateVerdict(submission)).toBe(true);
      expect(McpToolRequestValidator.validateGateVerdict(submission)).toBe(submission);
      expect(
        McpToolRequestValidator.validatePartial({ gate_verdict: submission }).gate_verdict
      ).toBe(submission);
      const parsed = parseGateVerdict(submission, 'gate_verdict');

      expect(parsed?.submission).toBe(submission);
      expect(parsed?.submission).toEqual(before);
      expect(parsed).toMatchObject({
        verdict: 'PASS',
        rationale: 'Reviewed',
        source: 'gate_verdict',
        detectedPattern: 'structured',
      });
      expect(parsed?.raw).toBe(
        'GATE_REVIEW: PASS - Reviewed\nREMINDERS: satisfied=review-notes; n/a=network(No network changes)\n\nGATE_VERDICTS:\n[1] PASS - Evidence supplied'
      );
      expect(submission).toEqual(before);
    });

    test.each(['PASS', 'FAIL'] as const)('accepts an ordinary structured %s review', (overall) => {
      const submission: GateVerdictSubmission = {
        overall,
        rationale: 'Reviewed',
        per_gate: [{ index: 1, passed: overall === 'PASS', rationale: 'Check reviewed' }],
      };

      expect(McpToolRequestValidator.validateGateVerdict(submission)).toBe(submission);
      expect(parseGateVerdict(submission, 'gate_verdict')).toMatchObject({
        verdict: overall,
        submission,
      });
    });

    test('accepts reminder-only and present-empty attestations without defaulting unknown shapes', () => {
      for (const reminders of [
        { satisfied: [], not_applicable: [] },
        { satisfied: ['style'], not_applicable: [{ id: 'network', reason: 'Not applicable' }] },
      ]) {
        const submission: GateVerdictSubmission = {
          overall: 'PASS',
          rationale: 'Reviewed',
          reminders,
        };
        expect(McpToolRequestValidator.validateGateVerdict(submission)).toBe(submission);
      }
    });

    test.each([
      null,
      undefined,
      42,
      true,
      [],
      {},
      { overall: 'PASS' },
      { rationale: 'Reviewed' },
      { overall: 'pass', rationale: 'Reviewed' },
      { overall: 'PASS', rationale: '' },
      { overall: 'PASS', rationale: ' \t ' },
      { overall: 'PASS', rationale: 'line one\nline two' },
      { overall: 'PASS', rationale: 'Reviewed', findings: [] },
      { overall: 'PASS', rationale: 'Reviewed', per_gate: null },
      { overall: 'PASS', rationale: 'Reviewed', per_gate: {} },
      { overall: 'PASS', rationale: 'Reviewed', per_gate: Array<unknown>(1) },
      ...[
        null,
        {},
        { index: 1, passed: true },
        { index: 1, passed: 'true', rationale: 'Reviewed' },
      ].map((entry) => ({
        overall: 'PASS',
        rationale: 'Reviewed',
        per_gate: [entry],
      })),
      ...[0, -1, 0.5, NaN, Infinity].map((index) => ({
        overall: 'PASS',
        rationale: 'Reviewed',
        per_gate: [{ index, passed: true, rationale: 'Reviewed' }],
      })),
      {
        overall: 'PASS',
        rationale: 'Reviewed',
        per_gate: [{ index: 1, passed: true, rationale: ' ' }],
      },
      {
        overall: 'PASS',
        rationale: 'Reviewed',
        per_gate: [{ index: 1, passed: true, rationale: 'a\nb' }],
      },
      {
        overall: 'PASS',
        rationale: 'Reviewed',
        per_gate: [{ index: 1, passed: true, rationale: 'Reviewed', extra: true }],
      },
      ...[
        null,
        {},
        { satisfied: [] },
        { satisfied: 'style', not_applicable: [] },
        { satisfied: Array<unknown>(1), not_applicable: [] },
        { satisfied: [], not_applicable: Array<unknown>(1) },
        { satisfied: ['bad,id'], not_applicable: [] },
        { satisfied: [], not_applicable: ['network'] },
        { satisfied: [], not_applicable: [{ id: 'network' }] },
        { satisfied: [], not_applicable: [{ id: 'network', reason: ' ' }] },
        { satisfied: [], not_applicable: [{ id: 'network', reason: 'bad;reason' }] },
        { satisfied: [], not_applicable: [{ id: 'network', reason: 'bad)reason' }] },
        { satisfied: [], not_applicable: [{ id: 'network', reason: 'a\nb' }] },
        { satisfied: [], not_applicable: [{ id: 'bad(id', reason: 'Reviewed' }] },
        { satisfied: [], not_applicable: [{ id: 'network', reason: 'Reviewed', extra: true }] },
        { satisfied: [], not_applicable: [], extra: true },
      ].map((reminders) => ({
        overall: 'PASS',
        rationale: 'Reviewed',
        reminders,
      })),
    ])('rejects malformed structured outer/entry/reminder input %j', (submission) => {
      expect(isValidGateVerdict(submission)).toBe(false);
      expect(McpToolRequestValidator.isValidGateVerdict(submission)).toBe(false);
      expect(() => McpToolRequestValidator.validateGateVerdict(submission)).toThrow();
    });

    test('report defense reuses the kernel syntax while leaving acceptance and binding authority separate', () => {
      const submission = richVerdict();
      const evaluation = submission.per_gate?.[0]?.evaluation;
      if (evaluation === undefined) throw new Error('Rich report fixture missing');
      const shapedButUnadjudicated = {
        ...submission,
        per_gate: [
          {
            index: 1,
            passed: true,
            rationale: 'Reviewed',
            evaluation: {
              ...evaluation,
              binding: { ...evaluation.binding, node_id: 'other-node' },
              observations: [{ ...evaluation.observations[0], state: 'met', value: false }],
            },
          },
        ],
      };

      expect(isValidGateVerdict(shapedButUnadjudicated)).toBe(true);
      for (const report of [
        null,
        {},
        { ...evaluation, extra: true },
        { ...evaluation, binding: { ...evaluation.binding, attempt_id: ' ' } },
        { ...evaluation, binding: { ...evaluation.binding, extra: true } },
        { ...evaluation, observations: [null] },
        { ...evaluation, observations: Array<unknown>(1) },
        { ...evaluation, observations: [{ ...evaluation.observations[0], value: Infinity }] },
        { ...evaluation, observations: [{ ...evaluation.observations[0], extra: true }] },
        {
          ...evaluation,
          observations: [
            {
              ...evaluation.observations[0],
              evidence: [{ target_digest: 'digest', start: -1, end: 3 }],
            },
          ],
        },
        {
          ...evaluation,
          observations: [
            {
              ...evaluation.observations[0],
              evidence: [{ target_digest: 'digest', start: 0, end: 3, extra: true }],
            },
          ],
        },
        { ...evaluation, reviewer: { provenance: 'host_verified' } },
        { ...evaluation, reviewer: { provenance: 'client_reported', model: ' ' } },
        { ...evaluation, reviewer: { provenance: 'unknown', extra: true } },
      ]) {
        const malformed = {
          ...submission,
          per_gate: [{ index: 1, passed: true, rationale: 'Reviewed', evaluation: report }],
        };
        expect(isValidGateVerdict(malformed)).toBe(false);
        expect(() => McpToolRequestValidator.validateGateVerdict(malformed)).toThrow();
      }
    });

    test.each([undefined, '', ' \n\t '])(
      'canonical parser refuses absent/blank legacy text %j',
      (raw) => {
        expect(parseGateVerdict(raw, 'gate_verdict')).toBeNull();
        expect(isValidGateVerdict(raw)).toBe(false);
        expect(() => McpToolRequestValidator.validateGateVerdict(raw)).toThrow();
      }
    );

    test.each([
      'GATE_REVIEW: PASS - Checked',
      'GATE_REVIEW: FAIL: Checked',
      'GATE PASS - Checked',
      'PASS - Checked',
    ])('preserves legacy parsing and string-only custody for %s', (raw) => {
      const parsed = parseGateVerdict(` \n${raw}\t `, 'gate_verdict');
      expect(parsed?.raw).toBe(raw);
      expect(parsed?.rationale).toBe('Checked');
      expect(parsed).not.toHaveProperty('submission');
    });

    test('confines structured verdicts to gate_verdict while preserving legacy user_response parsing', () => {
      const submission = richVerdict();

      expect(parseGateVerdict(submission, 'gate_verdict')?.submission).toBe(submission);
      expect(parseGateVerdict(submission, 'user_response')).toBeNull();
      expect(parseGateVerdict('GATE_REVIEW: PASS - Checked', 'user_response')?.verdict).toBe(
        'PASS'
      );
    });

    test('keeps the minimal legacy pattern restricted to gate_verdict', () => {
      expect(parseGateVerdict('PASS - Checked', 'gate_verdict')?.verdict).toBe('PASS');
      expect(parseGateVerdict('PASS - Checked', 'user_response')).toBeNull();
      expect(parseGateVerdict('GATE_REVIEW: PASS - Checked', 'user_response')?.verdict).toBe(
        'PASS'
      );
    });

    test('partial validation leaves an absent verdict absent', () => {
      expect(McpToolRequestValidator.validatePartial({})).not.toHaveProperty('gate_verdict');
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
