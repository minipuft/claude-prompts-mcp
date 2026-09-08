// @lifecycle test - Tier 1: the delegation handoff contract's pure functions.
import { describe, expect, test } from '@jest/globals';

import {
  HANDOFF_RESULT_HEADING,
  PROPOSED_GATE_REVIEW_TOKEN,
  buildHandoffResultSection,
  handoffNodeToken,
  parseHandoffTrailer,
  resolveHandoffEvidence,
  resolveHandoffEvidenceMode,
} from '../../../../src/engine/execution/delegation/handoff-contract.js';

describe('resolveHandoffEvidenceMode', () => {
  test('defaults to advisory when unconfigured', () => {
    expect(resolveHandoffEvidenceMode()).toBe('advisory');
    expect(resolveHandoffEvidenceMode(undefined)).toBe('advisory');
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
