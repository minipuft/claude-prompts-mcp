import { describe, expect, test } from '@jest/globals';

import {
  isGateVerdictSubmission,
  renderGateVerdict,
} from '../../../src/engine/gates/core/gate-verdict-renderer.js';

import type {
  GateVerdictReminders,
  GateVerdictSubmission,
  SemanticEvaluationReport,
} from '../../../src/shared/types/gate-evaluation.js';

/**
 * A structured verdict renders as display text (`ParsedGateVerdict.raw`, shown by a retry render
 * as the previous response). Nothing parses it back, so these tests pin what a reader sees: every
 * ordinary field, in order, with nothing dropped — and no line shaped like a submission format,
 * which a reply would otherwise teach a client to send.
 */
describe('renderGateVerdict display text', () => {
  test('leaves a semantic report intact while rendering only ordinary verdict fields', () => {
    const evaluation: SemanticEvaluationReport = {
      binding: {
        gate_id: 'semantic-review',
        node_id: 'node-1',
        attempt_id: 'attempt-2',
        definition_digest: 'definition-digest',
        target_digest: 'target-digest',
      },
      observations: [
        {
          criterion_id: 'coverage',
          state: 'unmet',
          value: 2,
          evidence: [],
          rationale: 'Coverage is below the rubric threshold',
        },
      ],
    };
    const originalReport = structuredClone(evaluation);
    const submission: GateVerdictSubmission = {
      overall: 'FAIL',
      rationale: 'One criterion failed',
      per_gate: [{ index: 1, passed: false, rationale: 'Coverage is insufficient', evaluation }],
    };

    const rendered = renderGateVerdict(submission);

    expect(submission.per_gate?.[0]?.evaluation).toBe(evaluation);
    expect(evaluation).toEqual(originalReport);
    expect(rendered).toBe(
      'Verdict: FAIL - One criterion failed\nPer gate:\n[1] FAIL - Coverage is insufficient'
    );
  });

  test('renders the overall verdict alone when there are no entries', () => {
    expect(renderGateVerdict({ overall: 'PASS', rationale: 'fine' })).toBe('Verdict: PASS - fine');
    expect(renderGateVerdict({ overall: 'PASS', rationale: 'fine', per_gate: [] })).toBe(
      'Verdict: PASS - fine'
    );
  });

  test.each([1, 2, 5, 12, 40])('renders every entry of a %s-gate review, in order', (count) => {
    const per_gate = Array.from({ length: count }, (_, i) => ({
      index: i + 1,
      passed: i % 3 !== 0,
      rationale: `gate ${i + 1} rationale`,
    }));

    const lines = renderGateVerdict({ overall: 'FAIL', rationale: 'mixed', per_gate }).split('\n');

    expect(lines.slice(2)).toEqual(
      per_gate.map(
        (entry) => `[${entry.index}] ${entry.passed ? 'PASS' : 'FAIL'} - ${entry.rationale}`
      )
    );
  });

  test('never renders a line shaped like the retired string submission', () => {
    const rendered = renderGateVerdict({
      overall: 'PASS',
      rationale: 'fine',
      reminders: { satisfied: ['code-quality'], not_applicable: [] },
      per_gate: [{ index: 1, passed: true, rationale: 'suite green' }],
    });

    expect(rendered).not.toContain('GATE_REVIEW');
    expect(rendered).not.toContain('GATE_VERDICTS');
    expect(rendered).not.toContain('REMINDERS:');
    // Positive control: the same probe sees the verdict word it does render.
    expect(rendered).toContain('Verdict: PASS - fine');
  });
});

/**
 * The reminder attestation is the whole of what the reviewer says about reminder-tier gates, so
 * an n/a reason lost in display would read as though those gates were silently waved through.
 */
describe('renderGateVerdict reminders', () => {
  test('renders satisfied ids and n/a entries with their reasons, after the verdict', () => {
    const reminders: GateVerdictReminders = {
      satisfied: ['code-quality', 'prose-hygiene'],
      not_applicable: [{ id: 'pr-security', reason: 'no auth surface touched, no tokens' }],
    };

    expect(renderGateVerdict({ overall: 'PASS', rationale: 'all good', reminders })).toBe(
      'Verdict: PASS - all good\n' +
        'Reminders: satisfied=code-quality,prose-hygiene; n/a=pr-security(no auth surface touched, no tokens)'
    );
  });

  test('present-and-empty renders as none; an absent field renders nothing', () => {
    const empty: GateVerdictReminders = { satisfied: [], not_applicable: [] };

    expect(renderGateVerdict({ overall: 'PASS', rationale: 'ok', reminders: empty })).toContain(
      'Reminders: none'
    );
    expect(renderGateVerdict({ overall: 'PASS', rationale: 'ok' })).not.toContain('Reminders');
  });
});

describe('isGateVerdictSubmission', () => {
  test('distinguishes a submission from a string', () => {
    expect(isGateVerdictSubmission({ overall: 'PASS', rationale: 'x' })).toBe(true);
    expect(isGateVerdictSubmission('GATE_REVIEW: PASS - x')).toBe(false);
  });

  test('rejects nullish and non-object values', () => {
    expect(isGateVerdictSubmission(null)).toBe(false);
    expect(isGateVerdictSubmission(undefined)).toBe(false);
    expect(isGateVerdictSubmission(42)).toBe(false);
  });
});
