// @lifecycle test - S8: delegation acknowledgment predicate (presence / absence / not-evaluable).
import { describe, expect, test } from '@jest/globals';

import {
  PROPOSED_GATE_REVIEW_TOKEN,
  buildResultContractSection,
} from '../../../../src/engine/execution/delegation/brief.js';
import { resolveDelegationSkipped } from '../../../../src/engine/execution/delegation/acknowledgment.js';

const GATE_TEXT = '## Quality Gates\n\n- step-quality: output must name its evidence';

describe('resolveDelegationSkipped (S8 acknowledgment predicate)', () => {
  describe('not evaluable → undefined (callers bind NULL)', () => {
    test('non-delegated step, even with gate text and no token', () => {
      expect(
        resolveDelegationSkipped({
          delegated: false,
          stepGateText: GATE_TEXT,
          capturedResponse: 'inline answer, no review block',
        })
      ).toBeUndefined();
    });

    test('delegated flag absent (undefined) reads as non-delegated', () => {
      expect(
        resolveDelegationSkipped({
          delegated: undefined,
          stepGateText: GATE_TEXT,
          capturedResponse: 'inline answer',
        })
      ).toBeUndefined();
    });

    test('delegated step with NO gate text — acknowledgment structurally unobservable', () => {
      expect(
        resolveDelegationSkipped({
          delegated: true,
          stepGateText: undefined,
          capturedResponse: 'worker output without any review block',
        })
      ).toBeUndefined();
    });

    test('delegated step with whitespace-only gate text reads as ungated', () => {
      expect(
        resolveDelegationSkipped({
          delegated: true,
          stepGateText: '   \n  ',
          capturedResponse: 'worker output',
        })
      ).toBeUndefined();
    });
  });

  describe('evaluable: delegated + gated', () => {
    test('token ABSENT → true (delegation skipped)', () => {
      expect(
        resolveDelegationSkipped({
          delegated: true,
          stepGateText: GATE_TEXT,
          capturedResponse: 'the parent answered inline and never spawned a worker',
        })
      ).toBe(true);
    });

    test('token PRESENT → false (acknowledged)', () => {
      expect(
        resolveDelegationSkipped({
          delegated: true,
          stepGateText: GATE_TEXT,
          capturedResponse: [
            'work product body',
            '',
            `${PROPOSED_GATE_REVIEW_TOKEN}`,
            '- step-quality: PASS — evidence named',
          ].join('\n'),
        })
      ).toBe(false);
    });

    test('detects the exact token the Result Contract instructs a worker to emit', () => {
      // The brief's Result Contract is the emitter; the predicate is the detector. This pins
      // the two to one spelling — if the contract's token drifts, this fails by name.
      const contract = buildResultContractSection(true);
      expect(contract).toContain(PROPOSED_GATE_REVIEW_TOKEN);
      expect(
        resolveDelegationSkipped({
          delegated: true,
          stepGateText: GATE_TEXT,
          capturedResponse: `output\n\n${contract}`,
        })
      ).toBe(false);
    });
  });
});
