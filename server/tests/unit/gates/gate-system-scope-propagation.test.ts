import { describe, expect, jest, test } from '@jest/globals';

import { LightweightGateSystem } from '../../../src/engine/gates/core/index.js';

import type { StateStoreOptions } from '../../../src/shared/types/persistence.js';

/**
 * Tier 4.4 — scope propagation into GateStateStore.
 *
 * `LightweightGateSystem` reaches the gate store at two points that carry no request: the
 * enabled-check it makes before validating, and the metric it records after. Both store methods
 * accept `scope?: StateStoreOptions` and both were called with nothing, so gate enable/disable
 * state resolved to the default scope for every workspace and validation metrics from every
 * project pooled into one row.
 *
 * The plan's stated verification for this row — "`kv_state[key='gates']` gains >1 row" — cannot
 * distinguish broken code from nobody having toggled gates in a second workspace, so it is
 * substituted here: these cases observe the scope argument at the seam directly.
 *
 * Classification: Unit. The store is a spy because the assertion IS the argument it receives;
 * a real SQLite store would move the observation one layer away from the defect.
 */

const createLogger = () =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as any;

/** Captures the scope argument each store method is called with. */
const createSpyStore = () => {
  const enabledScopes: Array<StateStoreOptions | undefined> = [];
  const validationScopes: Array<StateStoreOptions | undefined> = [];

  return {
    enabledScopes,
    validationScopes,
    store: {
      isGateSystemEnabled: (scope?: StateStoreOptions) => {
        enabledScopes.push(scope);
        return true;
      },
      recordValidation: (_success: boolean, _ms: number, scope?: StateStoreOptions) => {
        validationScopes.push(scope);
      },
    } as any,
  };
};

const createGateSystem = () => {
  const gateLoader = {
    getGate: jest.fn().mockReturnValue(undefined),
    getAllGates: jest.fn().mockReturnValue([]),
  } as any;
  const gateValidator = {
    validateGates: jest
      .fn<() => Promise<Array<{ passed: boolean }>>>()
      .mockResolvedValue([{ passed: true }]),
  } as any;
  return new LightweightGateSystem(gateLoader, gateValidator);
};

describe('LightweightGateSystem scope propagation', () => {
  test('passes the configured workspace scope when reading gate-system state', async () => {
    const gateSystem = createGateSystem();
    const spy = createSpyStore();

    gateSystem.setGateStateStore(spy.store, { workspaceId: 'ws-alpha' });

    await gateSystem.validateContent(['some-gate'], 'content under review', {});

    expect(spy.enabledScopes.length).toBeGreaterThan(0);
    // Not `undefined`: reading unscoped is what made one workspace's gate toggle visible to all.
    expect(spy.enabledScopes[0]).toEqual({ workspaceId: 'ws-alpha' });
  });

  test('passes the configured workspace scope when recording validation metrics', async () => {
    const gateSystem = createGateSystem();
    const spy = createSpyStore();

    gateSystem.setGateStateStore(spy.store, { workspaceId: 'ws-beta' });

    await gateSystem.validateContent(['some-gate'], 'content under review', {});

    expect(spy.validationScopes.length).toBeGreaterThan(0);
    expect(spy.validationScopes[0]).toEqual({ workspaceId: 'ws-beta' });
  });

  test('omits scope when none is configured, rather than inventing one', async () => {
    const gateSystem = createGateSystem();
    const spy = createSpyStore();

    // The scope is optional the whole way down, so an unconfigured system must degrade to the
    // store's own default instead of fabricating a workspace id the caller never supplied.
    gateSystem.setGateStateStore(spy.store);

    await gateSystem.validateContent(['some-gate'], 'content under review', {});

    expect(spy.enabledScopes[0]).toBeUndefined();
    expect(spy.validationScopes[0]).toBeUndefined();
  });
});
