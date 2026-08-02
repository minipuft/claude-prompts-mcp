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
    const mgr = await createFrameworkStateStore(logger, tmpRoot, undefined, 'radiant');

    // Without the config wiring this reported the built-in CAGEERF fallback.
    const unseen = { workspaceId: 'workspace-with-no-persisted-framework' };
    expect(mgr.getCurrentState(unseen).activeFramework.toLowerCase()).toBe('radiant');

    await mgr.shutdown();
  });

  test('the configured default does not override a scope that already persisted a switch', async () => {
    const logger = createLogger();
    // tmpRoot still holds the 'react' row written by the restoration test above.
    const mgr = await createFrameworkStateStore(logger, tmpRoot, undefined, 'radiant');

    expect(mgr.getCurrentState().activeFramework.toLowerCase()).toBe('react');

    await mgr.shutdown();
  });
});
