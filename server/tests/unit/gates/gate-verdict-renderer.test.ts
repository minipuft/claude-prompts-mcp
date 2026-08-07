import { describe, expect, test } from '@jest/globals';

import { parseGateVerdict } from '../../../src/engine/gates/core/gate-verdict-contract.js';
import {
  isGateVerdictSubmission,
  renderGateVerdict,
} from '../../../src/engine/gates/core/gate-verdict-renderer.js';
import { GateEnforcementAuthority } from '../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';

import type { GateVerdictSubmission } from '../../../src/engine/gates/core/gate-verdict-renderer.js';

/**
 * A structured verdict reaches the pipeline by being rendered to the canonical
 * string the existing parser reads. That is only sound if it is lossless, so
 * the round trip is asserted directly rather than assumed: for every valid
 * submission, parsing what was rendered must return exactly what was submitted.
 *
 * A renderer that dropped a rationale or truncated a gate list would be a
 * quieter version of the failure this replaces — the old free-text path at
 * least returned `null` when it could not read a verdict.
 */

/** Parse a rendered submission back through both real parsers. */
function roundTrip(submission: GateVerdictSubmission): {
  overall: 'PASS' | 'FAIL' | null;
  rationale: string | null;
  perGate: Array<{ index: number; passed: boolean; rationale: string }>;
} {
  const rendered = renderGateVerdict(submission);
  const parsed = parseGateVerdict(rendered, 'gate_verdict');
  // `parseGateVerdicts` reads only its string argument, but the constructor
  // requires collaborators it does not touch here. Stubs keep this a unit test
  // of the parser rather than dragging in a session store.
  const authority = new GateEnforcementAuthority(
    {} as ConstructorParameters<typeof GateEnforcementAuthority>[0],
    {} as ConstructorParameters<typeof GateEnforcementAuthority>[1]
  );

  return {
    overall: parsed?.verdict ?? null,
    rationale: parsed?.rationale ?? null,
    perGate: authority.parseGateVerdicts(rendered),
  };
}

describe('renderGateVerdict round trip', () => {
  test('preserves a PASS verdict and its rationale', () => {
    const submission: GateVerdictSubmission = {
      overall: 'PASS',
      rationale: 'All criteria met',
    };

    const result = roundTrip(submission);

    expect(result.overall).toBe('PASS');
    expect(result.rationale).toBe('All criteria met');
  });

  test('preserves a FAIL verdict and its rationale', () => {
    const result = roundTrip({ overall: 'FAIL', rationale: 'Missing error handling' });

    expect(result.overall).toBe('FAIL');
    expect(result.rationale).toBe('Missing error handling');
  });

  test('preserves every per-gate entry, in order', () => {
    const submission: GateVerdictSubmission = {
      overall: 'FAIL',
      rationale: 'One gate failed',
      per_gate: [
        { index: 1, passed: true, rationale: 'docs present' },
        { index: 2, passed: false, rationale: 'no tests for the error path' },
        { index: 3, passed: true, rationale: 'no secrets' },
      ],
    };

    const result = roundTrip(submission);

    expect(result.perGate).toEqual(submission.per_gate);
  });

  test('preserves a rationale containing hyphens', () => {
    // The separator is `\s*-\s*` and the capture is `(.+)$`, so the remainder
    // of the line is taken verbatim — no escaping needed. Asserted because a
    // renderer that escaped hyphens would break exactly this.
    const rationale = 'well-formed - but under-tested';

    const result = roundTrip({ overall: 'PASS', rationale });

    expect(result.rationale).toBe(rationale);
  });

  test('preserves a rationale that begins with the separator character', () => {
    const result = roundTrip({ overall: 'PASS', rationale: '- leading hyphen' });

    expect(result.rationale).toBe('- leading hyphen');
  });

  test('preserves a rationale containing a colon', () => {
    // `full-colon` is a *different* pattern; the rendered form must still match
    // `full-hyphen` first and not be re-read as a colon-separated verdict.
    const result = roundTrip({ overall: 'PASS', rationale: 'ratio 3:1 as documented' });

    expect(result.rationale).toBe('ratio 3:1 as documented');
  });

  test('preserves a rationale containing the block header text', () => {
    // A rationale mentioning GATE_VERDICTS must not be mistaken for the block.
    const result = roundTrip({
      overall: 'PASS',
      rationale: 'see GATE_VERDICTS below for detail',
      per_gate: [{ index: 1, passed: true, rationale: 'ok' }],
    });

    expect(result.rationale).toBe('see GATE_VERDICTS below for detail');
    expect(result.perGate).toEqual([{ index: 1, passed: true, rationale: 'ok' }]);
  });

  test('matches the primary pattern, not a fallback', () => {
    // Falling through to `minimal` would still parse, but would mean the
    // canonical render had drifted from the format it claims to produce.
    const rendered = renderGateVerdict({ overall: 'PASS', rationale: 'fine' });

    expect(parseGateVerdict(rendered, 'gate_verdict')?.detectedPattern).toBe('primary');
  });

  test('omits the per-gate block entirely when there are no entries', () => {
    expect(renderGateVerdict({ overall: 'PASS', rationale: 'fine' })).toBe(
      'GATE_REVIEW: PASS - fine'
    );
    expect(renderGateVerdict({ overall: 'PASS', rationale: 'fine', per_gate: [] })).toBe(
      'GATE_REVIEW: PASS - fine'
    );
  });

  test('renders per-gate lines consecutively', () => {
    // The block pattern matches consecutive entries and stops at the first line
    // that does not fit, so a blank line between entries would truncate the
    // review to whatever preceded it.
    const rendered = renderGateVerdict({
      overall: 'PASS',
      rationale: 'ok',
      per_gate: [
        { index: 1, passed: true, rationale: 'a' },
        { index: 2, passed: true, rationale: 'b' },
      ],
    });

    expect(rendered).toContain('GATE_VERDICTS:\n[1] PASS - a\n[2] PASS - b');
  });

  test.each([1, 2, 5, 12, 40])('preserves a %s-gate review in full', (count) => {
    const per_gate = Array.from({ length: count }, (_, i) => ({
      index: i + 1,
      passed: i % 3 !== 0,
      rationale: `gate ${i + 1} rationale`,
    }));

    const result = roundTrip({ overall: 'FAIL', rationale: 'mixed', per_gate });

    expect(result.perGate).toHaveLength(count);
    expect(result.perGate).toEqual(per_gate);
  });
});

describe('isGateVerdictSubmission', () => {
  test('distinguishes a submission from the legacy string form', () => {
    expect(isGateVerdictSubmission({ overall: 'PASS', rationale: 'x' })).toBe(true);
    expect(isGateVerdictSubmission('GATE_REVIEW: PASS - x')).toBe(false);
  });

  test('rejects nullish and non-object values', () => {
    expect(isGateVerdictSubmission(null)).toBe(false);
    expect(isGateVerdictSubmission(undefined)).toBe(false);
    expect(isGateVerdictSubmission(42)).toBe(false);
  });
});
