// @lifecycle canonical - Pins the auto-clear rule moved out of GateReviewStage in Tier 13.
import { describe, expect, test } from '@jest/globals';

import { resolveGroundTruthCoverage } from '../../../../../src/engine/execution/pipeline/decisions/gates/ground-truth-coverage.js';

const pass = (gateId: string) => ({ gateId, passed: true });
const fail = (gateId: string) => ({ gateId, passed: false });

/**
 * This decides whether a pending gate review is cleared without any LLM evaluation, so the
 * cases that matter most are the ones where it must refuse. A false `satisfied` costs one
 * redundant review; a false `true` marks unverified gates as passed and lets the chain
 * advance past them.
 */
describe('resolveGroundTruthCoverage', () => {
  test('clears the review when every required gate passed', () => {
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['tests', 'lint'],
      results: [pass('tests'), pass('lint')],
    });

    expect(coverage.satisfied).toBe(true);
    expect(coverage.verifiedGateIds).toEqual(['tests', 'lint']);
  });

  test('refuses when a required gate ran nothing — a passing sibling does not speak for it', () => {
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['tests', 'code-quality'],
      results: [pass('tests')],
    });

    expect(coverage.satisfied).toBe(false);
    expect(coverage.reason).toContain('code-quality');
  });

  test('refuses when any verification failed, even if coverage is complete', () => {
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['tests', 'lint'],
      results: [pass('tests'), fail('lint')],
    });

    expect(coverage.satisfied).toBe(false);
    expect(coverage.reason).toContain('lint');
  });

  test('refuses when no shell_verify criteria ran at all', () => {
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['tests'],
      results: [],
    });

    expect(coverage.satisfied).toBe(false);
    expect(coverage.verifiedGateIds).toEqual([]);
  });

  test('counts a gate an earlier stage already verified in this request', () => {
    // ShellVerificationStage (17) writes state.gates.shellVerifyPassedForGates; the review
    // stage passes it through so a gate verified there is not re-run here to be honoured.
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['tests', 'test-suite'],
      results: [pass('tests')],
      priorVerifiedGateIds: ['test-suite'],
    });

    expect(coverage.satisfied).toBe(true);
    expect(coverage.verifiedGateIds).toEqual(['tests', 'test-suite']);
  });

  test('prior verification alone does not clear a review with no results this run', () => {
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['test-suite'],
      results: [],
      priorVerifiedGateIds: ['test-suite'],
    });

    expect(coverage.satisfied).toBe(false);
    expect(coverage.verifiedGateIds).toEqual(['test-suite']);
  });

  test('deduplicates gates that produced several results', () => {
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['tests'],
      results: [pass('tests'), pass('tests')],
      priorVerifiedGateIds: ['tests'],
    });

    expect(coverage.satisfied).toBe(true);
    expect(coverage.verifiedGateIds).toEqual(['tests']);
  });

  test('reports every failing gate once, not once per result', () => {
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['tests'],
      results: [fail('tests'), fail('tests')],
    });

    expect(coverage.reason).toBe('Ground-truth verification failed for tests');
  });

  test('an empty requirement list is vacuously covered once something passed', () => {
    // Unreachable from GateReviewStage, which only runs verifications when the pending
    // review has gate ids. Pinned so the vacuous-truth edge is a decision, not an accident.
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: [],
      results: [pass('tests')],
    });

    expect(coverage.satisfied).toBe(true);
  });
});
