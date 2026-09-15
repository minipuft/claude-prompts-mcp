import { describe, expect, test } from '@jest/globals';

import { isGateActiveForContext } from '../../../../src/engine/gates/utils/gate-activation.js';

describe('isGateActiveForContext — ruling A1: no activation block is opt-in', () => {
  test('undefined activation is inactive by default — a gate attaches only when named explicitly', () => {
    expect(isGateActiveForContext(undefined, { promptCategory: 'code' })).toBe(false);
    // No context restriction leaning on it either — still false with an empty context.
    expect(isGateActiveForContext(undefined, {})).toBe(false);
  });

  // Measured status quo, left unchanged by ruling A1: an explicit `activation: {}` block (as
  // opposed to no block at all) carries no category/framework/explicit_request rule, so both
  // `checkRegularGateActivation` and `checkFrameworkGateActivation` fall through every guard and
  // return true. Ruling A1 only changes the `undefined` branch above.
  test('an explicit empty activation object stays active — distinct from no block at all', () => {
    expect(isGateActiveForContext({}, { promptCategory: 'code' })).toBe(true);
    expect(isGateActiveForContext({}, {})).toBe(true);
    expect(isGateActiveForContext({}, { promptCategory: 'code' }, 'framework')).toBe(true);
  });
});
