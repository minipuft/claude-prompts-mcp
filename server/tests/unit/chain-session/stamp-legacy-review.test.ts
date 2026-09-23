/**
 * Row 3.6: a review's own `phase` is the one phase channel. `stampLegacyReview` reads a
 * `metadata.phase` only for a review persisted before `phase` existed (row 4.8's detached map,
 * reached through `run-registry`'s legacy load); no writer sets that key any more.
 */
import { describe, expect, test } from '@jest/globals';

import { stampLegacyReview } from '../../../src/shared/types/chain-session.js';

import type { PendingGateReview } from '../../../src/shared/types/chain-execution.js';

const run = { state: { currentNodeId: 'n1' }, executionOrder: [] };

const review = (overrides: Partial<PendingGateReview> = {}): PendingGateReview => ({
  combinedPrompt: '',
  gateIds: ['g'],
  prompts: [],
  createdAt: 0,
  attemptCount: 1,
  maxAttempts: 3,
  ...overrides,
});

describe('stampLegacyReview phase', () => {
  test("the record's own phase beats a metadata.phase that disagrees with it", () => {
    const stamped = stampLegacyReview(
      review({ phase: 'exhausted', metadata: { phase: 'awaiting-verdict' } }),
      run,
      { nodeId: 'late' }
    );
    expect(stamped.phase).toBe('exhausted');
  });

  test('CONTROL: a pre-phase detached review still loads the phase its metadata recorded', () => {
    const stamped = stampLegacyReview(
      review({ metadata: { phase: 'awaiting-replacement' } }),
      run,
      { nodeId: 'late' }
    );
    expect(stamped.phase).toBe('awaiting-replacement');
  });

  test('with neither, the attempts decide', () => {
    expect(stampLegacyReview(review(), run).phase).toBe('awaiting-verdict');
    expect(stampLegacyReview(review({ attemptCount: 3 }), run).phase).toBe('exhausted');
  });
});
