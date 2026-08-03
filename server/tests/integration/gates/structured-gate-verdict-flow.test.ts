import { describe, expect, test } from '@jest/globals';

import { GateEnforcementAuthority } from '../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import {
  GATE_VERDICT_VALIDATION_MESSAGE,
  isValidGateVerdict,
  parseGateVerdict,
} from '../../../src/engine/gates/core/gate-verdict-contract.js';
import {
  isGateVerdictSubmission,
  renderGateVerdict,
} from '../../../src/engine/gates/core/gate-verdict-renderer.js';
import { buildPromptEngineSchema } from '../../../src/mcp/tools/schemas/prompt-engine.schema.js';

import type { PromptEngineInput } from '../../../src/mcp/tools/schemas/prompt-engine.schema.js';

/**
 * The full chain of custody for a structured gate verdict, composed from the
 * production units rather than mocks:
 *
 *   prompt_engine schema  →  isGateVerdictSubmission  →  renderGateVerdict
 *                                                              ↓
 *              parseGateVerdict  +  GateEnforcementAuthority.parseGateVerdicts
 *
 * Each link is unit-tested in isolation; what this asserts is that they agree.
 * The failure this guards against is a submission that validates, renders, and
 * then parses to something *different* — which produces no error anywhere and
 * would silently record the wrong review.
 */

const schema = buildPromptEngineSchema(isValidGateVerdict, GATE_VERDICT_VALIDATION_MESSAGE);

/** The boundary normalization exactly as `mcp/tools/index.ts` performs it. */
function normalizeAtBoundary(gateVerdict: unknown): string | undefined {
  return isGateVerdictSubmission(gateVerdict)
    ? renderGateVerdict(gateVerdict)
    : (gateVerdict as string | undefined)?.trim();
}

function authority(): GateEnforcementAuthority {
  return new GateEnforcementAuthority(
    {} as ConstructorParameters<typeof GateEnforcementAuthority>[0],
    {} as ConstructorParameters<typeof GateEnforcementAuthority>[1]
  );
}

describe('structured gate verdict, schema through parser', () => {
  test('a structured submission survives the whole path intact', () => {
    const submission = {
      overall: 'FAIL' as const,
      rationale: 'two gates unmet',
      per_gate: [
        { index: 1, passed: true, rationale: 'api-documentation: contract annotated' },
        { index: 2, passed: false, rationale: 'test-coverage: error path untested' },
        { index: 3, passed: false, rationale: 'code-quality: complexity over limit' },
      ],
    };

    const parsedArgs: PromptEngineInput = schema.parse({
      chain_id: 'chain-demo#2',
      gate_verdict: submission,
    });
    const normalized = normalizeAtBoundary(parsedArgs.gate_verdict);
    const verdict = parseGateVerdict(normalized, 'gate_verdict');

    expect(verdict?.verdict).toBe('FAIL');
    expect(verdict?.rationale).toBe('two gates unmet');
    expect(authority().parseGateVerdicts(normalized ?? '')).toEqual(submission.per_gate);
  });

  test('the legacy string form still reaches the parser unchanged', () => {
    // The string branch is retained for existing clients. Its retirement
    // condition is recorded in the plan; until then it must keep working.
    const parsedArgs: PromptEngineInput = schema.parse({
      chain_id: 'chain-demo#2',
      gate_verdict: 'GATE_REVIEW: PASS - looks good',
    });

    const verdict = parseGateVerdict(normalizeAtBoundary(parsedArgs.gate_verdict), 'gate_verdict');

    expect(verdict?.verdict).toBe('PASS');
    expect(verdict?.rationale).toBe('looks good');
  });

  test('a structured submission never falls through to a fallback pattern', () => {
    // Fallback patterns exist to rescue malformed free text. A structured
    // submission reaching one would mean the canonical render had drifted.
    const normalized = normalizeAtBoundary({
      overall: 'PASS' as const,
      rationale: 'fine',
    });

    expect(parseGateVerdict(normalized, 'gate_verdict')?.detectedPattern).toBe('primary');
  });

  describe('the schema rejects what the round trip could not preserve', () => {
    test('a multi-line rationale', () => {
      // Only the first non-empty line is parsed, so the remainder would vanish.
      const result = schema.safeParse({
        gate_verdict: { overall: 'PASS', rationale: 'first line\nsecond line' },
      });

      expect(result.success).toBe(false);
    });

    test('an empty rationale', () => {
      expect(
        schema.safeParse({ gate_verdict: { overall: 'PASS', rationale: '   ' } }).success
      ).toBe(false);
    });

    test('a per-gate entry with an empty rationale', () => {
      const result = schema.safeParse({
        gate_verdict: {
          overall: 'PASS',
          rationale: 'ok',
          per_gate: [{ index: 1, passed: true, rationale: '' }],
        },
      });

      expect(result.success).toBe(false);
    });

    test('a non-positive or fractional gate index', () => {
      const base = { overall: 'PASS' as const, rationale: 'ok' };

      expect(
        schema.safeParse({
          gate_verdict: { ...base, per_gate: [{ index: 0, passed: true, rationale: 'x' }] },
        }).success
      ).toBe(false);
      expect(
        schema.safeParse({
          gate_verdict: { ...base, per_gate: [{ index: 1.5, passed: true, rationale: 'x' }] },
        }).success
      ).toBe(false);
    });

    test('a verdict outside PASS/FAIL', () => {
      expect(
        schema.safeParse({ gate_verdict: { overall: 'MAYBE', rationale: 'ok' } }).success
      ).toBe(false);
    });

    test('a missing rationale entirely', () => {
      expect(schema.safeParse({ gate_verdict: { overall: 'PASS' } }).success).toBe(false);
    });
  });

  test('a rationale is trimmed on the way in, so the round trip is exact', () => {
    // The parser applies `.trim()` to its capture, so untrimmed input would not
    // survive. The schema trims first, making the two agree by construction.
    const parsedArgs: PromptEngineInput = schema.parse({
      gate_verdict: { overall: 'PASS', rationale: '   padded   ' },
    });
    const verdict = parseGateVerdict(normalizeAtBoundary(parsedArgs.gate_verdict), 'gate_verdict');

    expect(verdict?.rationale).toBe('padded');
  });
});
