// @lifecycle canonical - Pins the enforcement-mode default extracted from the authority in Tier 15A.
import { describe, expect, test } from '@jest/globals';

import { resolveEnforcementMode } from '../../../../../src/engine/execution/pipeline/decisions/index.js';

/**
 * This decides whether a failing gate blocks the user or merely warns them, so the case
 * that matters is the unset one: an absent mode must land on 'blocking'. Defaulting the
 * other way would let a gate configuration that never reached an enhancement stage pass
 * silently.
 */
describe('resolveEnforcementMode', () => {
  test('returns the configured mode when one is set', () => {
    expect(resolveEnforcementMode('advisory')).toBe('advisory');
    expect(resolveEnforcementMode('informational')).toBe('informational');
    expect(resolveEnforcementMode('blocking')).toBe('blocking');
  });

  test('defaults to blocking when the mode is undefined', () => {
    expect(resolveEnforcementMode(undefined)).toBe('blocking');
  });

  test('defaults to blocking when called with no argument at all', () => {
    expect(resolveEnforcementMode()).toBe('blocking');
  });
});
