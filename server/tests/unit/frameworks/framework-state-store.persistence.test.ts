import { afterAll, beforeAll, describe, expect, test, jest } from '@jest/globals';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createFrameworkStateStore } from '../../../src/engine/frameworks/framework-state-store.js';

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
});
