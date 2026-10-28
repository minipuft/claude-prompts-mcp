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

/**
 * Ruling B13: a gate that names the artifacts it checks is decided by artifacts, and by nothing
 * else. The middle test is the one that fails if `isGateActiveForContext` falls through to the
 * category check after the artifact check — the whole point of the ruling is that naming an
 * artifact REPLACES the category guess rather than widening it.
 */
describe('isGateActiveForContext — ruling B13: artifacts decide when a gate names any', () => {
  const testGate = { artifacts: ['test' as const], prompt_categories: ['development'] };

  test('(a) the gate attaches when the run declares a kind it names', () => {
    expect(isGateActiveForContext(testGate, { artifacts: ['test'] })).toBe(true);
    // Intersection, not equality — one shared kind is enough.
    expect(isGateActiveForContext(testGate, { artifacts: ['source', 'test', 'docs'] })).toBe(true);
  });

  test('(b) categories are IGNORED when artifacts are named — the gate stays off', () => {
    expect(isGateActiveForContext(testGate, { promptCategory: 'development' })).toBe(false);
    expect(
      isGateActiveForContext(testGate, { promptCategory: 'development', artifacts: ['source'] })
    ).toBe(false);
    // An empty declaration is a declaration of nothing, not a wildcard.
    expect(isGateActiveForContext(testGate, { promptCategory: 'development', artifacts: [] })).toBe(
      false
    );
  });

  test('(c) a gate naming only categories keeps today behaviour byte for byte', () => {
    const categoryGate = { prompt_categories: ['development'] };
    expect(isGateActiveForContext(categoryGate, { promptCategory: 'development' })).toBe(true);
    expect(isGateActiveForContext(categoryGate, { promptCategory: 'analysis' })).toBe(false);
    // A run declaring artifacts does not disturb a category gate either way.
    expect(
      isGateActiveForContext(categoryGate, { promptCategory: 'development', artifacts: ['source'] })
    ).toBe(true);
    expect(
      isGateActiveForContext(categoryGate, { promptCategory: 'analysis', artifacts: ['source'] })
    ).toBe(false);
  });

  test('explicit_request still gates an artifact gate, and is checked first', () => {
    const gate = { artifacts: ['test' as const], explicit_request: true };
    expect(isGateActiveForContext(gate, { artifacts: ['test'] })).toBe(false);
    expect(isGateActiveForContext(gate, { artifacts: ['test'], explicitRequest: true })).toBe(true);
  });

  test('a framework gate naming artifacts requires BOTH — artifacts AND framework', () => {
    const gate = { artifacts: ['test' as const], framework_context: ['CAGEERF'] };
    expect(
      isGateActiveForContext(gate, { artifacts: ['test'], framework: 'CAGEERF' }, 'framework')
    ).toBe(true);
    expect(
      isGateActiveForContext(gate, { artifacts: ['test'], framework: 'ReACT' }, 'framework')
    ).toBe(false);
    expect(
      isGateActiveForContext(gate, { artifacts: ['docs'], framework: 'CAGEERF' }, 'framework')
    ).toBe(false);
    // Framework gates that name NO artifact are untouched by B13.
    expect(
      isGateActiveForContext(
        { framework_context: ['CAGEERF'] },
        { framework: 'CAGEERF' },
        'framework'
      )
    ).toBe(true);
  });
});

/**
 * A gate that declares `framework_context` requires a matching framework in the context, whatever
 * its gate_type. Reading an absent framework as "unconstrained" attached a RADIANT-only category
 * gate to a development run under ReACT.
 */
describe('isGateActiveForContext — declared framework_context requires a matching framework', () => {
  const categoryGate = { prompt_categories: ['development'], framework_context: ['RADIANT'] };

  test('a category gate declaring a framework does not activate with no framework in context', () => {
    expect(
      isGateActiveForContext(categoryGate, { promptCategory: 'development' }, 'category')
    ).toBe(false);
    expect(isGateActiveForContext(categoryGate, { promptCategory: 'development' })).toBe(false);
    expect(
      isGateActiveForContext(categoryGate, { promptCategory: 'development', framework: '' })
    ).toBe(false);
  });

  test('a category gate declaring a framework does not activate under a different framework', () => {
    expect(
      isGateActiveForContext(
        categoryGate,
        { promptCategory: 'development', framework: 'REACT' },
        'category'
      )
    ).toBe(false);
  });

  test('control: a category gate declaring a framework activates under that framework, any case', () => {
    expect(
      isGateActiveForContext(
        categoryGate,
        { promptCategory: 'development', framework: 'RADIANT' },
        'category'
      )
    ).toBe(true);
    expect(
      isGateActiveForContext(categoryGate, { promptCategory: 'development', framework: 'radiant' })
    ).toBe(true);
  });

  test('a gate declaring no framework stays unconstrained by framework', () => {
    const gate = { prompt_categories: ['development'] };
    expect(isGateActiveForContext(gate, { promptCategory: 'development' })).toBe(true);
    expect(
      isGateActiveForContext(gate, { promptCategory: 'development', framework: 'REACT' })
    ).toBe(true);
  });
});
