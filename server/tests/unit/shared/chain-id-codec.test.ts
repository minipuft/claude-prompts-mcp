// @lifecycle canonical - Pins the chain run-identifier format after the Tier 11 consolidation.
import { describe, expect, it } from '@jest/globals';

import {
  CHAIN_ID_PATTERN,
  formatChainId,
  isChainId,
  nextRunNumber,
  parseRunNumber,
  stripRunNumber,
} from '../../../src/shared/utils/chain-id-codec.js';

/**
 * Tier 11 replaced four private copies of this format — two in
 * `13-session-stage.ts`, two in `modules/chains/manager.ts` — with one module. The
 * copies were byte-identical, so the refactor is a substitution and these cases encode
 * what they did, not a new contract. They exist so the next edit to the format has to
 * state which of these it means to change.
 */
describe('chain-id-codec', () => {
  describe('stripRunNumber', () => {
    it('removes a run suffix and leaves a bare base id alone', () => {
      expect(stripRunNumber('chain-analysis#4')).toBe('chain-analysis');
      expect(stripRunNumber('chain-analysis')).toBe('chain-analysis');
    });

    it('is idempotent, so callers need not track whether an id was already stripped', () => {
      expect(stripRunNumber(stripRunNumber('chain-analysis#4'))).toBe('chain-analysis');
    });

    it('strips only the trailing suffix, not a hash inside the base id', () => {
      expect(stripRunNumber('chain-a#2-b#7')).toBe('chain-a#2-b');
    });

    it('leaves a non-numeric suffix in place — it is not a run counter', () => {
      expect(stripRunNumber('chain-analysis#latest')).toBe('chain-analysis#latest');
    });
  });

  describe('parseRunNumber', () => {
    it('reads the trailing run number', () => {
      expect(parseRunNumber('chain-analysis#4')).toBe(4);
      expect(parseRunNumber('chain-analysis#0')).toBe(0);
      expect(parseRunNumber('chain-analysis#12')).toBe(12);
    });

    it('returns undefined for a bare base id, an empty string, or a non-numeric suffix', () => {
      expect(parseRunNumber('chain-analysis')).toBeUndefined();
      expect(parseRunNumber('')).toBeUndefined();
      expect(parseRunNumber('chain-analysis#latest')).toBeUndefined();
    });

    it('has no sticky regex state across calls', () => {
      expect(parseRunNumber('chain-a#1')).toBe(1);
      expect(parseRunNumber('chain-a#1')).toBe(1);
    });
  });

  describe('formatChainId', () => {
    it('appends a run number to a base id', () => {
      expect(formatChainId('chain-analysis', 3)).toBe('chain-analysis#3');
    });

    it('replaces an existing suffix rather than stacking a second one', () => {
      expect(formatChainId('chain-analysis#2', 3)).toBe('chain-analysis#3');
    });

    it('round-trips through the parse half', () => {
      const id = formatChainId('chain-analysis', 7);
      expect(stripRunNumber(id)).toBe('chain-analysis');
      expect(parseRunNumber(id)).toBe(7);
    });
  });

  describe('nextRunNumber', () => {
    it('starts a chain with no history at run 1', () => {
      expect(nextRunNumber([])).toBe(1);
    });

    it('counts from the last entry, not the length, so a pruned history still advances', () => {
      // Runs 1 and 2 were evicted; length would collide with the live run 4.
      expect(nextRunNumber(['chain-a#3', 'chain-a#4'])).toBe(5);
    });

    it('falls back to length + 1 when the last entry carries no parseable suffix', () => {
      expect(nextRunNumber(['chain-a#1', 'chain-a'])).toBe(3);
      expect(nextRunNumber(['chain-a#1', ''])).toBe(3);
    });
  });

  describe('isChainId / CHAIN_ID_PATTERN', () => {
    it('accepts a base id with or without a run suffix', () => {
      expect(isChainId('chain-analysis-flow')).toBe(true);
      expect(isChainId('chain-analysis_flow#12')).toBe(true);
    });

    it('rejects a missing prefix, an empty slug, and a non-numeric suffix', () => {
      expect(isChainId('analysis-flow')).toBe(false);
      expect(isChainId('chain-')).toBe(false);
      expect(isChainId('chain-analysis#latest')).toBe(false);
    });

    it('rejects non-strings, which is what makes it usable as a type guard', () => {
      expect(isChainId(undefined)).toBe(false);
      expect(isChainId(42)).toBe(false);
    });

    it('is anchored, so it never matches a chain id embedded in a longer command', () => {
      expect(CHAIN_ID_PATTERN.test('>>run chain-analysis#1 now')).toBe(false);
    });

    it('accepts every id the format half can produce', () => {
      expect(isChainId(formatChainId('chain-analysis', nextRunNumber([])))).toBe(true);
    });
  });
});
