import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  GateStateStore,
  type PersistedGateSystemState,
} from '../../../src/engine/gates/gate-state-store.js';
import { SqliteEngine, SqliteStateStore } from '../../../src/infra/database/index.js';

import type { Logger } from '../../../src/infra/logging/index.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

function createStateStore(
  dbManager: SqliteEngine,
  logger: Logger
): SqliteStateStore<PersistedGateSystemState> {
  return new SqliteStateStore<PersistedGateSystemState>(
    dbManager,
    {
      tableName: 'kv_state',
      key: 'gates',
      defaultState: () => ({
        enabled: true,
        enabledAt: new Date().toISOString(),
        enableReason: 'System initialization (default enabled)',
        validationMetrics: {
          totalValidations: 0,
          successfulValidations: 0,
          averageValidationTime: 0,
          lastValidationTime: null,
        },
      }),
    },
    logger
  );
}

describe('GateStateStore (persistence)', () => {
  let tmpRoot: string;
  let dbManager: SqliteEngine;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-state-'));
    dbManager = await SqliteEngine.getInstance(tmpRoot, createLogger() as any);
    await dbManager.initialize();
  });

  afterAll(async () => {
    if (dbManager) {
      await dbManager.shutdown();
    }
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  test('writes and restores gate state across instances', async () => {
    const logger = createLogger();
    const storeA = createStateStore(dbManager, logger);
    const managerA = new GateStateStore(logger, storeA);
    await managerA.initialize();

    await managerA.disableGateSystem('unit-disable');

    const persisted = await storeA.load();
    expect(persisted.enabled).toBe(false);

    const storeB = createStateStore(dbManager, logger);
    const managerB = new GateStateStore(logger, storeB);
    await managerB.initialize();

    expect(managerB.getCurrentState().enabled).toBe(false);

    await managerA.cleanup();
    await managerB.cleanup();
  });

  test('isolates gate state and metrics by workspace scope key', async () => {
    const logger = createLogger();
    const store = createStateStore(dbManager, logger);
    const manager = new GateStateStore(logger, store);
    await manager.initialize();

    const defaultBefore = manager.getCurrentState();
    const ensureScopedEnabled = async (workspaceId: string, enabled: boolean): Promise<void> => {
      const initialEnabled = manager.getCurrentState({ workspaceId }).enabled;
      if (initialEnabled === enabled) {
        if (enabled) {
          await manager.disableGateSystem(`${workspaceId}-force-disable`, { workspaceId });
        } else {
          await manager.enableGateSystem(`${workspaceId}-force-enable`, { workspaceId });
        }
      }

      if (enabled) {
        await manager.enableGateSystem(`${workspaceId}-enable`, { workspaceId });
      } else {
        await manager.disableGateSystem(`${workspaceId}-disable`, { workspaceId });
      }
    };

    await ensureScopedEnabled('workspace-a', false);
    manager.recordValidation(true, 120, { workspaceId: 'workspace-a' });

    await ensureScopedEnabled('workspace-b', true);
    manager.recordValidation(false, 300, { workspaceId: 'workspace-b' });

    const workspaceAState = manager.getCurrentState({ workspaceId: 'workspace-a' });
    const workspaceBState = manager.getCurrentState({ workspaceId: 'workspace-b' });
    const defaultState = manager.getCurrentState();

    expect(workspaceAState.enabled).toBe(false);
    expect(workspaceAState.validationMetrics.totalValidations).toBe(1);
    expect(workspaceAState.validationMetrics.successfulValidations).toBe(1);

    expect(workspaceBState.enabled).toBe(true);
    expect(workspaceBState.validationMetrics.totalValidations).toBe(1);
    expect(workspaceBState.validationMetrics.successfulValidations).toBe(0);

    expect(defaultState.enabled).toBe(defaultBefore.enabled);
    expect(defaultState.validationMetrics.totalValidations).toBe(
      defaultBefore.validationMetrics.totalValidations
    );

    const healthA = manager.getSystemHealth({ workspaceId: 'workspace-a' });
    const healthB = manager.getSystemHealth({ workspaceId: 'workspace-b' });
    expect(healthA.totalValidations).toBe(1);
    expect(healthB.totalValidations).toBe(1);
    expect(healthA.averageValidationTime).toBe(120);
    expect(healthB.averageValidationTime).toBe(300);

    const persistedWorkspaceA = await store.load({ workspaceId: 'workspace-a' });
    const persistedWorkspaceB = await store.load({ workspaceId: 'workspace-b' });
    expect(persistedWorkspaceA.enabled).toBe(false);
    expect(persistedWorkspaceB.enabled).toBe(true);

    const rowA = dbManager.queryOne<{ tenant_id: string; workspace_id: string | null }>(
      `SELECT tenant_id, workspace_id FROM kv_state WHERE workspace_id = ? AND key = 'gates'`,
      ['workspace-a']
    );
    expect(rowA?.tenant_id).toBe('workspace-a');
    expect(rowA?.workspace_id).toBe('workspace-a');

    await manager.cleanup();
  });
});
