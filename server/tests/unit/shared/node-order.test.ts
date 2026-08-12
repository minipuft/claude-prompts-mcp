// @lifecycle canonical - Pure node-identity + ordinal-math coverage (P3 Tier 1, step-identity plan).
import { describe, expect, it } from '@jest/globals';

import {
  isTerminal,
  mintInsertionId,
  mintNodeIds,
  mintSequentialIds,
  nextAfter,
  ordinalOf,
  totalOf,
} from '../../../src/shared/utils/node-order.js';

import type { ChainNode } from '../../../src/shared/types/chain-execution.js';

describe('node-order', () => {
  describe('mintNodeIds', () => {
    it('is deterministic: the same input always mints the same output', () => {
      const steps = [{ stepName: 'Prepare Data' }, { stepName: 'Review Output' }];
      expect(mintNodeIds(steps)).toEqual(mintNodeIds(steps));
      expect(mintNodeIds(steps)).toEqual(['prepare-data', 'review-output']);
    });

    it('honors an explicit id over the stepName slug', () => {
      const steps = [
        { id: 'custom-id', stepName: 'This Name Would Slug Differently' },
        { stepName: 'Second Step' },
      ];
      expect(mintNodeIds(steps)).toEqual(['custom-id', 'second-step']);
    });

    it('deduplicates colliding slugs deterministically in step order', () => {
      const steps = [
        { stepName: 'Do Thing' },
        { stepName: 'Do Thing' },
        { stepName: 'do   thing' }, // same slug via different punctuation/whitespace
      ];
      const ids = mintNodeIds(steps);
      expect(ids).toEqual(['do-thing', 'do-thing-2', 'do-thing-3']);
      // Falsification target: uniqueness must hold even though all three stepNames slug identically.
      expect(new Set(ids).size).toBe(3);
    });

    it('deduplicates a collision between an explicit id and a later slug', () => {
      const steps = [
        { id: 'review', stepName: 'Something Else' },
        { stepName: 'Review' }, // slugs to 'review', collides with the explicit id above
      ];
      expect(mintNodeIds(steps)).toEqual(['review', 'review-2']);
    });

    it('collapses non-alphanumeric runs to a single hyphen and trims edges', () => {
      expect(mintNodeIds([{ stepName: '  --Weird!!  Name__ Here--  ' }])).toEqual([
        'weird-name-here',
      ]);
    });

    it('mints an empty array for an empty step list', () => {
      expect(mintNodeIds([])).toEqual([]);
    });
  });

  describe('mintSequentialIds', () => {
    it('mints n1..nK in order', () => {
      expect(mintSequentialIds(3)).toEqual(['n1', 'n2', 'n3']);
    });

    it('mints a single-node id for count 1', () => {
      expect(mintSequentialIds(1)).toEqual(['n1']);
    });

    it('mints an empty array for count 0', () => {
      expect(mintSequentialIds(0)).toEqual([]);
    });
  });

  describe('mintInsertionId (P4)', () => {
    it('fresh: returns the bare slugified base when it is not already taken', () => {
      expect(mintInsertionId('Investigate Cache TTL', ['n1', 'n2', 'n3'])).toBe(
        'investigate-cache-ttl'
      );
    });

    it('collision: appends -2 when the slugified base is already an existing id', () => {
      expect(mintInsertionId('investigate-cache-ttl', ['investigate-cache-ttl', 'n2'])).toBe(
        'investigate-cache-ttl-2'
      );
    });

    it('double-collision: appends -3 when both the base and -2 are already taken', () => {
      expect(
        mintInsertionId('investigate-cache-ttl', [
          'investigate-cache-ttl',
          'investigate-cache-ttl-2',
          'n2',
        ])
      ).toBe('investigate-cache-ttl-3');
    });

    it('never renumbers the existing ids it was given — only the candidate changes', () => {
      const existingIds = ['investigate-cache-ttl', 'investigate-cache-ttl-2', 'n2'];
      const before = [...existingIds];
      mintInsertionId('investigate-cache-ttl', existingIds);
      expect(existingIds).toEqual(before);
    });
  });

  describe('ordinal math', () => {
    const nodes: ChainNode[] = [
      { id: 'a', promptId: 'p-a', stepName: 'A' },
      { id: 'b', promptId: 'p-b', stepName: 'B' },
      { id: 'c', promptId: 'p-c', stepName: 'C' },
    ];
    const single: ChainNode[] = [{ id: 'only', promptId: 'p-only', stepName: 'Only' }];

    describe('ordinalOf', () => {
      it('returns the 1-based position of a present node', () => {
        expect(ordinalOf(nodes, 'a')).toBe(1);
        expect(ordinalOf(nodes, 'b')).toBe(2);
        expect(ordinalOf(nodes, 'c')).toBe(3);
      });

      it('returns -1 for an absent node id', () => {
        expect(ordinalOf(nodes, 'missing')).toBe(-1);
      });

      it('accepts a plain string[] as well as ChainNode[]', () => {
        expect(ordinalOf(['a', 'b', 'c'], 'b')).toBe(2);
      });

      it('single-node chain: the only node is ordinal 1', () => {
        expect(ordinalOf(single, 'only')).toBe(1);
      });
    });

    describe('totalOf', () => {
      it('counts all nodes', () => {
        expect(totalOf(nodes)).toBe(3);
      });

      it('counts zero for an empty chain', () => {
        expect(totalOf([])).toBe(0);
      });

      it('counts one for a single-node chain', () => {
        expect(totalOf(single)).toBe(1);
      });
    });

    describe('nextAfter', () => {
      it('returns the following node id for a non-terminal node', () => {
        expect(nextAfter(nodes, 'a')).toBe('b');
        expect(nextAfter(nodes, 'b')).toBe('c');
      });

      it('returns null for the terminal node', () => {
        expect(nextAfter(nodes, 'c')).toBeNull();
      });

      it('returns null for an absent node id', () => {
        expect(nextAfter(nodes, 'missing')).toBeNull();
      });

      it('returns null for the only node in a single-node chain', () => {
        expect(nextAfter(single, 'only')).toBeNull();
      });
    });

    describe('isTerminal', () => {
      it('is true only for the last node', () => {
        expect(isTerminal(nodes, 'a')).toBe(false);
        expect(isTerminal(nodes, 'b')).toBe(false);
        expect(isTerminal(nodes, 'c')).toBe(true);
      });

      it('is false for an absent node id — absence is distinct from terminal-ness', () => {
        expect(isTerminal(nodes, 'missing')).toBe(false);
      });

      it('is true for the only node in a single-node chain', () => {
        expect(isTerminal(single, 'only')).toBe(true);
      });
    });
  });
});
