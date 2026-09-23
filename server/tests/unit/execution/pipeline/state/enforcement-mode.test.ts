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

  describe('from the applying gates (P4.137)', () => {
    const chain = (...declared: Array<'blocking' | 'advisory' | 'informational' | undefined>) =>
      resolveEnforcementMode(undefined, { declared, undeclared: 'blocking' });

    test('three twins: blocking, advisory, and no gate at all', () => {
      expect(chain('blocking')).toBe('blocking');
      expect(chain('advisory')).toBe('advisory');
      expect(chain()).toBe('blocking');
    });

    test('the strictest declared mode wins, in any order', () => {
      expect(chain('advisory', 'blocking')).toBe('blocking');
      expect(chain('blocking', 'advisory')).toBe('blocking');
      expect(chain('informational', 'advisory')).toBe('advisory');
      expect(chain('informational')).toBe('informational');
    });

    test('a gate that declares nothing counts as the caller default, never as advisory', () => {
      expect(chain(undefined)).toBe('blocking');
      expect(chain('advisory', undefined)).toBe('blocking');
      expect(
        resolveEnforcementMode(undefined, { declared: [undefined], undeclared: 'advisory' })
      ).toBe('advisory');
    });

    test('a configured mode still wins over the gates', () => {
      expect(
        resolveEnforcementMode('advisory', { declared: ['blocking'], undeclared: 'blocking' })
      ).toBe('advisory');
    });
  });
});
