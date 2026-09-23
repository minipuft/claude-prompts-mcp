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
    type Mode = 'blocking' | 'advisory' | 'informational';
    /** A step whose gates declare `modes`, one gate per entry, ids `g0`, `g1`, ... */
    const step = (modes: Array<Mode | undefined>, undeclared: Mode = 'blocking') => ({
      declared: new Map(modes.map((mode, index) => [`g${index}`, mode] as const)),
      undeclared,
    });
    const chain = (...modes: Array<Mode | undefined>) =>
      resolveEnforcementMode(undefined, step(modes));

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
      expect(resolveEnforcementMode(undefined, step([undefined], 'advisory'))).toBe('advisory');
    });

    test('a configured mode wins when no gate failed by name', () => {
      expect(resolveEnforcementMode('advisory', step(['blocking']))).toBe('advisory');
    });
  });

  describe('from the gates a verdict failed by name (R107)', () => {
    /** `g0` advisory, `g1` blocking, `g2` undeclared, `g3` informational — stage 11 says blocking. */
    const mixedStep = {
      declared: new Map<string, 'blocking' | 'advisory' | 'informational' | undefined>([
        ['g0', 'advisory'],
        ['g1', 'blocking'],
        ['g2', undefined],
        ['g3', 'informational'],
      ]),
      undeclared: 'blocking' as const,
    };
    const onFail = (failed: string[]) => resolveEnforcementMode('blocking', mixedStep, failed);

    test('only advisory or informational gates failed: the run advances', () => {
      expect(onFail(['g0'])).toBe('advisory');
      expect(onFail(['g3'])).toBe('informational');
      expect(onFail(['g3', 'g0'])).toBe('advisory');
    });

    test('any failed gate that holds decides, declared blocking or undeclared', () => {
      expect(onFail(['g0', 'g1'])).toBe('blocking');
      expect(onFail(['g2'])).toBe('blocking');
      expect(onFail(['g0', 'g2'])).toBe('blocking');
    });

    test('a failed gate outside the step set holds rather than advising', () => {
      expect(onFail(['not-on-this-step'])).toBe('blocking');
    });

    test('no failing-gate set falls back to the step: overall-only and legacy verdicts', () => {
      expect(onFail([])).toBe('blocking');
      expect(resolveEnforcementMode(undefined, mixedStep)).toBe('blocking');
    });
  });
});
