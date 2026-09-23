// @lifecycle canonical - Pins which open review a structural failure joins (R103 / P4.156).
import { describe, expect, test } from '@jest/globals';

import { composeStructuralReview } from '../../../../../src/engine/execution/pipeline/decisions/gates/structural-review-composition.js';
import { UNKNOWN_INTERRUPT_GATE_ID } from '../../../../../src/engine/execution/pipeline/decisions/mutation/types.js';

import type { PendingGateReview } from '../../../../../src/shared/types/chain-execution.js';

const STRUCTURAL = '__phase_guard__';

const finding = (reviewedStep: { stepNumber: number; nodeId: string } | Record<string, never>) => ({
  gateId: STRUCTURAL,
  feedback: 'Add the missing sections.',
  retryHints: ['Ensure your response includes the required "## Context" section'],
  failedPhases: ['context'],
  mode: 'enforce',
  previousResponse: 'one line',
  reviewedStep,
  maxAttempts: 3,
  createdAt: 42,
});

const gateReview = (
  metadata: Record<string, unknown>,
  gateIds = ['my-gate']
): PendingGateReview => ({
  combinedPrompt: 'gate instructions',
  gateIds,
  prompts: [{ gateId: 'my-gate', gateName: 'My gate' } as PendingGateReview['prompts'][number]],
  createdAt: 1,
  attemptCount: 2,
  maxAttempts: 5,
  retryHints: [],
  history: [],
  metadata,
});

const STEP_1 = { stepNumber: 1, nodeId: 'n1' };

describe('composeStructuralReview', () => {
  test('joins a gate review of the graded step, keeping its budget and spent attempts', () => {
    const open = gateReview({ stepNumber: 1 });
    const review = composeStructuralReview(open, finding(STEP_1));

    expect(review.gateIds).toEqual(['my-gate', STRUCTURAL]);
    expect(review.maxAttempts).toBe(5);
    expect(review.attemptCount).toBe(2);
    expect(review.prompts).toBe(open.prompts);
    expect(review.combinedPrompt).toBe('gate instructions\n\n---\n\nAdd the missing sections.');
    expect(review.metadata).toEqual({
      stepNumber: 1,
      nodeId: 'n1',
      failedPhases: ['context'],
      mode: 'enforce',
    });
    // The open review is not mutated: the store owns it until the stage persists the result.
    expect(open.gateIds).toEqual(['my-gate']);
  });

  test('with no review open, opens the structural review on its own budget', () => {
    const review = composeStructuralReview(undefined, finding(STEP_1));

    expect(review.gateIds).toEqual([STRUCTURAL]);
    expect(review.maxAttempts).toBe(3);
    expect(review.attemptCount).toBe(0);
    expect(review.metadata?.['source']).toBe('phase-guard-verification');
  });

  test('a review of a DIFFERENT step is not joined; the node-id twin of the same step is', () => {
    expect(composeStructuralReview(gateReview({ stepNumber: 2 }), finding(STEP_1)).gateIds).toEqual(
      [STRUCTURAL]
    );
    expect(composeStructuralReview(gateReview({ nodeId: 'n2' }), finding(STEP_1)).gateIds).toEqual([
      STRUCTURAL,
    ]);
    // CONTROL: the same review naming the graded node is joined.
    expect(composeStructuralReview(gateReview({ nodeId: 'n1' }), finding(STEP_1)).gateIds).toEqual([
      'my-gate',
      STRUCTURAL,
    ]);
  });

  test('a call that captured no step joins the review that is open', () => {
    expect(composeStructuralReview(gateReview({ stepNumber: 2 }), finding({})).gateIds).toEqual([
      'my-gate',
      STRUCTURAL,
    ]);
  });

  test('an unknown-interrupt hold is never joined', () => {
    const hold = gateReview({ stepNumber: 1 }, [UNKNOWN_INTERRUPT_GATE_ID]);
    expect(composeStructuralReview(hold, finding(STEP_1)).gateIds).toEqual([STRUCTURAL]);
  });
});
