// @lifecycle canonical - Unit tests for per-field gate body override (plan item 3.3, ADR 0001 (b))
import { describe, expect, it } from '@jest/globals';

import { mergeGateBody } from '../../../../src/engine/gates/services/gate-body-merge.js';

describe('mergeGateBody', () => {
  describe('scalars — declared replaces, omitted inherits', () => {
    it('replaces a declared scalar', () => {
      const merged = mergeGateBody(
        { description: 'registry text', severity: 'medium' },
        { description: 'prompt text' }
      );

      expect(merged['description']).toBe('prompt text');
    });

    it('inherits a scalar the override omits', () => {
      const merged = mergeGateBody(
        { description: 'registry text', severity: 'medium' },
        { description: 'prompt text' }
      );

      expect(merged['severity']).toBe('medium');
    });

    it('treats an explicit undefined as omitted', () => {
      const merged = mergeGateBody({ guidance: 'inherited' }, { guidance: undefined });

      expect(merged['guidance']).toBe('inherited');
    });

    it('treats an explicit null as declared, so a field can be cleared on purpose', () => {
      const merged = mergeGateBody({ guidance: 'inherited' }, { guidance: null });

      expect(merged['guidance']).toBeNull();
    });

    it('adds a field the base never had', () => {
      const merged = mergeGateBody({ description: 'base' }, { enforcementMode: 'blocking' });

      expect(merged['enforcementMode']).toBe('blocking');
      expect(merged['description']).toBe('base');
    });
  });

  describe('arrays — declared replaces the whole array, never appends', () => {
    // Appending would make narrowing impossible: an author wanting two of a registry gate's five
    // criteria could not express it and would silently get seven.

    it('replaces criteria rather than concatenating', () => {
      const merged = mergeGateBody(
        { criteria: ['one', 'two', 'three', 'four', 'five'] },
        { criteria: ['one', 'two'] }
      );

      expect(merged['criteria']).toEqual(['one', 'two']);
    });

    it('lets an author narrow to fewer criteria than the base had', () => {
      const merged = mergeGateBody({ pass_criteria: ['a', 'b', 'c'] }, { pass_criteria: ['b'] });

      expect(merged['pass_criteria']).toHaveLength(1);
    });

    it('replaces apply_to_steps rather than merging step numbers', () => {
      const merged = mergeGateBody({ apply_to_steps: [1, 2, 3] }, { apply_to_steps: [2] });

      expect(merged['apply_to_steps']).toEqual([2]);
    });

    it('inherits an array the override omits', () => {
      const merged = mergeGateBody({ criteria: ['kept'] }, { description: 'new' });

      expect(merged['criteria']).toEqual(['kept']);
    });

    it('allows an explicit empty array to clear the base array', () => {
      const merged = mergeGateBody({ criteria: ['one', 'two'] }, { criteria: [] });

      expect(merged['criteria']).toEqual([]);
    });
  });

  describe('objects — declared replaces the whole object, never key by key', () => {
    it('does not pair one source retry limit with the other backoff', () => {
      // Key-by-key merge here produces a retry_config neither source authored.
      const merged = mergeGateBody(
        { retry_config: { max_attempts: 5, backoff: 'exponential' } },
        { retry_config: { max_attempts: 1 } }
      );

      expect(merged['retry_config']).toEqual({ max_attempts: 1 });
      expect(merged['retry_config']).not.toHaveProperty('backoff');
    });

    it('replaces context wholesale', () => {
      const merged = mergeGateBody(
        { context: { origin: 'registry', extra: true } },
        { context: { origin: 'prompt' } }
      );

      expect(merged['context']).toEqual({ origin: 'prompt' });
    });

    it('inherits an object the override omits', () => {
      const merged = mergeGateBody(
        { retry_config: { max_attempts: 3 } },
        { description: 'changed' }
      );

      expect(merged['retry_config']).toEqual({ max_attempts: 3 });
    });
  });

  describe('purity', () => {
    it('does not mutate either input', () => {
      const base = { description: 'base', criteria: ['a'] };
      const override = { description: 'override' };

      mergeGateBody(base, override);

      expect(base).toEqual({ description: 'base', criteria: ['a'] });
      expect(override).toEqual({ description: 'override' });
    });

    it('returns the base unchanged for an empty override', () => {
      expect(mergeGateBody({ a: 1, b: 2 }, {})).toEqual({ a: 1, b: 2 });
    });
  });
});
