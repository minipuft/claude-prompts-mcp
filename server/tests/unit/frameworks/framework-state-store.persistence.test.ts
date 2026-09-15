import { afterAll, beforeAll, describe, expect, test, jest } from '@jest/globals';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createFrameworkStateStore } from '../../../src/engine/frameworks/framework-state-store.js';

import type { PersistedFrameworkState } from '../../../src/engine/frameworks/framework-state-store.js';
import type { SqliteStateStore } from '../../../src/infra/database/stores/sqlite-store.js';
import type { Logger } from '../../../src/infra/logging/index.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

describe('FrameworkStateStore (persistence)', () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-state-'));
    fs.mkdirSync(path.join(tmpRoot, 'runtime-state'), { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  test('writes and restores framework state across instances via SQLite', async () => {
    const logger = createLogger();
    const mgrA = await createFrameworkStateStore(logger, tmpRoot);

    await mgrA.enableFrameworkSystem('unit-enable');
    await mgrA.switchFramework({ targetFramework: 'react', reason: 'unit-switch' });

    const stateA = mgrA.getCurrentState();
    expect(stateA.frameworkSystemEnabled).toBe(true);
    expect(stateA.activeFramework.toLowerCase()).toBe('react');

    await mgrA.shutdown();

    // New instance should restore the same state from SQLite
    const mgrB = await createFrameworkStateStore(logger, tmpRoot);
    const stateB = mgrB.getCurrentState();
    expect(stateB.frameworkSystemEnabled).toBe(true);
    expect(stateB.activeFramework.toLowerCase()).toBe('react');

    await mgrB.shutdown();
  });

  // Uses an unseen scope rather than a fresh root: SqliteEngine is a process-wide singleton
  // with no reset, so a second temp root would silently reuse this suite's first database.
  test('a scope with no persisted row resolves to the configured default framework', async () => {
    const logger = createLogger();
    const mgr = await createFrameworkStateStore(logger, tmpRoot, { defaultFramework: 'radiant' });

    // Without the config wiring this reported the built-in CAGEERF fallback.
    const unseen = { workspaceId: 'workspace-with-no-persisted-framework' };
    expect(mgr.getCurrentState(unseen).activeFramework.toLowerCase()).toBe('radiant');

    await mgr.shutdown();
  });

  test('two project scopes switch independently', async () => {
    const logger = createLogger();
    const mgr = await createFrameworkStateStore(logger, tmpRoot, {
      defaultScope: { workspaceId: 'project-alpha' },
    });

    const beta = { workspaceId: 'project-beta' };
    await mgr.switchFramework({ targetFramework: 'react', reason: 'alpha' });
    await mgr.switchFramework({ targetFramework: 'cageerf', reason: 'beta' }, beta);

    // The unscoped read resolves to alpha — this process's own project.
    expect(mgr.getCurrentState().activeFramework.toLowerCase()).toBe('react');
    expect(mgr.getCurrentState(beta).activeFramework.toLowerCase()).toBe('cageerf');

    await mgr.shutdown();
  });

  test('a new project scope adopts the pre-scoping global row instead of resetting', async () => {
    const logger = createLogger();
    // The suite's first test wrote 'react' under the unscoped 'default' row, standing in
    // for state written before scope ids existed.
    const migrated = await createFrameworkStateStore(logger, tmpRoot, {
      defaultFramework: 'radiant',
      defaultScope: { workspaceId: 'project-upgrading' },
    });

    // Adopted from the legacy row, not reset to the configured 'radiant' default.
    expect(migrated.getCurrentState().activeFramework.toLowerCase()).toBe('react');

    await migrated.shutdown();
  });

  test('the configured default does not override a scope that already persisted a switch', async () => {
    const logger = createLogger();
    // tmpRoot still holds the 'react' row written by the restoration test above.
    const mgr = await createFrameworkStateStore(logger, tmpRoot, { defaultFramework: 'radiant' });

    expect(mgr.getCurrentState().activeFramework.toLowerCase()).toBe('react');

    await mgr.shutdown();
  });

  test('a persisted framework that is no longer registered falls back to the configured default', async () => {
    const logger = createLogger();
    const scope = { workspaceId: 'project-with-a-removed-framework' };
    // `switchFramework` on the store persists what it is told; validation belongs to the manager.
    const before = await createFrameworkStateStore(logger, tmpRoot, { defaultScope: scope });
    await before.switchFramework({ targetFramework: 'framework-that-was-removed' });
    await before.shutdown();

    const after = await createFrameworkStateStore(logger, tmpRoot, {
      defaultFramework: 'radiant',
      defaultScope: scope,
    });
    // Not the first framework available, which is what the recovery used to pick.
    expect(after.getCurrentState().activeFramework.toLowerCase()).toBe('radiant');
    expect(after.getActiveFramework().id.toLowerCase()).toBe('radiant');
    await after.shutdown();
  });

  test('removing the selected framework selects the configured default and persists it', async () => {
    const logger = createLogger();
    const scope = { workspaceId: 'project-removing-its-framework' };
    const options = { defaultFramework: 'radiant', defaultScope: scope };
    const store = await createFrameworkStateStore(logger, tmpRoot, options);
    await store.switchFramework({ targetFramework: 'react' });

    const removed = await store.getFrameworkManager()!.removeFramework('react');

    expect(removed).toBe(true);
    expect(store.getCurrentState().activeFramework.toLowerCase()).toBe('radiant');
    expect(store.getActiveFramework().id.toLowerCase()).toBe('radiant');
    await store.shutdown();

    const restarted = await createFrameworkStateStore(logger, tmpRoot, options);
    expect(restarted.getCurrentState().activeFramework.toLowerCase()).toBe('radiant');
    await restarted.shutdown();
  });

  test('a selection moved off a removed framework that fails to persist rejects', async () => {
    const logger = createLogger();
    let failSaves = false;
    const stateStore = {
      exists: async () => false,
      load: async () => undefined,
      save: async () => {
        if (failSaves) throw new Error('state database is read-only');
      },
    } as unknown as SqliteStateStore<PersistedFrameworkState>;
    const store = await createFrameworkStateStore(logger, tmpRoot, {
      defaultFramework: 'radiant',
      defaultScope: { workspaceId: 'project-with-a-read-only-database' },
      stateStore,
    });
    await store.switchFramework({ targetFramework: 'react' });

    failSaves = true;
    await expect(store.getFrameworkManager()!.removeFramework('react')).rejects.toThrow(
      'state database is read-only'
    );
  });
});
