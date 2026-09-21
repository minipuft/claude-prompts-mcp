// @lifecycle test - Tier 1: the delegation handoff contract's pure functions.
import { describe, expect, test } from '@jest/globals';

import {
  HANDOFF_EVIDENCE_REASONS,
  HANDOFF_RESULT_HEADING,
  PROPOSED_GATE_REVIEW_TOKEN,
  buildHandoffResultSection,
  handoffNodeToken,
  parseHandoffTrailer,
  resolveHandoffEvidence,
  resolveHandoffEvidenceMode,
  resolveHandoffEvidenceReason,
} from '../../../../src/engine/execution/delegation/handoff-contract.js';

describe('resolveHandoffEvidenceMode', () => {
  // R3 (owner, 2026-09-08): `required` is the DEFAULT and `advisory` is the opt-out. This case
  // asserted the opposite through Tier 1 and is flipped here rather than deleted — the direction
  // of the default is the whole behavioural claim of Tier 2, and an absent case would let it
  // drift back with nothing failing.
  test('defaults to required when unconfigured', () => {
    expect(resolveHandoffEvidenceMode()).toBe('required');
    expect(resolveHandoffEvidenceMode(undefined)).toBe('required');
  });

  test('passes through an explicit configured mode', () => {
    expect(resolveHandoffEvidenceMode('required')).toBe('required');
    expect(resolveHandoffEvidenceMode('advisory')).toBe('advisory');
  });
});

describe('handoffNodeToken', () => {
  test('uses nodeId when the step carries one', () => {
    expect(handoffNodeToken({ nodeId: 'n7', stepNumber: 2 })).toBe('n7');
  });

  test('falls back to n<stepNumber> for a legacy chain with no node ids', () => {
    expect(handoffNodeToken({ stepNumber: 2 })).toBe('n2');
    expect(handoffNodeToken({ nodeId: undefined, stepNumber: 2 })).toBe('n2');
  });
});

describe('parseHandoffTrailer', () => {
  test('parses a full trailer: node, gate review, and findings', () => {
    const reply = [
      'work product body',
      '',
      '```',
      HANDOFF_RESULT_HEADING,
      'node: n2',
      PROPOSED_GATE_REVIEW_TOKEN,
      '- step-quality: PASS — evidence named',
      'findings: none observed',
      '```',
    ].join('\n');

    const trailer = parseHandoffTrailer(reply);
    expect(trailer.node).toBe('n2');
    expect(trailer.proposedGateReview).toContain(PROPOSED_GATE_REVIEW_TOKEN);
    expect(trailer.proposedGateReview).toContain('- step-quality: PASS — evidence named');
    expect(trailer.proposedGateReview).not.toContain('findings:');
    expect(trailer.findingsBlock).toBe('findings: none observed');
    expect(trailer.proposedGateReview).not.toContain('```');
  });

  test('heading-only trailer (no node line) parses all fields null', () => {
    const reply = ['work product', '', HANDOFF_RESULT_HEADING].join('\n');
    const trailer = parseHandoffTrailer(reply);
    expect(trailer.node).toBeNull();
    expect(trailer.proposedGateReview).toBeNull();
    expect(trailer.findingsBlock).toBeNull();
  });

  test('no heading at all parses all fields null', () => {
    const reply = 'plain prose reply with no trailer whatsoever';
    const trailer = parseHandoffTrailer(reply);
    expect(trailer.node).toBeNull();
    expect(trailer.proposedGateReview).toBeNull();
    expect(trailer.findingsBlock).toBeNull();
  });

  test('accepts a heading prefixed with markdown `#`s', () => {
    const reply = ['work product', '', `## ${HANDOFF_RESULT_HEADING}`, 'node: n3'].join('\n');
    const trailer = parseHandoffTrailer(reply);
    expect(trailer.node).toBe('n3');
  });

  test('uses the LAST matching heading when more than one appears', () => {
    const reply = [
      HANDOFF_RESULT_HEADING,
      'node: wrong-earlier-token',
      'some other prose in between',
      HANDOFF_RESULT_HEADING,
      'node: n9',
    ].join('\n');
    expect(parseHandoffTrailer(reply).node).toBe('n9');
  });
});

describe('resolveHandoffEvidence', () => {
  const base = { mode: 'required' as const, expectedToken: 'n2', reply: 'prose only, no trailer' };

  test('not delegated → ok regardless of mode or reply', () => {
    expect(resolveHandoffEvidence({ ...base, delegated: undefined })).toEqual({ kind: 'ok' });
    expect(resolveHandoffEvidence({ ...base, delegated: false })).toEqual({ kind: 'ok' });
  });

  test('advisory mode → ok even with prose-only reply', () => {
    expect(resolveHandoffEvidence({ ...base, delegated: true, mode: 'advisory' })).toEqual({
      kind: 'ok',
    });
  });

  test('required + no trailer → missing "trailer"', () => {
    expect(resolveHandoffEvidence({ ...base, delegated: true })).toEqual({
      kind: 'missing',
      expected: 'n2',
      missing: 'trailer',
      found: null,
    });
  });

  test('required + heading with no node line → missing "node-line"', () => {
    const reply = ['work product', '', HANDOFF_RESULT_HEADING].join('\n');
    expect(resolveHandoffEvidence({ ...base, delegated: true, reply })).toEqual({
      kind: 'missing',
      expected: 'n2',
      missing: 'node-line',
      found: null,
    });
  });

  test('required + wrong token → missing "node-mismatch" naming the found token', () => {
    const reply = ['work product', '', HANDOFF_RESULT_HEADING, 'node: n7'].join('\n');
    expect(resolveHandoffEvidence({ ...base, delegated: true, reply })).toEqual({
      kind: 'missing',
      expected: 'n2',
      missing: 'node-mismatch',
      found: 'n7',
    });
  });

  test('required + matching token → ok', () => {
    const reply = ['work product', '', HANDOFF_RESULT_HEADING, 'node: n2'].join('\n');
    expect(resolveHandoffEvidence({ ...base, delegated: true, reply })).toEqual({ kind: 'ok' });
  });
});

describe('buildHandoffResultSection', () => {
  test('contains the heading and the rendered token value', () => {
    const section = buildHandoffResultSection('n4', false);
    expect(section).toContain(HANDOFF_RESULT_HEADING);
    expect(section).toContain('node: n4');
  });

  test('gate lines render only when hasGates is true', () => {
    const gated = buildHandoffResultSection('n1', true);
    const ungated = buildHandoffResultSection('n1', false);
    expect(gated).toContain(PROPOSED_GATE_REVIEW_TOKEN);
    expect(gated).toContain('PROPOSED only');
    expect(ungated).not.toContain(PROPOSED_GATE_REVIEW_TOKEN);
    expect(ungated).not.toContain('PROPOSED only');
  });

  test('never renders a findings: line', () => {
    expect(buildHandoffResultSection('n1', true)).not.toContain('findings:');
    expect(buildHandoffResultSection('n1', false)).not.toContain('findings:');
  });

  test('keeps the worker-boundary wording', () => {
    const section = buildHandoffResultSection('n1', false);
    expect(section).toContain('Do not call `prompt_engine`');
    expect(section).toContain('the orchestrating agent owns the run');
  });
});

/**
 * The reason projection (row 2.2). These cases are the surviving half of the retired
 * `acknowledgment.test.ts`: the S8 boolean predicate answered "was the contracted block absent"
 * for a delegated+gated step and `undefined` for everything else, so a delegated step with no
 * gates and a step that was never delegated shared one answer. The reason keeps them apart —
 * `undefined` now means exactly "not delegated", and gate text is not consulted at all.
 */
describe('resolveHandoffEvidenceReason', () => {
  const GATED_CONTRACT_REPLY = [
    'work product body',
    '',
    '```',
    HANDOFF_RESULT_HEADING,
    'node: n2',
    PROPOSED_GATE_REVIEW_TOKEN,
    '- step-quality: PASS — evidence named',
    '```',
  ].join('\n');

  test('not delegated → undefined (the writer binds NULL)', () => {
    expect(
      resolveHandoffEvidenceReason({
        delegated: false,
        expectedToken: 'n2',
        reply: 'inline answer, no trailer',
      })
    ).toBeUndefined();
    expect(
      resolveHandoffEvidenceReason({
        delegated: undefined,
        expectedToken: 'n2',
        reply: 'inline answer, no trailer',
      })
    ).toBeUndefined();
  });

  test('delegated with NO gate text is still evaluable — the S8 boolean could not say this', () => {
    // The retired predicate returned `undefined` here because it looked for the gate-review
    // token, which an ungated brief never asks for. The reason reads the node line instead, so
    // an ungated delegated step is recorded like any other.
    expect(
      resolveHandoffEvidenceReason({
        delegated: true,
        expectedToken: 'n2',
        reply: 'worker output with no trailer at all',
      })
    ).toBe('trailer');
  });

  test('delegated + trailer naming this node → ok', () => {
    expect(
      resolveHandoffEvidenceReason({
        delegated: true,
        expectedToken: 'n2',
        reply: GATED_CONTRACT_REPLY,
      })
    ).toBe('ok');
  });

  test('delegated + heading with no node line → node-line', () => {
    expect(
      resolveHandoffEvidenceReason({
        delegated: true,
        expectedToken: 'n2',
        reply: ['work product', '', HANDOFF_RESULT_HEADING].join('\n'),
      })
    ).toBe('node-line');
  });

  test('delegated + trailer naming another node → node-mismatch', () => {
    expect(
      resolveHandoffEvidenceReason({
        delegated: true,
        expectedToken: 'n2',
        reply: ['work product', '', HANDOFF_RESULT_HEADING, 'node: n7'].join('\n'),
      })
    ).toBe('node-mismatch');
  });

  test('the emitted Result Contract satisfies its own reader', () => {
    // The brief's Result Contract is the emitter and this is the reader; pinning the two here
    // means a drift in either spelling fails by name rather than at a client.
    const contract = buildHandoffResultSection('step-review', true);
    expect(
      resolveHandoffEvidenceReason({
        delegated: true,
        expectedToken: 'step-review',
        reply: `worker output\n\n${contract}`,
      })
    ).toBe('ok');
  });

  test('every reason it can return is in the exported enumeration', () => {
    // HANDOFF_EVIDENCE_REASONS is what the sqlite CHECK constraint repeats, so a reason the
    // resolver produces but the list omits would be an INSERT the column rejects at runtime.
    const produced = [
      resolveHandoffEvidenceReason({ delegated: true, expectedToken: 'n2', reply: '' }),
      resolveHandoffEvidenceReason({
        delegated: true,
        expectedToken: 'n2',
        reply: HANDOFF_RESULT_HEADING,
      }),
      resolveHandoffEvidenceReason({
        delegated: true,
        expectedToken: 'n2',
        reply: `${HANDOFF_RESULT_HEADING}\nnode: n9`,
      }),
      resolveHandoffEvidenceReason({
        delegated: true,
        expectedToken: 'n2',
        reply: `${HANDOFF_RESULT_HEADING}\nnode: n2`,
      }),
    ];
    expect(new Set(produced)).toEqual(new Set(HANDOFF_EVIDENCE_REASONS));
    expect(HANDOFF_EVIDENCE_REASONS).toHaveLength(4);
  });

  test('the reason and the refusal are one classification', () => {
    // resolveHandoffEvidence is the refusal projection of the same classifier: whatever reason
    // is recorded under `advisory` is exactly what `required` would have refused on.
    for (const reply of [
      'prose only',
      HANDOFF_RESULT_HEADING,
      `${HANDOFF_RESULT_HEADING}\nnode: n9`,
    ]) {
      const reason = resolveHandoffEvidenceReason({
        delegated: true,
        expectedToken: 'n2',
        reply,
      });
      const evidence = resolveHandoffEvidence({
        delegated: true,
        mode: 'required',
        expectedToken: 'n2',
        reply,
      });
      expect(evidence.kind).toBe('missing');
      expect(evidence.kind === 'missing' ? evidence.missing : null).toBe(reason);
    }
  });
});
