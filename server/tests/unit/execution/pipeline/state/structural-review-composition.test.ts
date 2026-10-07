// @lifecycle canonical - Pins which open review a structural failure joins (R103 / P4.156).
import { describe, expect, test } from '@jest/globals';

import {
  composeStructuralReview,
  hasStructuralFinding,
  PHASE_GUARD_GATE_ID,
  selectToolReviewGateIds,
  withoutStructuralFinding,
} from '../../../../../src/engine/execution/pipeline/decisions/gates/structural-review-composition.js';
import { UNKNOWN_INTERRUPT_GATE_ID } from '../../../../../src/engine/execution/pipeline/decisions/mutation/types.js';
import { PHASE_GUARD_GATE_ID as STAGE_STRUCTURAL_ID } from '../../../../../src/engine/execution/pipeline/stages/19-phase-guard-verification-stage.js';
import { GateDefinitionSchema } from '../../../../../src/engine/gates/core/gate-schema.js';

import type {
  GateReview,
  PendingGateReview,
  GateReviewDefinitionSnapshot,
} from '../../../../../src/shared/types/chain-execution.js';

const STRUCTURAL = PHASE_GUARD_GATE_ID;

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

function authoredCollision(): PendingGateReview {
  // The public schema permits this authored id: the collision is not merely a fabricated label.
  const definition = GateDefinitionSchema.parse({
    id: STRUCTURAL,
    name: 'Authored collision',
    type: 'validation',
    description: 'Public fixture',
    pass_criteria: [{ type: 'shell_verify', shell_command: ['node', 'check.js'] }],
  }) as GateReviewDefinitionSnapshot['definition'];
  return {
    ...gateReview({ nodeId: 'n1', source: 'worker-report' }, [STRUCTURAL]),
    kind: 'detached',
    semanticContext: {
      nodeId: 'n1',
      attemptId: 'attempt-1',
      definitions: { [STRUCTURAL]: { definition, definitionDigest: 'frozen-public-digest' } },
    },
  };
}

function identified(review: PendingGateReview): GateReview {
  return { ...review, nodeId: 'n1', kind: 'detached', phase: 'awaiting-verdict' };
}

describe('composeStructuralReview', () => {
  test('joins a gate review of the graded step, keeping its budget and spent attempts', () => {
    const open = gateReview({ stepNumber: 1 });
    const review = composeStructuralReview(open, finding(STEP_1));

    expect(review.gateIds).toEqual(['my-gate', STRUCTURAL]);
    expect(review.structuralGateIds).toEqual([STRUCTURAL]);
    expect(selectToolReviewGateIds(review)).toEqual(['my-gate']);
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
    expect(review.structuralGateIds).toEqual([STRUCTURAL]);
    expect(selectToolReviewGateIds(review)).toEqual([]);
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

  test('Stage19 reexports the composition owner binding', () => {
    expect(STRUCTURAL).toBe('__phase_guard__');
    expect(STAGE_STRUCTURAL_ID).toBe(STRUCTURAL);
  });

  test('merged detached review keeps identity/source and its full hold while selecting tool work', () => {
    const open = identified(gateReview({ nodeId: 'n1', source: 'worker-report' }));
    const review = composeStructuralReview(open, finding(STEP_1));
    const before = JSON.stringify(review);
    expect(review.kind).toBe('detached');
    expect(review.metadata?.['source']).toBe('worker-report');
    expect(review.history).toBe(open.history);
    expect(review.structuralGateIds).toEqual([STRUCTURAL]);
    expect(selectToolReviewGateIds(review)).toEqual(['my-gate']);
    expect(review.gateIds).toEqual(['my-gate', STRUCTURAL]);
    expect(review.retryHints).toEqual(finding(STEP_1).retryHints);
    expect(JSON.stringify(review)).toBe(before);
  });

  test.each(['unknown-gate', '__phase_guard__suffix', UNKNOWN_INTERRUPT_GATE_ID])(
    'an unknown finding %s mints no trusted structural exception',
    (gateId) => {
      const review = composeStructuralReview(undefined, { ...finding(STEP_1), gateId });
      expect(review.structuralGateIds).toEqual([]);
      expect(selectToolReviewGateIds(review)).toEqual([gateId]);
    }
  );

  test('kind/source labels and unknown/prefix markers cannot exclude ordinary or legacy gate ids', () => {
    const ids = ['my-gate', STRUCTURAL, '__phase_guard__suffix', UNKNOWN_INTERRUPT_GATE_ID];
    const legacy = {
      ...gateReview({ source: 'phase-guard-verification' }, ids),
      kind: 'structural' as const,
    };
    expect(selectToolReviewGateIds(legacy)).toEqual(ids);
    expect(
      selectToolReviewGateIds({
        ...legacy,
        structuralGateIds: ['__phase_guard__suffix', UNKNOWN_INTERRUPT_GATE_ID],
      })
    ).toEqual(ids);
    const minted = composeStructuralReview(
      gateReview({ nodeId: 'n1' }, ['my-gate', '__phase_guard__suffix']),
      finding(STEP_1)
    );
    expect(selectToolReviewGateIds(minted)).toEqual(['my-gate', '__phase_guard__suffix']);
    expect(minted.gateIds).toContain(STRUCTURAL);
  });

  test('compose preserves an authored canonical-ID snapshot and selector keeps its tool requirement', () => {
    const open = authoredCollision();
    const review = composeStructuralReview(open, finding(STEP_1));
    expect(review.gateIds).toEqual([STRUCTURAL]);
    expect(review.structuralGateIds).toEqual([STRUCTURAL]);
    expect(review.semanticContext).toBe(open.semanticContext);
    expect(review.prompts).toBe(open.prompts);
    expect(review.history).toBe(open.history);
    expect(review.maxAttempts).toBe(5);
    expect(review.attemptCount).toBe(2);
    expect(review.metadata?.['source']).toBe('worker-report');
    expect(selectToolReviewGateIds(review)).toEqual([STRUCTURAL]);
    expect(open.structuralGateIds).toBeUndefined();
  });

  test('a structural review without an authored definition still opens fresh on repeated finding', () => {
    const open = composeStructuralReview(undefined, finding(STEP_1));
    expect(
      composeStructuralReview({ ...open, attemptCount: 2 }, finding(STEP_1)).attemptCount
    ).toBe(0);
  });

  test('an own snapshot key with a different definition id confers no authored collision authority', () => {
    const open = authoredCollision();
    const mismatched = {
      ...open,
      semanticContext: {
        ...open.semanticContext!,
        definitions: {
          [STRUCTURAL]: { definition: { id: 'different-gate' }, definitionDigest: 'digest' },
        },
      },
    };
    const review = composeStructuralReview(mismatched, finding(STEP_1));
    expect(review.attemptCount).toBe(0);
    expect(selectToolReviewGateIds(review)).toEqual([]);
    const stripped = withoutStructuralFinding(
      identified({ ...mismatched, structuralGateIds: [STRUCTURAL] })
    );
    expect(stripped.gateIds).toEqual([]);
  });

  test('plain structural compose/select/strip preserves the hold until its structural grade is removed', () => {
    const review = identified(composeStructuralReview(undefined, finding(STEP_1)));
    expect(review.gateIds).toEqual([STRUCTURAL]);
    expect(selectToolReviewGateIds(review)).toEqual([]);
    expect(review.gateIds).toEqual([STRUCTURAL]);
    const stripped = withoutStructuralFinding(review);
    expect(stripped.gateIds).toEqual([]);
    expect(stripped.structuralGateIds).toEqual([]);
    expect(stripped.retryHints).toEqual([]);
    expect(stripped.metadata).toEqual({ nodeId: 'n1', stepNumber: 1 });
    expect(selectToolReviewGateIds(stripped)).toEqual([]);
  });

  test('stripping a synthetic finding clears membership, hints and phase metadata without mutating the review', () => {
    const review = identified(
      composeStructuralReview(
        gateReview({ nodeId: 'n1', source: 'worker-report' }),
        finding(STEP_1)
      )
    );
    const before = JSON.stringify(review);
    const stripped = withoutStructuralFinding(review);
    expect(stripped.gateIds).toEqual(['my-gate']);
    expect(stripped.structuralGateIds).toEqual([]);
    expect(stripped.combinedPrompt).toBe('');
    expect(stripped.retryHints).toEqual([]);
    expect(stripped.metadata).toEqual({ nodeId: 'n1', stepNumber: 1, source: 'worker-report' });
    expect(stripped.prompts).toBe(review.prompts);
    expect(stripped.history).toBe(review.history);
    expect(stripped.attemptCount).toBe(review.attemptCount);
    expect(selectToolReviewGateIds(stripped)).toEqual(['my-gate']);
    expect(JSON.stringify(review)).toBe(before);
  });

  test('stripping an authored collision clears only structural membership and retains the authored id/authority', () => {
    const review = identified(composeStructuralReview(authoredCollision(), finding(STEP_1)));
    const stripped = withoutStructuralFinding(review);
    expect(stripped.structuralGateIds).toEqual([]);
    expect(stripped.gateIds).toEqual([STRUCTURAL]);
    expect(stripped.semanticContext).toBe(review.semanticContext);
    expect(stripped.metadata?.['source']).toBe('worker-report');
    expect(stripped.retryHints).toEqual([]);
    expect(stripped.metadata).not.toHaveProperty('failedPhases');
    expect(selectToolReviewGateIds(stripped)).toEqual([STRUCTURAL]);
  });

  test('strip is inert for an unrelated review', () => {
    const review = identified(gateReview({ source: 'worker-report' }));
    expect(withoutStructuralFinding(review)).toBe(review);
  });

  test('strip is inert for an unmarked authored collision, retaining all original review fields', () => {
    const review = identified(authoredCollision());
    expect(hasStructuralFinding(review)).toBe(false);
    expect(withoutStructuralFinding(review)).toBe(review);
    expect(selectToolReviewGateIds(review)).toEqual([STRUCTURAL]);
  });

  test('structural membership requires the canonical id; legacy fallback requires both authority fields absent', () => {
    const legacy = gateReview({ source: 'other-source' }, [STRUCTURAL]);
    expect(hasStructuralFinding(legacy)).toBe(true);
    expect(hasStructuralFinding({ ...legacy, structuralGateIds: [] })).toBe(false);
    expect(hasStructuralFinding(authoredCollision())).toBe(false);
    const marked = composeStructuralReview(authoredCollision(), finding(STEP_1));
    expect(hasStructuralFinding(marked)).toBe(true);
    expect(hasStructuralFinding({ ...marked, gateIds: ['my-gate'] })).toBe(false);
    expect(hasStructuralFinding(undefined)).toBe(false);
  });
});
