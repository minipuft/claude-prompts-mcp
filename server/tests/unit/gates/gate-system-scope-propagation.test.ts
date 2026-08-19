import { describe, expect, jest, test } from '@jest/globals';

import { LightweightGateSystem } from '../../../src/engine/gates/core/index.js';

import type { StateStoreOptions } from '../../../src/shared/types/persistence.js';

/**
 * Tier 4.4 — scope propagation into GateStateStore.
 *
 * `LightweightGateSystem` reaches the gate store at a point that carries no request: the
 * enabled-check it makes before serving guidance. That method accepts `scope?: StateStoreOptions`
 * and was called with nothing, so gate enable/disable state resolved to the default scope for
 * every workspace.
 *
 * The plan's stated verification for this row — "`kv_state[key='gates']` gains >1 row" — cannot
 * distinguish broken code from nobody having toggled gates in a second workspace, so it is
 * substituted here: these cases observe the scope argument at the seam directly.
 *
 * **Reduced 2026-08-19.** There used to be a second seam, `recordValidation` after validating,
 * exercised through `validateContent`. Both that method and `GateValidator` behind it were
 * deleted as superseded — every criteria type is enforced by a pipeline stage instead — so the
 * metric had no producer to propagate scope from. The enabled-check is the seam that remains,
 * and it is reached through `getGuidanceText`.
 *
 * Classification: Unit. The store is a spy because the assertion IS the argument it receives;
 * a real SQLite store would move the observation one layer away from the defect.
 */

const createLogger = () =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as any;

/** Captures the scope argument each store method is called with. */
const createSpyStore = () => {
  const enabledScopes: Array<StateStoreOptions | undefined> = [];
  return {
    enabledScopes,
    store: {
      isGateSystemEnabled: (scope?: StateStoreOptions) => {
        enabledScopes.push(scope);
        return true;
      },
    } as any,
  };
};

const createGateSystem = () => {
  const gateLoader = {
    getGate: jest.fn().mockReturnValue(undefined),
    getAllGates: jest.fn().mockReturnValue([]),
    getActiveGates: jest
      .fn<() => Promise<{ guidanceText: string[] }>>()
      .mockResolvedValue({ guidanceText: [] }),
  } as any;
  return new LightweightGateSystem(gateLoader);
};

describe('LightweightGateSystem scope propagation', () => {
  test('passes the configured workspace scope when reading gate-system state', async () => {
    const gateSystem = createGateSystem();
    const spy = createSpyStore();

    gateSystem.setGateStateStore(spy.store, { workspaceId: 'ws-alpha' });

    await gateSystem.getGuidanceText(['some-gate'], {});

    expect(spy.enabledScopes.length).toBeGreaterThan(0);
    // Not `undefined`: reading unscoped is what made one workspace's gate toggle visible to all.
    expect(spy.enabledScopes[0]).toEqual({ workspaceId: 'ws-alpha' });
  });

  test('omits scope when none is configured, rather than inventing one', async () => {
    const gateSystem = createGateSystem();
    const spy = createSpyStore();

    // The scope is optional the whole way down, so an unconfigured system must degrade to the
    // store's own default instead of fabricating a workspace id the caller never supplied.
    gateSystem.setGateStateStore(spy.store);

    await gateSystem.getGuidanceText(['some-gate'], {});

    expect(spy.enabledScopes[0]).toBeUndefined();
  });
});
