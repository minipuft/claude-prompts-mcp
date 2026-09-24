// @lifecycle canonical - Pins which review a verdict, report or gate_action addresses.
import { describe, expect, test } from '@jest/globals';

import { resolveReviewTarget } from '../../../../../src/engine/execution/pipeline/decisions/gates/review-target.js';

import type {
  GateReview,
  GateReviewKind,
} from '../../../../../src/shared/types/chain-execution.js';

const review = (nodeId: string, kind: GateReviewKind): GateReview => ({
  nodeId,
  kind,
  phase: 'awaiting-verdict',
  combinedPrompt: '',
  gateIds: ['g1'],
  prompts: [],
  createdAt: 1,
  attemptCount: 0,
  maxAttempts: 3,
});

const NODES = ['n1', 'n2', 'n3'];

describe('resolveReviewTarget', () => {
  test('a trailer naming a node with a review addresses that review, even off the current node', () => {
    expect(
      resolveReviewTarget({
        reviews: { n1: review('n1', 'detached'), n3: review('n3', 'gate') },
        currentNodeId: 'n3',
        nodeIds: NODES,
        trailerNodeId: 'n1',
      })
    ).toEqual({ kind: 'review', nodeId: 'n1' });
  });

  test('a trailer naming a node the run does not have is refused as unknown-node', () => {
    expect(
      resolveReviewTarget({
        reviews: { n3: review('n3', 'gate') },
        currentNodeId: 'n3',
        nodeIds: NODES,
        trailerNodeId: 'n9',
      })
    ).toEqual({ kind: 'refuse', reason: 'unknown-node' });
  });

  test('a trailer naming a real node with no review is refused as no-review, not redirected', () => {
    expect(
      resolveReviewTarget({
        reviews: { n3: review('n3', 'gate') },
        currentNodeId: 'n3',
        nodeIds: NODES,
        trailerNodeId: 'n2',
      })
    ).toEqual({ kind: 'refuse', reason: 'no-review' });
  });

  test("without a trailer, the current node's review", () => {
    expect(
      resolveReviewTarget({
        reviews: { n2: review('n2', 'gate') },
        currentNodeId: 'n2',
        nodeIds: NODES,
      })
    ).toEqual({ kind: 'review', nodeId: 'n2' });
  });

  test('a review opened on N while the run stands on N+1 is addressed on N', () => {
    expect(
      resolveReviewTarget({
        reviews: { n1: review('n1', 'structural') },
        currentNodeId: 'n2',
        nodeIds: NODES,
      })
    ).toEqual({ kind: 'review', nodeId: 'n1' });
  });

  test('a final-step review is addressed after the run walked past its last node', () => {
    expect(
      resolveReviewTarget({
        reviews: { n3: review('n3', 'gate') },
        currentNodeId: null,
        nodeIds: NODES,
      })
    ).toEqual({ kind: 'review', nodeId: 'n3' });
  });

  test('without a trailer, a detached review is never addressed — only its trailer answers it', () => {
    expect(
      resolveReviewTarget({
        reviews: { n2: review('n2', 'detached') },
        currentNodeId: 'n2',
        nodeIds: NODES,
      })
    ).toEqual({ kind: 'refuse', reason: 'no-review' });
    // with a step review beside it, the step review is the one addressed
    expect(
      resolveReviewTarget({
        reviews: { n2: review('n2', 'detached'), n1: review('n1', 'gate') },
        currentNodeId: 'n2',
        nodeIds: NODES,
      })
    ).toEqual({ kind: 'review', nodeId: 'n1' });
  });

  test('no review anywhere is refused as no-review', () => {
    expect(resolveReviewTarget({ reviews: {}, currentNodeId: 'n1', nodeIds: NODES })).toEqual({
      kind: 'refuse',
      reason: 'no-review',
    });
  });

  test('two open step reviews and none on the current node are refused as ambiguous, naming both', () => {
    expect(
      resolveReviewTarget({
        reviews: { n1: review('n1', 'gate'), n2: review('n2', 'structural') },
        currentNodeId: 'n3',
        nodeIds: NODES,
      })
    ).toEqual({ kind: 'refuse', reason: 'ambiguous', nodeIds: ['n1', 'n2'] });
  });

  test('CONTROL: the same two reviews, addressed by a trailer, resolve to the named node', () => {
    expect(
      resolveReviewTarget({
        reviews: { n1: review('n1', 'gate'), n2: review('n2', 'structural') },
        currentNodeId: 'n3',
        nodeIds: NODES,
        trailerNodeId: 'n2',
      })
    ).toEqual({ kind: 'review', nodeId: 'n2' });
  });
});
