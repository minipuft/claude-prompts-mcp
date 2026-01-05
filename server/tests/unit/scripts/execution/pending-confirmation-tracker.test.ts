// @lifecycle canonical - Unit tests for PendingConfirmationTracker.
/**
 * PendingConfirmationTracker Unit Tests
 *
 * Tests the "re-run to approve" workflow for script tools:
 * - Recording pending confirmations
 * - Auto-approving on re-run with matching inputs
 * - Expiration handling
 * - Input hash matching
 */

import {
  PendingConfirmationTracker,
  getDefaultPendingConfirmationTracker,
  resetDefaultPendingConfirmationTracker,
} from '../../../../src/scripts/execution/pending-confirmation-tracker.js';

describe('PendingConfirmationTracker', () => {
  let tracker: PendingConfirmationTracker;

  beforeEach(() => {
    tracker = new PendingConfirmationTracker({ debug: false });
  });

  afterEach(() => {
    resetDefaultPendingConfirmationTracker();
  });

  describe('recordPending', () => {
    it('should record a pending confirmation', () => {
      tracker.recordPending('test_prompt', 'tool1', { key: 'value' });

      expect(tracker.hasPending('test_prompt', 'tool1')).toBe(true);
      expect(tracker.size).toBe(1);
    });

    it('should overwrite existing pending for same prompt+tool', () => {
      tracker.recordPending('test_prompt', 'tool1', { key: 'value1' });
      tracker.recordPending('test_prompt', 'tool1', { key: 'value2' });

      expect(tracker.size).toBe(1);
    });

    it('should track multiple tools for same prompt', () => {
      tracker.recordPending('test_prompt', 'tool1', { key: 'value1' });
      tracker.recordPending('test_prompt', 'tool2', { key: 'value2' });

      expect(tracker.hasPending('test_prompt', 'tool1')).toBe(true);
      expect(tracker.hasPending('test_prompt', 'tool2')).toBe(true);
      expect(tracker.size).toBe(2);
    });
  });

  describe('checkAndClearPending', () => {
    it('should return true and clear pending for matching inputs', () => {
      const inputs = { name: 'test', value: 123 };
      tracker.recordPending('test_prompt', 'tool1', inputs);

      const result = tracker.checkAndClearPending('test_prompt', 'tool1', inputs);

      expect(result).toBe(true);
      expect(tracker.hasPending('test_prompt', 'tool1')).toBe(false);
    });

    it('should return false for non-existent pending', () => {
      const result = tracker.checkAndClearPending('test_prompt', 'tool1', {});

      expect(result).toBe(false);
    });

    it('should return false for mismatched inputs', () => {
      tracker.recordPending('test_prompt', 'tool1', { key: 'value1' });

      const result = tracker.checkAndClearPending('test_prompt', 'tool1', { key: 'different' });

      expect(result).toBe(false);
      // Should still be pending (not cleared because inputs didn't match)
      expect(tracker.hasPending('test_prompt', 'tool1')).toBe(true);
    });

    it('should match inputs regardless of key order', () => {
      const inputs1 = { a: 1, b: 2, c: 3 };
      const inputs2 = { c: 3, a: 1, b: 2 }; // Different order

      tracker.recordPending('test_prompt', 'tool1', inputs1);
      const result = tracker.checkAndClearPending('test_prompt', 'tool1', inputs2);

      expect(result).toBe(true);
    });

    it('should match nested objects with different key order', () => {
      const inputs1 = { outer: { a: 1, b: 2 } };
      const inputs2 = { outer: { b: 2, a: 1 } };

      tracker.recordPending('test_prompt', 'tool1', inputs1);
      const result = tracker.checkAndClearPending('test_prompt', 'tool1', inputs2);

      expect(result).toBe(true);
    });
  });

  describe('hasPending', () => {
    it('should return false for non-existent pending', () => {
      expect(tracker.hasPending('test_prompt', 'tool1')).toBe(false);
    });

    it('should return true for existing pending', () => {
      tracker.recordPending('test_prompt', 'tool1', {});
      expect(tracker.hasPending('test_prompt', 'tool1')).toBe(true);
    });
  });

  describe('expiration', () => {
    it('should return false for expired pending in checkAndClearPending', () => {
      // Create tracker with 1ms expiration for testing
      const shortTracker = new PendingConfirmationTracker({ expirationMs: 1 });
      shortTracker.recordPending('test_prompt', 'tool1', {});

      // Wait for expiration
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result = shortTracker.checkAndClearPending('test_prompt', 'tool1', {});
          expect(result).toBe(false);
          resolve();
        }, 10);
      });
    });

    it('should return false for expired pending in hasPending', () => {
      const shortTracker = new PendingConfirmationTracker({ expirationMs: 1 });
      shortTracker.recordPending('test_prompt', 'tool1', {});

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(shortTracker.hasPending('test_prompt', 'tool1')).toBe(false);
          resolve();
        }, 10);
      });
    });
  });

  describe('clear', () => {
    it('should clear all pending confirmations', () => {
      tracker.recordPending('prompt1', 'tool1', {});
      tracker.recordPending('prompt2', 'tool2', {});

      tracker.clear();

      expect(tracker.size).toBe(0);
      expect(tracker.hasPending('prompt1', 'tool1')).toBe(false);
      expect(tracker.hasPending('prompt2', 'tool2')).toBe(false);
    });
  });

  describe('default instance management', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = getDefaultPendingConfirmationTracker();
      const instance2 = getDefaultPendingConfirmationTracker();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getDefaultPendingConfirmationTracker();
      resetDefaultPendingConfirmationTracker();
      const instance2 = getDefaultPendingConfirmationTracker();

      expect(instance1).not.toBe(instance2);
    });
  });
});
